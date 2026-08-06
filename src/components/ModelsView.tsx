import { Cpu, Download, HardDrive, Layers3, LoaderCircle, Play } from "lucide-react";

import { engineName } from "../lib/format";
import type { BridgeStatus, RuntimeStatus, SystemSnapshot } from "../types";

interface ModelsViewProps {
  bridge: BridgeStatus;
  runtime: RuntimeStatus;
  system: SystemSnapshot;
  onRuntimeAction: () => void;
}

export function ModelsView({ bridge, runtime, system, onRuntimeAction }: ModelsViewProps) {
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

      {!bridge.available ? (
        <section className="surface-panel runtime-card" aria-live="polite">
          <div>
            <span className="eyebrow">Runtime per {runtime.platform}</span>
            <h3>{runtime.message}</h3>
            <p>
              L’installazione iniziale comprende OCR, trascrizione, conversione,
              Privacy Filter, traduzione PDF e i relativi modelli. Richiede una
              connessione e può occupare oltre 20 GB; continua senza aprire terminali.
            </p>
            <small>Attività dettagliata: {runtime.logPath}</small>
          </div>
          <button
            className="button button-primary"
            disabled={!runtime.supported || runtime.installing}
            onClick={onRuntimeAction}
            type="button"
          >
            {runtime.installing ? (
              <><LoaderCircle className="spin" size={16} /> Installazione in corso</>
            ) : runtime.installed ? (
              <><Play size={16} /> Avvia motori</>
            ) : (
              <><Download size={16} /> Installa motori</>
            )}
          </button>
        </section>
      ) : null}

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
