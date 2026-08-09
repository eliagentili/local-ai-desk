import {
  Cpu,
  Download,
  FileText,
  HardDrive,
  Layers3,
  DownloadCloud,
  LoaderCircle,
  Play,
  ShieldAlert,
  Square,
} from "lucide-react";

import { describeError } from "../lib/errors";
import { formatBytes } from "../lib/format";
import { engineName, install } from "../lib/strings";
import type { BridgeStatus, RuntimeStatus, SystemSnapshot } from "../types";
import { InstallProgress } from "./InstallProgress";

interface ModelsViewProps {
  bridge: BridgeStatus;
  busy: boolean;
  cancellingInstall: boolean;
  hasActiveJobs: boolean;
  runtime: RuntimeStatus;
  system: SystemSnapshot;
  onCancelInstall: () => void;
  onDownloadModel: (engineId: string) => void;
  onOpenLog: (path: string) => void;
  onRuntimeAction: () => void;
  onStopRuntime: () => void;
}

export function ModelsView({
  bridge,
  busy,
  cancellingInstall,
  hasActiveJobs,
  runtime,
  system,
  onCancelInstall,
  onDownloadModel,
  onOpenLog,
  onRuntimeAction,
  onStopRuntime,
}: ModelsViewProps) {
  const spaceKnown = runtime.freeBytes > 0;
  const missingBytes = Math.max(0, runtime.requiredBytes - runtime.freeBytes);
  // Only the install needs this much room; a runtime already on disk just has to
  // start, so the check never blocks "Avvia motori".
  const notEnoughSpace = !runtime.installed && spaceKnown && missingBytes > 0;

  return (
    <div className="view-stack">
      <section className="view-intro">
        <div>
          <span className="eyebrow">Runtime locale</span>
          <h2>Un catalogo, più motori.</h2>
          <p>
            Lo stesso catalogo funziona su macOS e Windows. Codice e dati restano
            separati, mentre modelli e cache vivono solo nel tuo profilo utente.
          </p>
        </div>
        <span className="large-status" data-ready={bridge.available}>
          <span className="status-dot" /> {bridge.label}
        </span>
      </section>

      <div className="model-summary">
        <div>
          <Cpu size={19} />
          <span>Compute</span>
          <strong>{system.computeLabel}</strong>
        </div>
        <div>
          <HardDrive size={19} />
          <span>Modelli</span>
          <strong title={runtime.modelsDirectory}>
            {runtime.modelsDirectory.includes(".ollama")
              ? "Condivisi con Ollama"
              : `Solo su ${system.platformLabel}`}
          </strong>
        </div>
        <div>
          <Layers3 size={19} />
          <span>Strategia</span>
          <strong>Pack modulari</strong>
        </div>
      </div>

      {/* No `aria-live` here: the card re-renders on a four-second poll, so a live
          region on it read the whole panel back on every unrelated change. The
          install phase is announced once per phase, from App. */}
      <section className="surface-panel runtime-card">
        <div>
          <span className="eyebrow">Runtime per {runtime.platform}</span>
          <h3>{runtime.message}</h3>
          <p>
            {bridge.available
              ? "I motori girano solo sul loopback del dispositivo. Puoi fermarli quando non ti servono: nessun lavoro parte finché non li riavvii."
              : "L’installazione iniziale comprende OCR, trascrizione, conversione, Privacy Filter, traduzione PDF e i relativi modelli. Richiede una connessione e può occupare oltre 20 GB; continua senza aprire terminali."}
          </p>
          {!runtime.installed && !runtime.installing ? (
            <p className="runtime-space">
              {install.requires(formatBytes(runtime.requiredBytes))}
              {spaceKnown ? ` · ${formatBytes(runtime.freeBytes)} ${install.spaceOk}` : ""}
            </p>
          ) : null}
          <div className="runtime-logs">
            <button
              className="text-button"
              onClick={() => onOpenLog(runtime.logPath)}
              type="button"
            >
              <FileText size={13} /> Log di installazione
            </button>
            <button
              className="text-button"
              onClick={() => onOpenLog(runtime.runtimeLogPath)}
              type="button"
            >
              <FileText size={13} /> Log dei motori
            </button>
          </div>
        </div>
        {bridge.available ? (
          <button
            className="button button-secondary"
            disabled={busy || hasActiveJobs}
            onClick={onStopRuntime}
            title={hasActiveJobs ? "Attendi la fine dei lavori attivi" : undefined}
            type="button"
          >
            <Square size={16} /> Ferma motori
          </button>
        ) : runtime.installing ? null : (
          <button
            className="button button-primary"
            disabled={!runtime.supported || notEnoughSpace || busy}
            onClick={onRuntimeAction}
            type="button"
          >
            {busy ? (
              <><LoaderCircle className="spin" size={16} /> Avvio in corso…</>
            ) : runtime.installed ? (
              <><Play size={16} /> Avvia motori</>
            ) : (
              <><Download size={16} /> Installa motori</>
            )}
          </button>
        )}
      </section>

      {runtime.installing ? (
        <section className="surface-panel install-card">
          <InstallProgress
            cancelling={cancellingInstall}
            onCancel={onCancelInstall}
            runtime={runtime}
          />
        </section>
      ) : null}

      {/* Said before the button is pressed, with the gigabytes that are missing:
          the core refuses the install below the threshold, and discovering it
          after a download of tens of gigabytes is the worst possible moment. */}
      {notEnoughSpace ? (
        <div className="inline-alert install-blocked" data-tone="error">
          <span>{install.notEnoughSpaceTitle}</span>
          <p>
            {install.missingSpace(
              formatBytes(missingBytes),
              formatBytes(runtime.requiredBytes),
            )}
          </p>
        </div>
      ) : null}

      {/* The visible panel is not a live region: the announcement comes from the
          always-mounted region in App, which assistive technology saw empty
          first. Mounted together with its text, this warning was never read. */}
      {runtime.modelsServerExposed ? (
        <section className="surface-panel exposure-note">
          <ShieldAlert size={19} />
          <div>
            <strong>Il servizio modelli è raggiungibile dalla rete</strong>
            <p>
              Local AI Desk sta usando un Ollama che non ha avviato lui, configurato per
              accettare connessioni oltre a quelle di questo computer. I tuoi documenti
              restano sul dispositivo, ma quel servizio risponde anche ad altri sulla
              stessa rete. Avvialo con <code>OLLAMA_HOST=127.0.0.1</code> se non è voluto.
            </p>
          </div>
        </section>
      ) : null}

      <section className="model-grid" aria-label="Motori rilevati">
        {bridge.engines.length ? (
          bridge.engines.map((engine) => {
            const downloading = engine.downloadState === "downloading";
            const percent =
              downloading && engine.totalBytes > 0
                ? Math.min(100, Math.round((engine.downloadedBytes / engine.totalBytes) * 100))
                : null;
            return (
              <article className="model-card" key={engine.id}>
                <div className="model-card-top">
                  <span className="model-monogram">
                    {engineName(engine.id)
                      .split(/\s|-/)
                      .map((part) => part[0])
                      .join("")
                      .slice(0, 2)}
                  </span>
                  <span className="status-label" data-ready={engine.state === "ready"}>
                    {engine.state === "ready" ? "Pronto" : "Incompleto"}
                  </span>
                </div>
                <h3>{engineName(engine.id)}</h3>
                <p>{engine.label}</p>

                {engine.state !== "ready" && engine.downloadable ? (
                  <div className="model-pack">
                    {downloading ? (
                      <>
                        <div
                          aria-label={`Download di ${engine.packLabel ?? "modello"}`}
                          aria-valuemax={percent === null ? undefined : 100}
                          aria-valuemin={percent === null ? undefined : 0}
                          aria-valuenow={percent ?? undefined}
                          className="progress-track"
                          data-indeterminate={percent === null}
                          role="progressbar"
                        >
                          <span style={percent === null ? undefined : { width: `${percent}%` }} />
                        </div>
                        <small>
                          {formatBytes(engine.downloadedBytes)}
                          {engine.totalBytes > 0 ? ` di ${formatBytes(engine.totalBytes)}` : ""}
                          {percent === null ? " scaricati" : ` · ${percent}%`}
                        </small>
                      </>
                    ) : (
                      <>
                        <button
                          className="button button-secondary button-compact"
                          onClick={() => onDownloadModel(engine.id)}
                          type="button"
                        >
                          <DownloadCloud size={15} />
                          Scarica il modello
                          {engine.packBytes > 0 ? ` · ${formatBytes(engine.packBytes)}` : ""}
                        </button>
                        {engine.downloadError ? (
                          <small className="job-error">
                            {describeError(engine.downloadError)}
                          </small>
                        ) : (
                          <small>
                            Finché manca, questo motore lavora in modalità ridotta e lo
                            dichiara nel risultato.
                          </small>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <small>
                    {engine.version ? `Versione ${engine.version}` : "Modello locale"}
                  </small>
                )}
              </article>
            );
          })
        ) : (
          <div className="surface-panel model-empty">
            <h3>I motori non sono avviati</h3>
            <p>
              Puoi usare e popolare la libreria anche prima dell’installazione. I
              motori compariranno qui appena il runtime locale sarà pronto.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
