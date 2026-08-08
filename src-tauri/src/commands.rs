use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
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
        QuickFilesReport, RuntimeStatus, StartJobsReport, SystemSnapshot, WorkflowOptions,
    },
    process,
};

/// Engine logs are appended, never truncated: a crash loop must leave the
/// traceback that caused it readable instead of overwriting it on every retry.
fn append_log(path: &Path) -> Result<File, String> {
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| format!("Log non scrivibile ({}): {error}", path.display()))
}

/// Keep a log from growing without bound across months of use.
fn rotate_log_if_large(path: &Path) {
    const MAX_LOG_BYTES: u64 = 4 * 1024 * 1024;
    let Ok(metadata) = fs::metadata(path) else {
        return;
    };
    if metadata.len() > MAX_LOG_BYTES {
        let _ = fs::rename(path, path.with_extension("log.1"));
    }
}

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
        operating_system: std::env::consts::OS.to_string(),
        platform_label: match std::env::consts::OS {
            "macos" => "macOS".to_string(),
            "windows" => "Windows".to_string(),
            other => other.to_string(),
        },
        compute_label: match (std::env::consts::OS, std::env::consts::ARCH) {
            ("macos", "aarch64") => "Apple Silicon · Metal".to_string(),
            ("windows", "x86_64") => "Windows · CPU/GPU locale".to_string(),
            (_, architecture) => format!("CPU locale · {architecture}"),
        },
        architecture: std::env::consts::ARCH.to_string(),
        logical_cpus: std::thread::available_parallelism()
            .map(usize::from)
            .unwrap_or(1),
        total_memory_bytes: system.total_memory(),
        available_memory_bytes: system.available_memory(),
        data_directory: data_dir.to_string_lossy().into_owned(),
    }
}

fn runtime_python(engine_data_dir: &Path) -> PathBuf {
    if cfg!(windows) {
        engine_data_dir
            .join(".venv")
            .join("Scripts")
            .join("python.exe")
    } else {
        engine_data_dir.join(".venv").join("bin").join("python")
    }
}

fn process_is_running(process: &Arc<std::sync::Mutex<Option<std::process::Child>>>) -> bool {
    let Ok(mut process) = process.lock() else {
        return false;
    };
    let Some(child) = process.as_mut() else {
        return false;
    };
    match child.try_wait() {
        Ok(None) => true,
        Ok(Some(_)) | Err(_) => {
            *process = None;
            false
        }
    }
}

fn install_process_is_running(state: &AppState) -> bool {
    let result = {
        let Ok(mut process) = state.installer_process.lock() else {
            return false;
        };
        let Some(child) = process.as_mut() else {
            return false;
        };
        match child.try_wait() {
            Ok(None) => return true,
            Ok(Some(status)) if status.success() => {
                *process = None;
                Some("Installazione completata; avvio dei motori in corso".to_string())
            }
            Ok(Some(status)) => {
                *process = None;
                let log = fs::read(state.engine_data_dir.join("install.log")).unwrap_or_default();
                let start = log.len().saturating_sub(1_200);
                let tail = String::from_utf8_lossy(&log[start..]);
                let detail = tail
                    .lines()
                    .rev()
                    .find(|line| !line.trim().is_empty())
                    .unwrap_or("Apri il log di installazione da Modelli")
                    .trim();
                Some(format!("Installazione interrotta ({status}): {detail}"))
            }
            Err(error) => {
                *process = None;
                Some(format!("Stato installazione non leggibile: {error}"))
            }
        }
    };
    if let Some(result) = result {
        process::forget_now(&state.engine_data_dir, "install");
        if let Ok(mut last_result) = state.last_install_result.lock() {
            *last_result = Some(result);
        }
    }
    false
}

fn loopback_runtime_available() -> bool {
    let address = "127.0.0.1:8787".parse().expect("static socket address");
    std::net::TcpStream::connect_timeout(&address, Duration::from_millis(120)).is_ok()
}

fn loopback_ollama_available() -> bool {
    let address = "127.0.0.1:11434".parse().expect("static socket address");
    std::net::TcpStream::connect_timeout(&address, Duration::from_millis(120)).is_ok()
}

fn spawn_ollama_process(state: &AppState) -> Result<(), String> {
    if loopback_ollama_available() || process_is_running(&state.ollama_process) {
        return Ok(());
    }
    let executable = if cfg!(windows) {
        state
            .engine_data_dir
            .join("tools")
            .join("ollama")
            .join("ollama.exe")
    } else {
        state
            .engine_data_dir
            .join("tools")
            .join("ollama")
            .join("Ollama.app")
            .join("Contents")
            .join("Resources")
            .join("ollama")
    };
    if !executable.is_file() {
        return Ok(());
    }
    let models = state.engine_data_dir.join("models").join("ollama");
    fs::create_dir_all(&models).map_err(|error| error.to_string())?;
    let ollama_log = state.engine_data_dir.join("ollama.log");
    rotate_log_if_large(&ollama_log);
    let stdout = append_log(&ollama_log)?;
    let stderr = stdout.try_clone().map_err(|error| error.to_string())?;
    let mut command = Command::new(executable);
    command
        .arg("serve")
        .env("OLLAMA_MODELS", models)
        // Never inherit an OLLAMA_HOST that would publish local models on the
        // network: the app only ever talks to the loopback interface.
        .env("OLLAMA_HOST", "127.0.0.1:11434")
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));
    process::isolate_process_group(&mut command);
    let child = command
        .spawn()
        .map_err(|error| format!("Avvio di Ollama non riuscito: {error}"))?;
    process::remember(&state.engine_data_dir, "ollama", child.id());
    *state
        .ollama_process
        .lock()
        .map_err(|_| "Stato di Ollama non disponibile".to_string())? = Some(child);
    Ok(())
}

fn spawn_runtime_process(state: &AppState) -> Result<(), String> {
    if loopback_runtime_available() || process_is_running(&state.runtime_process) {
        return Ok(());
    }
    let python = runtime_python(&state.engine_data_dir);
    if !python.is_file() {
        return Err(
            "Il runtime locale non è ancora installato. Apri Modelli e avvia l'installazione."
                .to_string(),
        );
    }
    spawn_ollama_process(state)?;
    let backend = state
        .engine_resource_dir
        .join("backend")
        .join("app")
        .join("main.py");
    if !backend.is_file() {
        return Err("Il pacchetto dei motori non è presente nell’app".to_string());
    }
    fs::create_dir_all(&state.engine_data_dir).map_err(|error| error.to_string())?;
    let log_path = state.engine_data_dir.join("runtime.log");
    rotate_log_if_large(&log_path);
    let stdout = append_log(&log_path)?;
    let stderr = stdout.try_clone().map_err(|error| error.to_string())?;
    let mut command = Command::new(python);
    command
        .current_dir(&state.engine_resource_dir)
        .env("LOCAL_AI_ENGINE_HOME", &state.engine_data_dir)
        .env("LOCAL_AI_ENGINE_TOKEN", engine_bridge::engine_token())
        .env("PYTHONUTF8", "1")
        .arg("-m")
        .arg("uvicorn")
        .arg("backend.app.main:app")
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg("8787")
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));
    process::isolate_process_group(&mut command);
    let child = command
        .spawn()
        .map_err(|error| format!("Avvio del runtime non riuscito: {error}"))?;
    process::remember(&state.engine_data_dir, "runtime", child.id());
    *state
        .runtime_process
        .lock()
        .map_err(|_| "Stato del runtime non disponibile".to_string())? = Some(child);
    Ok(())
}

/// Terminate every engine process this app is responsible for. Ollama goes last
/// so the runtime can still reach it while it shuts its own workers down.
pub(crate) fn stop_engine_processes(state: &AppState) {
    for (slot, name) in [
        (&state.runtime_process, "runtime"),
        (&state.ollama_process, "ollama"),
        (&state.installer_process, "install"),
    ] {
        process::stop_process_tree(slot);
        // Compare-and-delete: a registration that no longer describes a live
        // process is ours to drop, anyone else's is left alone.
        process::forget(&state.engine_data_dir, name);
    }
}

pub(crate) fn try_start_installed_runtime(state: &AppState) {
    // A pid file that survived the previous run means the app was force-quit or
    // crashed: clean up whatever it left running before starting a new runtime.
    process::reap_orphan(&state.engine_data_dir, "runtime");
    process::reap_orphan(&state.engine_data_dir, "ollama");
    if process::reap_orphan(&state.engine_data_dir, "install") {
        // A half-finished install leaves a virtualenv nobody should build on.
        if let Ok(mut last_result) = state.last_install_result.lock() {
            *last_result = Some(
                "Un'installazione interrotta dalla sessione precedente è stata annullata: riavviala da Modelli."
                    .to_string(),
            );
        }
    }
    let _ = spawn_runtime_process(state);
}

/// The engine port answers but the listener is not a runtime we started and it
/// does not accept our token: something else owns 8787.
fn foreign_engine_listener(state: &AppState, bridge_available: bool) -> bool {
    loopback_runtime_available() && !bridge_available && !process_is_running(&state.runtime_process)
}

/// Read-only: polled every few seconds by the UI, so it must never spawn or
/// restart anything. Starting the runtime is `try_start_installed_runtime` at
/// launch and `start_engine_runtime` on explicit request.
#[tauri::command]
pub async fn get_runtime_status(state: State<'_, AppState>) -> Result<RuntimeStatus, String> {
    let bridge_available = bridge_status().await.available;
    let running = bridge_available || process_is_running(&state.runtime_process);
    let installing = install_process_is_running(state.inner());
    let installed = runtime_python(&state.engine_data_dir).is_file()
        && state.engine_data_dir.join(".ready").is_file();
    let occupied = foreign_engine_listener(state.inner(), bridge_available);
    let supported = cfg!(any(target_os = "macos", target_os = "windows"));
    let last_install_result = state
        .last_install_result
        .lock()
        .ok()
        .and_then(|result| result.clone());
    Ok(RuntimeStatus {
        platform: match std::env::consts::OS {
            "macos" => "macOS".to_string(),
            "windows" => "Windows".to_string(),
            other => other.to_string(),
        },
        supported,
        installed,
        running,
        installing,
        data_directory: state.engine_data_dir.to_string_lossy().into_owned(),
        log_path: state
            .engine_data_dir
            .join("install.log")
            .to_string_lossy()
            .into_owned(),
        runtime_log_path: state
            .engine_data_dir
            .join("runtime.log")
            .to_string_lossy()
            .into_owned(),
        message: if running {
            "Motori locali attivi".to_string()
        } else if installing {
            "Installazione dei componenti in corso".to_string()
        } else if occupied {
            "La porta 8787 è occupata da un altro programma. Chiudilo e riavvia i motori."
                .to_string()
        } else if installed {
            "Runtime installato, pronto per essere avviato".to_string()
        } else if let Some(result) = last_install_result {
            result
        } else if supported {
            "Runtime da installare una sola volta".to_string()
        } else {
            "Piattaforma non ancora supportata".to_string()
        },
    })
}

/// Last lines of a log, for error messages that tell the user what went wrong
/// instead of only that something did.
fn log_tail(path: &Path, lines: usize) -> Option<String> {
    let raw = fs::read(path).ok()?;
    let start = raw.len().saturating_sub(4_000);
    let tail = String::from_utf8_lossy(&raw[start..]);
    let collected: Vec<&str> = tail
        .lines()
        .rev()
        .filter(|line| !line.trim().is_empty())
        .take(lines)
        .collect();
    if collected.is_empty() {
        return None;
    }
    Some(
        collected
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join(" · ")
            .trim()
            .to_string(),
    )
}

#[tauri::command]
pub async fn start_engine_runtime(state: State<'_, AppState>) -> Result<RuntimeStatus, String> {
    spawn_runtime_process(state.inner())?;
    // `spawn_runtime_process` returns Ok without starting anything when the
    // port is already taken. If that listener is not ours, no amount of waiting
    // will help, and blaming our own log would send the user down a dead end.
    if !process_is_running(&state.runtime_process)
        && loopback_runtime_available()
        && !bridge_status().await.available
    {
        return Err(
            "La porta 8787 è occupata da un altro programma. Chiudilo e riprova ad avviare i motori."
                .to_string(),
        );
    }

    // Wait for the engine to actually answer instead of assuming it will: the
    // user is told the truth, and a runtime that dies on startup surfaces the
    // reason from its own log.
    for _ in 0..24 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        if bridge_status().await.available {
            return get_runtime_status(state).await;
        }
        if !process_is_running(&state.runtime_process) {
            let detail = log_tail(&state.engine_data_dir.join("runtime.log"), 3)
                .unwrap_or_else(|| "nessun dettaglio nel log".to_string());
            return Err(format!(
                "I motori si sono chiusi subito dopo l'avvio: {detail}"
            ));
        }
    }
    Err(
        "I motori non hanno risposto entro 12 secondi. Controlla runtime.log da Modelli."
            .to_string(),
    )
}

/// Give the user a way out: stop the local engines without quitting the app.
#[tauri::command]
pub async fn stop_engine_runtime(state: State<'_, AppState>) -> Result<RuntimeStatus, String> {
    let has_active = {
        let Ok(cancellations) = state.cancellations.lock() else {
            return Err("Stato dei lavori non disponibile".to_string());
        };
        !cancellations.is_empty()
    };
    if has_active {
        return Err(
            "Ci sono lavori attivi. Annullali o attendi che finiscano prima di fermare i motori."
                .to_string(),
        );
    }
    stop_engine_processes(state.inner());
    get_runtime_status(state).await
}

#[tauri::command]
pub async fn install_engine_runtime(state: State<'_, AppState>) -> Result<RuntimeStatus, String> {
    if install_process_is_running(state.inner()) {
        return get_runtime_status(state).await;
    }
    if !cfg!(any(target_os = "macos", target_os = "windows")) {
        return Err("L’installazione guidata supporta macOS e Windows".to_string());
    }
    fs::create_dir_all(&state.engine_data_dir).map_err(|error| error.to_string())?;
    // An installer started by a previous run may still be writing into the same
    // virtualenv. Running a second bootstrap on top of it corrupts both.
    if process::reap_orphan(&state.engine_data_dir, "install") {
        return Err(
            "Un'installazione precedente era ancora in corso: è stata interrotta. Riprova."
                .to_string(),
        );
    }
    if let Ok(mut last_result) = state.last_install_result.lock() {
        *last_result = None;
    }
    let log_path = state.engine_data_dir.join("install.log");
    rotate_log_if_large(&log_path);
    let stdout = append_log(&log_path)?;
    let stderr = stdout.try_clone().map_err(|error| error.to_string())?;
    let script = if cfg!(windows) {
        state
            .engine_resource_dir
            .join("scripts")
            .join("bootstrap-windows.ps1")
    } else {
        state
            .engine_resource_dir
            .join("scripts")
            .join("bootstrap-macos.sh")
    };
    if !script.is_file() {
        return Err("Script di installazione non presente nel pacchetto".to_string());
    }
    let mut command = if cfg!(windows) {
        let mut command = Command::new("powershell.exe");
        command
            .arg("-NoLogo")
            .arg("-NoProfile")
            .arg("-NonInteractive")
            .arg("-ExecutionPolicy")
            .arg("Bypass")
            .arg("-File")
            .arg(&script)
            .arg("-SourceDir")
            .arg(&state.engine_resource_dir)
            .arg("-DataDir")
            .arg(&state.engine_data_dir);
        command
    } else {
        let mut command = Command::new("/bin/zsh");
        command
            .arg(&script)
            .arg("--source")
            .arg(&state.engine_resource_dir)
            .arg("--data")
            .arg(&state.engine_data_dir);
        command
    };
    command
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));
    process::isolate_process_group(&mut command);
    let child = command
        .spawn()
        .map_err(|error| format!("Installazione non avviata: {error}"))?;
    process::remember(&state.engine_data_dir, "install", child.id());
    *state
        .installer_process
        .lock()
        .map_err(|_| "Stato installazione non disponibile".to_string())? = Some(child);
    get_runtime_status(state).await
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

    let client = match engine_bridge::engine_client(Duration::from_millis(900)) {
        Ok(client) => client,
        Err(_) => return fallback,
    };

    let response = match client
        .get("http://127.0.0.1:8787/api/status")
        .timeout(Duration::from_millis(900))
        .send()
        .await
    {
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
        let jobs = database::list_jobs(&database_for_query, JOB_HISTORY_LIMIT)?;
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

fn inspect_quick_paths(paths: Vec<String>) -> (Vec<crate::models::LibraryItem>, Vec<String>) {
    let mut files = Vec::new();
    let mut rejected = Vec::new();
    let mut known_paths = HashSet::new();

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
        if !known_paths.insert(canonical.clone()) {
            continue;
        }
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
        let now = Utc::now().to_rfc3339();
        files.push(crate::models::LibraryItem {
            id: format!("quick-{}", uuid::Uuid::new_v4()),
            name,
            path: canonical.to_string_lossy().into_owned(),
            kind: kind_for(&canonical),
            size_bytes: metadata.len(),
            content_hash: String::new(),
            status: "temporary".to_string(),
            added_at: now.clone(),
            updated_at: now,
        });
    }
    (files, rejected)
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

/// How much history the activity view keeps in memory. The list is polled while
/// jobs run, so an unbounded query would make every tick more expensive as the
/// archive grows. It is never below `MAX_BATCH_FILES`, so the newest batch is
/// always visible in full and the export count cannot be silently truncated.
const JOB_HISTORY_LIMIT: i64 = 500;

/// Largest batch a single run may contain.
const MAX_BATCH_FILES: usize = 500;

#[tauri::command]
pub async fn list_jobs(state: State<'_, AppState>) -> Result<Vec<Job>, String> {
    let database_path = state.database_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        database::list_jobs(&database_path, JOB_HISTORY_LIMIT)
    })
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
pub async fn inspect_quick_files(paths: Vec<String>) -> Result<QuickFilesReport, String> {
    if paths.is_empty() {
        return Err("Nessun file selezionato".to_string());
    }
    if paths.len() > 500 {
        return Err("Seleziona al massimo 500 file per volta".to_string());
    }
    let (files, rejected) =
        tauri::async_runtime::spawn_blocking(move || inspect_quick_paths(paths))
            .await
            .map_err(|error| format!("Lettura interrotta: {error}"))?;
    Ok(QuickFilesReport { files, rejected })
}

#[tauri::command]
pub async fn remove_library_item(
    item_id: String,
    state: State<'_, AppState>,
) -> Result<AppSnapshot, String> {
    let database_path = state.database_path.clone();
    let removed = tauri::async_runtime::spawn_blocking(move || {
        database::delete_library_item(&database_path, &item_id)
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())?;
    if !removed {
        return Err("Elemento della libreria non trovato".to_string());
    }
    snapshot(state.database_path.clone(), state.data_dir.clone()).await
}

#[tauri::command]
pub async fn start_jobs(
    item_ids: Vec<String>,
    quick_paths: Vec<String>,
    options: WorkflowOptions,
    state: State<'_, AppState>,
) -> Result<StartJobsReport, String> {
    if item_ids.is_empty() && quick_paths.is_empty() {
        return Err("Seleziona almeno un file".to_string());
    }
    if item_ids.len().saturating_add(quick_paths.len()) > MAX_BATCH_FILES {
        return Err(format!("Avvia al massimo {MAX_BATCH_FILES} file per batch"));
    }
    let mut bridge = bridge_status().await;
    if !bridge.available {
        let _ = spawn_runtime_process(state.inner());
        tokio::time::sleep(Duration::from_millis(700)).await;
        bridge = bridge_status().await;
    }
    if !bridge.available {
        return Err(
            "I motori locali non sono attivi. Apri Modelli per installarli o riavviarli."
                .to_string(),
        );
    }
    // Refuse before materialising jobs that are certain to fail: a 200-file
    // batch of guaranteed errors is worse than one clear message.
    if let Some(reason) = engine_not_ready(&bridge, &options.intent) {
        return Err(reason);
    }

    let database_path = state.database_path.clone();
    let ids_for_query = item_ids.clone();
    let persistent_items = tauri::async_runtime::spawn_blocking(move || {
        database::library_items_by_ids(&database_path, &ids_for_query)
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| format!("Elemento non trovato: {error}"))?;
    let (quick_items, rejected) =
        tauri::async_runtime::spawn_blocking(move || inspect_quick_paths(quick_paths))
            .await
            .map_err(|error| error.to_string())?;
    if let Some(error) = rejected.first() {
        return Err(format!("File rapido non disponibile: {error}"));
    }
    let mut items = Vec::with_capacity(persistent_items.len() + quick_items.len());
    items.extend(
        persistent_items
            .into_iter()
            .map(|item| (Some(item.id.clone()), item)),
    );
    items.extend(quick_items.into_iter().map(|item| (None, item)));
    let workflow_items: Vec<_> = items.iter().map(|(_, item)| item.clone()).collect();
    validate_workflow(&workflow_items, &options)?;
    let tool = resolve_tool(&options.intent)?.to_string();
    let batch_id = uuid::Uuid::new_v4().to_string();
    let specs: Vec<JobSpec> = items
        .into_iter()
        .map(|(library_item_id, item)| {
            let id = uuid::Uuid::new_v4().to_string();
            JobSpec {
                engine_job_id: id.clone(),
                id,
                batch_id: batch_id.clone(),
                library_item_id,
                item,
                options: options.clone(),
                tool: tool.clone(),
            }
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

    // Taken from what was inserted, not from a later read of the job list: a
    // windowed query would quietly drop the tail of a large batch.
    let job_ids: Vec<String> = specs.iter().map(|spec| spec.id.clone()).collect();
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
    Ok(StartJobsReport {
        batch_id,
        job_ids,
        snapshot: current,
    })
}

/// Which engine has to be ready before an intent can produce a real result.
fn required_engine(intent: &str) -> Option<&'static str> {
    match intent {
        "translate" => Some("pdf-translate"),
        "ocr" => Some("paddleocr"),
        "transcribe" => Some("faster-whisper"),
        // `extract` routes across several engines at run time and `privacy`
        // degrades to the local rules on purpose, so neither can be pre-checked.
        _ => None,
    }
}

fn engine_not_ready(bridge: &BridgeStatus, intent: &str) -> Option<String> {
    let engine_id = required_engine(intent)?;
    let engine = bridge
        .engines
        .iter()
        .find(|engine| engine.id == engine_id)?;
    if engine.state == "ready" {
        return None;
    }
    Some(format!(
        "Il motore «{}» non è pronto: {}. Apri Modelli e completa l'installazione prima di avviare il batch.",
        engine.id, engine.label
    ))
}

/// Put a finished-but-unsuccessful job back in the queue with its original
/// settings, so a transient failure does not cost the user the whole setup.
#[tauri::command]
pub async fn retry_job(job_id: String, state: State<'_, AppState>) -> Result<AppSnapshot, String> {
    let database_path = state.database_path.clone();
    let lookup_id = job_id.clone();
    let job = tauri::async_runtime::spawn_blocking(move || {
        database::jobs_by_ids(&database_path, &[lookup_id])
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())?
    .into_iter()
    .next()
    .ok_or_else(|| "Lavoro non trovato".to_string())?;

    let Some(library_item_id) = job.library_item_id.clone() else {
        // Quick-drop sources are deliberately never recorded, so there is no
        // path to re-read. Say that plainly instead of failing obscurely.
        return Err(
            "Questo lavoro usava un file temporaneo, che non è stato archiviato. Trascina di nuovo il file per rielaborarlo."
                .to_string(),
        );
    };

    let database_path = state.database_path.clone();
    let item_id = library_item_id.clone();
    let item = tauri::async_runtime::spawn_blocking(move || {
        database::library_items_by_ids(&database_path, &[item_id])
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|_| "La fonte non è più nella Libreria: reimportala per riprovare.".to_string())?
    .into_iter()
    .next()
    .ok_or_else(|| "La fonte non è più nella Libreria: reimportala per riprovare.".to_string())?;

    if !Path::new(&item.path).is_file() {
        return Err(format!(
            "Il file originale non è più al suo posto: {}",
            item.path
        ));
    }

    if !bridge_status().await.available {
        return Err(
            "I motori locali non sono attivi. Apri Modelli per avviarli, poi riprova.".to_string(),
        );
    }

    let database_path = state.database_path.clone();
    let requeue_id = job_id.clone();
    let requeued = tauri::async_runtime::spawn_blocking(move || {
        database::requeue_job(&database_path, &requeue_id)
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())?;
    if !requeued {
        return Err(
            "Si può riprovare solo un lavoro non riuscito, annullato o interrotto".to_string(),
        );
    }

    let options = WorkflowOptions {
        intent: job.workflow.clone(),
        output_format: job.output_format.clone(),
        language: job.language.clone(),
        source_language: job.source_language.clone(),
        target_language: job.target_language.clone(),
        translation_mode: job.translation_mode.clone(),
    };
    let spec = JobSpec {
        id: job.id.clone(),
        // A fresh identity for this attempt: the engine may still be holding
        // the previous one, and would refuse the retry as a duplicate.
        engine_job_id: format!("{}-r{}", job.id, uuid::Uuid::new_v4().simple()),
        batch_id: job.batch_id.clone().unwrap_or_else(|| job.id.clone()),
        library_item_id: Some(library_item_id),
        item,
        options,
        tool: job.tool.clone(),
    };
    let cancellation = Arc::new(AtomicBool::new(false));
    state
        .cancellations
        .lock()
        .map_err(|_| "Stato di cancellazione non disponibile".to_string())?
        .insert(spec.id.clone(), Arc::clone(&cancellation));
    engine_bridge::spawn_job(state.inner().clone(), spec, cancellation);

    snapshot(state.database_path.clone(), state.data_dir.clone()).await
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
    // A job that finished microseconds ago is not cancellable any more: say so
    // rather than reporting a cancellation that never happened.
    let changed = tauri::async_runtime::spawn_blocking(move || {
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
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())?;
    engine_bridge::request_remote_cancel(&job_id).await;
    Ok(changed > 0)
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

/// Entries inside the export archive share the sanitiser used for results, so
/// a name can never carry a separator into the ZIP and escape `risultati/`.
fn safe_archive_name(name: &str) -> String {
    engine_bridge::safe_filename(name, "risultato.txt")
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

#[cfg(target_os = "macos")]
fn reveal(path: &Path) -> Result<(), String> {
    Command::new("/usr/bin/open")
        .arg("-R")
        .arg(path)
        .spawn()
        .map_err(|error| format!("Finder non disponibile: {error}"))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn reveal(path: &Path) -> Result<(), String> {
    Command::new("explorer.exe")
        .arg(format!("/select,{}", path.to_string_lossy()))
        .spawn()
        .map_err(|error| format!("Esplora file non disponibile: {error}"))?;
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn reveal(path: &Path) -> Result<(), String> {
    let directory = path.parent().unwrap_or(path);
    Command::new("xdg-open")
        .arg(directory)
        .spawn()
        .map_err(|error| format!("Gestore file non disponibile: {error}"))?;
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

/// Show a diagnostics file in the system file manager. Confined to the app data
/// directory so the UI can never turn this into a general "open anything" call.
#[tauri::command]
pub async fn reveal_path(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let canonical_data = state
        .data_dir
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let target = PathBuf::from(&path).canonicalize().map_err(|_| {
        "Il file non esiste ancora: comparirà al primo avvio dei motori.".to_string()
    })?;
    if !target.starts_with(&canonical_data) || !target.is_file() {
        return Err("Percorso non consentito".to_string());
    }
    reveal(&target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{LibraryItem, WorkflowOptions};

    fn options(intent: &str, output_format: &str) -> WorkflowOptions {
        WorkflowOptions {
            intent: intent.to_string(),
            output_format: output_format.to_string(),
            ..WorkflowOptions::default()
        }
    }

    fn item_named(name: &str) -> LibraryItem {
        LibraryItem {
            id: "item".to_string(),
            name: name.to_string(),
            path: format!("/tmp/{name}"),
            kind: "File".to_string(),
            size_bytes: 1,
            content_hash: "hash".to_string(),
            status: "ready".to_string(),
            added_at: "2026-08-06T12:00:00Z".to_string(),
            updated_at: "2026-08-06T12:00:00Z".to_string(),
        }
    }

    #[test]
    fn workflow_validation_rejects_mismatched_inputs_and_formats() {
        // Transcription of a PDF, OCR of a spreadsheet and translation into the
        // same language are all user-reachable through a stale selection.
        assert!(
            validate_workflow(&[item_named("nota.pdf")], &options("transcribe", "txt")).is_err()
        );
        assert!(validate_workflow(&[item_named("conti.xlsx")], &options("ocr", "txt")).is_err());
        assert!(validate_workflow(&[item_named("nota.pdf")], &options("extract", "srt")).is_err());
        assert!(
            validate_workflow(&[item_named("clip.mp4")], &options("transcribe", "srt")).is_ok()
        );

        let mut same_language = options("translate", "pdf");
        same_language.source_language = "it".to_string();
        same_language.target_language = "it".to_string();
        assert!(validate_workflow(&[item_named("doc.pdf")], &same_language).is_err());

        let mut auto_source = options("translate", "pdf");
        auto_source.source_language = "auto".to_string();
        assert!(validate_workflow(&[item_named("doc.pdf")], &auto_source).is_err());

        let mut injected = options("extract", "markdown");
        injected.language = "it; DROP TABLE jobs".to_string();
        assert!(validate_workflow(&[item_named("nota.pdf")], &injected).is_err());

        // A batch is only as valid as its least compatible member.
        assert!(validate_workflow(
            &[item_named("clip.mp4"), item_named("nota.pdf")],
            &options("transcribe", "txt"),
        )
        .is_err());
    }

    #[test]
    fn every_intent_resolves_to_a_tool_and_unknown_ones_do_not() {
        for intent in ["extract", "translate", "ocr", "transcribe", "privacy"] {
            assert!(resolve_tool(intent).is_ok(), "{intent} must map to a tool");
        }
        assert!(resolve_tool("").is_err());
        assert!(resolve_tool("delete-everything").is_err());
    }

    #[test]
    fn archive_names_stay_flat_and_keep_non_ascii_titles() {
        // Path separators must not survive into the archive: a traversal here
        // would let a result escape the `risultati/` folder on extraction.
        assert_eq!(safe_archive_name("../../etc/passwd"), "passwd");
        assert_eq!(safe_archive_name("cartella/risultato.md"), "risultato.md");
        assert_eq!(safe_archive_name("C:\\Windows\\note.txt"), "note.txt");
        // Accents and emoji are ordinary filenames, not something to strip.
        assert_eq!(
            safe_archive_name("relazione annuale è.md"),
            "relazione annuale è.md"
        );
        assert_eq!(safe_archive_name("鍵 🔑.txt"), "鍵 🔑.txt");
        assert_eq!(safe_archive_name(""), "risultato.txt");
    }

    #[test]
    fn engine_readiness_blocks_only_the_intents_that_need_one_engine() {
        let bridge = |state: &str| BridgeStatus {
            available: true,
            local_only: true,
            ready_engines: 0,
            total_engines: 1,
            batch_parallelism: 3,
            label: String::new(),
            engines: vec![EngineStatus {
                id: "faster-whisper".to_string(),
                state: state.to_string(),
                label: "Da installare".to_string(),
                version: None,
            }],
        };
        assert!(engine_not_ready(&bridge("missing"), "transcribe").is_some());
        assert!(engine_not_ready(&bridge("ready"), "transcribe").is_none());
        // Auto routes at run time and Privacy Shield degrades on purpose, so
        // neither may be blocked before the job starts.
        assert!(engine_not_ready(&bridge("missing"), "extract").is_none());
        assert!(engine_not_ready(&bridge("missing"), "privacy").is_none());
    }

    #[test]
    fn quick_files_are_inspected_without_hashing_or_persisting() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let source = temporary.path().join("video grande.mp4");
        fs::write(&source, b"local-only").expect("test source");

        let (files, rejected) = inspect_quick_paths(vec![
            source.to_string_lossy().into_owned(),
            source.to_string_lossy().into_owned(),
        ]);

        assert!(rejected.is_empty());
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, "temporary");
        assert!(files[0].content_hash.is_empty());
        assert_eq!(files[0].size_bytes, 10);
    }

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
                engine_job_id: id.to_string(),
                batch_id: "batch-zip".to_string(),
                library_item_id: Some(format!("item-{id}")),
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
                    warnings: &[],
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
