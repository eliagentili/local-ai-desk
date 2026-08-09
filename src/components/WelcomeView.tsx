import {
  Clock3,
  Download,
  HardDrive,
  Languages,
  LoaderCircle,
  Mic2,
  ScanText,
  ShieldCheck,
  Sparkles,
  Wifi,
} from "lucide-react";
import type { ComponentType } from "react";

import { formatBytes } from "../lib/format";
import { install, intentDescriptions, intentLabels, intentOrder, welcome } from "../lib/strings";
import type { RuntimeStatus, WorkflowIntent } from "../types";
import { InstallProgress } from "./InstallProgress";

const intentIcons: Record<WorkflowIntent, ComponentType<{ size?: number }>> = {
  extract: Sparkles,
  translate: Languages,
  ocr: ScanText,
  transcribe: Mic2,
  privacy: ShieldCheck,
};

interface WelcomeViewProps {
  runtime: RuntimeStatus;
  busy: boolean;
  cancelling: boolean;
  onInstall: () => void;
  onCancelInstall: () => void;
  onPostpone: () => void;
}

/** Shown in place of the dashboard while the engines are missing. The old first
 *  run invited the user to process a file and then disabled the button three
 *  screens later; here the only two moves are "installa" and "più tardi", and
 *  both say what they cost. */
export function WelcomeView({
  runtime,
  busy,
  cancelling,
  onInstall,
  onCancelInstall,
  onPostpone,
}: WelcomeViewProps) {
  const spaceKnown = runtime.freeBytes > 0;
  const missingBytes = Math.max(0, runtime.requiredBytes - runtime.freeBytes);
  const notEnoughSpace = spaceKnown && missingBytes > 0;

  return (
    <div className="view-stack welcome-view">
      <section className="surface-panel welcome-panel">
        <span className="eyebrow">{welcome.eyebrow}</span>
        <h2>{welcome.title}</h2>
        <p>{welcome.intro}</p>

        <h3>{welcome.objectivesTitle}</h3>
        <ul className="welcome-objectives">
          {intentOrder.map((intent) => {
            const Icon = intentIcons[intent];
            return (
              <li key={intent}>
                <span className="welcome-objective-icon" aria-hidden="true">
                  <Icon size={17} />
                </span>
                <span>
                  <strong>{intentLabels[intent]}</strong>
                  <small>{intentDescriptions[intent]}</small>
                </span>
              </li>
            );
          })}
        </ul>

        <h3>{welcome.requirementsTitle}</h3>
        <div className="welcome-requirements">
          <div>
            <HardDrive size={17} />
            <span>{welcome.spaceLabel}</span>
            <strong>{formatBytes(runtime.requiredBytes)}</strong>
            <small>
              {spaceKnown
                ? `${formatBytes(runtime.freeBytes)} ${install.spaceOk}`
                : welcome.spaceUnknown}
            </small>
          </div>
          <div>
            <Clock3 size={17} />
            <span>{welcome.timeLabel}</span>
            <strong>{welcome.timeValue}</strong>
            <small>{welcome.timeDetail}</small>
          </div>
          <div>
            <Wifi size={17} />
            <span>{welcome.networkLabel}</span>
            <strong>{welcome.networkValue}</strong>
            <small>{welcome.networkDetail}</small>
          </div>
        </div>

        {/* The refusal is shown before the button is pressed: the core rejects an
            install below the threshold anyway, and finding out afterwards would
            mean waiting for a download that cannot finish. */}
        {notEnoughSpace ? (
          <div className="inline-alert welcome-alert" data-tone="error">
            <span>{install.notEnoughSpaceTitle}</span>
            <p>
              {install.missingSpace(
                formatBytes(missingBytes),
                formatBytes(runtime.requiredBytes),
              )}
            </p>
          </div>
        ) : !spaceKnown ? (
          <div className="inline-alert welcome-alert">
            <span>{welcome.spaceLabel}</span>
            <p>{install.freeSpaceUnknown}</p>
          </div>
        ) : null}

        {!runtime.supported ? (
          <div className="inline-alert welcome-alert" data-tone="error">
            <span>{welcome.eyebrow}</span>
            <p>{welcome.unsupported}</p>
          </div>
        ) : null}

        {runtime.installing ? (
          <InstallProgress
            cancelling={cancelling}
            onCancel={onCancelInstall}
            runtime={runtime}
          />
        ) : (
          <>
            <div className="welcome-actions">
              <button
                className="button button-primary"
                disabled={!runtime.supported || notEnoughSpace || busy}
                onClick={onInstall}
                type="button"
              >
                {busy ? (
                  <><LoaderCircle className="spin" size={17} /> {install.phaseUnknown}</>
                ) : (
                  <><Download size={17} /> {welcome.install}</>
                )}
              </button>
              <button className="button button-secondary" onClick={onPostpone} type="button">
                {welcome.postpone}
              </button>
            </div>
            <p className="welcome-hint">{welcome.postponeHint}</p>
          </>
        )}
      </section>
    </div>
  );
}
