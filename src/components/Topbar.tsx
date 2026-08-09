import { Archive, CloudOff, Cpu, Download, RotateCw } from "lucide-react";

import type { AppUpdater } from "../hooks/useAppUpdater";
import { sectionTitles } from "../lib/strings";
import type { BridgeStatus, SectionId } from "../types";

interface TopbarProps {
  active: SectionId;
  bridge: BridgeStatus;
  importing: boolean;
  onImport: () => void;
  onOpenUpdates: () => void;
  updater: AppUpdater;
}

export function Topbar({ active, bridge, importing, onImport, onOpenUpdates, updater }: TopbarProps) {
  const showUpdate = ["available", "downloading", "downloaded", "installing", "ready"].includes(updater.phase);
  return (
    <header className="topbar">
      <div>
        <span className="eyebrow">Workspace personale</span>
        <h1>{sectionTitles[active]}</h1>
      </div>
      <div className="topbar-actions">
        {showUpdate ? (
          <button className="system-pill update-pill" onClick={onOpenUpdates} type="button">
            {updater.phase === "ready" ? <RotateCw size={14} /> : <Download size={14} />}
            {updater.phase === "ready"
              ? "Riavvia per aggiornare"
              : updater.phase === "downloaded"
                ? "Pronto da installare"
              : updater.phase === "downloading"
                ? `Aggiornamento ${updater.progress === null ? "…" : `${updater.progress}%`}`
                : `Versione ${updater.availableVersion}`}
          </button>
        ) : null}
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
