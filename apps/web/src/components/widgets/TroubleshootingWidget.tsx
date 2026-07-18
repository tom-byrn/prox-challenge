import { useState } from "react";
import { Check, ClipboardCheck, RotateCcw } from "lucide-react";

type CheckItem = { cause: string; action: string };
type Match = { id: string; symptom: string; checks: CheckItem[]; pages: number[] };
type TroubleshootingData = { symptom: string; process?: string; matches: Match[] };

function isTroubleshootingData(data: unknown): data is TroubleshootingData {
  return Boolean(data && typeof data === "object" && Array.isArray((data as { matches?: unknown }).matches));
}

export function TroubleshootingWidget({ data }: { data: unknown }) {
  const [checked, setChecked] = useState<Set<number>>(() => new Set());
  if (!isTroubleshootingData(data) || !data.matches[0]) return <section className="widget"><p>No diagnostic checklist matched this symptom.</p></section>;
  const match = data.matches[0];

  const toggle = (index: number) => {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <section className="widget troubleshooting-widget">
      <div className="widget-heading">
        <div className="widget-icon"><ClipboardCheck size={19} /></div>
        <div><span className="eyebrow">Work through in order</span><h3>{match.symptom}</h3></div>
        <span className="progress-count">{checked.size}/{match.checks.length}</span>
      </div>
      <div className="check-list">
        {match.checks.map((item, index) => {
          const complete = checked.has(index);
          return (
            <button key={`${item.cause}-${index}`} className={complete ? "complete" : ""} type="button" onClick={() => toggle(index)}>
              <span className="check-box">{complete ? <Check size={15} /> : index + 1}</span>
              <span><strong>{item.cause}</strong><small>{item.action}</small></span>
            </button>
          );
        })}
      </div>
      <div className="widget-footer-row">
        <span>Owner’s Manual, pp. {match.pages.join(", ")}</span>
        <button type="button" onClick={() => setChecked(new Set())}><RotateCcw size={14} /> Reset</button>
      </div>
    </section>
  );
}
