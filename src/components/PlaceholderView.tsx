import { ArrowUpRight, Blocks, Route } from "lucide-react";

import type { AppSnapshot, SectionId } from "../types";

interface PlaceholderViewProps {
  section: Exclude<SectionId, "home" | "library" | "studio" | "activity" | "models">;
  snapshot: AppSnapshot;
  onNavigate: (section: SectionId) => void;
}

const copy = {
  workflows: {
    eyebrow: "Automazione locale",
    title: "Dai file al risultato, senza babysitting.",
    description:
      "Workflow introdurrà pipeline riutilizzabili, cartelle sorvegliate, condizioni, preset e una coda che riparte in sicurezza.",
    icon: Route,
  },
  settings: {
    eyebrow: "Controllo esplicito",
    title: "Privacy comprensibile, non promessa.",
    description:
      "Qui saranno visibili cartelle, rete, risorse, aggiornamenti, permessi e diagnostica esportabile. La base dati è già isolata nel contenitore dell’app.",
    icon: Blocks,
  },
} as const;

export function PlaceholderView({ section, snapshot, onNavigate }: PlaceholderViewProps) {
  const content = copy[section];
  const Icon = content.icon;
  return (
    <div className="view-stack">
      <section className="coming-soon-panel">
        <div className="coming-icon">
          <Icon size={29} />
        </div>
        <span className="eyebrow">{content.eyebrow}</span>
        <h2>{content.title}</h2>
        <p>{content.description}</p>
        <button
          className="button button-secondary"
          onClick={() => onNavigate(section === "settings" ? "models" : "library")}
          type="button"
        >
          {section === "settings" ? "Controlla i motori" : "Apri la libreria"}
          <ArrowUpRight size={16} />
        </button>
      </section>

      {section === "settings" ? (
        <section className="surface-panel diagnostics-card">
          <div>
            <span className="eyebrow">Dati applicazione</span>
            <h3>Posizione verificabile</h3>
          </div>
          <code>{snapshot.system.dataDirectory}</code>
          <div className="diagnostic-grid">
            <span>
              Sistema <strong>{snapshot.system.platformLabel}</strong>
            </span>
            <span>
              Architettura <strong>{snapshot.system.architecture}</strong>
            </span>
            <span>
              Core logici <strong>{snapshot.system.logicalCpus}</strong>
            </span>
            <span>
              Rete motori <strong>Solo loopback</strong>
            </span>
          </div>
        </section>
      ) : null}
    </div>
  );
}
