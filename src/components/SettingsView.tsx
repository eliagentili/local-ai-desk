import {
  BadgeCheck,
  CloudOff,
  Download,
  HardDrive,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  Wifi,
} from "lucide-react";

import { formatBytes, formatDateTime } from "../lib/format";
import type { AppUpdater } from "../hooks/useAppUpdater";
import type { AppSnapshot } from "../types";

interface SettingsViewProps {
  hasActiveJobs: boolean;
  snapshot: AppSnapshot;
  updater: AppUpdater;
}

function updateStatus(updater: AppUpdater) {
  switch (updater.phase) {
    case "unsupported":
      return "Disponibile nell’app installata";
    case "checking":
      return "Controllo in corso…";
    case "current":
      return "Hai già l’ultima versione";
    case "available":
      return `Versione ${updater.availableVersion} disponibile`;
    case "downloading":
      return updater.progress === null
        ? "Download protetto in corso…"
        : `Download ${updater.progress}%`;
    case "downloaded":
      return "Download completato, pronto per l’installazione";
    case "installing":
      return "Verifica firma e preparazione…";
    case "ready":
      return "Aggiornamento pronto al riavvio";
    case "restarting":
      return "Riavvio in corso…";
    case "error":
      return "Controllo non riuscito";
    default:
      return "Controllo automatico attivo";
  }
}

export function SettingsView({ hasActiveJobs, snapshot, updater }: SettingsViewProps) {
  const checkedAt = formatDateTime(updater.lastCheckedAt);
  const releaseDate = formatDateTime(updater.releaseDate);
  const updating = ["downloading", "installing", "restarting"].includes(updater.phase);
  const blocked = hasActiveJobs && ["downloaded", "ready"].includes(updater.phase);

  const handlePrimaryAction = () => {
    if (updater.phase === "ready") {
      void updater.restart();
    } else if (["available", "downloaded"].includes(updater.phase) || (updater.phase === "error" && updater.availableVersion)) {
      void updater.downloadAndInstall();
    } else {
      void updater.checkForUpdates(true);
    }
  };

  const primaryLabel = (() => {
    if (updater.phase === "checking") return "Controllo…";
    if (updater.phase === "downloading") return updater.progress === null ? "Download…" : `${updater.progress}%`;
    if (updater.phase === "installing") return "Preparazione…";
    if (updater.phase === "downloaded") return "Installa aggiornamento";
    if (updater.phase === "ready") return "Riavvia e aggiorna";
    if (updater.phase === "restarting") return "Riavvio…";
    if (updater.phase === "available" || (updater.phase === "error" && updater.availableVersion)) {
      return "Scarica e prepara";
    }
    return updater.phase === "error" ? "Riprova" : "Controlla ora";
  })();

  return (
    <div className="view-stack settings-view">
      <section className="settings-hero">
        <div className="settings-hero-icon" aria-hidden="true">
          <ShieldCheck size={31} />
        </div>
        <div>
          <span className="eyebrow">Controllo esplicito</span>
          <h2>Aggiornata, privata, sotto il tuo controllo.</h2>
          <p>
            Local AI Desk controlla soltanto il manifest delle release su GitHub. Gli aggiornamenti
            sono firmati e i tuoi documenti non entrano mai nel processo.
          </p>
        </div>
        <span className="version-chip">
          {updater.native ? `v${updater.currentVersion}` : updater.currentVersion}
        </span>
      </section>

      <section className="surface-panel update-card" aria-live="polite">
        <div className="update-card-heading">
          <div>
            <span className="eyebrow">Canale pubblico · Beta</span>
            <h3>Aggiornamenti dell’app</h3>
            <p>{updateStatus(updater)}</p>
          </div>
          <span className="signed-badge">
            <BadgeCheck size={15} />
            Firma Ed25519
          </span>
        </div>

        {updater.phase === "downloading" || updater.phase === "installing" ? (
          <div className="update-progress-block">
            <div className="update-progress-copy">
              <span>
                {updater.phase === "installing"
                  ? "Verifica e installazione"
                  : `${formatBytes(updater.downloadedBytes)}${
                      updater.totalBytes ? ` di ${formatBytes(updater.totalBytes)}` : " scaricati"
                    }`}
              </span>
              <strong>{updater.phase === "installing" ? "Firma valida" : updater.progress === null ? "…" : `${updater.progress}%`}</strong>
            </div>
            <div
              aria-label="Avanzamento aggiornamento"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={updater.progress ?? undefined}
              className="update-progress-track"
              role="progressbar"
            >
              <span
                className={updater.progress === null || updater.phase === "installing" ? "is-indeterminate" : ""}
                style={updater.progress === null || updater.phase === "installing" ? undefined : { width: `${updater.progress}%` }}
              />
            </div>
          </div>
        ) : null}

        {updater.availableVersion ? (
          <div className="release-summary">
            <div>
              <span>Nuova versione</span>
              <strong>{updater.availableVersion}</strong>
              {releaseDate ? <small>Pubblicata il {releaseDate}</small> : null}
            </div>
            {updater.releaseNotes ? <p>{updater.releaseNotes}</p> : null}
          </div>
        ) : null}

        {updater.error ? (
          <div className="inline-alert" data-tone="error">
            <span>Dettaglio</span>
            <p>{updater.error}</p>
          </div>
        ) : null}

        {blocked ? (
          <div className="inline-alert">
            <span>Aggiornamento in attesa</span>
            <p>Il pacchetto è al sicuro. Termina o annulla i lavori attivi, poi conferma l’installazione.</p>
          </div>
        ) : null}

        <div className="update-card-footer">
          <label className="preference-row">
            <span>
              <strong>Controlla automaticamente</strong>
              <small>15 secondi dopo l’avvio e poi ogni 6 ore.</small>
            </span>
            <input
              checked={updater.automaticChecks}
              disabled={!updater.native}
              onChange={(event) => updater.setAutomaticChecks(event.target.checked)}
              type="checkbox"
            />
            <i aria-hidden="true" />
          </label>
          <div className="update-actions">
            {checkedAt ? <small>Ultimo controllo: {checkedAt}</small> : null}
            <button
              className="button button-primary"
              disabled={!updater.native || updating || blocked}
              onClick={handlePrimaryAction}
              type="button"
            >
              {updater.phase === "ready" ? <RotateCw size={16} /> : ["available", "downloaded"].includes(updater.phase) ? <Download size={16} /> : <RefreshCw className={updating ? "spin" : undefined} size={16} />}
              {primaryLabel}
            </button>
          </div>
        </div>
      </section>

      <section className="settings-grid">
        <article className="surface-panel settings-info-card">
          <div className="settings-info-icon"><CloudOff size={21} /></div>
          <span className="eyebrow">Privacy di rete</span>
          <h3>I file non vengono caricati</h3>
          <p>Il controllo legge versione, note e firma. Nessun nome file, contenuto o risultato lascia il dispositivo.</p>
          <div className="connection-row"><Wifi size={14} /> GitHub Releases · sola lettura</div>
        </article>
        <article className="surface-panel settings-info-card">
          <div className="settings-info-icon"><HardDrive size={21} /></div>
          <span className="eyebrow">Dati applicazione</span>
          <h3>Posizione verificabile</h3>
          <code title={snapshot.system.dataDirectory}>{snapshot.system.dataDirectory}</code>
          <p>Originali e risultati restano intatti anche durante l’aggiornamento dell’app.</p>
        </article>
      </section>

      <section className="surface-panel diagnostics-card">
        <div>
          <span className="eyebrow">Diagnostica locale</span>
          <h3>Ambiente in uso</h3>
        </div>
        <span className="diagnostic-trust"><ShieldCheck size={15} /> Motori su loopback</span>
        <div className="diagnostic-grid">
          <span>Sistema <strong>{snapshot.system.platformLabel}</strong></span>
          <span>Architettura <strong>{snapshot.system.architecture}</strong></span>
          <span>Core logici <strong>{snapshot.system.logicalCpus}</strong></span>
          <span>Rete motori <strong>Solo locale</strong></span>
        </div>
      </section>
    </div>
  );
}
