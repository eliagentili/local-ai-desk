import {
  Cpu,
  Download,
  FileText,
  HardDrive,
  Layers3,
  LoaderCircle,
  Play,
  Square,
} from "lucide-react";

import { engineName } from "../lib/format";
import type { BridgeStatus, RuntimeStatus, SystemSnapshot } from "../types";

interface ModelsViewProps {
  bridge: BridgeStatus;
  busy: boolean;
  hasActiveJobs: boolean;
  runtime: RuntimeStatus;
  system: SystemSnapshot;
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
          <span>Posizione</span>
          <strong>Solo su {system.platformLabel}</strong>
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

      <section className="model-grid" aria-label="Motori rilevati">
        {bridge.engines.length ? (
          bridge.engines.map((engine) => (
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
                  {engine.state === "ready" ? "Pronto" : engine.state}
                </span>
              </div>
              <h3>{engineName(engine.id)}</h3>
              <p>{engine.label}</p>
              <small>{engine.version ? `Versione ${engine.version}` : "Modello locale"}</small>
            </article>
          ))
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
