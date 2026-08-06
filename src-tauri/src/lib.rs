mod commands;
mod database;
mod models;

use std::fs;

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

            let database_path = data_dir.join("local-ai-desk.sqlite3");
            database::initialize(&database_path)
                .map_err(|error| format!("Impossibile inizializzare il database: {error}"))?;

            app.manage(AppState {
                database_path,
                data_dir,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap_snapshot,
            commands::import_files,
            commands::refresh_snapshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Local AI Desk");
}
