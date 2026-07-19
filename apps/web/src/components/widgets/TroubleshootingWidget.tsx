import { useState } from "react";
import { ArrowRight, Check, ClipboardCheck, RotateCcw } from "lucide-react";

type CheckItem = { cause: string; action: string };
type Match = { id: string; symptom: string; checks: CheckItem[]; pages: number[] };
type TroubleshootingData = { symptom: string; process?: string; matches: Match[] };

function isTroubleshootingData(data: unknown): data is TroubleshootingData {
  return Boolean(data && typeof data === "object" && Array.isArray((data as { matches?: unknown }).matches));
}

type Props = {
  data: unknown;
  onStepHelp: (stepNumber: number) => void;
  helpDisabled: boolean;
};

export function TroubleshootingWidget({ data, onStepHelp, helpDisabled }: Props) {
  const [completedCount, setCompletedCount] = useState(0);
  if (!isTroubleshootingData(data) || !data.matches[0]) return <section className="widget"><p>No diagnostic checklist matched this symptom.</p></section>;
  const match = data.matches[0];

  return (
    <section className="widget troubleshooting-widget">
      <div className="widget-heading">
        <div className="widget-icon"><ClipboardCheck size={19} /></div>
        <div><span className="eyebrow">Work through in order</span><h3>{match.symptom}</h3></div>
        <span className="progress-count">{completedCount}/{match.checks.length}</span>
      </div>
      <div className="check-list">
        {match.checks.map((item, index) => {
          const stepNumber = index + 1;
          const complete = index < completedCount;
          const unlocked = index <= completedCount;
          const current = index === completedCount;
          return (
            <div
              key={`${item.cause}-${index}`}
              className={`check-list-item${complete ? " complete" : ""}${current ? " current" : ""}${unlocked ? "" : " locked"}`}
              aria-current={current ? "step" : undefined}
            >
              <button
                className="check-step-action"
                type="button"
                disabled={!unlocked || complete}
                aria-label={complete ? `Step ${stepNumber} complete: ${item.cause}` : `Complete step ${stepNumber}: ${item.cause}`}
                onClick={() => {
                  if (current) setCompletedCount((count) => Math.min(count + 1, match.checks.length));
                }}
              >
                <span className="check-box">{complete ? <Check size={15} /> : stepNumber}</span>
                <span><strong>{item.cause}</strong><small>{item.action}</small></span>
              </button>
              <button
                type="button"
                className="procedure-help-action check-help-action"
                disabled={!unlocked || helpDisabled}
                aria-label={`Get help with step ${stepNumber}`}
                data-tooltip="Stuck?"
                onClick={() => onStepHelp(stepNumber)}
              >
                <ArrowRight size={17} strokeWidth={2.5} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="widget-footer-row">
        <span>Owner’s Manual, pp. {match.pages.join(", ")}</span>
        <button type="button" onClick={() => setCompletedCount(0)}><RotateCcw size={14} /> Reset</button>
      </div>
    </section>
  );
}
