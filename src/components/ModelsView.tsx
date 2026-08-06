import { Cpu, HardDrive, Layers3 } from "lucide-react";

import { engineName } from "../lib/format";
import type { BridgeStatus } from "../types";

export function ModelsView({ bridge }: { bridge: BridgeStatus }) {
  return (
    <div className="view-stack">
      <section className="view-intro">
        <div>
          <span className="eyebrow">Runtime locale</span>
          <h2>Un catalogo, più motori.</h2>
          <p>
            La Foundation rileva oggi i motori della suite precedente. La prossima
            fase li convertirà in pacchetti installabili, aggiornabili e verificabili.
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
          <strong>Apple Silicon · Metal</strong>
        </div>
        <div>
          <HardDrive size={19} />
          <span>Posizione</span>
          <strong>Solo sul Mac</strong>
        </div>
        <div>
          <Layers3 size={19} />
          <span>Strategia</span>
          <strong>Pack modulari</strong>
        </div>
      </div>

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
              Puoi usare e popolare la nuova libreria. Avvia la versione attuale per
              far apparire qui i motori già installati.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
