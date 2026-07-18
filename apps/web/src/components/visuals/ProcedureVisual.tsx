import type { ProcedureSpec } from "../../visual-spec";

export function ProcedureVisual({ spec }: { spec: ProcedureSpec }) {
  return (
    <ol className="visual-procedure">
      {spec.steps.map((step, index) => (
        <li key={step.id} className={`tone-${step.tone ?? "neutral"}`}>
          <span>{index + 1}</span>
          <div><strong>{step.title}</strong><p>{step.body}</p></div>
        </li>
      ))}
    </ol>
  );
}
