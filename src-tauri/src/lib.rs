mod commands;
mod database;
mod engine_bridge;
mod models;
mod process;

use std::{collections::HashMap, fs, path::Path, sync::Arc};

use database::AppState;
use tauri::Manager;

/// A `.partial` file is a result that was being streamed when the app stopped.
/// It is never a finished output, so removing it at launch keeps the results
/// folder free of debris without ever touching a real result.
fn sweep_partial_results(results_dir: &Path) {
    let Ok(entries) = fs::read_dir(results_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let job_dir = entry.path();
        if !job_dir.is_dir() {
            continue;
        }
        let Ok(files) = fs::read_dir(&job_dir) else {
            continue;
        };
        for file in files.flatten() {
            let name = file.file_name();
            let name = name.to_string_lossy();
            if name.starts_with('.') && name.ends_with(".partial") {
                let _ = fs::remove_file(file.path());
            }
        }
        // Only succeeds when nothing else is left, so finished results survive.
        let _ = fs::remove_dir(&job_dir);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let application = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| format!("Impossibile trovare la cartella dati: {error}"))?;
            fs::create_dir_all(&data_dir)?;
            let results_dir = data_dir.join("results");
            fs::create_dir_all(&results_dir)?;
            let downloads_dir = app
                .path()
                .download_dir()
                .unwrap_or_else(|_| data_dir.join("exports"));
            fs::create_dir_all(&downloads_dir)?;

            let database_path = data_dir.join("local-ai-desk.sqlite3");
            database::initialize(&database_path)
                .map_err(|error| format!("Impossibile inizializzare il database: {error}"))?;
            sweep_partial_results(&results_dir);

            let resource_dir = app
                .path()
                .resource_dir()
                .map_err(|error| format!("Risorse dell’app non disponibili: {error}"))?;
            let state = AppState {
                database_path,
                data_dir: data_dir.clone(),
                results_dir,
                downloads_dir,
                engine_resource_dir: resource_dir.join("engine"),
                engine_data_dir: data_dir.join("engine"),
                runtime_process: Arc::new(std::sync::Mutex::new(None)),
                ollama_process: Arc::new(std::sync::Mutex::new(None)),
                installer_process: Arc::new(std::sync::Mutex::new(None)),
                last_install_result: Arc::new(std::sync::Mutex::new(None)),
                scheduler: Arc::new(tokio::sync::Semaphore::new(3)),
                cancellations: Arc::new(std::sync::Mutex::new(HashMap::new())),
            };
            commands::try_start_installed_runtime(&state);
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap_snapshot,
            commands::import_files,
            commands::inspect_quick_files,
            commands::remove_library_item,
            commands::refresh_snapshot,
            commands::get_bridge_status,
            commands::get_runtime_status,
            commands::install_engine_runtime,
            commands::start_engine_runtime,
            commands::stop_engine_runtime,
            commands::list_jobs,
            commands::start_jobs,
            commands::retry_job,
            commands::cancel_job,
            commands::cancel_all_jobs,
            commands::export_results,
            commands::reveal_job_result,
            commands::reveal_path,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Local AI Desk");

    application.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            // Terminating the whole process group — not just the direct child —
            // is what stops the engine runtime from leaving translation workers
            // and model servers running after the window closes.
            commands::stop_engine_processes(&app_handle.state::<AppState>());
        }
    });
}
