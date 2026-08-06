import { CheckCircle2, CircleDashed, Clock3 } from "lucide-react";

import { formatDate } from "../lib/format";
import type { Job } from "../types";

export function ActivityView({ jobs }: { jobs: Job[] }) {
  return (
    <div className="view-stack">
      <section className="view-intro">
        <div>
          <span className="eyebrow">Coda persistente</span>
          <h2>Ogni lavoro ha una storia.</h2>
          <p>
            Qui confluiranno progresso reale, fase corrente, tempi, annullamento e
            recupero dopo un riavvio. I file appena importati restano in bozza finché
            non scegli cosa farne.
          </p>
        </div>
      </section>

      <section className="surface-panel activity-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Timeline</span>
            <h3>{jobs.length ? `${jobs.length} attività` : "Nessuna attività"}</h3>
          </div>
        </div>
        {jobs.length ? (
          <div className="activity-list">
            {jobs.map((job) => (
              <article className="activity-row" key={job.id}>
                <span className="activity-icon" data-status={job.status}>
                  {job.status === "completed" ? (
                    <CheckCircle2 size={20} />
                  ) : job.status === "running" ? (
                    <CircleDashed className="spin" size={20} />
                  ) : (
                    <Clock3 size={20} />
                  )}
                </span>
                <div className="activity-copy">
                  <strong>{job.inputName}</strong>
                  <span>{job.stage}</span>
                  <div
                    aria-label={`Avanzamento ${job.progress}%`}
                    aria-valuemax={100}
                    aria-valuemin={0}
                    aria-valuenow={Math.max(0, Math.min(100, job.progress))}
                    className="progress-track"
                    role="progressbar"
                  >
                    <span style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }} />
                  </div>
                </div>
                <div className="activity-meta">
                  <span className="status-label">{statusLabel(job.status)}</span>
                  <small>{formatDate(job.updatedAt)}</small>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state compact-empty">
            <Clock3 size={25} />
            <h3>La coda è libera</h3>
            <p>Le elaborazioni appariranno qui con il loro avanzamento effettivo.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft: "Da configurare",
    queued: "In coda",
    running: "In corso",
    completed: "Completato",
    cancelled: "Annullato",
    failed: "Errore",
  };
  return labels[status] ?? status;
}
