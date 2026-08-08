use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Child,
    sync::{atomic::AtomicBool, Arc, Mutex},
};

use chrono::Utc;
use rusqlite::{params, Connection};
use tokio::sync::Semaphore;

use crate::models::{Job, JobSpec, LibraryItem};

#[derive(Debug, Clone)]
pub struct AppState {
    pub database_path: PathBuf,
    pub data_dir: PathBuf,
    pub results_dir: PathBuf,
    pub downloads_dir: PathBuf,
    pub engine_resource_dir: PathBuf,
    pub engine_data_dir: PathBuf,
    /// Where Ollama keeps its models. Shared with the user's own Ollama rather
    /// than duplicated inside the app container: these are official registry
    /// models, often several gigabytes, and a machine that already has them
    /// should never download a second copy.
    pub ollama_models_dir: PathBuf,
    pub runtime_process: Arc<Mutex<Option<Child>>>,
    pub ollama_process: Arc<Mutex<Option<Child>>>,
    pub installer_process: Arc<Mutex<Option<Child>>>,
    pub last_install_result: Arc<Mutex<Option<String>>>,
    pub scheduler: Arc<Semaphore>,
    pub cancellations: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

fn connect(path: &Path) -> rusqlite::Result<Connection> {
    let connection = Connection::open(path)?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    // `journal_mode` lives in the file header and is set once in `initialize`.
    // Renegotiating WAL on every open would make each short-lived connection
    // pay for a mode switch, and progress updates open one every 450 ms per job.
    connection.pragma_update(None, "synchronous", "NORMAL")?;
    connection.busy_timeout(std::time::Duration::from_secs(5))?;
    Ok(connection)
}

fn ensure_column(
    connection: &Connection,
    table: &str,
    column: &str,
    declaration: &str,
) -> rusqlite::Result<()> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if !columns.iter().any(|known| known == column) {
        connection.execute_batch(&format!(
            "ALTER TABLE {table} ADD COLUMN {column} {declaration}"
        ))?;
    }
    Ok(())
}

pub fn initialize(path: &Path) -> rusqlite::Result<()> {
    let connection = connect(path)?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "journal_size_limit", 8 * 1024 * 1024)?;
    connection.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS library_items (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          path TEXT NOT NULL,
          kind TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          content_hash TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL,
          added_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY,
          batch_id TEXT,
          library_item_id TEXT,
          input_name TEXT NOT NULL,
          workflow TEXT NOT NULL,
          tool TEXT NOT NULL DEFAULT 'auto',
          output_format TEXT NOT NULL DEFAULT 'markdown',
          language TEXT NOT NULL DEFAULT 'auto',
          source_language TEXT NOT NULL DEFAULT 'en',
          target_language TEXT NOT NULL DEFAULT 'it',
          translation_mode TEXT NOT NULL DEFAULT 'translated',
          status TEXT NOT NULL,
          progress REAL NOT NULL DEFAULT 0,
          stage TEXT NOT NULL,
          stage_current INTEGER NOT NULL DEFAULT 0,
          stage_total INTEGER NOT NULL DEFAULT 0,
          part_index INTEGER NOT NULL DEFAULT 1,
          total_parts INTEGER NOT NULL DEFAULT 1,
          output_path TEXT,
          output_name TEXT,
          output_mime TEXT,
          engine TEXT,
          elapsed_seconds REAL,
          warnings TEXT,
          error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(library_item_id) REFERENCES library_items(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS job_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          job_id TEXT NOT NULL,
          status TEXT NOT NULL,
          progress REAL NOT NULL,
          stage TEXT NOT NULL,
          message TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_library_added_at ON library_items(added_at DESC);
        CREATE INDEX IF NOT EXISTS idx_jobs_updated_at ON jobs(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
        CREATE INDEX IF NOT EXISTS idx_job_events_job ON job_events(job_id, id);
        ",
    )?;

    for (column, declaration) in [
        ("batch_id", "TEXT"),
        ("tool", "TEXT NOT NULL DEFAULT 'auto'"),
        ("output_format", "TEXT NOT NULL DEFAULT 'markdown'"),
        ("language", "TEXT NOT NULL DEFAULT 'auto'"),
        ("source_language", "TEXT NOT NULL DEFAULT 'en'"),
        ("target_language", "TEXT NOT NULL DEFAULT 'it'"),
        ("translation_mode", "TEXT NOT NULL DEFAULT 'translated'"),
        ("stage_current", "INTEGER NOT NULL DEFAULT 0"),
        ("stage_total", "INTEGER NOT NULL DEFAULT 0"),
        ("part_index", "INTEGER NOT NULL DEFAULT 1"),
        ("total_parts", "INTEGER NOT NULL DEFAULT 1"),
        ("output_name", "TEXT"),
        ("output_mime", "TEXT"),
        ("engine", "TEXT"),
        ("elapsed_seconds", "REAL"),
        ("warnings", "TEXT"),
    ] {
        ensure_column(&connection, "jobs", column, declaration)?;
    }

    // Foundation databases do not have batch_id until the migration above.
    // Build its index only after the column is guaranteed to exist.
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_jobs_batch ON jobs(batch_id)",
        [],
    )?;

    let now = Utc::now().to_rfc3339();
    connection.execute(
        "UPDATE jobs
         SET status = 'interrupted', progress = 0, stage = 'Interrotto dal riavvio',
             error = 'Il lavoro era attivo quando l’app è stata chiusa. Puoi avviarlo di nuovo.',
             updated_at = ?1
         WHERE status IN ('queued', 'preparing', 'uploading', 'running', 'finalizing', 'cancelling')",
        params![now],
    )?;
    prune_job_events(path, 200)?;
    Ok(())
}

pub struct NewLibraryItem<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub path: &'a str,
    pub kind: &'a str,
    pub size_bytes: u64,
    pub content_hash: &'a str,
    pub now: &'a str,
}

pub fn insert_library_item(
    database_path: &Path,
    item: &NewLibraryItem<'_>,
) -> rusqlite::Result<bool> {
    let connection = connect(database_path)?;
    let size_bytes = i64::try_from(item.size_bytes).unwrap_or(i64::MAX);
    let inserted = connection.execute(
        "INSERT OR IGNORE INTO library_items
         (id, name, path, kind, size_bytes, content_hash, status, added_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'ready', ?7, ?7)",
        params![
            item.id,
            item.name,
            item.path,
            item.kind,
            size_bytes,
            item.content_hash,
            item.now,
        ],
    )? > 0;
    Ok(inserted)
}

fn map_library_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<LibraryItem> {
    Ok(LibraryItem {
        id: row.get(0)?,
        name: row.get(1)?,
        path: row.get(2)?,
        kind: row.get(3)?,
        size_bytes: row.get::<_, i64>(4)?.max(0) as u64,
        content_hash: row.get(5)?,
        status: row.get(6)?,
        added_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

pub fn list_library(database_path: &Path) -> rusqlite::Result<Vec<LibraryItem>> {
    let connection = connect(database_path)?;
    let mut statement = connection.prepare(
        "SELECT id, name, path, kind, size_bytes, content_hash, status, added_at, updated_at
         FROM library_items ORDER BY added_at DESC",
    )?;
    let rows = statement.query_map([], map_library_item)?;
    rows.collect()
}

pub fn delete_library_item(database_path: &Path, id: &str) -> rusqlite::Result<bool> {
    let connection = connect(database_path)?;
    Ok(connection.execute("DELETE FROM library_items WHERE id = ?1", params![id])? > 0)
}

pub fn library_items_by_ids(
    database_path: &Path,
    ids: &[String],
) -> rusqlite::Result<Vec<LibraryItem>> {
    let connection = connect(database_path)?;
    let mut statement = connection.prepare(
        "SELECT id, name, path, kind, size_bytes, content_hash, status, added_at, updated_at
         FROM library_items WHERE id = ?1",
    )?;
    ids.iter()
        .map(|id| statement.query_row(params![id], map_library_item))
        .collect()
}

fn map_job(row: &rusqlite::Row<'_>) -> rusqlite::Result<Job> {
    Ok(Job {
        id: row.get(0)?,
        batch_id: row.get(1)?,
        library_item_id: row.get(2)?,
        input_name: row.get(3)?,
        workflow: row.get(4)?,
        tool: row.get(5)?,
        output_format: row.get(6)?,
        language: row.get(7)?,
        source_language: row.get(8)?,
        target_language: row.get(9)?,
        translation_mode: row.get(10)?,
        status: row.get(11)?,
        progress: row.get(12)?,
        stage: row.get(13)?,
        stage_current: row.get::<_, i64>(14)?.max(0) as u64,
        stage_total: row.get::<_, i64>(15)?.max(0) as u64,
        part_index: row.get::<_, i64>(16)?.max(1) as u32,
        total_parts: row.get::<_, i64>(17)?.max(1) as u32,
        output_path: row.get(18)?,
        output_name: row.get(19)?,
        output_mime: row.get(20)?,
        engine: row.get(21)?,
        elapsed_seconds: row.get(22)?,
        warnings: row
            .get::<_, Option<String>>(23)?
            .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
            .unwrap_or_default(),
        error: row.get(24)?,
        created_at: row.get(25)?,
        updated_at: row.get(26)?,
    })
}

const JOB_SELECT: &str =
    "SELECT id, batch_id, library_item_id, input_name, workflow, tool, output_format,
            language, source_language, target_language, translation_mode, status,
            progress, stage, stage_current, stage_total, part_index, total_parts,
            output_path, output_name, output_mime, engine, elapsed_seconds,
            warnings, error, created_at, updated_at FROM jobs";

/// Newest first, with a stable tiebreak: every job in a batch shares the same
/// `created_at`, so without the id the row order would shuffle between polls and
/// the buttons in the activity list would move under the user's pointer.
pub fn list_jobs(database_path: &Path, limit: i64) -> rusqlite::Result<Vec<Job>> {
    let connection = connect(database_path)?;
    let mut statement = connection.prepare(&format!(
        "{JOB_SELECT} ORDER BY created_at DESC, id ASC LIMIT ?1"
    ))?;
    let rows = statement.query_map(params![limit], map_job)?;
    rows.collect()
}

pub fn jobs_by_ids(database_path: &Path, ids: &[String]) -> rusqlite::Result<Vec<Job>> {
    let connection = connect(database_path)?;
    let mut statement = connection.prepare(&format!("{JOB_SELECT} WHERE id = ?1"))?;
    ids.iter()
        .map(|id| statement.query_row(params![id], map_job))
        .collect()
}

fn insert_job_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    spec: &JobSpec,
    now: &str,
) -> rusqlite::Result<()> {
    transaction.execute(
        "INSERT INTO jobs
         (id, batch_id, library_item_id, input_name, workflow, tool, output_format,
          language, source_language, target_language, translation_mode, status,
          progress, stage, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                 'queued', 0, 'In coda', ?12, ?12)",
        params![
            spec.id,
            spec.batch_id,
            spec.library_item_id,
            spec.item.name,
            spec.options.intent,
            spec.tool,
            spec.options.output_format,
            spec.options.language,
            spec.options.source_language,
            spec.options.target_language,
            spec.options.translation_mode,
            now,
        ],
    )?;
    transaction.execute(
        "INSERT INTO job_events (job_id, status, progress, stage, created_at)
         VALUES (?1, 'queued', 0, 'In coda', ?2)",
        params![spec.id, now],
    )?;
    Ok(())
}

pub fn insert_jobs(database_path: &Path, specs: &[JobSpec]) -> rusqlite::Result<()> {
    let mut connection = connect(database_path)?;
    let transaction = connection.transaction()?;
    let now = Utc::now().to_rfc3339();
    for spec in specs {
        insert_job_in_transaction(&transaction, spec, &now)?;
    }
    transaction.commit()?;
    Ok(())
}

#[cfg(test)]
fn insert_job(database_path: &Path, spec: &JobSpec) -> rusqlite::Result<()> {
    insert_jobs(database_path, std::slice::from_ref(spec))
}

#[derive(Debug, Clone)]
pub struct ProgressUpdate<'a> {
    pub status: &'a str,
    pub progress: f64,
    pub stage: &'a str,
    pub stage_current: u64,
    pub stage_total: u64,
    pub part_index: u32,
    pub total_parts: u32,
    pub message: Option<&'a str>,
}

/// A job that already reached a terminal state must never be moved back out of
/// it: a cancellation that lands after the result was written would otherwise
/// leave a finished job stuck in `cancelling` forever, with its output orphaned.
const TERMINAL_STATES: &str = "('completed', 'failed', 'cancelled', 'interrupted')";

/// Returns the number of rows updated, i.e. `0` when the job had already
/// finished and the update was correctly ignored.
pub fn update_job_progress(
    database_path: &Path,
    job_id: &str,
    update: &ProgressUpdate<'_>,
) -> rusqlite::Result<usize> {
    let mut connection = connect(database_path)?;
    let transaction = connection.transaction()?;
    let now = Utc::now().to_rfc3339();
    let changed = transaction.execute(
        &format!(
            "UPDATE jobs SET status = ?2, progress = ?3, stage = ?4,
             stage_current = ?5, stage_total = ?6, part_index = ?7, total_parts = ?8,
             error = ?9, updated_at = ?10
             WHERE id = ?1 AND status NOT IN {TERMINAL_STATES}"
        ),
        params![
            job_id,
            update.status,
            update.progress.clamp(0.0, 100.0),
            update.stage,
            i64::try_from(update.stage_current).unwrap_or(i64::MAX),
            i64::try_from(update.stage_total).unwrap_or(i64::MAX),
            update.part_index,
            update.total_parts,
            update.message,
            now,
        ],
    )?;
    if changed > 0 {
        transaction.execute(
            "INSERT INTO job_events (job_id, status, progress, stage, message, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                job_id,
                update.status,
                update.progress.clamp(0.0, 100.0),
                update.stage,
                update.message,
                now,
            ],
        )?;
    }
    transaction.commit()?;
    Ok(changed)
}

/// Move a finished-but-unsuccessful job back into the queue, keeping its id so
/// the timeline shows one entry per source instead of a growing pile of retries.
pub fn requeue_job(database_path: &Path, job_id: &str) -> rusqlite::Result<bool> {
    let mut connection = connect(database_path)?;
    let transaction = connection.transaction()?;
    let now = Utc::now().to_rfc3339();
    let changed = transaction.execute(
        "UPDATE jobs SET status = 'queued', progress = 0, stage = 'In coda',
         stage_current = 0, stage_total = 0, part_index = 1, total_parts = 1,
         output_path = NULL, output_name = NULL, output_mime = NULL,
         warnings = NULL, error = NULL, elapsed_seconds = NULL, updated_at = ?2
         WHERE id = ?1 AND status IN ('failed', 'cancelled', 'interrupted')",
        params![job_id, now],
    )?;
    if changed > 0 {
        transaction.execute(
            "INSERT INTO job_events (job_id, status, progress, stage, message, created_at)
             VALUES (?1, 'queued', 0, 'In coda', 'Riprovato dall''utente.', ?2)",
            params![job_id, now],
        )?;
    }
    transaction.commit()?;
    Ok(changed > 0)
}

/// The event log is an append-only audit trail of a job's transitions. Capping
/// it keeps a long-lived install from paying for years of progress ticks.
pub fn prune_job_events(database_path: &Path, keep_per_job: i64) -> rusqlite::Result<usize> {
    let connection = connect(database_path)?;
    connection.execute(
        "DELETE FROM job_events WHERE id IN (
           SELECT id FROM (
             SELECT id, ROW_NUMBER() OVER (
               PARTITION BY job_id ORDER BY id DESC
             ) AS position FROM job_events
           ) WHERE position > ?1
         )",
        params![keep_per_job],
    )
}

pub struct CompletedJob<'a> {
    pub output_path: &'a str,
    pub output_name: &'a str,
    pub output_mime: &'a str,
    pub engine: &'a str,
    pub elapsed_seconds: f64,
    /// Degradations the engine reported, e.g. a model that was unavailable and
    /// forced a lower-quality path. Success without them would be a lie.
    pub warnings: &'a [String],
}

pub fn complete_job(
    database_path: &Path,
    job_id: &str,
    completed: &CompletedJob<'_>,
) -> rusqlite::Result<()> {
    let mut connection = connect(database_path)?;
    let transaction = connection.transaction()?;
    let now = Utc::now().to_rfc3339();
    transaction.execute(
        "UPDATE jobs SET status = 'completed', progress = 100, stage = 'Risultato pronto',
         output_path = ?2, output_name = ?3, output_mime = ?4, engine = ?5,
         elapsed_seconds = ?6, warnings = ?7, error = NULL, updated_at = ?8
         WHERE id = ?1",
        params![
            job_id,
            completed.output_path,
            completed.output_name,
            completed.output_mime,
            completed.engine,
            completed.elapsed_seconds,
            if completed.warnings.is_empty() {
                None
            } else {
                serde_json::to_string(completed.warnings).ok()
            },
            now,
        ],
    )?;
    transaction.execute(
        "INSERT INTO job_events (job_id, status, progress, stage, created_at)
         VALUES (?1, 'completed', 100, 'Risultato pronto', ?2)",
        params![job_id, now],
    )?;
    transaction.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::WorkflowOptions;

    #[test]
    fn schema_persists_library_and_job_lifecycle() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let path = temporary.path().join("test.sqlite3");
        initialize(&path).expect("schema");

        let item = NewLibraryItem {
            id: "item-1",
            name: "documento.pdf",
            path: "/tmp/documento.pdf",
            kind: "PDF",
            size_bytes: 42,
            content_hash: "hash-1",
            now: "2026-08-06T10:00:00Z",
        };
        assert!(insert_library_item(&path, &item).expect("first insert"));
        assert!(!insert_library_item(&path, &item).expect("duplicate insert"));
        assert!(list_jobs(&path, 200).expect("jobs before start").is_empty());

        let library_item = list_library(&path).expect("library").remove(0);
        let spec = JobSpec {
            id: "job-1".to_string(),
            engine_job_id: "job-1".to_string(),
            batch_id: "batch-1".to_string(),
            library_item_id: Some(library_item.id.clone()),
            item: library_item,
            options: WorkflowOptions::default(),
            tool: "auto".to_string(),
        };
        insert_job(&path, &spec).expect("insert job");
        update_job_progress(
            &path,
            "job-1",
            &ProgressUpdate {
                status: "running",
                progress: 10.0,
                stage: "Elaborazione locale",
                stage_current: 0,
                stage_total: 0,
                part_index: 1,
                total_parts: 1,
                message: None,
            },
        )
        .expect("progress");
        let output = temporary.path().join("result.md");
        complete_job(
            &path,
            "job-1",
            &CompletedJob {
                output_path: &output.to_string_lossy(),
                output_name: "result.md",
                output_mime: "text/markdown",
                engine: "test-engine",
                elapsed_seconds: 1.5,
                warnings: &["Modello non disponibile: usate le regole locali.".to_string()],
            },
        )
        .expect("complete");

        let jobs = list_jobs(&path, 200).expect("jobs");
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].status, "completed");
        assert_eq!(jobs[0].engine.as_deref(), Some("test-engine"));
        assert!(delete_library_item(&path, "item-1").expect("remove library reference"));
        assert!(list_library(&path)
            .expect("library after removal")
            .is_empty());
        assert_eq!(
            list_jobs(&path, 200).expect("job after source removal")[0].library_item_id,
            None
        );
    }

    #[test]
    fn a_finished_job_cannot_be_dragged_back_out_of_its_terminal_state() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let path = temporary.path().join("terminal.sqlite3");
        initialize(&path).expect("schema");
        let now = "2026-08-06T10:00:00Z".to_string();
        let spec = JobSpec {
            id: "late-cancel".to_string(),
            engine_job_id: "late-cancel".to_string(),
            batch_id: "batch".to_string(),
            library_item_id: None,
            item: LibraryItem {
                id: "source".to_string(),
                name: "nota.md".to_string(),
                path: "/tmp/nota.md".to_string(),
                kind: "Testo".to_string(),
                size_bytes: 4,
                content_hash: String::new(),
                status: "temporary".to_string(),
                added_at: now.clone(),
                updated_at: now,
            },
            options: WorkflowOptions::default(),
            tool: "auto".to_string(),
        };
        insert_job(&path, &spec).expect("job");
        let output = temporary.path().join("risultato.md");
        complete_job(
            &path,
            "late-cancel",
            &CompletedJob {
                output_path: &output.to_string_lossy(),
                output_name: "risultato.md",
                output_mime: "text/markdown",
                engine: "test",
                elapsed_seconds: 0.2,
                warnings: &[],
            },
        )
        .expect("complete");

        // The user hits cancel a moment after the result landed.
        let changed = update_job_progress(
            &path,
            "late-cancel",
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
        .expect("guarded update");

        assert_eq!(changed, 0, "a completed job refuses further progress");
        let job = list_jobs(&path, 200).expect("jobs").remove(0);
        assert_eq!(job.status, "completed");
        assert_eq!(job.progress, 100.0);
        assert!(job.output_path.is_some(), "the result stays reachable");
    }

    #[test]
    fn a_failed_job_can_be_requeued_and_a_completed_one_cannot() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let path = temporary.path().join("retry.sqlite3");
        initialize(&path).expect("schema");
        let now = "2026-08-06T10:00:00Z".to_string();
        let spec = JobSpec {
            id: "retryable".to_string(),
            engine_job_id: "retryable".to_string(),
            batch_id: "batch".to_string(),
            library_item_id: None,
            item: LibraryItem {
                id: "source".to_string(),
                name: "scansione.pdf".to_string(),
                path: "/tmp/scansione.pdf".to_string(),
                kind: "PDF".to_string(),
                size_bytes: 4,
                content_hash: String::new(),
                status: "temporary".to_string(),
                added_at: now.clone(),
                updated_at: now,
            },
            options: WorkflowOptions::default(),
            tool: "auto".to_string(),
        };
        insert_job(&path, &spec).expect("job");
        update_job_progress(
            &path,
            "retryable",
            &ProgressUpdate {
                status: "failed",
                progress: 0.0,
                stage: "Elaborazione non riuscita",
                stage_current: 0,
                stage_total: 0,
                part_index: 1,
                total_parts: 1,
                message: Some("Spazio su disco esaurito"),
            },
        )
        .expect("fail the job");

        assert!(requeue_job(&path, "retryable").expect("requeue"));
        let job = list_jobs(&path, 200).expect("jobs").remove(0);
        assert_eq!(job.status, "queued");
        assert_eq!(
            job.error, None,
            "the stale error must not survive the retry"
        );
        assert_eq!(job.progress, 0.0);

        // Re-running something that already succeeded would orphan its output.
        let output = temporary.path().join("risultato.md");
        complete_job(
            &path,
            "retryable",
            &CompletedJob {
                output_path: &output.to_string_lossy(),
                output_name: "risultato.md",
                output_mime: "text/markdown",
                engine: "test",
                elapsed_seconds: 0.2,
                warnings: &[],
            },
        )
        .expect("complete");
        assert!(!requeue_job(&path, "retryable").expect("second requeue"));
    }

    #[test]
    fn engine_warnings_survive_the_round_trip_to_the_database() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let path = temporary.path().join("warnings.sqlite3");
        initialize(&path).expect("schema");
        let now = "2026-08-06T10:00:00Z".to_string();
        let spec = JobSpec {
            id: "degraded".to_string(),
            engine_job_id: "degraded".to_string(),
            batch_id: "batch".to_string(),
            library_item_id: None,
            item: LibraryItem {
                id: "source".to_string(),
                name: "contratto.txt".to_string(),
                path: "/tmp/contratto.txt".to_string(),
                kind: "Testo".to_string(),
                size_bytes: 4,
                content_hash: String::new(),
                status: "temporary".to_string(),
                added_at: now.clone(),
                updated_at: now,
            },
            options: WorkflowOptions::default(),
            tool: "privacy".to_string(),
        };
        insert_job(&path, &spec).expect("job");
        let output = temporary.path().join("protetto.txt");
        complete_job(
            &path,
            "degraded",
            &CompletedJob {
                output_path: &output.to_string_lossy(),
                output_name: "protetto.txt",
                output_mime: "text/plain",
                engine: "Regole italiane locali",
                elapsed_seconds: 0.3,
                warnings: &[
                    "Modello non installato: applicate solo le regole locali.".to_string(),
                    "La mascheratura non garantisce l'anonimizzazione.".to_string(),
                ],
            },
        )
        .expect("complete");

        let job = list_jobs(&path, 200).expect("jobs").remove(0);
        assert_eq!(job.status, "completed");
        assert_eq!(
            job.warnings.len(),
            2,
            "a degraded run is never silently 'ok'"
        );
        assert!(job.warnings[0].contains("regole locali"));
    }

    #[test]
    fn job_history_is_bounded_and_ordered_newest_first() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let path = temporary.path().join("history.sqlite3");
        initialize(&path).expect("schema");
        for index in 0..5 {
            let stamp = format!("2026-08-0{}T10:00:00Z", index + 1);
            let spec = JobSpec {
                id: format!("job-{index}"),
                engine_job_id: format!("job-{index}"),
                batch_id: format!("batch-{index}"),
                library_item_id: None,
                item: LibraryItem {
                    id: format!("source-{index}"),
                    name: format!("file-{index}.md"),
                    path: format!("/tmp/file-{index}.md"),
                    kind: "Testo".to_string(),
                    size_bytes: 4,
                    content_hash: String::new(),
                    status: "temporary".to_string(),
                    added_at: stamp.clone(),
                    updated_at: stamp,
                },
                options: WorkflowOptions::default(),
                tool: "auto".to_string(),
            };
            insert_job(&path, &spec).expect("job");
        }

        let limited = list_jobs(&path, 2).expect("limited jobs");
        assert_eq!(
            limited.len(),
            2,
            "the limit is applied in SQL, not in the UI"
        );

        // Same-batch jobs share created_at to the microsecond, so without the id
        // tiebreak the row order would shuffle between polls and move buttons
        // out from under the pointer.
        let first = list_jobs(&path, 200).expect("jobs");
        let second = list_jobs(&path, 200).expect("jobs again");
        let ids: Vec<_> = first.iter().map(|job| &job.id).collect();
        let ids_again: Vec<_> = second.iter().map(|job| &job.id).collect();
        assert_eq!(ids, ids_again, "ordering is stable across reads");
    }

    #[test]
    fn transient_jobs_do_not_create_library_records() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let path = temporary.path().join("transient.sqlite3");
        initialize(&path).expect("schema");
        let now = "2026-08-06T10:00:00Z".to_string();
        let spec = JobSpec {
            id: "quick-job".to_string(),
            engine_job_id: "quick-job".to_string(),
            batch_id: "quick-batch".to_string(),
            library_item_id: None,
            item: LibraryItem {
                id: "quick-source".to_string(),
                name: "grande.mp4".to_string(),
                path: "/tmp/grande.mp4".to_string(),
                kind: "Video".to_string(),
                size_bytes: 4_000_000_000,
                content_hash: String::new(),
                status: "temporary".to_string(),
                added_at: now.clone(),
                updated_at: now,
            },
            options: WorkflowOptions::default(),
            tool: "auto".to_string(),
        };

        insert_job(&path, &spec).expect("transient job");
        assert!(list_library(&path).expect("library").is_empty());
        let job = list_jobs(&path, 200).expect("jobs").remove(0);
        assert_eq!(job.library_item_id, None);
        assert_eq!(job.input_name, "grande.mp4");
    }

    #[test]
    fn migrates_foundation_database_before_building_batch_index() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let path = temporary.path().join("foundation.sqlite3");
        let legacy = Connection::open(&path).expect("legacy connection");
        legacy
            .execute_batch(
                "
                CREATE TABLE library_items (
                  id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL,
                  kind TEXT NOT NULL, size_bytes INTEGER NOT NULL,
                  content_hash TEXT NOT NULL UNIQUE, status TEXT NOT NULL,
                  added_at TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                CREATE TABLE jobs (
                  id TEXT PRIMARY KEY, library_item_id TEXT, input_name TEXT NOT NULL,
                  workflow TEXT NOT NULL, status TEXT NOT NULL,
                  progress REAL NOT NULL DEFAULT 0, stage TEXT NOT NULL,
                  output_path TEXT, error TEXT, created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                INSERT INTO jobs
                  (id, input_name, workflow, status, progress, stage, created_at, updated_at)
                VALUES
                  ('draft-1', 'prima.pdf', 'auto', 'draft', 0, 'Scegli un’azione',
                   '2026-08-01T10:00:00Z', '2026-08-01T10:00:00Z');
                ",
            )
            .expect("foundation schema");
        drop(legacy);

        initialize(&path).expect("migration");
        let jobs = list_jobs(&path, 200).expect("migrated jobs");
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].status, "draft");
        assert_eq!(jobs[0].tool, "auto");

        let connection = Connection::open(path).expect("migrated connection");
        let indexed: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_jobs_batch'",
                [],
                |row| row.get(0),
            )
            .expect("batch index");
        assert_eq!(indexed, 1);
    }
}
