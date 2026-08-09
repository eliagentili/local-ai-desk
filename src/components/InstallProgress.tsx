import { LoaderCircle, StopCircle } from "lucide-react";

import { install } from "../lib/strings";
import type { RuntimeStatus } from "../types";

interface InstallProgressProps {
  runtime: RuntimeStatus;
  cancelling: boolean;
  onCancel: (() => void) | null;
}

/** The install writes `[n/totale]` markers to its log and the core parses them,
 *  so the phase can be shown instead of a spinner that says nothing for tens of
 *  minutes. Step 0 means the first marker has not appeared yet, which is a real
 *  state and is shown as indeterminate rather than as "fase 0". */
export function InstallProgress({ runtime, cancelling, onCancel }: InstallProgressProps) {
  const total = runtime.installStepTotal;
  const step = runtime.installStep;
  const known = step > 0 && total > 0;
  const percent = known ? Math.min(100, Math.round((step / total) * 100)) : null;
  const label = runtime.installStepLabel.trim() || install.phaseUnknown;

  return (
    <div className="install-progress">
      <div className="install-progress-copy">
        <span className="eyebrow">{install.phaseEyebrow}</span>
        <strong>{label}</strong>
        <small>{known ? install.stepOf(step, total) : install.phaseUnknown}</small>
      </div>
      <div
        aria-label={install.phaseEyebrow}
        aria-valuemax={known ? 100 : undefined}
        aria-valuemin={known ? 0 : undefined}
        aria-valuenow={percent ?? undefined}
        aria-valuetext={known ? `${install.stepOf(step, total)}: ${label}` : label}
        className="progress-track"
        data-indeterminate={!known}
        role="progressbar"
      >
        <span style={percent === null ? undefined : { width: `${percent}%` }} />
      </div>
      <small className="install-progress-hint">{install.logHint}</small>
      {onCancel ? (
        <button
          className="button button-secondary button-compact"
          disabled={cancelling}
          onClick={onCancel}
          type="button"
        >
          {cancelling ? (
            <><LoaderCircle className="spin" size={15} /> {install.cancelling}</>
          ) : (
            <><StopCircle size={15} /> {install.cancel}</>
          )}
        </button>
      ) : null}
    </div>
  );
}
