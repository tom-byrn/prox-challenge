import type { ReferenceCardSpec } from "../../visual-spec";

export function ReferenceCardVisual({ spec }: { spec: ReferenceCardSpec }) {
  return (
    <div className="visual-reference-card">
      <div className="reference-group-grid">
        {spec.groups.map((group) => (
          <section key={group.id} className="reference-group">
            <h4>{group.title}</h4>
            <dl>
              {group.items.map((item) => (
                <div key={item.id} className={`tone-${item.tone ?? "neutral"}`}>
                  <dt>{item.label}</dt>
                  <dd>
                    {item.value ? <strong>{item.value}</strong> : null}
                    {item.detail ? <span>{item.detail}</span> : null}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      {(spec.callouts ?? []).map((callout) => (
        <aside key={callout.id} className={`visual-generic-callout tone-${callout.tone ?? "neutral"}`}>
          {callout.title ? <strong>{callout.title}</strong> : null}
          <span>{callout.body}</span>
        </aside>
      ))}
    </div>
  );
}
