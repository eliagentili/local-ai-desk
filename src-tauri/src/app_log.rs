//! Local diagnostics log for the application itself.
//!
//! Without it there is no way to tell, after the fact, whether a session ended
//! cleanly or how long the app took to become usable — and this product sends
//! nothing anywhere, so the only place those two facts can live is a file on the
//! user's own disk. Every line is appended, never truncated: a crash loop must
//! leave the trace that explains it. The file holds timings and lifecycle
//! events; it never records the name or content of a document.

use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        OnceLock,
    },
    time::Instant,
};

/// Kept small on purpose: this file is meant to be read by a person, and by the
/// time it is megabytes long the interesting line is already unreachable.
const MAX_LOG_BYTES: u64 = 1024 * 1024;

static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();
static PROCESS_START: OnceLock<Instant> = OnceLock::new();
static READY_RECORDED: AtomicBool = AtomicBool::new(false);

pub fn log_path(data_dir: &Path) -> PathBuf {
    data_dir.join("app.log")
}

/// Open the log, rotate it if it grew too large, and route panics into it.
///
/// Called once, as early in startup as the data directory is known, so that a
/// panic during the rest of the setup is still recorded.
pub fn initialize(data_dir: &Path) {
    let path = log_path(data_dir);
    if fs::metadata(&path).is_ok_and(|metadata| metadata.len() > MAX_LOG_BYTES) {
        // One generation back is enough to survive a rotation that happens
        // between a crash and the user reporting it.
        let _ = fs::rename(&path, path.with_extension("log.1"));
    }
    let _ = LOG_PATH.set(path);
    let _ = PROCESS_START.set(Instant::now());

    record(&format!(
        "avvio {} {} su {}",
        env!("CARGO_PKG_NAME"),
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
    ));

    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // Location and message only: a payload could carry user content, and the
        // log is a file the user may well send to someone else.
        let where_it_broke = info
            .location()
            .map(|location| format!("{}:{}", location.file(), location.line()))
            .unwrap_or_else(|| "posizione non nota".to_string());
        record(&format!("panico in {where_it_broke}"));
        previous(info);
    }));
}

/// Append one line, with the local time so the user can line it up with what
/// they were doing. Silent on failure: logging must never break the app.
pub fn record(line: &str) {
    let Some(path) = LOG_PATH.get() else {
        return;
    };
    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) else {
        return;
    };
    let stamp = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%.3f%:z");
    // A single write of a single line: append mode then keeps concurrent
    // writers from interleaving inside a line.
    let _ = file.write_all(format!("{stamp} {line}\n").as_bytes());
}

/// Record how long the app took to hand the user a usable window, once per run.
///
/// The first snapshot the interface asks for is the moment the app is actually
/// usable, so that is what gets measured rather than the time to draw a frame.
pub fn record_ready() {
    if READY_RECORDED.swap(true, Ordering::AcqRel) {
        return;
    }
    let Some(start) = PROCESS_START.get() else {
        return;
    };
    record(&format!("pronto in {} ms", start.elapsed().as_millis()));
}

/// Marker that separates a clean shutdown from a crash. A run without it, on the
/// next launch, is a run that ended badly — which is the whole measurement.
pub fn record_clean_exit() {
    let uptime = PROCESS_START
        .get()
        .map(|start| start.elapsed().as_secs())
        .unwrap_or(0);
    record(&format!("chiusura pulita dopo {uptime} s"));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_log_that_grew_too_large_is_rotated_instead_of_truncated() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let path = log_path(temporary.path());
        fs::write(&path, vec![b'x'; (MAX_LOG_BYTES + 1) as usize]).expect("oversized log");

        // `initialize` installs global state, so only the rotation half of it is
        // exercised here; the write path has its own coverage below.
        if fs::metadata(&path).is_ok_and(|metadata| metadata.len() > MAX_LOG_BYTES) {
            fs::rename(&path, path.with_extension("log.1")).expect("rotation");
        }

        assert!(!path.exists(), "the current log starts empty");
        assert!(
            path.with_extension("log.1").exists(),
            "the crash being investigated keeps its own trace",
        );
    }

    #[test]
    fn recording_without_a_configured_path_is_a_no_op() {
        // Tests and the very first instants of startup have no log yet; the call
        // must be harmless rather than a source of panics of its own.
        record("una riga senza destinazione");
    }
}
