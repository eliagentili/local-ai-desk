import { isTauri } from "@tauri-apps/api/core";
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useRef, useState } from "react";

const AUTO_CHECK_KEY = "local-ai-desk:update-checks-enabled:v1";
const INITIAL_CHECK_DELAY_MS = 15_000;
const PERIODIC_CHECK_MS = 6 * 60 * 60 * 1_000;

export type UpdatePhase =
  | "unsupported"
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "ready"
  | "restarting"
  | "error";

export interface UpdateSnapshot {
  phase: UpdatePhase;
  currentVersion: string;
  availableVersion: string | null;
  releaseNotes: string | null;
  releaseDate: string | null;
  downloadedBytes: number;
  totalBytes: number | null;
  lastCheckedAt: string | null;
  error: string | null;
  automaticChecks: boolean;
  dismissed: boolean;
}

export interface AppUpdater extends UpdateSnapshot {
  native: boolean;
  progress: number | null;
  checkForUpdates: (manual?: boolean) => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  restart: () => Promise<void>;
  dismiss: () => void;
  setAutomaticChecks: (enabled: boolean) => void;
}

function readAutomaticCheckPreference() {
  try {
    return window.localStorage.getItem(AUTO_CHECK_KEY) !== "false";
  } catch {
    return true;
  }
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/signature|verify|public key/i.test(message)) {
    return "La firma dell’aggiornamento non è valida. L’installazione è stata bloccata.";
  }
  if (/valid release json|failed to fetch|network|connection|timed? out|404/i.test(message)) {
    return "Il canale aggiornamenti non è raggiungibile in questo momento. Riprova tra poco.";
  }
  if (/permission|access denied|operation not permitted/i.test(message)) {
    return "Il sistema non ha autorizzato l’aggiornamento. Controlla i permessi dell’app e riprova.";
  }
  return message;
}

export function useAppUpdater(hasActiveJobs: boolean): AppUpdater {
  const native = isTauri();
  const updateRef = useRef<Update | null>(null);
  const downloadedRef = useRef(false);
  const busyRef = useRef(false);
  const activeJobsRef = useRef(hasActiveJobs);
  const phaseRef = useRef<UpdatePhase>(native ? "idle" : "unsupported");
  const [snapshot, setSnapshot] = useState<UpdateSnapshot>(() => ({
    phase: native ? "idle" : "unsupported",
    currentVersion: native ? "…" : "Anteprima browser",
    availableVersion: null,
    releaseNotes: null,
    releaseDate: null,
    downloadedBytes: 0,
    totalBytes: null,
    lastCheckedAt: null,
    error: null,
    automaticChecks: readAutomaticCheckPreference(),
    dismissed: false,
  }));

  useEffect(() => {
    activeJobsRef.current = hasActiveJobs;
  }, [hasActiveJobs]);

  useEffect(() => {
    phaseRef.current = snapshot.phase;
  }, [snapshot.phase]);

  useEffect(() => {
    if (!native) return;
    let disposed = false;
    void import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then((currentVersion) => {
        if (!disposed) setSnapshot((current) => ({ ...current, currentVersion }));
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [native]);

  const checkForUpdates = useCallback(
    async (manual = true) => {
      if (
        !native ||
        busyRef.current ||
        ["downloading", "downloaded", "installing", "ready", "restarting"].includes(phaseRef.current)
      ) return;
      busyRef.current = true;
      setSnapshot((current) => ({
        ...current,
        phase: "checking",
        error: null,
        dismissed: manual ? false : current.dismissed,
      }));

      try {
        const previous = updateRef.current;
        updateRef.current = null;
        downloadedRef.current = false;
        if (previous) await previous.close().catch(() => undefined);

        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check({ timeout: 20_000 });
        const checkedAt = new Date().toISOString();
        updateRef.current = update;

        if (!update) {
          setSnapshot((current) => ({
            ...current,
            phase: "current",
            availableVersion: null,
            releaseNotes: null,
            releaseDate: null,
            lastCheckedAt: checkedAt,
            error: null,
          }));
          return;
        }

        setSnapshot((current) => ({
          ...current,
          phase: "available",
          currentVersion: update.currentVersion,
          availableVersion: update.version,
          releaseNotes: update.body ?? null,
          releaseDate: update.date ?? null,
          downloadedBytes: 0,
          totalBytes: null,
          lastCheckedAt: checkedAt,
          error: null,
          dismissed: false,
        }));
      } catch (error) {
        setSnapshot((current) => ({
          ...current,
          phase: "error",
          error: errorMessage(error),
          lastCheckedAt: new Date().toISOString(),
        }));
      } finally {
        busyRef.current = false;
      }
    },
    [native],
  );

  useEffect(() => {
    if (!native || !snapshot.automaticChecks) return;
    const initialTimer = window.setTimeout(() => {
      void checkForUpdates(false);
    }, INITIAL_CHECK_DELAY_MS);
    const periodicTimer = window.setInterval(() => {
      void checkForUpdates(false);
    }, PERIODIC_CHECK_MS);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(periodicTimer);
    };
  }, [checkForUpdates, native, snapshot.automaticChecks]);

  const downloadAndInstall = useCallback(async () => {
    const update = updateRef.current;
    if (!native || !update || busyRef.current) return;
    busyRef.current = true;
    let downloadedBytes = 0;
    let lastPaintedAt = 0;

    try {
      if (!downloadedRef.current) {
        setSnapshot((current) => ({
          ...current,
          phase: "downloading",
          downloadedBytes: 0,
          totalBytes: null,
          error: null,
          dismissed: false,
        }));
        await update.download((event: DownloadEvent) => {
          if (event.event === "Started") {
            setSnapshot((current) => ({
              ...current,
              downloadedBytes: 0,
              totalBytes: event.data.contentLength ?? null,
            }));
          } else if (event.event === "Progress") {
            downloadedBytes += event.data.chunkLength;
            // Chunks arrive in the tens of kilobytes: repainting on each one
            // costs far more than the extra precision is worth.
            const now = Date.now();
            if (now - lastPaintedAt >= 120) {
              lastPaintedAt = now;
              const bytes = downloadedBytes;
              setSnapshot((current) => ({ ...current, downloadedBytes: bytes }));
            }
          } else {
            setSnapshot((current) => ({
              ...current,
              downloadedBytes: current.totalBytes ?? current.downloadedBytes,
            }));
          }
        });
        setSnapshot((current) => ({ ...current, downloadedBytes }));
        downloadedRef.current = true;
      }

      if (activeJobsRef.current) {
        setSnapshot((current) => ({ ...current, phase: "downloaded" }));
        return;
      }

      setSnapshot((current) => ({ ...current, phase: "installing" }));
      await update.install();
      setSnapshot((current) => ({ ...current, phase: "ready" }));
    } catch (error) {
      setSnapshot((current) => ({
        ...current,
        phase: "error",
        error: errorMessage(error),
      }));
    } finally {
      busyRef.current = false;
    }
  }, [native]);

  const restart = useCallback(async () => {
    if (!native || busyRef.current || activeJobsRef.current) return;
    busyRef.current = true;
    setSnapshot((current) => ({ ...current, phase: "restarting", error: null }));
    try {
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (error) {
      busyRef.current = false;
      setSnapshot((current) => ({
        ...current,
        phase: "ready",
        error: errorMessage(error),
      }));
    }
  }, [native]);

  const dismiss = useCallback(() => {
    setSnapshot((current) => ({ ...current, dismissed: true }));
  }, []);

  const setAutomaticChecks = useCallback((enabled: boolean) => {
    try {
      window.localStorage.setItem(AUTO_CHECK_KEY, String(enabled));
    } catch {
      // The in-memory preference still works if local storage is unavailable.
    }
    setSnapshot((current) => ({ ...current, automaticChecks: enabled }));
  }, []);

  useEffect(
    () => () => {
      const update = updateRef.current;
      if (update) void update.close().catch(() => undefined);
    },
    [],
  );

  const progress =
    snapshot.totalBytes && snapshot.totalBytes > 0
      ? Math.min(100, Math.round((snapshot.downloadedBytes / snapshot.totalBytes) * 100))
      : null;

  return {
    ...snapshot,
    native,
    progress,
    checkForUpdates,
    downloadAndInstall,
    restart,
    dismiss,
    setAutomaticChecks,
  };
}
