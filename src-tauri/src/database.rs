use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};

use crate::models::{Job, LibraryItem};

#[derive(Debug)]
pub struct AppState {
    pub database_path: PathBuf,
    pub data_dir: PathBuf,
}

fn connect(path: &Path) -> rusqlite::Result<Connection> {
    let connection = Connection::open(path)?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.busy_timeout(std::time::Duration::from_secs(5))?;
    Ok(connection)
}

pub fn initialize(path: &Path) -> rusqlite::Result<()> {
    let connection = connect(path)?;
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
          library_item_id TEXT,
          input_name TEXT NOT NULL,
          workflow TEXT NOT NULL,
          status TEXT NOT NULL,
          progress REAL NOT NULL DEFAULT 0,
          stage TEXT NOT NULL,
          output_path TEXT,
          error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(library_item_id) REFERENCES library_items(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_library_added_at ON library_items(added_at DESC);
        CREATE INDEX IF NOT EXISTS idx_jobs_updated_at ON jobs(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
        ",
    )?;
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
    let mut connection = connect(database_path)?;
    let transaction = connection.transaction()?;
    let size_bytes = i64::try_from(item.size_bytes).unwrap_or(i64::MAX);
    let inserted = transaction.execute(
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

    if inserted {
        transaction.execute(
            "INSERT INTO jobs
             (id, library_item_id, input_name, workflow, status, progress, stage, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'auto', 'draft', 0, 'Scegli un’azione', ?4, ?4)",
            params![uuid::Uuid::new_v4().to_string(), item.id, item.name, item.now],
        )?;
    }

    transaction.commit()?;
    Ok(inserted)
}

pub fn list_library(database_path: &Path) -> rusqlite::Result<Vec<LibraryItem>> {
    let connection = connect(database_path)?;
    let mut statement = connection.prepare(
        "SELECT id, name, path, kind, size_bytes, content_hash, status, added_at, updated_at
         FROM library_items ORDER BY added_at DESC",
    )?;
    let rows = statement.query_map([], |row| {
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
    })?;
    rows.collect()
}

pub fn list_jobs(database_path: &Path) -> rusqlite::Result<Vec<Job>> {
    let connection = connect(database_path)?;
    let mut statement = connection.prepare(
        "SELECT id, library_item_id, input_name, workflow, status, progress, stage,
                output_path, error, created_at, updated_at
         FROM jobs ORDER BY updated_at DESC",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(Job {
            id: row.get(0)?,
            library_item_id: row.get(1)?,
            input_name: row.get(2)?,
            workflow: row.get(3)?,
            status: row.get(4)?,
            progress: row.get(5)?,
            stage: row.get(6)?,
            output_path: row.get(7)?,
            error: row.get(8)?,
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
        })
    })?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_persists_library_items_and_draft_jobs() {
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
        assert_eq!(list_library(&path).expect("library").len(), 1);

        let jobs = list_jobs(&path).expect("jobs");
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].status, "draft");
    }
}
