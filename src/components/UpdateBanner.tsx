import { Download, RefreshCw, RotateCw, X } from "lucide-react";

import type { AppUpdater } from "../hooks/useAppUpdater";

interface UpdateBannerProps {
  hasActiveJobs: boolean;
  onOpenSettings: () => void;
  updater: AppUpdater;
}

export function UpdateBanner({ hasActiveJobs, onOpenSettings, updater }: UpdateBannerProps) {
  const busy = updater.phase === "downloading" || updater.phase === "installing";
  const downloaded = updater.phase === "downloaded";
  const ready = updater.phase === "ready";
  const handleAction = () => {
    if (hasActiveJobs && (ready || downloaded)) {
      onOpenSettings();
    } else if (ready) {
      void updater.restart();
    } else if (updater.phase === "available" || downloaded) {
      void updater.downloadAndInstall();
    } else {
      onOpenSettings();
    }
  };

  return (
    // No `aria-live`: with the percentage inside, this banner re-announced
    // itself about eight times a second. The single announcement is in App.
    <aside className="update-banner" aria-label="Aggiornamento disponibile">
      <div className="update-banner-icon" aria-hidden="true">
        {ready ? <RotateCw size={19} /> : busy ? <RefreshCw className="spin" size={19} /> : <Download size={19} />}
      </div>
      <div className="update-banner-copy">
        <strong>
          {ready
            ? "Aggiornamento pronto"
            : downloaded
              ? "Aggiornamento scaricato"
            : busy
              ? updater.phase === "installing" ? "Preparazione sicura…" : `Download ${updater.progress === null ? "…" : `${updater.progress}%`}`
              : `Local AI Desk ${updater.availableVersion}`}
        </strong>
        <span>
          {hasActiveJobs
            ? ready || downloaded ? "Attenderà la fine dei lavori attivi." : "Scarica ora; l’installazione attenderà i lavori."
            : ready
              ? "Riavvia quando vuoi per completare."
              : busy
                ? "Puoi continuare a usare l’app."
                : "Firmato e verificato prima dell’installazione."}
        </span>
        {busy ? (
          <div className="update-banner-progress"><span style={updater.progress === null ? undefined : { width: `${updater.progress}%` }} /></div>
        ) : null}
      </div>
      <button className="button button-primary button-compact" disabled={busy} onClick={handleAction} type="button">
        {hasActiveJobs && (ready || downloaded) ? "Dettagli" : ready ? "Riavvia" : downloaded ? "Installa" : busy ? "Attendi" : "Aggiorna"}
      </button>
      {!busy && !ready && !downloaded ? (
        <button className="update-banner-close" aria-label="Ricordamelo più tardi" onClick={updater.dismiss} type="button">
          <X size={15} />
        </button>
      ) : null}
    </aside>
  );
}
