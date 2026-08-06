use std::{
    fs::File,
    io::{BufReader, Read},
    path::{Path, PathBuf},
    time::Duration,
};

use chrono::Utc;
use serde_json::Value;
use sysinfo::System;
use tauri::State;

use crate::{
    database::{self, AppState, NewLibraryItem},
    models::{AppSnapshot, BridgeStatus, EngineStatus, ImportReport, SystemSnapshot},
};

fn hash_file(path: &Path) -> Result<String, String> {
    let file = File::open(path).map_err(|error| format!("lettura non riuscita: {error}"))?;
    let mut reader = BufReader::with_capacity(8 * 1024 * 1024, file);
    let mut hasher = blake3::Hasher::new();
    let mut buffer = vec![0_u8; 8 * 1024 * 1024];

    loop {
        let bytes = reader
            .read(&mut buffer)
            .map_err(|error| format!("lettura non riuscita: {error}"))?;
        if bytes == 0 {
            break;
        }
        hasher.update(&buffer[..bytes]);
    }

    Ok(hasher.finalize().to_hex().to_string())
}

fn kind_for(path: &Path) -> String {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "pdf" => "PDF",
        "doc" | "docx" | "odt" | "rtf" => "Documento",
        "xls" | "xlsx" | "csv" | "ods" => "Foglio",
        "ppt" | "pptx" | "odp" => "Presentazione",
        "mp3" | "m4a" | "wav" | "flac" | "aac" | "ogg" => "Audio",
        "mp4" | "mov" | "mkv" | "avi" | "webm" | "m4v" => "Video",
        "png" | "jpg" | "jpeg" | "tiff" | "tif" | "heic" | "webp" => "Immagine",
        "txt" | "md" | "json" | "xml" | "html" => "Testo",
        _ => "File",
    }
    .to_string()
}

fn system_snapshot(data_dir: &Path) -> SystemSnapshot {
    let mut system = System::new();
    system.refresh_memory();
    SystemSnapshot {
        architecture: std::env::consts::ARCH.to_string(),
        logical_cpus: std::thread::available_parallelism()
            .map(usize::from)
            .unwrap_or(1),
        total_memory_bytes: system.total_memory(),
        available_memory_bytes: system.available_memory(),
        data_directory: data_dir.to_string_lossy().into_owned(),
    }
}

async fn bridge_status() -> BridgeStatus {
    let fallback = BridgeStatus {
        available: false,
        local_only: true,
        ready_engines: 0,
        total_engines: 0,
        label: "Motori non avviati".to_string(),
        engines: Vec::new(),
    };

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_millis(900))
        .build()
    {
        Ok(client) => client,
        Err(_) => return fallback,
    };

    let response = match client.get("http://127.0.0.1:8787/api/status").send().await {
        Ok(response) if response.status().is_success() => response,
        _ => return fallback,
    };

    let payload: Value = match response.json().await {
        Ok(payload) => payload,
        Err(_) => return fallback,
    };

    let engines = payload.get("engines").and_then(Value::as_object);
    let total = engines.map_or(0, serde_json::Map::len);
    let ready = engines.map_or(0, |engines| {
        engines
            .values()
            .filter(|engine| engine.get("state").and_then(Value::as_str) == Some("ready"))
            .count()
    });
    let mut engine_statuses: Vec<EngineStatus> = engines
        .map(|engines| {
            engines
                .iter()
                .map(|(id, engine)| EngineStatus {
                    id: id.clone(),
                    state: engine
                        .get("state")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown")
                        .to_string(),
                    label: engine
                        .get("label")
                        .and_then(Value::as_str)
                        .unwrap_or("Stato sconosciuto")
                        .to_string(),
                    version: engine
                        .get("version")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                })
                .collect()
        })
        .unwrap_or_default();
    engine_statuses.sort_by(|left, right| left.id.cmp(&right.id));

    BridgeStatus {
        available: true,
        local_only: payload
            .get("local_only")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        ready_engines: ready,
        total_engines: total,
        label: if ready == total && total > 0 {
            format!("{ready} motori pronti")
        } else {
            format!("{ready}/{total} motori pronti")
        },
        engines: engine_statuses,
    }
}

async fn snapshot(database_path: PathBuf, data_dir: PathBuf) -> Result<AppSnapshot, String> {
    let database_for_query = database_path.clone();
    let records = tauri::async_runtime::spawn_blocking(move || {
        let library = database::list_library(&database_for_query)?;
        let jobs = database::list_jobs(&database_for_query)?;
        Ok::<_, rusqlite::Error>((library, jobs))
    })
    .await
    .map_err(|error| format!("Lettura interrotta: {error}"))?
    .map_err(|error| format!("Database non disponibile: {error}"))?;

    Ok(AppSnapshot {
        library: records.0,
        jobs: records.1,
        bridge: bridge_status().await,
        system: system_snapshot(&data_dir),
    })
}

#[tauri::command]
pub async fn bootstrap_snapshot(state: State<'_, AppState>) -> Result<AppSnapshot, String> {
    snapshot(state.database_path.clone(), state.data_dir.clone()).await
}

#[tauri::command]
pub async fn refresh_snapshot(state: State<'_, AppState>) -> Result<AppSnapshot, String> {
    snapshot(state.database_path.clone(), state.data_dir.clone()).await
}

#[tauri::command]
pub async fn import_files(
    paths: Vec<String>,
    state: State<'_, AppState>,
) -> Result<ImportReport, String> {
    if paths.is_empty() {
        return Err("Nessun file selezionato".to_string());
    }

    let database_path = state.database_path.clone();
    let data_dir = state.data_dir.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut imported = 0;
        let mut duplicates = 0;
        let mut rejected = Vec::new();

        for raw_path in paths {
            let requested = PathBuf::from(&raw_path);
            let canonical = match requested.canonicalize() {
                Ok(path) if path.is_file() => path,
                Ok(_) => {
                    rejected.push(format!("{raw_path}: non è un file"));
                    continue;
                }
                Err(error) => {
                    rejected.push(format!("{raw_path}: {error}"));
                    continue;
                }
            };

            let metadata = match canonical.metadata() {
                Ok(metadata) => metadata,
                Err(error) => {
                    rejected.push(format!("{raw_path}: {error}"));
                    continue;
                }
            };
            let name = canonical
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("File senza nome")
                .to_string();
            let content_hash = match hash_file(&canonical) {
                Ok(hash) => hash,
                Err(error) => {
                    rejected.push(format!("{name}: {error}"));
                    continue;
                }
            };
            let now = Utc::now().to_rfc3339();
            let id = uuid::Uuid::new_v4().to_string();
            let canonical_string = canonical.to_string_lossy().into_owned();
            let kind = kind_for(&canonical);
            let item = NewLibraryItem {
                id: &id,
                name: &name,
                path: &canonical_string,
                kind: &kind,
                size_bytes: metadata.len(),
                content_hash: &content_hash,
                now: &now,
            };

            match database::insert_library_item(&database_path, &item) {
                Ok(true) => imported += 1,
                Ok(false) => duplicates += 1,
                Err(error) => rejected.push(format!("{name}: {error}")),
            }
        }

        Ok::<_, String>((imported, duplicates, rejected))
    })
    .await
    .map_err(|error| format!("Importazione interrotta: {error}"))??;

    let current = snapshot(state.database_path.clone(), data_dir).await?;
    Ok(ImportReport {
        imported: result.0,
        duplicates: result.1,
        rejected: result.2,
        snapshot: current,
    })
}
