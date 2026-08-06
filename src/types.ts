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
  libraryItemId: string | null;
  inputName: string;
  workflow: string;
  status: string;
  progress: number;
  stage: string;
  outputPath: string | null;
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
  label: string;
  engines: EngineStatus[];
}

export interface SystemSnapshot {
  architecture: string;
  logicalCpus: number;
  totalMemoryBytes: number;
  availableMemoryBytes: number;
  dataDirectory: string;
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
