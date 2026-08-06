use std::{
    collections::HashSet,
    fs::{self, File},
    io::{BufReader, Read, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

use chrono::{Local, Utc};
use serde_json::{json, Value};
use sysinfo::System;
use tauri::State;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

use crate::{
    database::{self, AppState, NewLibraryItem, ProgressUpdate},
    engine_bridge,
    models::{
        AppSnapshot, BridgeStatus, EngineStatus, ExportReport, ImportReport, Job, JobSpec,
        StartJobsReport, SystemSnapshot, WorkflowOptions,
    },
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

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn kind_for(path: &Path) -> String {
    match extension(path).as_str() {
        "pdf" => "PDF",
        "doc" | "docx" | "odt" | "rtf" => "Documento",
        "xls" | "xlsx" | "csv" | "ods" => "Foglio",
        "ppt" | "pptx" | "odp" => "Presentazione",
        "mp3" | "m4a" | "wav" | "flac" | "aac" | "ogg" => "Audio",
        "mp4" | "mov" | "mkv" | "avi" | "webm" | "m4v" => "Video",
        "png" | "jpg" | "jpeg" | "tiff" | "tif" | "heic" | "webp" | "bmp" => "Immagine",
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

pub(crate) async fn bridge_status() -> BridgeStatus {
    let fallback = BridgeStatus {
        available: false,
        local_only: true,
        ready_engines: 0,
        total_engines: 0,
        batch_parallelism: 3,
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
        batch_parallelism: payload
            .get("batch_parallelism")
            .and_then(Value::as_u64)
            .unwrap_or(3)
            .clamp(1, 8) as usize,
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

fn resolve_tool(intent: &str) -> Result<&'static str, String> {
    match intent {
        "extract" => Ok("auto"),
        "translate" => Ok("pdf-translate"),
        "ocr" => Ok("paddleocr"),
        "transcribe" => Ok("faster-whisper"),
        "privacy" => Ok("privacy"),
        _ => Err("Azione non riconosciuta".to_string()),
    }
}

fn validate_workflow(
    items: &[crate::models::LibraryItem],
    options: &WorkflowOptions,
) -> Result<(), String> {
    let allowed_languages = [
        "auto", "en", "it", "es", "fr", "de", "pt", "nl", "pl", "ru", "uk", "ar", "zh-CN", "ja",
        "ko", "hi", "tr",
    ];
    if !allowed_languages.contains(&options.language.as_str())
        || !allowed_languages.contains(&options.source_language.as_str())
        || !allowed_languages.contains(&options.target_language.as_str())
    {
        return Err("Lingua non supportata".to_string());
    }
    let extensions: Vec<String> = items
        .iter()
        .map(|item| extension(Path::new(&item.path)))
        .collect();
    match options.intent.as_str() {
        "translate" => {
            if extensions.iter().any(|value| value != "pdf") {
                return Err("La traduzione con layout accetta soltanto PDF".to_string());
            }
            if options.source_language == "auto" || options.target_language == "auto" {
                return Err(
                    "Per la traduzione scegli esplicitamente lingua originale e lingua finale"
                        .to_string(),
                );
            }
            if options.source_language == options.target_language {
                return Err("Scegli due lingue diverse".to_string());
            }
            if !["translated", "bilingual"].contains(&options.translation_mode.as_str()) {
                return Err("Modalità di traduzione non supportata".to_string());
            }
        }
        "ocr" => {
            let supported = ["pdf", "png", "jpg", "jpeg", "webp", "tiff", "tif", "bmp"];
            if extensions
                .iter()
                .any(|value| !supported.contains(&value.as_str()))
            {
                return Err("L’OCR accetta PDF e immagini compatibili".to_string());
            }
            if !["markdown", "txt", "json"].contains(&options.output_format.as_str()) {
                return Err("Formato OCR non supportato".to_string());
            }
        }
        "transcribe" => {
            let supported = [
                "wav", "mp3", "m4a", "aac", "flac", "ogg", "mp4", "mov", "mkv", "webm", "avi",
                "m4v",
            ];
            if extensions
                .iter()
                .any(|value| !supported.contains(&value.as_str()))
            {
                return Err("La trascrizione accetta soltanto audio e video".to_string());
            }
            if !["txt", "srt", "json"].contains(&options.output_format.as_str()) {
                return Err("Formato di trascrizione non supportato".to_string());
            }
        }
        "privacy" => {
            let supported = ["txt", "md", "csv", "json", "html", "xml"];
            if extensions
                .iter()
                .any(|value| !supported.contains(&value.as_str()))
            {
                return Err("Privacy Shield accetta soltanto file testuali".to_string());
            }
            if !["txt", "json"].contains(&options.output_format.as_str()) {
                return Err("Formato Privacy Shield non supportato".to_string());
            }
        }
        "extract" => {
            if !["markdown", "txt"].contains(&options.output_format.as_str()) {
                return Err("Il percorso Auto può esportare Markdown o testo".to_string());
            }
        }
        _ => return Err("Azione non riconosciuta".to_string()),
    }
    Ok(())
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
pub async fn get_bridge_status() -> BridgeStatus {
    bridge_status().await
}

#[tauri::command]
pub async fn list_jobs(state: State<'_, AppState>) -> Result<Vec<Job>, String> {
    let database_path = state.database_path.clone();
    tauri::async_runtime::spawn_blocking(move || database::list_jobs(&database_path))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
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

#[tauri::command]
pub async fn start_jobs(
    item_ids: Vec<String>,
    options: WorkflowOptions,
    state: State<'_, AppState>,
) -> Result<StartJobsReport, String> {
    if item_ids.is_empty() {
        return Err("Seleziona almeno un elemento della libreria".to_string());
    }
    if item_ids.len() > 500 {
        return Err("Avvia al massimo 500 elementi per batch".to_string());
    }
    if !bridge_status().await.available {
        return Err("Avvia Local AI Desk per rendere disponibili i motori locali".to_string());
    }

    let database_path = state.database_path.clone();
    let ids_for_query = item_ids.clone();
    let items = tauri::async_runtime::spawn_blocking(move || {
        database::library_items_by_ids(&database_path, &ids_for_query)
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| format!("Elemento non trovato: {error}"))?;
    validate_workflow(&items, &options)?;
    let tool = resolve_tool(&options.intent)?.to_string();
    let batch_id = uuid::Uuid::new_v4().to_string();
    let specs: Vec<JobSpec> = items
        .into_iter()
        .map(|item| JobSpec {
            id: uuid::Uuid::new_v4().to_string(),
            batch_id: batch_id.clone(),
            item,
            options: options.clone(),
            tool: tool.clone(),
        })
        .collect();
    let specs_for_database = specs.clone();
    let database_path = state.database_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        database::insert_jobs(&database_path, &specs_for_database)
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())?;

    for spec in specs {
        let cancellation = Arc::new(AtomicBool::new(false));
        state
            .cancellations
            .lock()
            .map_err(|_| "Stato di cancellazione non disponibile".to_string())?
            .insert(spec.id.clone(), Arc::clone(&cancellation));
        engine_bridge::spawn_job(state.inner().clone(), spec, cancellation);
    }
    let current = snapshot(state.database_path.clone(), state.data_dir.clone()).await?;
    let job_ids = current
        .jobs
        .iter()
        .filter(|job| job.batch_id.as_deref() == Some(&batch_id))
        .map(|job| job.id.clone())
        .collect();
    Ok(StartJobsReport {
        batch_id,
        job_ids,
        snapshot: current,
    })
}

#[tauri::command]
pub async fn cancel_job(job_id: String, state: State<'_, AppState>) -> Result<bool, String> {
    let flag = state
        .cancellations
        .lock()
        .map_err(|_| "Stato di cancellazione non disponibile".to_string())?
        .get(&job_id)
        .cloned();
    let Some(flag) = flag else {
        return Ok(false);
    };
    flag.store(true, Ordering::Release);
    let database_path = state.database_path.clone();
    let job_for_update = job_id.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        database::update_job_progress(
            &database_path,
            &job_for_update,
            &ProgressUpdate {
                status: "cancelling",
                progress: 0.0,
                stage: "Interruzione in corso",
                stage_current: 0,
                stage_total: 0,
                part_index: 1,
                total_parts: 1,
                message: None,
            },
        )
    })
    .await;
    engine_bridge::request_remote_cancel(&job_id).await;
    Ok(true)
}

#[tauri::command]
pub async fn cancel_all_jobs(state: State<'_, AppState>) -> Result<usize, String> {
    let active: Vec<(String, Arc<AtomicBool>)> = state
        .cancellations
        .lock()
        .map_err(|_| "Stato di cancellazione non disponibile".to_string())?
        .iter()
        .map(|(id, flag)| (id.clone(), Arc::clone(flag)))
        .collect();
    for (_, flag) in &active {
        flag.store(true, Ordering::Release);
    }
    for (job_id, _) in &active {
        engine_bridge::request_remote_cancel(job_id).await;
    }
    Ok(active.len())
}

fn safe_archive_name(name: &str) -> String {
    let basename = Path::new(name)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("risultato.txt");
    basename
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '\0' => '-',
            other => other,
        })
        .collect()
}

fn create_results_zip(
    database_path: &Path,
    results_dir: &Path,
    downloads_dir: &Path,
    job_ids: &[String],
) -> Result<ExportReport, String> {
    let jobs = database::jobs_by_ids(database_path, job_ids).map_err(|error| error.to_string())?;
    if jobs.is_empty() {
        return Err("Non ci sono risultati completati da esportare".to_string());
    }
    if jobs
        .iter()
        .any(|job| job.status != "completed" || job.output_path.is_none())
    {
        return Err("Attendi che tutti i lavori del batch siano completati".to_string());
    }
    let completed: Vec<Job> = jobs;
    let canonical_results = results_dir
        .canonicalize()
        .map_err(|error| format!("Cartella risultati non disponibile: {error}"))?;
    fs::create_dir_all(downloads_dir).map_err(|error| error.to_string())?;
    let stamp = Local::now().format("%Y%m%d-%H%M%S");
    let filename = format!(
        "Local-AI-Desk-Risultati-{stamp}-{}.zip",
        &uuid::Uuid::new_v4().simple().to_string()[..6]
    );
    let destination = downloads_dir.join(&filename);
    let partial_destination = downloads_dir.join(format!(".{filename}.partial"));
    let archive_file = File::create(&partial_destination).map_err(|error| error.to_string())?;
    let mut archive = ZipWriter::new(archive_file);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Stored)
        .large_file(true)
        .unix_permissions(0o644);
    let mut used_names = HashSet::new();
    let mut manifest_items = Vec::new();

    let write_result = (|| -> Result<(), String> {
        for job in &completed {
            let path = PathBuf::from(job.output_path.as_deref().unwrap_or_default());
            let canonical = path
                .canonicalize()
                .map_err(|error| format!("Risultato non trovato: {error}"))?;
            if !canonical.starts_with(&canonical_results) || !canonical.is_file() {
                return Err(
                    "Un risultato non appartiene alla cartella protetta dell’app".to_string(),
                );
            }
            let base = safe_archive_name(job.output_name.as_deref().unwrap_or("risultato.txt"));
            let mut archive_name = base.clone();
            let mut suffix = 2;
            while !used_names.insert(archive_name.clone()) {
                archive_name = format!("{suffix}-{base}");
                suffix += 1;
            }
            archive
                .start_file(format!("risultati/{archive_name}"), options)
                .map_err(|error| error.to_string())?;
            let mut source = File::open(&canonical).map_err(|error| error.to_string())?;
            std::io::copy(&mut source, &mut archive).map_err(|error| error.to_string())?;
            manifest_items.push(json!({
                "input": job.input_name,
                "output": archive_name,
                "workflow": job.workflow,
                "engine": job.engine,
                "elapsed_seconds": job.elapsed_seconds,
            }));
        }

        archive
            .start_file("riepilogo.json", options)
            .map_err(|error| error.to_string())?;
        let manifest = serde_json::to_vec_pretty(&json!({
            "created_at": Utc::now().to_rfc3339(),
            "file_count": completed.len(),
            "items": manifest_items,
        }))
        .map_err(|error| error.to_string())?;
        archive
            .write_all(&manifest)
            .map_err(|error| error.to_string())?;
        archive.finish().map_err(|error| error.to_string())?;
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&partial_destination);
        return Err(error);
    }
    fs::rename(&partial_destination, &destination).map_err(|error| {
        let _ = fs::remove_file(&partial_destination);
        error.to_string()
    })?;
    Ok(ExportReport {
        path: destination.to_string_lossy().into_owned(),
        filename,
        file_count: completed.len(),
    })
}

fn reveal(path: &Path) -> Result<(), String> {
    Command::new("/usr/bin/open")
        .arg("-R")
        .arg(path)
        .spawn()
        .map_err(|error| format!("Finder non disponibile: {error}"))?;
    Ok(())
}

#[tauri::command]
pub async fn export_results(
    job_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<ExportReport, String> {
    let database_path = state.database_path.clone();
    let results_dir = state.results_dir.clone();
    let downloads_dir = state.downloads_dir.clone();
    let report = tauri::async_runtime::spawn_blocking(move || {
        create_results_zip(&database_path, &results_dir, &downloads_dir, &job_ids)
    })
    .await
    .map_err(|error| error.to_string())??;
    reveal(Path::new(&report.path))?;
    Ok(report)
}

#[tauri::command]
pub async fn reveal_job_result(job_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let database_path = state.database_path.clone();
    let results_dir = state.results_dir.clone();
    let job = tauri::async_runtime::spawn_blocking(move || {
        database::jobs_by_ids(&database_path, &[job_id])
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())?
    .into_iter()
    .next()
    .ok_or_else(|| "Lavoro non trovato".to_string())?;
    let output = PathBuf::from(
        job.output_path
            .ok_or_else(|| "Questo lavoro non ha ancora un risultato".to_string())?,
    );
    let canonical_results = results_dir
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let canonical_output = output.canonicalize().map_err(|error| error.to_string())?;
    if !canonical_output.starts_with(canonical_results) {
        return Err("Percorso risultato non valido".to_string());
    }
    reveal(&canonical_output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{LibraryItem, WorkflowOptions};

    #[test]
    fn exports_completed_batch_with_manifest_and_unique_names() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let database_path = temporary.path().join("zip.sqlite3");
        let results_dir = temporary.path().join("results");
        let downloads_dir = temporary.path().join("downloads");
        fs::create_dir_all(&results_dir).expect("results directory");
        database::initialize(&database_path).expect("schema");

        let options = WorkflowOptions::default();
        let specs: Vec<JobSpec> = ["job-a", "job-b"]
            .into_iter()
            .map(|id| JobSpec {
                id: id.to_string(),
                batch_id: "batch-zip".to_string(),
                item: LibraryItem {
                    id: format!("item-{id}"),
                    name: format!("{id}.md"),
                    path: format!("/tmp/{id}.md"),
                    kind: "Testo".to_string(),
                    size_bytes: 4,
                    content_hash: format!("hash-{id}"),
                    status: "ready".to_string(),
                    added_at: "2026-08-06T12:00:00Z".to_string(),
                    updated_at: "2026-08-06T12:00:00Z".to_string(),
                },
                options: options.clone(),
                tool: "auto".to_string(),
            })
            .collect();
        for spec in &specs {
            let item_path = spec.item.path.clone();
            database::insert_library_item(
                &database_path,
                &NewLibraryItem {
                    id: &spec.item.id,
                    name: &spec.item.name,
                    path: &item_path,
                    kind: &spec.item.kind,
                    size_bytes: spec.item.size_bytes,
                    content_hash: &spec.item.content_hash,
                    now: &spec.item.added_at,
                },
            )
            .expect("library item");
        }
        database::insert_jobs(&database_path, &specs).expect("jobs");
        for spec in &specs {
            let job_dir = results_dir.join(&spec.id);
            fs::create_dir_all(&job_dir).expect("job directory");
            let output_path = job_dir.join("risultato.md");
            fs::write(&output_path, format!("Risultato {}", spec.id)).expect("result");
            database::complete_job(
                &database_path,
                &spec.id,
                &database::CompletedJob {
                    output_path: &output_path.to_string_lossy(),
                    output_name: "risultato.md",
                    output_mime: "text/markdown",
                    engine: "test",
                    elapsed_seconds: 0.1,
                },
            )
            .expect("complete");
        }

        let report = create_results_zip(
            &database_path,
            &results_dir,
            &downloads_dir,
            &["job-a".to_string(), "job-b".to_string()],
        )
        .expect("archive");
        assert_eq!(report.file_count, 2);
        let archive_file = File::open(&report.path).expect("archive file");
        let mut archive = zip::ZipArchive::new(archive_file).expect("zip");
        assert!(archive.by_name("risultati/risultato.md").is_ok());
        assert!(archive.by_name("risultati/2-risultato.md").is_ok());
        let mut manifest = String::new();
        archive
            .by_name("riepilogo.json")
            .expect("manifest")
            .read_to_string(&mut manifest)
            .expect("manifest text");
        assert!(manifest.contains("\"file_count\": 2"));
    }
}
