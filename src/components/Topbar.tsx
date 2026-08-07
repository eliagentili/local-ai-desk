import { Archive, CloudOff, Cpu } from "lucide-react";

import type { BridgeStatus, SectionId } from "../types";

const sectionTitles: Record<SectionId, string> = {
  home: "Panoramica",
  library: "Libreria",
  studio: "Studio",
  workflows: "Workflow",
  activity: "Attività",
  models: "Modelli locali",
  settings: "Impostazioni",
};

interface TopbarProps {
  active: SectionId;
  bridge: BridgeStatus;
  importing: boolean;
  onImport: () => void;
}

export function Topbar({ active, bridge, importing, onImport }: TopbarProps) {
  return (
    <header className="topbar">
      <div>
        <span className="eyebrow">Workspace personale</span>
        <h1>{sectionTitles[active]}</h1>
      </div>
      <div className="topbar-actions">
        <span className="system-pill" data-ready={bridge.available}>
          <Cpu size={14} />
          {bridge.label}
        </span>
        <span className="system-pill privacy-pill">
          <CloudOff size={14} />
          Nessun cloud
        </span>
        <button
          className="button button-primary button-compact"
          disabled={importing}
          onClick={onImport}
          type="button"
        >
          <Archive size={16} />
          {importing ? "Aggiunta…" : "Aggiungi alla libreria"}
        </button>
      </div>
    </header>
  );
}
