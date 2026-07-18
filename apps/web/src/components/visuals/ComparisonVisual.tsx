import type { ComparisonSpec } from "../../visual-spec";

export function ComparisonVisual({ spec }: { spec: ComparisonSpec }) {
  return (
    <div className="visual-comparison-scroll">
      <table className="visual-comparison">
        <thead><tr><th>Attribute</th>{spec.columns.map((column) => <th key={column.id}>{column.label}</th>)}</tr></thead>
        <tbody>
          {spec.rows.map((row) => {
            const values = new Map(row.values.map((value) => [value.columnId, value]));
            return (
              <tr key={row.id}>
                <th>{row.label}</th>
                {spec.columns.map((column) => {
                  const value = values.get(column.id);
                  return <td key={column.id} className={`tone-${value?.tone ?? "neutral"}`}>{value?.text ?? "—"}</td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
