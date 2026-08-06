import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { AlertCircle, CheckCircle2, FileUp, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import "./App.css";
import { ActivityView } from "./components/ActivityView";
import { Dashboard } from "./components/Dashboard";
import { LibraryView } from "./components/LibraryView";
import { ModelsView } from "./components/ModelsView";
import { PlaceholderView } from "./components/PlaceholderView";
import { Sidebar } from "./components/Sidebar";
import { StudioView } from "./components/StudioView";
import { Topbar } from "./components/Topbar";
import type {
  AppSnapshot,
  BridgeStatus,
  ExportReport,
  ImportReport,
  Job,
  LibraryItem,
  QuickFilesReport,
  SectionId,
  StartJobsReport,
  RuntimeStatus,
  WorkflowOptions,
} from "./types";

const activeJobStates = new Set([
  "queued",
  "preparing",
  "uploading",
  "running",
  "finalizing",
  "cancelling",
]);

const emptySnapshot: AppSnapshot = {
  library: [],
  jobs: [],
  bridge: {
    available: false,
    localOnly: true,
    readyEngines: 0,
    totalEngines: 0,
    batchParallelism: 3,
    label: "Verifica motori…",
    engines: [],
  },
  system: {
    operatingSystem: "—",
    platformLabel: "—",
    computeLabel: "—",
    architecture: "—",
    logicalCpus: 0,
    totalMemoryBytes: 0,
    availableMemoryBytes: 0,
    dataDirectory: "—",
  },
};

const emptyRuntime: RuntimeStatus = {
  platform: "—",
  supported: true,
  installed: false,
  running: false,
  installing: false,
  dataDirectory: "—",
  logPath: "—",
  message: "Verifica del runtime…",
};

interface Notice {
  tone: "success" | "error";
  title: string;
  detail: string;
}

function App() {
  const [active, setActive] = useState<SectionId>("home");
  const [snapshot, setSnapshot] = useState<AppSnapshot>(emptySnapshot);
  const [runtime, setRuntime] = useState<RuntimeStatus>(emptyRuntime);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [quickItems, setQuickItems] = useState<LibraryItem[]>([]);
  const [dropActive, setDropActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const inspectingRef = useRef(false);

  const addQuickPaths = useCallback(async (paths: string[]) => {
    if (!isTauri() || !paths.length || inspectingRef.current) return;
    inspectingRef.current = true;
    setInspecting(true);
    setNotice(null);
    try {
      const report = await invoke<QuickFilesReport>("inspect_quick_files", { paths });
      setQuickItems((current) => {
        const next = new Map(current.map((item) => [item.path, item]));
        for (const item of report.files) next.set(item.path, next.get(item.path) ?? item);
        return Array.from(next.values());
      });
      if (report.files.length) setActive("studio");
      setNotice({
        tone: report.rejected.length ? "error" : "success",
        title: report.rejected.length ? "Selezione parziale" : "File pronti, senza archiviarli",
        detail: `${report.files.length} ${report.files.length === 1 ? "file temporaneo" : "file temporanei"}${
          report.rejected.length ? ` · ${report.rejected.length} non accettati` : " · pulizia automatica dopo il lavoro"
        }`,
      });
    } catch (error) {
      setNotice({ tone: "error", title: "File non disponibili", detail: String(error) });
    } finally {
      inspectingRef.current = false;
      setInspecting(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      if (!isTauri()) {
        if (mounted) {
          setLoading(false);
          setNotice({
            tone: "error",
            title: "Anteprima browser",
            detail: "Apri l’app nativa per usare libreria, file e motori locali.",
          });
        }
        return;
      }

      try {
        const [initial, runtimeStatus] = await Promise.all([
          invoke<AppSnapshot>("bootstrap_snapshot"),
          invoke<RuntimeStatus>("get_runtime_status"),
        ]);
        if (mounted) {
          setSnapshot(initial);
          setRuntime(runtimeStatus);
        }
      } catch (error) {
        if (mounted) {
          setNotice({
            tone: "error",
            title: "Avvio incompleto",
            detail: String(error),
          });
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void bootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "drop") {
          setDropActive(false);
          void addQuickPaths(event.payload.paths);
        } else {
          setDropActive(event.payload.type === "enter" || event.payload.type === "over");
        }
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [addQuickPaths]);

  useEffect(() => {
    if (!isTauri()) return;
    let stopped = false;
    const refreshBridge = () => {
      void Promise.all([
        invoke<BridgeStatus>("get_bridge_status"),
        invoke<RuntimeStatus>("get_runtime_status"),
      ])
        .then(([bridge, runtimeStatus]) => {
          if (!stopped) {
            setSnapshot((current) => ({ ...current, bridge }));
            setRuntime(runtimeStatus);
          }
        })
        .catch(() => undefined);
    };
    const timer = window.setInterval(refreshBridge, 4_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  const hasActiveJobs = snapshot.jobs.some((job) => activeJobStates.has(job.status));

  useEffect(() => {
    if (!isTauri() || !hasActiveJobs) return;
    let stopped = false;
    const timer = window.setInterval(() => {
      void invoke<Job[]>("list_jobs")
        .then((jobs) => {
          if (!stopped) setSnapshot((current) => ({ ...current, jobs }));
        })
        .catch(() => undefined);
    }, 700);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [hasActiveJobs]);

  async function handleImport() {
    if (!isTauri() || importing) return;
    setNotice(null);

    try {
      const selection = await open({
        multiple: true,
        directory: false,
        title: "Importa nella libreria privata",
      });
      const paths = typeof selection === "string" ? [selection] : selection ?? [];
      if (!paths.length) return;

      setImporting(true);
      const report = await invoke<ImportReport>("import_files", { paths });
      setSnapshot(report.snapshot);

      const details = [
        `${report.imported} ${report.imported === 1 ? "file aggiunto" : "file aggiunti"}`,
        report.duplicates ? `${report.duplicates} già presenti` : null,
        report.rejected.length ? `${report.rejected.length} non importati` : null,
      ].filter(Boolean);
      setNotice({
        tone: report.rejected.length ? "error" : "success",
        title: report.rejected.length ? "Importazione parziale" : "Importazione completata",
        detail: details.join(" · "),
      });
      if (report.imported > 0) setActive("library");
    } catch (error) {
      setNotice({
        tone: "error",
        title: "Importazione non riuscita",
        detail: String(error),
      });
    } finally {
      setImporting(false);
    }
  }

  async function handleQuickPick() {
    if (!isTauri() || inspectingRef.current) return;
    try {
      const selection = await open({
        multiple: true,
        directory: false,
        title: "Elabora senza aggiungere alla libreria",
      });
      const paths = typeof selection === "string" ? [selection] : selection ?? [];
      await addQuickPaths(paths);
    } catch (error) {
      setNotice({ tone: "error", title: "Selezione non riuscita", detail: String(error) });
    }
  }

  async function handleStart(
    itemIds: string[],
    quickPaths: string[],
    options: WorkflowOptions,
  ) {
    if (!isTauri() || starting) return;
    setStarting(true);
    setNotice(null);
    try {
      const report = await invoke<StartJobsReport>("start_jobs", {
        itemIds,
        quickPaths,
        options,
      });
      setSnapshot(report.snapshot);
      if (quickPaths.length) {
        const startedPaths = new Set(quickPaths);
        setQuickItems((current) => current.filter((item) => !startedPaths.has(item.path)));
      }
      setNotice({
        tone: "success",
        title: "Batch avviato",
        detail: `${report.jobIds.length} ${report.jobIds.length === 1 ? "lavoro" : "lavori"} affidati allo scheduler locale`,
      });
      setActive("activity");
    } catch (error) {
      setNotice({ tone: "error", title: "Avvio non riuscito", detail: String(error) });
    } finally {
      setStarting(false);
    }
  }

  async function handleRemoveLibraryItem(itemId: string) {
    try {
      const current = await invoke<AppSnapshot>("remove_library_item", { itemId });
      setSnapshot(current);
      setNotice({
        tone: "success",
        title: "Rimosso dalla libreria",
        detail: "Il riferimento è stato eliminato. Il file originale e i risultati restano intatti.",
      });
    } catch (error) {
      setNotice({ tone: "error", title: "Rimozione non riuscita", detail: String(error) });
    }
  }

  async function refreshJobs() {
    const jobs = await invoke<Job[]>("list_jobs");
    setSnapshot((current) => ({ ...current, jobs }));
  }

  async function handleCancel(jobId: string) {
    try {
      await invoke<boolean>("cancel_job", { jobId });
      await refreshJobs();
    } catch (error) {
      setNotice({ tone: "error", title: "Annullamento non riuscito", detail: String(error) });
    }
  }

  async function handleCancelAll() {
    try {
      const count = await invoke<number>("cancel_all_jobs");
      await refreshJobs();
      setNotice({
        tone: "success",
        title: "Annullamento richiesto",
        detail: `${count} ${count === 1 ? "lavoro attivo" : "lavori attivi"}`,
      });
    } catch (error) {
      setNotice({ tone: "error", title: "Annullamento non riuscito", detail: String(error) });
    }
  }

  async function handleExport(jobIds: string[]) {
    try {
      const report = await invoke<ExportReport>("export_results", { jobIds });
      setNotice({
        tone: "success",
        title: "ZIP creato in Download",
        detail: `${report.filename} · ${report.fileCount} risultati`,
      });
    } catch (error) {
      setNotice({ tone: "error", title: "Esportazione non riuscita", detail: String(error) });
    }
  }

  async function handleReveal(jobId: string) {
    try {
      await invoke("reveal_job_result", { jobId });
    } catch (error) {
      setNotice({ tone: "error", title: "Risultato non disponibile", detail: String(error) });
    }
  }

  async function handleRuntimeAction() {
    try {
      const command = runtime.installed ? "start_engine_runtime" : "install_engine_runtime";
      const next = await invoke<RuntimeStatus>(command);
      setRuntime(next);
      setNotice({
        tone: "success",
        title: runtime.installed ? "Avvio richiesto" : "Installazione avviata",
        detail: runtime.installed
          ? "I motori saranno disponibili tra pochi secondi."
          : "Il download prosegue in background; puoi seguirlo nella schermata Motori.",
      });
    } catch (error) {
      setNotice({ tone: "error", title: "Runtime non disponibile", detail: String(error) });
    }
  }

  function renderView() {
    if (active === "home") {
      return (
        <Dashboard
          onImport={() => void handleImport()}
          onNavigate={setActive}
          onQuickPick={() => void handleQuickPick()}
          snapshot={snapshot}
        />
      );
    }
    if (active === "library") {
      return (
        <LibraryView
          items={snapshot.library}
          onImport={() => void handleImport()}
          onRemove={(itemId) => void handleRemoveLibraryItem(itemId)}
        />
      );
    }
    if (active === "studio") {
      return (
        <StudioView
          bridge={snapshot.bridge}
          items={snapshot.library}
          onImport={() => void handleImport()}
          onQuickPick={() => void handleQuickPick()}
          onClearQuick={() => setQuickItems([])}
          onStart={(itemIds, quickPaths, options) =>
            void handleStart(itemIds, quickPaths, options)
          }
          quickItems={quickItems}
          starting={starting}
        />
      );
    }
    if (active === "activity") {
      return (
        <ActivityView
          jobs={snapshot.jobs}
          onCancel={(jobId) => void handleCancel(jobId)}
          onCancelAll={() => void handleCancelAll()}
          onExport={(jobIds) => void handleExport(jobIds)}
          onReveal={(jobId) => void handleReveal(jobId)}
        />
      );
    }
    if (active === "models") {
      return (
        <ModelsView
          bridge={snapshot.bridge}
          onRuntimeAction={() => void handleRuntimeAction()}
          runtime={runtime}
          system={snapshot.system}
        />
      );
    }
    return <PlaceholderView onNavigate={setActive} section={active} snapshot={snapshot} />;
  }

  return (
    <div className="app-shell">
      <Sidebar
        active={active}
        jobCount={snapshot.jobs.filter((job) => activeJobStates.has(job.status)).length}
        onNavigate={setActive}
      />
      <div className="workspace">
        <Topbar
          active={active}
          bridge={snapshot.bridge}
          importing={importing}
          onImport={() => void handleImport()}
        />
        <main className="main-content" aria-busy={loading}>
          {loading ? (
            <div className="loading-state" role="status">
              <span className="loading-mark">L/AI</span>
              <strong>Preparazione del workspace locale…</strong>
            </div>
          ) : (
            renderView()
          )}
        </main>
      </div>

      {notice ? (
        <div className="toast" data-tone={notice.tone} role="status">
          {notice.tone === "success" ? (
            <CheckCircle2 size={19} />
          ) : (
            <AlertCircle size={19} />
          )}
          <div>
            <strong>{notice.title}</strong>
            <span>{notice.detail}</span>
          </div>
          <button aria-label="Chiudi messaggio" onClick={() => setNotice(null)} type="button">
            <X size={16} />
          </button>
        </div>
      ) : null}
      {dropActive ? (
        <div className="drop-overlay" role="status">
          <div>
            <FileUp size={34} />
            <strong>Rilascia per elaborare</strong>
            <span>Niente Libreria · originali intatti · pulizia automatica</span>
          </div>
        </div>
      ) : null}
      {inspecting ? <span className="sr-only" role="status">Lettura dei file…</span> : null}
    </div>
  );
}

export default App;
