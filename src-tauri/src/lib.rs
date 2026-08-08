mod commands;
mod database;
mod engine_bridge;
mod models;
mod process;

use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};

use database::AppState;
use tauri::Manager;

/// Ollama's conventional per-user model store.
///
/// An explicit `OLLAMA_MODELS` always wins: a user who moved their models to an
/// external disk has already made this decision, and overriding it would both
/// ignore them and waste the space again.
fn ollama_models_dir(home: &Path, explicit: Option<String>) -> PathBuf {
    match explicit {
        Some(path) if !path.trim().is_empty() => PathBuf::from(path),
        _ => home.join(".ollama").join("models"),
    }
}

/// Move a model store written by an earlier version into the shared location.
///
/// Without this, upgrading would leave several gigabytes stranded in the app
/// container and download them all over again.
fn migrate_legacy_model_store(legacy: &Path, shared: &Path) {
    if !legacy.join("blobs").is_dir() || shared.join("blobs").exists() {
        return;
    }
    if let Some(parent) = shared.parent() {
        let _ = fs::create_dir_all(parent);
    }
    // A rename across the same volume is instant; a failure just means the next
    // install re-pulls, which is wasteful but never wrong.
    let _ = fs::rename(legacy, shared);
}

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
        // Registered first, so a second launch never reaches `setup`. Two
        // instances would otherwise share one SQLite file, one engine port and
        // one set of engine processes, and each would try to clean up the
        // other's runtime as if it were an orphan.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
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

            let engine_data_dir = data_dir.join("engine");
            let home_dir = app.path().home_dir().unwrap_or_else(|_| data_dir.clone());
            let ollama_models_dir =
                ollama_models_dir(&home_dir, std::env::var("OLLAMA_MODELS").ok());
            migrate_legacy_model_store(
                &engine_data_dir.join("models").join("ollama"),
                &ollama_models_dir,
            );

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
                engine_data_dir,
                ollama_models_dir,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn models_live_where_ollama_itself_would_put_them() {
        let home = Path::new("/Users/prova");
        assert_eq!(
            ollama_models_dir(home, None),
            Path::new("/Users/prova/.ollama/models"),
        );
        // A user who moved their models to an external disk already decided
        // this; overriding would ignore them and spend the space again.
        assert_eq!(
            ollama_models_dir(home, Some("/Volumi/Esterno/models".to_string())),
            Path::new("/Volumi/Esterno/models"),
        );
        assert_eq!(
            ollama_models_dir(home, Some("   ".to_string())),
            Path::new("/Users/prova/.ollama/models"),
            "an empty override is not a choice",
        );
    }

    #[test]
    fn an_earlier_private_store_is_moved_instead_of_downloaded_again() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let legacy = temporary.path().join("engine/models/ollama");
        let shared = temporary.path().join("home/.ollama/models");
        fs::create_dir_all(legacy.join("blobs")).expect("legacy store");
        fs::write(legacy.join("blobs/sha256-abc"), b"pesi").expect("blob");

        migrate_legacy_model_store(&legacy, &shared);

        assert!(
            shared.join("blobs/sha256-abc").is_file(),
            "models are reused"
        );
        assert!(
            !legacy.exists(),
            "nothing is left behind to confuse the next run"
        );
    }

    #[test]
    fn an_existing_shared_store_is_never_overwritten() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let legacy = temporary.path().join("engine/models/ollama");
        let shared = temporary.path().join("home/.ollama/models");
        fs::create_dir_all(legacy.join("blobs")).expect("legacy store");
        fs::create_dir_all(shared.join("blobs")).expect("shared store");
        fs::write(shared.join("blobs/sha256-mine"), b"i miei modelli").expect("blob");

        migrate_legacy_model_store(&legacy, &shared);

        assert!(
            shared.join("blobs/sha256-mine").is_file(),
            "the user's own models are untouched",
        );
        assert!(legacy.exists(), "and ours are not silently discarded");
    }

    #[test]
    fn only_partial_results_are_swept_from_the_results_folder() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let results = temporary.path();
        let finished = results.join("job-completo");
        let interrupted = results.join("job-interrotto");
        fs::create_dir_all(&finished).expect("job dir");
        fs::create_dir_all(&interrupted).expect("job dir");
        fs::write(finished.join("risultato.md"), b"esito").expect("result");
        fs::write(interrupted.join(".abc123.partial"), b"a meta").expect("partial");

        sweep_partial_results(results);

        assert!(
            finished.join("risultato.md").is_file(),
            "a real result survives"
        );
        assert!(!interrupted.exists(), "an empty job folder is cleared away");
    }
}
