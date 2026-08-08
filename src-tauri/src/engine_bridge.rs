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
const TOKEN_HEADER: &str = "x-local-token";

/// Shared secret handed to the engine runtime at spawn time. Without it the
/// backend refuses every request, so a stray process squatting on port 8787 can
/// neither receive the user's documents nor be mistaken for our own runtime.
static ENGINE_TOKEN: std::sync::OnceLock<String> = std::sync::OnceLock::new();

pub(crate) fn engine_token() -> &'static str {
    ENGINE_TOKEN.get_or_init(|| {
        let mut token = String::with_capacity(64);
        for _ in 0..4 {
            token.push_str(&uuid::Uuid::new_v4().simple().to_string());
        }
        token
    })
}

/// A client that always identifies itself to the local engine.
pub(crate) fn engine_client(connect_timeout: Duration) -> Result<Client, reqwest::Error> {
    let mut headers = header::HeaderMap::new();
    let mut value = header::HeaderValue::from_str(engine_token())
        .unwrap_or(header::HeaderValue::from_static(""));
    value.set_sensitive(true);
    headers.insert(TOKEN_HEADER, value);
    Client::builder()
        .default_headers(headers)
        .connect_timeout(connect_timeout)
        .build()
}

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
    /// Quality caveats the engine attached to an otherwise successful run.
    #[serde(default)]
    warnings: Vec<String>,
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
    .map(|_| ())
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

/// Names reserved by Windows: a file called `CON.txt` cannot be created there,
/// so a result carrying that name would fail to extract from an exported ZIP
/// even though it was produced on macOS.
const WINDOWS_RESERVED: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Reduce an engine-supplied name to a single, writable filename.
///
/// Both separators are stripped regardless of host platform, because a name can
/// be produced on one OS and extracted on the other: `Path::file_name` alone
/// would leave `C:\dir\file` intact on Unix.
pub(crate) fn safe_filename(name: &str, fallback: &str) -> String {
    let basename = name
        .rsplit(['/', '\\'])
        .next()
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback);
    let cleaned: String = basename
        .chars()
        .map(|character| match character {
            // Control characters would render as garbage and break some shells.
            ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            other if (other as u32) < 0x20 => '-',
            other => other,
        })
        .collect();
    let trimmed = cleaned.trim_matches([' ', '.']);
    if trimmed.is_empty() {
        return fallback.to_string();
    }
    let stem = trimmed.split('.').next().unwrap_or(trimmed);
    if WINDOWS_RESERVED
        .iter()
        .any(|reserved| stem.eq_ignore_ascii_case(reserved))
    {
        return format!("_{trimmed}");
    }
    trimmed.to_string()
}

/// Working name for a result still being written.
///
/// Fixed length on purpose: deriving it from the output name pushed long
/// filenames past the filesystem limit, so a result the engine could name was
/// one this could not create. The dot prefix and `.partial` suffix are what the
/// startup sweep looks for.
fn partial_name() -> String {
    format!(
        ".{}.partial",
        &uuid::Uuid::new_v4().simple().to_string()[..12]
    )
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
            .append_pair("job_id", &spec.engine_job_id);
    } else {
        url.query_pairs_mut()
            .append_pair("tool", &spec.tool)
            .append_pair("output_format", &spec.options.output_format)
            .append_pair("language", &spec.options.language)
            .append_pair("filename", &spec.item.name)
            .append_pair("job_id", &spec.engine_job_id);
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
        "cancelling" | "cancelled" => "cancelling",
        // Never terminal here: `mark_failed` closes the job with the actual
        // reason, and a terminal status set from a poll would lock it out.
        "error" => "finalizing",
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

struct WrittenResult {
    path: PathBuf,
    name: String,
    mime: String,
    engine: String,
    elapsed_seconds: f64,
    warnings: Vec<String>,
}

async fn write_translation_result(
    response: Response,
    state: &AppState,
    spec: &JobSpec,
    cancel: &AtomicBool,
) -> Result<WrittenResult, RunError> {
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
    let partial_path = job_dir.join(partial_name());
    let mut destination = File::create(&partial_path).await?;
    let outcome: Result<(), RunError> = async {
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            if is_cancelled(cancel) {
                return Err(RunError::Cancelled);
            }
            destination.write_all(&chunk?).await?;
        }
        destination.flush().await?;
        Ok(())
    }
    .await;
    drop(destination);

    // Promote the partial file only once it is complete: renaming after a
    // cancellation would publish a truncated PDF under the final name. A full
    // disk and a failed rename converge on the same cleanup.
    let outcome = match outcome {
        Ok(()) => fs::rename(&partial_path, &output_path)
            .await
            .map_err(RunError::from),
        Err(error) => Err(error),
    };
    if let Err(error) = outcome {
        let _ = fs::remove_file(&partial_path).await;
        let _ = fs::remove_dir(&job_dir).await;
        return Err(error);
    }
    Ok(WrittenResult {
        path: output_path,
        name: output_name,
        mime,
        engine,
        elapsed_seconds: elapsed,
        warnings: Vec::new(),
    })
}

async fn write_text_result(
    response: Response,
    state: &AppState,
    spec: &JobSpec,
    cancel: &AtomicBool,
) -> Result<WrittenResult, RunError> {
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
    if is_cancelled(cancel) {
        let _ = fs::remove_dir(&job_dir).await;
        return Err(RunError::Cancelled);
    }
    // Write, then rename: a reader never sees a partially written result, which
    // is what "risultato atomico" claims for every format, not only for PDF.
    let partial_path = job_dir.join(partial_name());
    let written = async {
        fs::write(&partial_path, payload.output.unwrap_or_default()).await?;
        fs::rename(&partial_path, &output_path).await
    }
    .await;
    if let Err(error) = written {
        let _ = fs::remove_file(&partial_path).await;
        let _ = fs::remove_dir(&job_dir).await;
        return Err(RunError::from(error));
    }
    Ok(WrittenResult {
        path: output_path,
        name: output_name,
        mime: output_mime(&payload.format).to_string(),
        engine: payload.engine,
        elapsed_seconds: payload.elapsed_seconds,
        warnings: payload.warnings,
    })
}

async fn execute_inner(
    state: &AppState,
    spec: &JobSpec,
    cancel: &Arc<AtomicBool>,
) -> Result<(), RunError> {
    let client = engine_client(Duration::from_secs(2))?;

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
    // The engine has no request timeout on purpose: transcribing a long video
    // or OCR-ing a large scan legitimately takes hours. What must not happen is
    // a *dead* engine holding a scheduler permit forever, so liveness is probed
    // instead of elapsed time.
    let mut ticks: u32 = 0;
    let mut missed_heartbeats: u32 = 0;

    let response = loop {
        tokio::select! {
            result = &mut request => break result?,
            _ = sleep(Duration::from_millis(450)) => {
                ticks += 1;
                if ticks.is_multiple_of(11) {
                    let alive = client
                        .get(format!("{LEGACY_BASE}/api/health"))
                        .timeout(Duration::from_secs(2))
                        .send()
                        .await
                        .map(|response| response.status().is_success())
                        .unwrap_or(false);
                    missed_heartbeats = if alive { 0 } else { missed_heartbeats + 1 };
                    if missed_heartbeats >= 6 {
                        return Err(RunError::Message(
                            "I motori locali hanno smesso di rispondere. Aprili da Modelli, \
                             riavviali e riprova il lavoro."
                                .to_string(),
                        ));
                    }
                }
                if is_cancelled(cancel) {
                    let _ = persist_progress(
                        state.database_path.clone(), spec.id.clone(),
                        OwnedProgress::stage("cancelling", 0.0, "Interruzione del motore"),
                    ).await;
                    cancel_remote(&client, &spec.engine_job_id).await;
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
                        poll_translation_progress(&client, &spec.engine_job_id).await
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
        cancel_remote(&client, &spec.engine_job_id).await;
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

    let written = if translation {
        write_translation_result(response, state, spec, cancel).await?
    } else {
        write_text_result(response, state, spec, cancel).await?
    };
    let elapsed = if written.elapsed_seconds > 0.0 {
        written.elapsed_seconds
    } else {
        started.elapsed().as_secs_f64()
    };
    let path_string = written.path.to_string_lossy().into_owned();
    let database_path = state.database_path.clone();
    let job_id = spec.id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        database::complete_job(
            &database_path,
            &job_id,
            &CompletedJob {
                output_path: &path_string,
                output_name: &written.name,
                output_mime: &written.mime,
                engine: &written.engine,
                elapsed_seconds: elapsed,
                warnings: &written.warnings,
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
    if let Ok(client) = engine_client(Duration::from_secs(1)) {
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
            engine_job_id: "cancel-job".to_string(),
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
            status = database::list_jobs(&database_path, 200)
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
            engine_job_id: "bridge-job".to_string(),
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

        let job = database::list_jobs(&database_path, 200)
            .expect("jobs")
            .remove(0);
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
