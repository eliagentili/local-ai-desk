import {
  ArrowRight,
  FileUp,
  FileSearch,
  Languages,
  Mic2,
  ShieldCheck,
} from "lucide-react";

import { formatBytes, formatDate } from "../lib/format";
import { roadmapNote } from "../lib/strings";
import type { AppSnapshot, SectionId } from "../types";

interface DashboardProps {
  snapshot: AppSnapshot;
  onImport: () => void;
  onQuickPick: () => void;
  onNavigate: (section: SectionId) => void;
}

export function Dashboard({ snapshot, onImport, onQuickPick, onNavigate }: DashboardProps) {
  const pendingJobs = snapshot.jobs.filter((job) =>
    ["queued", "preparing", "uploading", "running", "finalizing", "cancelling"].includes(
      job.status,
    ),
  );
  const recentItems = snapshot.library.slice(0, 4);

  return (
    <div className="view-stack dashboard-view">
      <section className="hero-panel">
        <div className="hero-copy">
          <span className="eyebrow">Privato. Locale. Multipiattaforma.</span>
          <h2>
            Dal file al risultato.
            <br />
            <span>Senza lasciare il tuo computer.</span>
          </h2>
          <p>
            Trascina documenti, PDF, audio o video. Local AI Desk sceglie il motore
            giusto, lavora in locale e conserva solo ciò che vuoi tu.
          </p>
          <div className="hero-actions">
            <button className="button button-primary" onClick={onQuickPick} type="button">
              Elabora subito
              <ArrowRight size={17} />
            </button>
            <button
              className="button button-secondary"
              onClick={onImport}
              type="button"
            >
              Aggiungi alla libreria
            </button>
          </div>
        </div>
        <button className="hero-drop-zone" onClick={onQuickPick} type="button">
          <span className="hero-drop-icon"><FileUp size={28} /></span>
          <span className="eyebrow">Drop rapido</span>
          <strong>Trascina qui. Lavora. Fatto.</strong>
          <small>Scegli anche più file: non vengono aggiunti alla Libreria.</small>
          <span className="drop-benefits" aria-label="Vantaggi del drop rapido">
            <span>Auto locale</span>
            <span>Nessun duplicato</span>
            <span>Pulizia automatica</span>
          </span>
        </button>
      </section>

      <section aria-labelledby="quick-actions-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Parti da qui</span>
            <h3 id="quick-actions-title">Azioni rapide</h3>
          </div>
          <span className="section-note">Originali intatti · risultati sempre sotto controllo</span>
        </div>
        <div className="quick-grid">
          <QuickAction
            icon={<FileSearch size={22} />}
            title="Elabora un documento"
            description="Trascina PDF, Office o scansioni e lascia scegliere ad Auto."
            accent="lime"
            onClick={onQuickPick}
          />
          <QuickAction
            icon={<Languages size={22} />}
            title="Traduci un PDF"
            description="Configura lingua e layout, poi segui ogni pagina in Attività."
            accent="blue"
            onClick={() => onNavigate("studio")}
          />
          <QuickAction
            icon={<Mic2 size={22} />}
            title="Trascrivi audio o video"
            description="Crea testo, sottotitoli o JSON con Faster Whisper locale."
            accent="coral"
            onClick={() => onNavigate("studio")}
          />
          <QuickAction
            icon={<ShieldCheck size={22} />}
            title="Controlla la privacy"
            description="Rileva e maschera dati personali nei file testuali."
            accent="ink"
            onClick={() => onNavigate("studio")}
          />
        </div>
        {/* The sidebar used to carry a "Workflow" entry that opened a page with
            nothing in it. The promise belongs here, as a declared absence. */}
        <p className="roadmap-note">{roadmapNote}</p>
      </section>

      <section className="metrics-grid" aria-label="Stato del workspace">
        <Metric label="Elementi in libreria" value={String(snapshot.library.length)} />
        <Metric label="In elaborazione" value={String(pendingJobs.length)} />
        <Metric
          label="Motori disponibili"
          value={snapshot.bridge.available ? `${snapshot.bridge.readyEngines}` : "—"}
          detail={snapshot.bridge.available ? "pronti in locale" : "avvia i motori locali"}
        />
        <Metric
          label="Memoria disponibile"
          value={formatBytes(snapshot.system.availableMemoryBytes)}
          detail={`${snapshot.system.logicalCpus} core logici · ${snapshot.system.architecture}`}
        />
      </section>

      <section className="split-grid">
        <div className="surface-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Libreria</span>
              <h3>File recenti</h3>
            </div>
            <button className="text-button" onClick={() => onNavigate("library")} type="button">
              Vedi tutto <ArrowRight size={14} />
            </button>
          </div>
          {recentItems.length ? (
            <div className="compact-list">
              {recentItems.map((item) => (
                <div className="compact-row" key={item.id}>
                  <span className="file-badge">{item.kind.slice(0, 3).toUpperCase()}</span>
                  <div className="row-copy">
                    <strong>{item.name}</strong>
                    <span>
                      {formatBytes(item.sizeBytes)} · {formatDate(item.addedAt)}
                    </span>
                  </div>
                  <span className="status-label">Pronto</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyInline
              title="La libreria è vuota"
              description="È opzionale: il Drop rapido elabora anche file di molti GB senza archiviarli."
            />
          )}
        </div>

        <div className="surface-panel bridge-panel">
          <span className="eyebrow">Compatibilità</span>
          <h3>Motori esistenti</h3>
          <p>
            La nuova app esegue la suite solo sul loopback del dispositivo. Nessun
            endpoint remoto, upload cloud o token esterno.
          </p>
          <div className="bridge-status" data-ready={snapshot.bridge.available}>
            <span className="status-dot" />
            <div>
              <strong>{snapshot.bridge.label}</strong>
              <span>
                {snapshot.bridge.available
                  ? `Scheduler attivo · massimo ${snapshot.bridge.batchParallelism} lavori`
                  : "La nuova libreria funziona comunque in autonomia"}
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

interface QuickActionProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  accent: "lime" | "blue" | "coral" | "ink";
  onClick: () => void;
}

function QuickAction({ icon, title, description, accent, onClick }: QuickActionProps) {
  return (
    <button className="quick-card" data-accent={accent} onClick={onClick} type="button">
      <span className="quick-icon">{icon}</span>
      <strong>{title}</strong>
      <p>{description}</p>
      <ArrowRight className="quick-arrow" size={17} />
    </button>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function EmptyInline({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-inline">
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}
