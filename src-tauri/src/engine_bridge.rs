use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use futures_util::{StreamExt, TryStreamExt};
use reqwest::{header, Client, Response, Url};
use serde::Deserialize;
use serde_json::Value;
use tokio::{
    fs::{self, File},
    io::AsyncWriteExt,
    time::sleep,
};
use tokio_util::io::ReaderStream;

use crate::{
    database::{self, AppState, CompletedJob, ProgressUpdate},
    models::JobSpec,
};

const LEGACY_BASE: &str = "http://127.0.0.1:8787";

#[derive(Debug)]
enum RunError {
    Cancelled,
    Message(String),
}

#[derive(Debug)]
struct OwnedProgress {
    status: String,
    progress: f64,
    stage: String,
    stage_current: u64,
    stage_total: u64,
    part_index: u32,
    total_parts: u32,
    message: Option<String>,
}

impl OwnedProgress {
    fn stage(status: &str, progress: f64, stage: &str) -> Self {
        Self {
            status: status.to_string(),
            progress,
            stage: stage.to_string(),
            stage_current: 0,
            stage_total: 0,
            part_index: 1,
            total_parts: 1,
            message: None,
        }
    }
}

impl From<std::io::Error> for RunError {
    fn from(error: std::io::Error) -> Self {
        Self::Message(error.to_string())
    }
}

impl From<reqwest::Error> for RunError {
    fn from(error: reqwest::Error) -> Self {
        Self::Message(error.to_string())
    }
}

#[derive(Debug, Deserialize)]
struct LegacyTextResult {
    output: Option<String>,
    format: String,
    filename: String,
    engine: String,
    elapsed_seconds: f64,
}

fn is_cancelled(flag: &AtomicBool) -> bool {
    flag.load(Ordering::Acquire)
}

async fn persist_progress(
    database_path: PathBuf,
    job_id: String,
    update: OwnedProgress,
) -> Result<(), RunError> {
    tauri::async_runtime::spawn_blocking(move || {
        database::update_job_progress(
            &database_path,
            &job_id,
            &ProgressUpdate {
                status: &update.status,
                progress: update.progress,
                stage: &update.stage,
                stage_current: update.stage_current,
                stage_total: update.stage_total,
                part_index: update.part_index,
                total_parts: update.total_parts,
                message: update.message.as_deref(),
            },
        )
    })
    .await
    .map_err(|error| RunError::Message(error.to_string()))?
    .map_err(|error| RunError::Message(error.to_string()))
}

async fn mark_cancelled(state: &AppState, job_id: &str) {
    let _ = persist_progress(
        state.database_path.clone(),
        job_id.to_string(),
        OwnedProgress {
            message: Some("Lavoro annullato dall’utente.".to_string()),
            ..OwnedProgress::stage("cancelled", 0.0, "Annullato")
        },
    )
    .await;
}

async fn mark_failed(state: &AppState, job_id: &str, message: String) {
    let _ = persist_progress(
        state.database_path.clone(),
        job_id.to_string(),
        OwnedProgress {
            message: Some(message),
            ..OwnedProgress::stage("failed", 0.0, "Elaborazione non riuscita")
        },
    )
    .await;
}

async fn cancel_remote(client: &Client, job_id: &str) {
    let _ = client
        .post(format!("{LEGACY_BASE}/api/jobs/{job_id}/cancel"))
        .timeout(Duration::from_secs(2))
        .send()
        .await;
}

fn output_extension(format: &str) -> &str {
    match format {
        "markdown" => "md",
        "json" => "json",
        "srt" => "srt",
        "pdf" => "pdf",
        _ => "txt",
    }
}

fn output_mime(format: &str) -> &str {
    match format {
        "markdown" => "text/markdown",
        "json" => "application/json",
        "srt" => "application/x-subrip",
        "pdf" => "application/pdf",
        _ => "text/plain",
    }
}

fn safe_filename(name: &str, fallback: &str) -> String {
    let basename = Path::new(name)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(fallback);
    let cleaned: String = basename
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '\0' => '-',
            other => other,
        })
        .collect();
    let trimmed = cleaned.trim_matches([' ', '.']);
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn translation_fallback_name(spec: &JobSpec) -> String {
    let stem = Path::new(&spec.item.name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("documento");
    let suffix = if spec.options.translation_mode == "bilingual" {
        "bilingue"
    } else {
        "tradotto"
    };
    format!("{stem}.{}.{}.pdf", spec.options.target_language, suffix)
}

fn response_filename(response: &Response, fallback: &str) -> String {
    let Some(value) = response
        .headers()
        .get(header::CONTENT_DISPOSITION)
        .and_then(|value| value.to_str().ok())
    else {
        return fallback.to_string();
    };
    let parsed = value
        .split(';')
        .map(str::trim)
        .find_map(|part| {
            part.strip_prefix("filename=")
                .map(|name| name.trim_matches('"'))
        })
        .unwrap_or(fallback);
    safe_filename(parsed, fallback)
}

fn build_url(spec: &JobSpec) -> Result<Url, RunError> {
    let translation = spec.tool == "pdf-translate";
    let endpoint = if translation {
        format!("{LEGACY_BASE}/api/translate-pdf")
    } else {
        format!("{LEGACY_BASE}/api/process-file")
    };
    let mut url = Url::parse(&endpoint).map_err(|error| RunError::Message(error.to_string()))?;
    if translation {
        url.query_pairs_mut()
            .append_pair("source_language", &spec.options.source_language)
            .append_pair("target_language", &spec.options.target_language)
            .append_pair("mode", &spec.options.translation_mode)
            .append_pair("filename", &spec.item.name)
            .append_pair("job_id", &spec.id);
    } else {
        url.query_pairs_mut()
            .append_pair("tool", &spec.tool)
            .append_pair("output_format", &spec.options.output_format)
            .append_pair("language", &spec.options.language)
            .append_pair("filename", &spec.item.name)
            .append_pair("job_id", &spec.id);
    }
    Ok(url)
}

async fn poll_translation_progress(
    client: &Client,
    job_id: &str,
) -> Option<(String, f64, String, u64, u64, u32, u32)> {
    let response = client
        .get(format!("{LEGACY_BASE}/api/jobs/{job_id}/status"))
        .timeout(Duration::from_secs(2))
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let payload: Value = response.json().await.ok()?;
    let remote_state = payload
        .get("state")
        .and_then(Value::as_str)
        .unwrap_or("running");
    let status = match remote_state {
        "queued" => "preparing",
        "uploading" => "uploading",
        "preparing" => "preparing",
        "completed" => "finalizing",
        "cancelling" => "cancelling",
        "cancelled" => "cancelled",
        "error" => "failed",
        _ => "running",
    }
    .to_string();
    let progress = payload
        .get("progress")
        .and_then(Value::as_f64)
        .unwrap_or(10.0);
    let stage = payload
        .get("stage_label")
        .and_then(Value::as_str)
        .unwrap_or("Traduzione locale")
        .to_string();
    let current = payload
        .get("stage_current")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let total = payload
        .get("stage_total")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let part_index = payload
        .get("part_index")
        .and_then(Value::as_u64)
        .unwrap_or(1) as u32;
    let total_parts = payload
        .get("total_parts")
        .and_then(Value::as_u64)
        .unwrap_or(1) as u32;
    Some((
        status,
        progress,
        stage,
        current,
        total,
        part_index,
        total_parts,
    ))
}

async fn write_translation_result(
    response: Response,
    state: &AppState,
    spec: &JobSpec,
    cancel: &AtomicBool,
) -> Result<(PathBuf, String, String, String, f64), RunError> {
    let fallback = translation_fallback_name(spec);
    let output_name = response_filename(&response, &fallback);
    let mime = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/pdf")
        .to_string();
    let engine = response
        .headers()
        .get("x-local-engine")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("PDFMathTranslate 2 + TranslateGemma")
        .to_string();
    let elapsed = response
        .headers()
        .get("x-elapsed-seconds")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<f64>().ok())
        .unwrap_or(0.0);

    let job_dir = state.results_dir.join(&spec.id);
    fs::create_dir_all(&job_dir).await?;
    let output_path = job_dir.join(&output_name);
    let partial_path = job_dir.join(format!(".{output_name}.partial"));
    let mut destination = File::create(&partial_path).await?;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if is_cancelled(cancel) {
            let _ = fs::remove_file(&partial_path).await;
            return Err(RunError::Cancelled);
        }
        destination.write_all(&chunk?).await?;
    }
    destination.flush().await?;
    drop(destination);
    fs::rename(&partial_path, &output_path).await?;
    Ok((output_path, output_name, mime, engine, elapsed))
}

async fn write_text_result(
    response: Response,
    state: &AppState,
    spec: &JobSpec,
) -> Result<(PathBuf, String, String, String, f64), RunError> {
    let status = response.status();
    let raw = response
        .text()
        .await
        .map_err(|error| RunError::Message(error.to_string()))?;
    if !status.is_success() {
        let detail = serde_json::from_str::<Value>(&raw)
            .ok()
            .and_then(|payload| {
                payload
                    .get("detail")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or(raw);
        return Err(if status.as_u16() == 499 {
            RunError::Cancelled
        } else {
            RunError::Message(detail)
        });
    }
    let payload: LegacyTextResult =
        serde_json::from_str(&raw).map_err(|error| RunError::Message(error.to_string()))?;
    let fallback = format!(
        "{}.{}",
        Path::new(&spec.item.name)
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("risultato"),
        output_extension(&payload.format)
    );
    let output_name = safe_filename(&payload.filename, &fallback);
    let job_dir = state.results_dir.join(&spec.id);
    fs::create_dir_all(&job_dir).await?;
    let output_path = job_dir.join(&output_name);
    fs::write(&output_path, payload.output.unwrap_or_default()).await?;
    Ok((
        output_path,
        output_name,
        output_mime(&payload.format).to_string(),
        payload.engine,
        payload.elapsed_seconds,
    ))
}

async fn execute_inner(
    state: &AppState,
    spec: &JobSpec,
    cancel: &Arc<AtomicBool>,
) -> Result<(), RunError> {
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(2))
        .build()?;

    persist_progress(
        state.database_path.clone(),
        spec.id.clone(),
        OwnedProgress::stage("preparing", 1.0, "Attesa delle risorse locali"),
    )
    .await?;

    let permit = loop {
        if is_cancelled(cancel) {
            return Err(RunError::Cancelled);
        }
        match state.scheduler.clone().try_acquire_owned() {
            Ok(permit) => break permit,
            Err(tokio::sync::TryAcquireError::NoPermits) => sleep(Duration::from_millis(200)).await,
            Err(error) => return Err(RunError::Message(error.to_string())),
        }
    };

    if is_cancelled(cancel) {
        return Err(RunError::Cancelled);
    }
    let health = client
        .get(format!("{LEGACY_BASE}/api/health"))
        .timeout(Duration::from_secs(2))
        .send()
        .await
        .map_err(|_| {
            RunError::Message(
                "I motori locali non sono avviati. Apri Local AI Desk prima di riprovare."
                    .to_string(),
            )
        })?;
    if !health.status().is_success() {
        return Err(RunError::Message(
            "Il ponte verso i motori non risponde.".to_string(),
        ));
    }

    let source = File::open(&spec.item.path).await.map_err(|error| {
        RunError::Message(format!("Il file originale non è più disponibile: {error}"))
    })?;
    let total_bytes = source.metadata().await?.len();
    let uploaded = Arc::new(AtomicU64::new(0));
    let uploaded_for_stream = Arc::clone(&uploaded);
    let stream = ReaderStream::with_capacity(source, 1024 * 1024).inspect_ok(move |chunk| {
        uploaded_for_stream.fetch_add(chunk.len() as u64, Ordering::Release);
    });
    let body = reqwest::Body::wrap_stream(stream);
    let url = build_url(spec)?;
    let mut request = Box::pin(
        client
            .post(url)
            .header(header::CONTENT_LENGTH, total_bytes)
            .body(body)
            .send(),
    );
    let translation = spec.tool == "pdf-translate";
    let mut last_signature = String::new();
    let started = Instant::now();

    let response = loop {
        tokio::select! {
            result = &mut request => break result?,
            _ = sleep(Duration::from_millis(450)) => {
                if is_cancelled(cancel) {
                    let _ = persist_progress(
                        state.database_path.clone(), spec.id.clone(),
                        OwnedProgress::stage("cancelling", 0.0, "Interruzione del motore"),
                    ).await;
                    cancel_remote(&client, &spec.id).await;
                    drop(permit);
                    return Err(RunError::Cancelled);
                }

                let sent = uploaded.load(Ordering::Acquire).min(total_bytes);
                if total_bytes > 0 && sent < total_bytes {
                    let ratio = sent as f64 / total_bytes as f64;
                    let progress = if translation { 0.5 + ratio * 3.0 } else { 1.0 + ratio * 7.0 };
                    let signature = format!("upload-{:.0}", ratio * 100.0);
                    if signature != last_signature {
                        last_signature = signature;
                        persist_progress(
                            state.database_path.clone(), spec.id.clone(),
                            OwnedProgress {
                                stage_current: sent,
                                stage_total: total_bytes,
                                ..OwnedProgress::stage(
                                    "uploading",
                                    progress,
                                    "Trasferimento al motore locale",
                                )
                            },
                        ).await?;
                    }
                } else if translation {
                    if let Some((status, progress, stage, current, total, part, parts)) =
                        poll_translation_progress(&client, &spec.id).await
                    {
                        let signature = format!("{status}-{progress:.1}-{stage}-{current}-{part}");
                        if signature != last_signature {
                            last_signature = signature;
                            persist_progress(
                                state.database_path.clone(), spec.id.clone(),
                                OwnedProgress {
                                    status,
                                    progress,
                                    stage,
                                    stage_current: current,
                                    stage_total: total,
                                    part_index: part,
                                    total_parts: parts,
                                    message: None,
                                },
                            ).await?;
                        }
                    }
                } else if last_signature != "processing" {
                    last_signature = "processing".to_string();
                    persist_progress(
                        state.database_path.clone(), spec.id.clone(),
                        OwnedProgress::stage(
                            "running",
                            10.0,
                            "Elaborazione nel motore locale",
                        ),
                    ).await?;
                }
            }
        }
    };

    if is_cancelled(cancel) {
        cancel_remote(&client, &spec.id).await;
        return Err(RunError::Cancelled);
    }
    if !response.status().is_success() {
        let status = response.status();
        let raw = response.text().await.unwrap_or_default();
        let detail = serde_json::from_str::<Value>(&raw)
            .ok()
            .and_then(|payload| {
                payload
                    .get("detail")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or(raw);
        return Err(if status.as_u16() == 499 {
            RunError::Cancelled
        } else {
            RunError::Message(if detail.is_empty() {
                format!("Il motore ha restituito HTTP {status}")
            } else {
                detail
            })
        });
    }

    persist_progress(
        state.database_path.clone(),
        spec.id.clone(),
        OwnedProgress::stage("finalizing", 99.0, "Salvataggio atomico del risultato"),
    )
    .await?;

    let (output_path, output_name, mime, engine, remote_elapsed) = if translation {
        write_translation_result(response, state, spec, cancel).await?
    } else {
        write_text_result(response, state, spec).await?
    };
    let elapsed = if remote_elapsed > 0.0 {
        remote_elapsed
    } else {
        started.elapsed().as_secs_f64()
    };
    let path_string = output_path.to_string_lossy().into_owned();
    let database_path = state.database_path.clone();
    let job_id = spec.id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        database::complete_job(
            &database_path,
            &job_id,
            &CompletedJob {
                output_path: &path_string,
                output_name: &output_name,
                output_mime: &mime,
                engine: &engine,
                elapsed_seconds: elapsed,
            },
        )
    })
    .await
    .map_err(|error| RunError::Message(error.to_string()))?
    .map_err(|error| RunError::Message(error.to_string()))?;
    drop(permit);
    Ok(())
}

pub fn spawn_job(state: AppState, spec: JobSpec, cancel: Arc<AtomicBool>) {
    tauri::async_runtime::spawn(async move {
        let result = execute_inner(&state, &spec, &cancel).await;
        match result {
            Ok(()) => {}
            Err(RunError::Cancelled) => mark_cancelled(&state, &spec.id).await,
            Err(RunError::Message(message)) => mark_failed(&state, &spec.id, message).await,
        }
        if let Ok(mut cancellations) = state.cancellations.lock() {
            cancellations.remove(&spec.id);
        }
    });
}

pub async fn request_remote_cancel(job_id: &str) {
    if let Ok(client) = Client::builder()
        .connect_timeout(Duration::from_secs(1))
        .build()
    {
        cancel_remote(&client, job_id).await;
    }
}

#[cfg(test)]
mod tests {
    use std::{collections::HashMap, sync::Mutex};

    use super::*;
    use crate::{
        database::NewLibraryItem,
        models::{LibraryItem, WorkflowOptions},
    };

    #[tokio::test]
    async fn cancels_a_job_while_it_waits_for_the_scheduler() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let database_path = temporary.path().join("cancel.sqlite3");
        let results_dir = temporary.path().join("results");
        let downloads_dir = temporary.path().join("downloads");
        std::fs::create_dir_all(&results_dir).expect("results directory");
        std::fs::create_dir_all(&downloads_dir).expect("downloads directory");
        database::initialize(&database_path).expect("schema");
        let input_path = temporary.path().join("attesa.md");
        std::fs::write(&input_path, "in attesa").expect("input");
        let input_path_string = input_path.to_string_lossy().into_owned();
        database::insert_library_item(
            &database_path,
            &NewLibraryItem {
                id: "cancel-item",
                name: "attesa.md",
                path: &input_path_string,
                kind: "Testo",
                size_bytes: 9,
                content_hash: "cancel-test-hash",
                now: "2026-08-06T12:00:00Z",
            },
        )
        .expect("library item");
        let spec = JobSpec {
            id: "cancel-job".to_string(),
            batch_id: "cancel-batch".to_string(),
            library_item_id: Some("cancel-item".to_string()),
            item: database::list_library(&database_path)
                .expect("library")
                .remove(0),
            options: WorkflowOptions::default(),
            tool: "auto".to_string(),
        };
        database::insert_jobs(&database_path, std::slice::from_ref(&spec)).expect("job");
        let state = AppState {
            database_path: database_path.clone(),
            data_dir: temporary.path().to_path_buf(),
            results_dir,
            downloads_dir,
            engine_resource_dir: temporary.path().join("engine-resource"),
            engine_data_dir: temporary.path().join("engine-data"),
            runtime_process: Arc::new(Mutex::new(None)),
            ollama_process: Arc::new(Mutex::new(None)),
            installer_process: Arc::new(Mutex::new(None)),
            last_install_result: Arc::new(Mutex::new(None)),
            scheduler: Arc::new(tokio::sync::Semaphore::new(0)),
            cancellations: Arc::new(Mutex::new(HashMap::new())),
        };
        let cancellation = Arc::new(AtomicBool::new(false));
        state
            .cancellations
            .lock()
            .expect("cancellation registry")
            .insert(spec.id.clone(), Arc::clone(&cancellation));
        spawn_job(state, spec, Arc::clone(&cancellation));
        tokio::time::sleep(Duration::from_millis(25)).await;
        cancellation.store(true, Ordering::Release);

        let mut status = String::new();
        for _ in 0..20 {
            tokio::time::sleep(Duration::from_millis(25)).await;
            status = database::list_jobs(&database_path)
                .expect("jobs")
                .remove(0)
                .status;
            if status == "cancelled" {
                break;
            }
        }
        assert_eq!(status, "cancelled");
    }

    #[tokio::test]
    #[ignore = "requires the Local AI Desk v1 bridge on 127.0.0.1:8787"]
    async fn streams_through_real_bridge_and_persists_result() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let database_path = temporary.path().join("e2e.sqlite3");
        let results_dir = temporary.path().join("results");
        let downloads_dir = temporary.path().join("downloads");
        std::fs::create_dir_all(&results_dir).expect("results directory");
        std::fs::create_dir_all(&downloads_dir).expect("downloads directory");
        database::initialize(&database_path).expect("schema");

        let input_path = temporary.path().join("prova-ponte.md");
        std::fs::write(
            &input_path,
            "# Prova Local AI Desk 2\n\nContenuto elaborato interamente in locale.",
        )
        .expect("input");
        let input_path_string = input_path.to_string_lossy().into_owned();
        database::insert_library_item(
            &database_path,
            &NewLibraryItem {
                id: "bridge-item",
                name: "prova-ponte.md",
                path: &input_path_string,
                kind: "Testo",
                size_bytes: input_path.metadata().expect("metadata").len(),
                content_hash: "bridge-test-hash",
                now: "2026-08-06T12:00:00Z",
            },
        )
        .expect("library item");

        let spec = JobSpec {
            id: "bridge-job".to_string(),
            batch_id: "bridge-batch".to_string(),
            library_item_id: Some("bridge-item".to_string()),
            item: LibraryItem {
                id: "bridge-item".to_string(),
                name: "prova-ponte.md".to_string(),
                path: input_path_string,
                kind: "Testo".to_string(),
                size_bytes: 67,
                content_hash: "bridge-test-hash".to_string(),
                status: "ready".to_string(),
                added_at: "2026-08-06T12:00:00Z".to_string(),
                updated_at: "2026-08-06T12:00:00Z".to_string(),
            },
            options: WorkflowOptions::default(),
            tool: "auto".to_string(),
        };
        database::insert_jobs(&database_path, std::slice::from_ref(&spec)).expect("job");
        let state = AppState {
            database_path: database_path.clone(),
            data_dir: temporary.path().to_path_buf(),
            results_dir,
            downloads_dir,
            engine_resource_dir: temporary.path().join("engine-resource"),
            engine_data_dir: temporary.path().join("engine-data"),
            runtime_process: Arc::new(Mutex::new(None)),
            ollama_process: Arc::new(Mutex::new(None)),
            installer_process: Arc::new(Mutex::new(None)),
            last_install_result: Arc::new(Mutex::new(None)),
            scheduler: Arc::new(tokio::sync::Semaphore::new(3)),
            cancellations: Arc::new(Mutex::new(HashMap::new())),
        };

        execute_inner(&state, &spec, &Arc::new(AtomicBool::new(false)))
            .await
            .expect("real bridge execution");

        let job = database::list_jobs(&database_path).expect("jobs").remove(0);
        assert_eq!(job.status, "completed");
        assert_eq!(job.progress, 100.0);
        assert_eq!(job.engine.as_deref(), Some("Microsoft MarkItDown"));
        let output_path = PathBuf::from(job.output_path.expect("output path"));
        assert!(output_path.starts_with(&state.results_dir));
        assert!(std::fs::read_to_string(output_path)
            .expect("output text")
            .contains("Prova Local AI Desk 2"));
    }
}
