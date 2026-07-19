import { memo, useEffect, useState } from "react";
import { Activity, AlertTriangle, Clock3, Coins, Database, Gauge, RotateCw, Wrench, X } from "lucide-react";
import { loadTelemetrySummary, type TelemetrySummary } from "../lib/chat-persistence";

type Props = {
  ownerId: string;
  onClose: () => void;
};

const integerFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function formatCost(cost: number): string {
  return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
}

export const SettingsPanel = memo(function SettingsPanel({ ownerId, onClose }: Props) {
  const [telemetry, setTelemetry] = useState<TelemetrySummary>();
  const [telemetryError, setTelemetryError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    void loadTelemetrySummary(ownerId, controller.signal)
      .then(setTelemetry)
      .catch((error) => {
        if ((error as Error).name !== "AbortError") setTelemetryError(error instanceof Error ? error.message : "Telemetry is unavailable.");
      });
    return () => controller.abort();
  }, [ownerId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="settings-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="settings-panel-header">
          <div>
            <span className="settings-panel-icon"><Gauge size={18} /></span>
            <div><small>Runtime telemetry</small><h2 id="settings-title">Settings & usage</h2></div>
          </div>
          <button type="button" aria-label="Close settings" onClick={onClose}><X size={17} /></button>
        </header>

        {telemetry === undefined ? (
          <div className="telemetry-loading"><RotateCw size={17} /><span>{telemetryError ?? "Loading telemetry…"}</span></div>
        ) : (
          <div className="settings-panel-body">
            <div className="telemetry-stat-grid">
              <article><span><Coins size={14} /> Total cost</span><strong>{formatCost(telemetry.totals.costUsd)}</strong><small>{formatCost(telemetry.averages.costUsd)} per turn</small></article>
              <article><span><Activity size={14} /> Agent turns</span><strong>{integerFormatter.format(telemetry.sampledTurns)}</strong><small>{telemetry.totals.repairs} repaired</small></article>
              <article><span><Clock3 size={14} /> Avg. latency</span><strong>{formatDuration(telemetry.averages.durationMs)}</strong><small>{formatDuration(telemetry.averages.apiDurationMs)} API time</small></article>
              <article className={telemetry.totals.errors || telemetry.totals.toolErrors ? "has-warning" : ""}><span><AlertTriangle size={14} /> Errors</span><strong>{telemetry.totals.errors + telemetry.totals.toolErrors}</strong><small>{telemetry.totals.errors} turns · {telemetry.totals.toolErrors} tools</small></article>
            </div>

            <section className="telemetry-section" aria-labelledby="usage-heading">
              <div className="telemetry-section-heading"><div><Database size={14} /><h3 id="usage-heading">Token usage</h3></div><small>Last {telemetry.sampledTurns} turns</small></div>
              <dl className="telemetry-metrics-list">
                <div><dt>Input</dt><dd>{integerFormatter.format(telemetry.totals.inputTokens)}</dd></div>
                <div><dt>Output</dt><dd>{integerFormatter.format(telemetry.totals.outputTokens)}</dd></div>
                <div><dt>Cache read</dt><dd>{integerFormatter.format(telemetry.totals.cacheReadInputTokens)}</dd></div>
                <div><dt>Cache written</dt><dd>{integerFormatter.format(telemetry.totals.cacheCreationInputTokens)}</dd></div>
              </dl>
            </section>

            <section className="telemetry-section" aria-labelledby="quality-heading">
              <div className="telemetry-section-heading"><div><Wrench size={14} /><h3 id="quality-heading">Agent quality signals</h3></div></div>
              <dl className="telemetry-metrics-list compact">
                <div><dt>Tool calls</dt><dd>{integerFormatter.format(telemetry.totals.toolCalls)}</dd></div>
                <div><dt>SDK turns</dt><dd>{integerFormatter.format(telemetry.totals.sdkTurns)}</dd></div>
                <div><dt>Validation catches</dt><dd>{integerFormatter.format(telemetry.totals.validationIssues)}</dd></div>
                <div><dt>Degraded answers</dt><dd>{integerFormatter.format(telemetry.totals.degraded)}</dd></div>
              </dl>
            </section>

            <section className="telemetry-section telemetry-recent" aria-labelledby="recent-heading">
              <div className="telemetry-section-heading"><div><Activity size={14} /><h3 id="recent-heading">Recent turns</h3></div></div>
              {telemetry.recent.length === 0 ? <p>No completed agent turns have been recorded yet.</p> : (
                <ol>
                  {telemetry.recent.map((turn) => (
                    <li key={turn.id}>
                      <span className={`telemetry-status status-${turn.status}`} aria-label={turn.status} />
                      <div><strong>{turn.conversationTitle}</strong><small>{turn.model} · {dateFormatter.format(turn.createdAt)}</small></div>
                      <span><strong>{formatCost(turn.costUsd)}</strong><small>{formatDuration(turn.durationMs)}</small></span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        )}

        <footer className="settings-panel-footer">
          <span>Operational metrics only</span>
          <small>Prompts and responses are not copied into telemetry.</small>
        </footer>
      </section>
    </div>
  );
});
