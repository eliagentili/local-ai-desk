use serde::Serialize;

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
    pub library_item_id: Option<String>,
    pub input_name: String,
    pub workflow: String,
    pub status: String,
    pub progress: f64,
    pub stage: String,
    pub output_path: Option<String>,
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
    pub architecture: String,
    pub logical_cpus: usize,
    pub total_memory_bytes: u64,
    pub available_memory_bytes: u64,
    pub data_directory: String,
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
