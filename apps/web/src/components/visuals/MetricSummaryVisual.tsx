import type { MetricSummarySpec } from "../../visual-spec";

export function MetricSummaryVisual({ spec }: { spec: MetricSummarySpec }) {
  return (
    <div className="visual-metric-summary">
      <dl className="metric-summary-grid">
        {spec.metrics.map((metric) => (
          <div key={metric.id} className={`tone-${metric.tone ?? "neutral"}`}>
            <dt>{metric.label}</dt>
            <dd>
              <strong>{metric.value}</strong>
              {metric.unit ? <span>{metric.unit}</span> : null}
            </dd>
            {metric.detail ? <p>{metric.detail}</p> : null}
          </div>
        ))}
      </dl>
      {spec.callout ? (
        <aside className={`visual-generic-callout tone-${spec.callout.tone ?? "neutral"}`}>
          {spec.callout.title ? <strong>{spec.callout.title}</strong> : null}
          <span>{spec.callout.body}</span>
        </aside>
      ) : null}
    </div>
  );
}
