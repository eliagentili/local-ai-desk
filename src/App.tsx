import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { AlertCircle, CheckCircle2, X } from "lucide-react";
import { useEffect, useState } from "react";

import "./App.css";
import { ActivityView } from "./components/ActivityView";
import { Dashboard } from "./components/Dashboard";
import { LibraryView } from "./components/LibraryView";
import { ModelsView } from "./components/ModelsView";
import { PlaceholderView } from "./components/PlaceholderView";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import type { AppSnapshot, ImportReport, SectionId } from "./types";

const emptySnapshot: AppSnapshot = {
  library: [],
  jobs: [],
  bridge: {
    available: false,
    localOnly: true,
    readyEngines: 0,
    totalEngines: 0,
    label: "Verifica motori…",
    engines: [],
  },
  system: {
    architecture: "—",
    logicalCpus: 0,
    totalMemoryBytes: 0,
    availableMemoryBytes: 0,
    dataDirectory: "—",
  },
};

interface Notice {
  tone: "success" | "error";
  title: string;
  detail: string;
}

function App() {
  const [active, setActive] = useState<SectionId>("home");
  const [snapshot, setSnapshot] = useState<AppSnapshot>(emptySnapshot);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

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
        const initial = await invoke<AppSnapshot>("bootstrap_snapshot");
        if (mounted) setSnapshot(initial);
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

  function renderView() {
    if (active === "home") {
      return (
        <Dashboard
          onImport={() => void handleImport()}
          onNavigate={setActive}
          snapshot={snapshot}
        />
      );
    }
    if (active === "library") {
      return <LibraryView items={snapshot.library} onImport={() => void handleImport()} />;
    }
    if (active === "activity") return <ActivityView jobs={snapshot.jobs} />;
    if (active === "models") return <ModelsView bridge={snapshot.bridge} />;
    return <PlaceholderView onNavigate={setActive} section={active} snapshot={snapshot} />;
  }

  return (
    <div className="app-shell">
      <Sidebar active={active} jobCount={snapshot.jobs.length} onNavigate={setActive} />
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
    </div>
  );
}

export default App;
