export type SectionId =
  | "home"
  | "library"
  | "studio"
  | "workflows"
  | "activity"
  | "models"
  | "settings";

export interface LibraryItem {
  id: string;
  name: string;
  path: string;
  kind: string;
  sizeBytes: number;
  contentHash: string;
  status: string;
  addedAt: string;
  updatedAt: string;
}

export interface Job {
  id: string;
  batchId: string | null;
  libraryItemId: string | null;
  inputName: string;
  workflow: string;
  tool: string;
  outputFormat: string;
  language: string;
  sourceLanguage: string;
  targetLanguage: string;
  translationMode: string;
  status: string;
  progress: number;
  stage: string;
  stageCurrent: number;
  stageTotal: number;
  partIndex: number;
  totalParts: number;
  outputPath: string | null;
  outputName: string | null;
  outputMime: string | null;
  engine: string | null;
  elapsedSeconds: number | null;
  /** Quality caveats reported by the engine on an otherwise successful run. */
  warnings: string[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EngineStatus {
  id: string;
  state: string;
  label: string;
  version: string | null;
}

export interface BridgeStatus {
  available: boolean;
  localOnly: boolean;
  readyEngines: number;
  totalEngines: number;
  batchParallelism: number;
  label: string;
  engines: EngineStatus[];
}

export interface SystemSnapshot {
  operatingSystem: string;
  platformLabel: string;
  computeLabel: string;
  architecture: string;
  logicalCpus: number;
  totalMemoryBytes: number;
  availableMemoryBytes: number;
  dataDirectory: string;
}

export interface RuntimeStatus {
  platform: string;
  supported: boolean;
  installed: boolean;
  running: boolean;
  installing: boolean;
  dataDirectory: string;
  logPath: string;
  runtimeLogPath: string;
  message: string;
}

export interface AppSnapshot {
  library: LibraryItem[];
  jobs: Job[];
  bridge: BridgeStatus;
  system: SystemSnapshot;
}

export interface ImportReport {
  imported: number;
  duplicates: number;
  rejected: string[];
  snapshot: AppSnapshot;
}

export interface QuickFilesReport {
  files: LibraryItem[];
  rejected: string[];
}

export type WorkflowIntent = "extract" | "translate" | "ocr" | "transcribe" | "privacy";

export interface WorkflowOptions {
  intent: WorkflowIntent;
  outputFormat: string;
  language: string;
  sourceLanguage: string;
  targetLanguage: string;
  translationMode: "translated" | "bilingual";
}

export interface StartJobsReport {
  batchId: string;
  jobIds: string[];
  snapshot: AppSnapshot;
}

export interface ExportReport {
  path: string;
  filename: string;
  fileCount: number;
}
