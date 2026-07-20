import { useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import type { ProcedureSpec } from "../../visual-spec";

type Props = {
  spec: ProcedureSpec;
  onStepHelp: (stepNumber: number, step: ProcedureSpec["steps"][number]) => void;
  helpDisabled: boolean;
};

export function ProcedureVisual({ spec, onStepHelp, helpDisabled }: Props) {
  const [completedCount, setCompletedCount] = useState(0);

  return (
    <ol className="visual-procedure">
      {spec.steps.map((step, index) => {
        const stepNumber = index + 1;
        const complete = index < completedCount;
        const unlocked = index <= completedCount;
        const current = index === completedCount;
        return (
          <li
            key={step.id}
            className={`tone-${step.tone ?? "neutral"}${complete ? " complete" : ""}${current ? " current" : ""}${unlocked ? "" : " locked"}`}
            aria-current={current ? "step" : undefined}
          >
            <button
              type="button"
              className="procedure-step-action"
              disabled={!unlocked || complete}
              aria-label={complete ? `Step ${stepNumber} complete: ${step.title}` : `Complete step ${stepNumber}: ${step.title}`}
              onClick={() => {
                if (current) setCompletedCount((count) => Math.min(count + 1, spec.steps.length));
              }}
            >
              <span className="procedure-step-number">{complete ? <Check size={14} strokeWidth={3} /> : stepNumber}</span>
              <span className="procedure-step-copy">
                <strong>{step.title}</strong>
                <span>{step.body}</span>
              </span>
            </button>
            <button
              type="button"
              className="procedure-help-action"
              disabled={!unlocked || helpDisabled}
              aria-label={`Get help with step ${stepNumber}`}
              data-tooltip="Stuck?"
              onClick={() => onStepHelp(stepNumber, step)}
            >
              <ArrowRight size={17} strokeWidth={2.5} />
            </button>
          </li>
        );
      })}
    </ol>
  );
}
