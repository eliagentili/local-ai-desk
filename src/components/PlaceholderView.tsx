import { ArrowUpRight, Route } from "lucide-react";

import type { SectionId } from "../types";

interface PlaceholderViewProps {
  section: "workflows";
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
} as const;

export function PlaceholderView({ section, onNavigate }: PlaceholderViewProps) {
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
          onClick={() => onNavigate("library")}
          type="button"
        >
          Apri la libreria
          <ArrowUpRight size={16} />
        </button>
      </section>
    </div>
  );
}
