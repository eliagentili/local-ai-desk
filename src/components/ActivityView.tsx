import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Clipboard,
  Clock3,
  FolderOpen,
  History,
  RotateCcw,
  StopCircle,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";

import { describeError } from "../lib/errors";
import { formatBytes, formatCount, formatDate, formatTime } from "../lib/format";
import { jobHistory, jobStatusLabel } from "../lib/strings";
import type { Job, JobEvent } from "../types";

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
  onCopyHistory: (text: string) => void;
  onExport: (jobIds: string[]) => void;
  onLoadEvents: (jobId: string) => Promise<JobEvent[]>;
  onRetry: (jobId: string) => void;
  onReveal: (jobId: string) => void;
}

export function ActivityView({
  jobs,
  onCancel,
  onCancelAll,
  onCopyHistory,
  onExport,
  onLoadEvents,
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
            {jobs.map((job) => (
              <ActivityRow
                job={job}
                key={job.id}
                onCancel={onCancel}
                onCopyHistory={onCopyHistory}
                onLoadEvents={onLoadEvents}
                onRetry={onRetry}
                onReveal={onReveal}
              />
            ))}
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

interface ActivityRowProps {
  job: Job;
  onCancel: (jobId: string) => void;
  onCopyHistory: (text: string) => void;
  onLoadEvents: (jobId: string) => Promise<JobEvent[]>;
  onRetry: (jobId: string) => void;
  onReveal: (jobId: string) => void;
}

function ActivityRow({
  job,
  onCancel,
  onCopyHistory,
  onLoadEvents,
  onRetry,
  onReveal,
}: ActivityRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [events, setEvents] = useState<JobEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const isActive = activeStates.has(job.status);
  const indeterminate =
    ["preparing", "running"].includes(job.status) && job.stageTotal === 0;
  // During the upload the two counters are bytes; every other stage counts pages
  // or segments. The status is the stable discriminator — the previous check
  // compared the Italian stage label, so translating it would have broken the
  // formatting instead of the wording.
  const stageInBytes = job.status === "uploading";
  const historyId = `job-history-${job.id}`;

  async function refreshEvents() {
    setLoading(true);
    try {
      setEvents(await onLoadEvents(job.id));
    } finally {
      setLoading(false);
    }
  }

  function toggleHistory() {
    const next = !expanded;
    setExpanded(next);
    // Re-read on every open: an active job appends events while the row is on
    // screen, so a cached list would age the moment it is shown.
    if (next) void refreshEvents();
  }

  function copyHistory() {
    if (!events?.length) return;
    const lines = events.map(
      (event) =>
        `${formatTime(event.createdAt)}\t${jobStatusLabel(event.status)}\t${
          Math.round(event.progress)
        }%\t${event.stage}${event.message ? `\t${event.message}` : ""}`,
    );
    onCopyHistory([`${job.inputName} · ${job.workflow}`, ...lines].join("\n"));
  }

  return (
    <article className="activity-row">
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
            {stageInBytes
              ? `${formatBytes(job.stageCurrent)} di ${formatBytes(job.stageTotal)}`
              : `${formatCount(job.stageCurrent)} di ${formatCount(job.stageTotal)}`}
            {job.totalParts > 1 ? ` · parte ${job.partIndex} di ${job.totalParts}` : ""}
          </small>
        ) : null}
        <div
          aria-label={indeterminate ? `${job.stage}, avanzamento non determinato` : `Avanzamento ${job.progress}%`}
          aria-valuemax={indeterminate ? undefined : 100}
          aria-valuemin={indeterminate ? undefined : 0}
          aria-valuenow={indeterminate ? undefined : Math.round(job.progress)}
          aria-valuetext={indeterminate ? undefined : `${Math.round(job.progress)}% · ${job.stage}`}
          className="progress-track"
          data-indeterminate={indeterminate}
          role="progressbar"
        >
          <span style={indeterminate ? undefined : { width: `${job.progress}%` }} />
        </div>
        {job.error ? (
          <small className="job-error">{describeError(job.error)}</small>
        ) : null}
        {job.warnings.map((warning) => (
          <small className="job-warning" key={warning}>
            <AlertTriangle size={12} /> {warning}
          </small>
        ))}
        {job.engine ? <small className="job-engine">{job.engine}</small> : null}
        <button
          aria-controls={historyId}
          aria-expanded={expanded}
          className="text-button history-toggle"
          onClick={toggleHistory}
          type="button"
        >
          <History size={13} />
          {expanded ? jobHistory.toggleClose : jobHistory.toggleOpen}
          <ChevronDown className="history-chevron" data-open={expanded} size={13} />
        </button>
        {expanded ? (
          <div className="job-history" id={historyId}>
            {loading && !events ? (
              <small>{jobHistory.loading}</small>
            ) : events?.length ? (
              <>
                <ol>
                  {events.map((event) => (
                    <li key={event.id}>
                      <span className="job-history-time">{formatTime(event.createdAt)}</span>
                      <span className="job-history-status" data-status={event.status}>
                        {jobStatusLabel(event.status)}
                      </span>
                      <span className="job-history-stage">
                        {event.stage}
                        {event.message ? (
                          <small>{describeError(event.message)}</small>
                        ) : null}
                      </span>
                      <span className="job-history-progress">
                        {Math.round(event.progress)}%
                      </span>
                    </li>
                  ))}
                </ol>
                <button className="text-button" onClick={copyHistory} type="button">
                  <Clipboard size={13} /> {jobHistory.copy}
                </button>
              </>
            ) : (
              <small>{jobHistory.empty}</small>
            )}
          </div>
        ) : null}
      </div>
      <div className="activity-meta">
        <span className="status-label" data-status={job.status}>
          {jobStatusLabel(job.status)}
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
}
