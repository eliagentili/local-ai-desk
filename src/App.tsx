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
import { SettingsView } from "./components/SettingsView";
import { Sidebar } from "./components/Sidebar";
import { StudioView } from "./components/StudioView";
import { Topbar } from "./components/Topbar";
import { UpdateBanner } from "./components/UpdateBanner";
import { WelcomeView } from "./components/WelcomeView";
import { useAppUpdater } from "./hooks/useAppUpdater";
import { describeError } from "./lib/errors";
import {
  announce,
  jobHistory,
  license,
  sectionTitles,
  updatePhaseStatus,
} from "./lib/strings";
import type {
  AppSnapshot,
  BridgeStatus,
  ExportReport,
  ImportReport,
  Job,
  JobEvent,
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

/** Percentages worth interrupting a screen reader for. A download announced on
 *  every repaint — about eight times a second — is unusable. */
const updateAnnouncementThresholds = [25, 50, 75, 100];

/** Update phases where one sentence is genuinely news. `checking` and
 *  `downloading` are excluded: the first is noise, the second has thresholds. */
const announcedUpdatePhases = new Set([
  "current",
  "available",
  "downloaded",
  "installing",
  "ready",
  "error",
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
  runtimeLogPath: "—",
  modelsDirectory: "—",
  modelsServerExposed: false,
  installStep: 0,
  installStepTotal: 0,
  installStepLabel: "",
  freeBytes: 0,
  requiredBytes: 0,
  message: "Verifica del runtime…",
};

interface Notice {
  tone: "success" | "error";
  title: string;
  detail: string;
  /** Per-file reasons the backend computed. Dropping them left the user with a
   *  count and no way to know which file failed or why. */
  reasons?: string[];
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
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [cancellingInstall, setCancellingInstall] = useState(false);
  const [welcomePostponed, setWelcomePostponed] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [noticeHeld, setNoticeHeld] = useState(false);
  const [sectionAnnouncement, setSectionAnnouncement] = useState("");
  const [jobAnnouncement, setJobAnnouncement] = useState("");
  const [failureAnnouncement, setFailureAnnouncement] = useState("");
  const [runtimeAnnouncement, setRuntimeAnnouncement] = useState("");
  const [updateAnnouncement, setUpdateAnnouncement] = useState("");
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
        reasons: report.rejected,
      });
    } catch (error) {
      setNotice({ tone: "error", title: "File non disponibili", detail: describeError(error) });
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
            detail: describeError(error),
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

  // A toast that never leaves covers the corner of the window for the rest of the
  // session, so confirmations expire. Errors do not: the reason a file was
  // rejected is the only record of it, and twelve seconds was not enough to read
  // four reasons. Hovering or focusing the toast holds it, which is what makes a
  // long list readable at all; leaving restarts the countdown from the top.
  useEffect(() => {
    if (!notice || notice.tone === "error" || noticeHeld) return;
    const timer = window.setTimeout(() => setNotice(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [notice, noticeHeld]);

  const hasActiveJobs = snapshot.jobs.some((job) => activeJobStates.has(job.status));
  const updater = useAppUpdater(hasActiveJobs);
  const showUpdateBanner =
    !updater.dismissed &&
    ["available", "downloading", "downloaded", "installing", "ready"].includes(updater.phase);

  // Jobs whose outcome this session is responsible for announcing. Built from the
  // ids the core just returned, never from `list_jobs`: that is a window capped at
  // a few hundred rows, so deriving the batch from it would announce history.
  const watchedJobsRef = useRef<Set<string>>(new Set());
  const jobStatusRef = useRef<Map<string, string>>(new Map());

  // The end of a job is the moment that matters most and it happens off-screen
  // whenever the user is not on Attività. Diffing two polls turns it into one
  // sentence per file, with failures on the assertive region so they are not
  // queued behind a confirmation.
  useEffect(() => {
    const watched = watchedJobsRef.current;
    if (!watched.size) return;
    const previousStatuses = jobStatusRef.current;
    const polite: string[] = [];
    const urgent: string[] = [];
    let completed = 0;
    let failed = 0;
    let pending = 0;
    let observed = 0;

    for (const job of snapshot.jobs) {
      if (!watched.has(job.id)) continue;
      observed += 1;
      const previous = previousStatuses.get(job.id);
      previousStatuses.set(job.id, job.status);
      if (activeJobStates.has(job.status)) {
        pending += 1;
        continue;
      }
      if (job.status === "completed") completed += 1;
      if (job.status === "failed") failed += 1;
      if (previous === job.status) continue;
      if (job.status === "completed") {
        polite.push(
          job.warnings.length
            ? announce.jobCompletedWithWarnings(job.inputName, job.warnings[0])
            : announce.jobCompleted(job.inputName),
        );
      } else if (job.status === "failed") {
        urgent.push(
          announce.jobFailed(
            job.inputName,
            job.error ? describeError(job.error) : "motivo non riportato",
          ),
        );
      } else if (job.status === "cancelled") {
        polite.push(announce.jobCancelled(job.inputName));
      } else if (job.status === "interrupted") {
        urgent.push(announce.jobInterrupted(job.inputName));
      }
    }

    const finished = observed === watched.size && pending === 0;
    if (finished && watched.size > 1) polite.push(announce.batchDone(completed, failed));
    if (polite.length) setJobAnnouncement(polite.join(" "));
    if (urgent.length) setFailureAnnouncement(urgent.join(" "));
    if (finished) {
      watched.clear();
      previousStatuses.clear();
    }
  }, [snapshot.jobs]);

  // Install phases arrive from a four-second poll, so the announcement is tied to
  // the phase number rather than to the poll: one sentence per phase.
  const installStepRef = useRef(0);
  useEffect(() => {
    if (!runtime.installing) {
      installStepRef.current = 0;
      return;
    }
    if (runtime.installStepTotal > 0 && runtime.installStep > installStepRef.current) {
      installStepRef.current = runtime.installStep;
      setRuntimeAnnouncement(
        announce.installStep(
          runtime.installStep,
          runtime.installStepTotal,
          runtime.installStepLabel,
        ),
      );
    }
  }, [
    runtime.installing,
    runtime.installStep,
    runtime.installStepTotal,
    runtime.installStepLabel,
  ]);

  const updateThresholdRef = useRef(0);
  useEffect(() => {
    if (updater.phase !== "downloading") {
      updateThresholdRef.current = 0;
      if (announcedUpdatePhases.has(updater.phase)) {
        setUpdateAnnouncement(
          updatePhaseStatus(updater.phase, updater.availableVersion, updater.progress),
        );
      }
      return;
    }
    if (updater.progress === null) return;
    const reached = updateAnnouncementThresholds.filter(
      (threshold) => threshold <= (updater.progress ?? 0),
    );
    const crossed = reached.length ? reached[reached.length - 1] : 0;
    if (crossed > updateThresholdRef.current) {
      updateThresholdRef.current = crossed;
      setUpdateAnnouncement(announce.updateProgress(crossed));
    }
  }, [updater.phase, updater.progress, updater.availableVersion]);

  // Changing view left the focus on the sidebar button, so the next Tab walked
  // through the navigation again instead of entering the view that had just
  // opened. The first mount is skipped: nothing has changed yet.
  const firstViewRef = useRef(true);
  useEffect(() => {
    if (firstViewRef.current) {
      firstViewRef.current = false;
      return;
    }
    document.getElementById("main-content")?.focus();
    setSectionAnnouncement(announce.section(sectionTitles[active]));
  }, [active]);

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
        reasons: report.rejected,
      });
      if (report.imported > 0) setActive("library");
    } catch (error) {
      setNotice({
        tone: "error",
        title: "Importazione non riuscita",
        detail: describeError(error),
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
      setNotice({ tone: "error", title: "Selezione non riuscita", detail: describeError(error) });
    }
  }

  async function handleStart(
    itemIds: string[],
    quickPaths: string[],
    options: WorkflowOptions,
  ) {
    if (!isTauri() || starting) return;
    if (["installing", "restarting"].includes(updater.phase)) {
      setNotice({
        tone: "error",
        title: "Aggiornamento in corso",
        detail: "Attendi pochi secondi prima di avviare un nuovo lavoro.",
      });
      return;
    }
    setStarting(true);
    setNotice(null);
    try {
      const report = await invoke<StartJobsReport>("start_jobs", {
        itemIds,
        quickPaths,
        options,
      });
      setSnapshot(report.snapshot);
      watchedJobsRef.current = new Set(report.jobIds);
      jobStatusRef.current.clear();
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
      setNotice({ tone: "error", title: "Avvio non riuscito", detail: describeError(error) });
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
      setNotice({ tone: "error", title: "Rimozione non riuscita", detail: describeError(error) });
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
      setNotice({ tone: "error", title: "Annullamento non riuscito", detail: describeError(error) });
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
      setNotice({ tone: "error", title: "Annullamento non riuscito", detail: describeError(error) });
    }
  }

  async function handleRetry(jobId: string) {
    const knownJobIds = new Set(snapshot.jobs.map((job) => job.id));
    try {
      const current = await invoke<AppSnapshot>("retry_job", { jobId });
      setSnapshot(current);
      // A retry inserts a new row, so its id is whatever the returned snapshot
      // has that the previous one did not. Reading it from the response is safe
      // precisely because the row was just written.
      const fresh = current.jobs
        .filter((job) => !knownJobIds.has(job.id))
        .map((job) => job.id);
      watchedJobsRef.current = new Set(fresh);
      jobStatusRef.current.clear();
      setNotice({
        tone: "success",
        title: "Lavoro rimesso in coda",
        detail: "Riparte con le stesse impostazioni.",
      });
      setActive("activity");
    } catch (error) {
      setNotice({ tone: "error", title: "Impossibile riprovare", detail: describeError(error) });
    }
  }

  async function handleDownloadModel(engineId: string) {
    try {
      await invoke("download_engine_model", { engineId });
      setNotice({
        tone: "success",
        title: "Download avviato",
        detail: "Puoi continuare a lavorare: l'avanzamento è in Modelli.",
      });
    } catch (error) {
      setNotice({ tone: "error", title: "Download non avviato", detail: describeError(error) });
    }
  }

  async function handleRevealPath(path: string) {
    try {
      await invoke("reveal_path", { path });
    } catch (error) {
      setNotice({ tone: "error", title: "Log non disponibile", detail: describeError(error) });
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
      setNotice({ tone: "error", title: "Esportazione non riuscita", detail: describeError(error) });
    }
  }

  async function handleReveal(jobId: string) {
    try {
      await invoke("reveal_job_result", { jobId });
    } catch (error) {
      setNotice({ tone: "error", title: "Risultato non disponibile", detail: describeError(error) });
    }
  }

  const handleLoadEvents = useCallback(async (jobId: string): Promise<JobEvent[]> => {
    try {
      return await invoke<JobEvent[]>("list_job_events", { jobId });
    } catch (error) {
      setNotice({
        tone: "error",
        title: jobHistory.failedTitle,
        detail: describeError(error),
      });
      return [];
    }
  }, []);

  async function handleCopyHistory(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice({
        tone: "success",
        title: jobHistory.copied,
        detail: jobHistory.copiedDetail,
      });
    } catch {
      setNotice({
        tone: "error",
        title: jobHistory.copyFailedTitle,
        detail: jobHistory.copyFailedDetail,
      });
    }
  }

  async function handleOpenLicense() {
    try {
      await invoke("reveal_license");
    } catch (error) {
      setNotice({ tone: "error", title: license.licenseError, detail: describeError(error) });
    }
  }

  async function handleOpenRepository() {
    try {
      await invoke("open_source_repository");
    } catch (error) {
      setNotice({ tone: "error", title: license.repositoryError, detail: describeError(error) });
    }
  }

  async function handleRuntimeAction() {
    if (runtimeBusy) return;
    const starting = runtime.installed;
    setRuntimeBusy(true);
    try {
      const next = await invoke<RuntimeStatus>(
        starting ? "start_engine_runtime" : "install_engine_runtime",
      );
      setRuntime(next);
      // `start_engine_runtime` only resolves once the engine answers, so the
      // tone is derived from the returned state rather than assumed.
      setNotice({
        tone: starting && !next.running ? "error" : "success",
        title: starting ? (next.running ? "Motori avviati" : "Avvio non riuscito") : "Installazione avviata",
        detail: starting
          ? next.message
          : "Il download prosegue in background; puoi seguirlo in Modelli.",
      });
    } catch (error) {
      setNotice({ tone: "error", title: "Motori non disponibili", detail: describeError(error) });
    } finally {
      setRuntimeBusy(false);
    }
  }

  async function handleCancelInstall() {
    if (cancellingInstall) return;
    setCancellingInstall(true);
    try {
      const next = await invoke<RuntimeStatus>("cancel_engine_install");
      setRuntime(next);
      setNotice({
        tone: "success",
        title: "Installazione annullata",
        detail: "Nulla di già installato è stato rimosso: puoi riprendere quando vuoi da Modelli.",
      });
    } catch (error) {
      setNotice({
        tone: "error",
        title: "Annullamento non riuscito",
        detail: describeError(error),
      });
    } finally {
      setCancellingInstall(false);
    }
  }

  async function handleStopRuntime() {
    if (runtimeBusy) return;
    setRuntimeBusy(true);
    try {
      const next = await invoke<RuntimeStatus>("stop_engine_runtime");
      setRuntime(next);
      setNotice({
        tone: "success",
        title: "Motori fermati",
        detail: "Puoi riavviarli quando vuoi da Modelli.",
      });
    } catch (error) {
      setNotice({ tone: "error", title: "Motori ancora attivi", detail: describeError(error) });
    } finally {
      setRuntimeBusy(false);
    }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setNotice(null);
        return;
      }
      const accel = event.metaKey || event.ctrlKey;
      if (!accel || event.altKey) return;
      if (event.key === "o" || event.key === "O") {
        event.preventDefault();
        void (event.shiftKey ? handleImport() : handleQuickPick());
      } else if (event.key === ",") {
        event.preventDefault();
        setActive("settings");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  // Without the engines nothing can be processed, so the dashboard's "Elabora
  // subito" led to a disabled button two screens later. The welcome screen takes
  // its place until they exist or the user postpones them for this session.
  const showWelcome = isTauri() && !runtime.installed && !welcomePostponed;

  function renderView() {
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
          onNavigate={setActive}
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
          onCopyHistory={(text) => void handleCopyHistory(text)}
          onExport={(jobIds) => void handleExport(jobIds)}
          onLoadEvents={handleLoadEvents}
          onRetry={(jobId) => void handleRetry(jobId)}
          onReveal={(jobId) => void handleReveal(jobId)}
        />
      );
    }
    if (active === "models") {
      return (
        <ModelsView
          bridge={snapshot.bridge}
          busy={runtimeBusy}
          cancellingInstall={cancellingInstall}
          hasActiveJobs={hasActiveJobs}
          onCancelInstall={() => void handleCancelInstall()}
          onDownloadModel={(engineId) => void handleDownloadModel(engineId)}
          onOpenLog={(path) => void handleRevealPath(path)}
          onRuntimeAction={() => void handleRuntimeAction()}
          onStopRuntime={() => void handleStopRuntime()}
          runtime={runtime}
          system={snapshot.system}
        />
      );
    }
    if (active === "settings") {
      return (
        <SettingsView
          hasActiveJobs={hasActiveJobs}
          onOpenLicense={() => void handleOpenLicense()}
          onOpenRepository={() => void handleOpenRepository()}
          snapshot={snapshot}
          updater={updater}
        />
      );
    }
    if (showWelcome) {
      return (
        <WelcomeView
          busy={runtimeBusy}
          cancelling={cancellingInstall}
          onCancelInstall={() => void handleCancelInstall()}
          onInstall={() => void handleRuntimeAction()}
          onPostpone={() => setWelcomePostponed(true)}
          runtime={runtime}
        />
      );
    }
    return (
      <Dashboard
        onImport={() => void handleImport()}
        onNavigate={setActive}
        onQuickPick={() => void handleQuickPick()}
        snapshot={snapshot}
      />
    );
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Vai al contenuto
      </a>
      <Sidebar
        active={active}
        appVersion={updater.currentVersion}
        jobCount={snapshot.jobs.filter((job) => activeJobStates.has(job.status)).length}
        onNavigate={setActive}
      />
      <div className="workspace">
        <Topbar
          active={active}
          bridge={snapshot.bridge}
          importing={importing}
          onImport={() => void handleImport()}
          onOpenUpdates={() => setActive("settings")}
          updater={updater}
        />
        <main aria-busy={loading} className="main-content" id="main-content" tabIndex={-1}>
          {loading ? (
            <div className="loading-state">
              <span className="loading-mark">L/AI</span>
              <strong>Preparazione del workspace locale…</strong>
            </div>
          ) : (
            renderView()
          )}
        </main>
      </div>

      {/* Mounted unconditionally: a live region inserted together with its text
          is not announced, because assistive technology never saw it empty.
          Errors switch it to `alert`, so a failed batch is not read after the
          confirmation that queued it. */}
      <div
        aria-live={notice?.tone === "error" ? "assertive" : "polite"}
        className={`toast${showUpdateBanner ? " toast-raised" : ""}`}
        data-tone={notice?.tone}
        data-visible={Boolean(notice)}
        onBlur={() => setNoticeHeld(false)}
        onFocus={() => setNoticeHeld(true)}
        onMouseEnter={() => setNoticeHeld(true)}
        onMouseLeave={() => setNoticeHeld(false)}
        role={notice?.tone === "error" ? "alert" : "status"}
      >
        {notice ? (
          <>
            {notice.tone === "success" ? (
              <CheckCircle2 size={19} />
            ) : (
              <AlertCircle size={19} />
            )}
            <div>
              <strong>{notice.title}</strong>
              <span>{notice.detail}</span>
              {notice.reasons?.length ? (
                <ul className="toast-reasons">
                  {notice.reasons.slice(0, 4).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                  {notice.reasons.length > 4 ? (
                    <li>e altri {notice.reasons.length - 4}</li>
                  ) : null}
                </ul>
              ) : null}
            </div>
            <button aria-label="Chiudi messaggio" onClick={() => setNotice(null)} type="button">
              <X size={16} />
            </button>
          </>
        ) : null}
      </div>
      {showUpdateBanner ? (
        <UpdateBanner
          hasActiveJobs={hasActiveJobs}
          onOpenSettings={() => setActive("settings")}
          updater={updater}
        />
      ) : null}
      {dropActive ? (
        <div className="drop-overlay" aria-hidden="true">
          <div>
            <FileUp size={34} />
            <strong>Rilascia per elaborare</strong>
            <span>Niente Libreria · originali intatti · pulizia automatica</span>
          </div>
        </div>
      ) : null}
      {/* One region per subject, all mounted from the first render. Sharing a node
          made every file drop re-announce the job tally, because the text changed
          for an unrelated reason; and a region that appears with its text — as
          the models-server warning used to — is never announced at all. */}
      <span aria-live="polite" className="sr-only" role="status">
        {loading ? announce.loading : sectionAnnouncement}
      </span>
      <span aria-live="polite" className="sr-only" role="status">
        {inspecting ? announce.reading : ""}
      </span>
      <span aria-live="polite" className="sr-only" role="status">
        {dropActive ? announce.dropping : ""}
      </span>
      <span aria-live="polite" className="sr-only" role="status">
        {runtime.modelsServerExposed ? announce.modelsServerExposed : ""}
      </span>
      <span aria-live="polite" className="sr-only" role="status">
        {runtimeAnnouncement}
      </span>
      <span aria-live="polite" className="sr-only" role="status">
        {updateAnnouncement}
      </span>
      <span aria-live="polite" className="sr-only" role="status">
        {jobAnnouncement}
      </span>
      <span aria-live="assertive" className="sr-only" role="alert">
        {failureAnnouncement}
      </span>
    </div>
  );
}

export default App;
