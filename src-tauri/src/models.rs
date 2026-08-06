use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryItem {
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: String,
    pub size_bytes: u64,
    pub content_hash: String,
    pub status: String,
    pub added_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub batch_id: Option<String>,
    pub library_item_id: Option<String>,
    pub input_name: String,
    pub workflow: String,
    pub tool: String,
    pub output_format: String,
    pub language: String,
    pub source_language: String,
    pub target_language: String,
    pub translation_mode: String,
    pub status: String,
    pub progress: f64,
    pub stage: String,
    pub stage_current: u64,
    pub stage_total: u64,
    pub part_index: u32,
    pub total_parts: u32,
    pub output_path: Option<String>,
    pub output_name: Option<String>,
    pub output_mime: Option<String>,
    pub engine: Option<String>,
    pub elapsed_seconds: Option<f64>,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStatus {
    pub available: bool,
    pub local_only: bool,
    pub ready_engines: usize,
    pub total_engines: usize,
    pub batch_parallelism: usize,
    pub label: String,
    pub engines: Vec<EngineStatus>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub id: String,
    pub state: String,
    pub label: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemSnapshot {
    pub operating_system: String,
    pub platform_label: String,
    pub compute_label: String,
    pub architecture: String,
    pub logical_cpus: usize,
    pub total_memory_bytes: u64,
    pub available_memory_bytes: u64,
    pub data_directory: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub platform: String,
    pub supported: bool,
    pub installed: bool,
    pub running: bool,
    pub installing: bool,
    pub data_directory: String,
    pub log_path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub library: Vec<LibraryItem>,
    pub jobs: Vec<Job>,
    pub bridge: BridgeStatus,
    pub system: SystemSnapshot,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub imported: usize,
    pub duplicates: usize,
    pub rejected: Vec<String>,
    pub snapshot: AppSnapshot,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowOptions {
    pub intent: String,
    pub output_format: String,
    pub language: String,
    pub source_language: String,
    pub target_language: String,
    pub translation_mode: String,
}

impl Default for WorkflowOptions {
    fn default() -> Self {
        Self {
            intent: "extract".to_string(),
            output_format: "markdown".to_string(),
            language: "auto".to_string(),
            source_language: "en".to_string(),
            target_language: "it".to_string(),
            translation_mode: "translated".to_string(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct JobSpec {
    pub id: String,
    pub batch_id: String,
    pub item: LibraryItem,
    pub options: WorkflowOptions,
    pub tool: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartJobsReport {
    pub batch_id: String,
    pub job_ids: Vec<String>,
    pub snapshot: AppSnapshot,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    pub path: String,
    pub filename: String,
    pub file_count: usize,
}
