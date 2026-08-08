import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  CircleDashed,
  Clock3,
  FolderOpen,
  RotateCcw,
  StopCircle,
  XCircle,
} from "lucide-react";
import { useMemo } from "react";

import { formatBytes, formatDate } from "../lib/format";
import type { Job } from "../types";

const activeStates = new Set([
  "queued",
  "preparing",
  "uploading",
  "running",
  "finalizing",
  "cancelling",
]);

const retryableStates = new Set(["failed", "cancelled", "interrupted"]);

interface ActivityViewProps {
  jobs: Job[];
  onCancel: (jobId: string) => void;
  onCancelAll: () => void;
  onExport: (jobIds: string[]) => void;
  onRetry: (jobId: string) => void;
  onReveal: (jobId: string) => void;
}

export function ActivityView({
  jobs,
  onCancel,
  onCancelAll,
  onExport,
  onRetry,
  onReveal,
}: ActivityViewProps) {
  const { active, exportable, latestBatchSize } = useMemo(() => {
    const current = jobs.filter((job) => activeStates.has(job.status));
    const batches = new Map<string, Job[]>();
    jobs.forEach((job) => {
      const key = job.batchId ?? job.id;
      const batch = batches.get(key);
      if (batch) batch.push(job);
      else batches.set(key, [job]);
    });
    // Always the most recent batch. Picking the first fully completed one meant
    // that a single unfinished job silently exported an older batch instead.
    const latest = [...batches.values()].reduce<Job[]>((best, batch) => {
      if (!batch.length) return best;
      if (!best.length) return batch;
      return batch[0].createdAt > best[0].createdAt ? batch : best;
    }, []);
    const ready = latest.filter(
      (job) => job.status === "completed" && Boolean(job.outputPath),
    );
    return { active: current, exportable: ready, latestBatchSize: latest.length };
  }, [jobs]);

  return (
    <div className="view-stack">
      <section className="view-intro activity-intro">
        <div>
          <span className="eyebrow">Coda persistente</span>
          <h2>Ogni lavoro, sotto controllo.</h2>
          <p>
            Upload misurato, fase reale del motore, annullamento e risultati che
            sopravvivono alla chiusura. Se un motore non espone una percentuale, la
            fase resta indeterminata invece di mostrare una stima inventata.
          </p>
        </div>
        <div className="activity-actions">
          {active.length ? (
            <button className="button button-danger" onClick={onCancelAll} type="button">
              <StopCircle size={16} /> Annulla tutto
            </button>
          ) : null}
          {exportable.length ? (
            <button
              className="button button-primary"
              onClick={() => onExport(exportable.map((job) => job.id))}
              type="button"
            >
              <Archive size={16} />
              {exportable.length === latestBatchSize
                ? "ZIP ultimo batch"
                : `ZIP ultimo batch (${exportable.length} di ${latestBatchSize})`}
            </button>
          ) : null}
        </div>
      </section>

      <section className="surface-panel activity-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Timeline</span>
            <h3>{jobs.length ? `${jobs.length} attività` : "Nessuna attività"}</h3>
          </div>
          {active.length ? (
            <span className="live-count">
              <span className="status-dot" /> {active.length} {active.length === 1 ? "attivo" : "attivi"}
            </span>
          ) : null}
        </div>
        {jobs.length ? (
          <div className="activity-list">
            {jobs.map((job) => {
              const isActive = activeStates.has(job.status);
              const indeterminate =
                ["preparing", "running"].includes(job.status) && job.stageTotal === 0;
              return (
                <article className="activity-row" key={job.id}>
                  <span className="activity-icon" data-status={job.status}>
                    {job.status === "completed" ? (
                      <CheckCircle2 size={20} />
                    ) : job.status === "failed" || job.status === "interrupted" ? (
                      <XCircle size={20} />
                    ) : isActive ? (
                      <CircleDashed className="spin" size={20} />
                    ) : (
                      <Clock3 size={20} />
                    )}
                  </span>
                  <div className="activity-copy">
                    <strong>{job.inputName}</strong>
                    <span>{job.stage}</span>
                    {job.stageTotal > 0 ? (
                      <small>
                        {job.stage === "Trasferimento al motore locale"
                          ? `${formatBytes(job.stageCurrent)} di ${formatBytes(job.stageTotal)}`
                          : `${job.stageCurrent.toLocaleString("it-IT")} di ${job.stageTotal.toLocaleString("it-IT")}`}
                        {job.totalParts > 1
                          ? ` · parte ${job.partIndex} di ${job.totalParts}`
                          : ""}
                      </small>
                    ) : null}
                    <div
                      aria-label={indeterminate ? `${job.stage}, avanzamento non determinato` : `Avanzamento ${job.progress}%`}
                      aria-valuemax={indeterminate ? undefined : 100}
                      aria-valuemin={indeterminate ? undefined : 0}
                      aria-valuenow={indeterminate ? undefined : Math.round(job.progress)}
                      className="progress-track"
                      data-indeterminate={indeterminate}
                      role="progressbar"
                    >
                      <span style={indeterminate ? undefined : { width: `${job.progress}%` }} />
                    </div>
                    {job.error ? <small className="job-error">{job.error}</small> : null}
                    {job.warnings.map((warning) => (
                      <small className="job-warning" key={warning}>
                        <AlertTriangle size={12} /> {warning}
                      </small>
                    ))}
                    {job.engine ? <small className="job-engine">{job.engine}</small> : null}
                  </div>
                  <div className="activity-meta">
                    <span className="status-label" data-status={job.status}>
                      {statusLabel(job.status)}
                    </span>
                    <small>{formatDate(job.updatedAt)}</small>
                    {isActive ? (
                      <button
                        className="row-action danger-action"
                        disabled={job.status === "cancelling"}
                        onClick={() => onCancel(job.id)}
                        type="button"
                      >
                        <StopCircle size={13} />
                        {job.status === "cancelling" ? "Interruzione…" : "Annulla"}
                      </button>
                    ) : job.status === "completed" ? (
                      <button className="row-action" onClick={() => onReveal(job.id)} type="button">
                        <FolderOpen size={13} /> Mostra
                      </button>
                    ) : retryableStates.has(job.status) ? (
                      <button className="row-action" onClick={() => onRetry(job.id)} type="button">
                        <RotateCcw size={13} /> Riprova
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state compact-empty">
            <Clock3 size={25} />
            <h3>La coda è libera</h3>
            <p>Configura un batch in Studio: i suoi progressi appariranno qui.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    queued: "In coda",
    preparing: "Preparazione",
    uploading: "Trasferimento",
    running: "In corso",
    finalizing: "Salvataggio",
    cancelling: "Interruzione",
    completed: "Completato",
    cancelled: "Annullato",
    interrupted: "Interrotto",
    failed: "Errore",
  };
  return labels[status] ?? status;
}
