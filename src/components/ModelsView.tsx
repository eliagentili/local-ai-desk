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

import { engineName, formatBytes } from "../lib/format";
import type { BridgeStatus, RuntimeStatus, SystemSnapshot } from "../types";

interface ModelsViewProps {
  bridge: BridgeStatus;
  busy: boolean;
  hasActiveJobs: boolean;
  runtime: RuntimeStatus;
  system: SystemSnapshot;
  onDownloadModel: (engineId: string) => void;
  onOpenLog: (path: string) => void;
  onRuntimeAction: () => void;
  onStopRuntime: () => void;
}

export function ModelsView({
  bridge,
  busy,
  hasActiveJobs,
  runtime,
  system,
  onDownloadModel,
  onOpenLog,
  onRuntimeAction,
  onStopRuntime,
}: ModelsViewProps) {
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

      <section className="surface-panel runtime-card" aria-live="polite">
        <div>
          <span className="eyebrow">Runtime per {runtime.platform}</span>
          <h3>{runtime.message}</h3>
          <p>
            {bridge.available
              ? "I motori girano solo sul loopback del dispositivo. Puoi fermarli quando non ti servono: nessun lavoro parte finché non li riavvii."
              : "L’installazione iniziale comprende OCR, trascrizione, conversione, Privacy Filter, traduzione PDF e i relativi modelli. Richiede una connessione e può occupare oltre 20 GB; continua senza aprire terminali."}
          </p>
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
        ) : (
          <button
            className="button button-primary"
            disabled={!runtime.supported || runtime.installing || busy}
            onClick={onRuntimeAction}
            type="button"
          >
            {runtime.installing ? (
              <><LoaderCircle className="spin" size={16} /> Installazione in corso</>
            ) : busy ? (
              <><LoaderCircle className="spin" size={16} /> Avvio in corso…</>
            ) : runtime.installed ? (
              <><Play size={16} /> Avvia motori</>
            ) : (
              <><Download size={16} /> Installa motori</>
            )}
          </button>
        )}
      </section>

      {runtime.modelsServerExposed ? (
        <section className="surface-panel exposure-note" role="status">
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
                          <small className="job-error">{engine.downloadError}</small>
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
