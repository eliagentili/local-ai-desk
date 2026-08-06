mod commands;
mod database;
mod engine_bridge;
mod models;

use std::{collections::HashMap, fs, sync::Arc};

use database::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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

            app.manage(AppState {
                database_path,
                data_dir,
                results_dir,
                downloads_dir,
                scheduler: Arc::new(tokio::sync::Semaphore::new(3)),
                cancellations: Arc::new(std::sync::Mutex::new(HashMap::new())),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap_snapshot,
            commands::import_files,
            commands::refresh_snapshot,
            commands::get_bridge_status,
            commands::list_jobs,
            commands::start_jobs,
            commands::cancel_job,
            commands::cancel_all_jobs,
            commands::export_results,
            commands::reveal_job_result,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Local AI Desk");
}
