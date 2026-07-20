import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Clipboard, Code2, Eye, RefreshCw, TerminalSquare, TriangleAlert } from "lucide-react";
import { artifactTypeLabel, normalizeArtifact, type StoredArtifactPayload } from "../artifacts";

type RuntimeEvent = {
  protocol?: string;
  type?: "ready" | "rendered" | "resize" | "error" | "console";
  artifactId?: string;
  height?: number;
  level?: "log" | "warn" | "error";
  message?: string;
};

export function ArtifactFrame({ artifact: storedArtifact, onRepair }: { artifact: StoredArtifactPayload; onRepair: (message: string) => void }) {
  const artifact = useMemo(() => normalizeArtifact(storedArtifact), [storedArtifact]);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const copyTimerRef = useRef<number | undefined>(undefined);
  const [mode, setMode] = useState<"preview" | "source">("preview");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string>();
  const [logs, setLogs] = useState<Array<{ id: string; level: string; message: string }>>([]);
  const [showConsole, setShowConsole] = useState(false);
  const [copied, setCopied] = useState(false);
  const [height, setHeight] = useState(440);

  const renderArtifact = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage({ protocol: "prox-artifact-v2", type: "render", artifact }, "*");
  }, [artifact]);

  useEffect(() => {
    setStatus("loading");
    setError(undefined);
    setLogs([]);
    setMode("preview");
    renderArtifact();
  }, [artifact, renderArtifact]);

  useEffect(() => () => window.clearTimeout(copyTimerRef.current), []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<RuntimeEvent>) => {
      if (event.source !== frameRef.current?.contentWindow || event.data?.protocol !== "prox-artifact-v2") return;
      const payload = event.data;
      if (payload.type === "ready") {
        renderArtifact();
        return;
      }
      if (payload.type === "rendered" && payload.artifactId === artifact.id) {
        setStatus("ready");
        return;
      }
      if (payload.type === "resize" && typeof payload.height === "number") {
        setHeight(Math.max(320, Math.min(720, payload.height)));
        return;
      }
      if (payload.type === "error") {
        setError(payload.message || "The artifact failed to render.");
        setStatus("error");
        return;
      }
      if (payload.type === "console" && payload.message) {
        setLogs((current) => [...current, { id: crypto.randomUUID(), level: payload.level || "log", message: payload.message! }].slice(-40));
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [artifact.id, renderArtifact]);

  const copySource = useCallback(async () => {
    await navigator.clipboard.writeText(artifact.content);
    setCopied(true);
    window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopied(false), 1_500);
  }, [artifact.content]);

  return (
    <section className="artifact-card" aria-labelledby={`artifact-title-${artifact.id}`}>
      <header className="artifact-title">
        <div className="artifact-heading-copy">
          <span><Code2 size={15} /> Artifact · {artifactTypeLabel(artifact.type)}</span>
          <strong id={`artifact-title-${artifact.id}`}>{artifact.title}</strong>
          <small>{artifact.identifier} · revision {artifact.revision}</small>
        </div>
        <div className="artifact-tabs" role="tablist" aria-label="Artifact view">
          <button type="button" role="tab" aria-selected={mode === "preview"} onClick={() => setMode("preview")}><Eye size={14} />Preview</button>
          <button type="button" role="tab" aria-selected={mode === "source"} onClick={() => setMode("source")}><Code2 size={14} />Source</button>
        </div>
      </header>

      {mode === "preview" ? (
        <div className="artifact-preview">
          <div className={`artifact-runtime-status status-${status}`} aria-live="polite">{status === "loading" ? "Starting isolated runtime…" : status === "ready" ? "Preview ready" : "Runtime error"}</div>
          {error ? (
            <div className="artifact-error">
              <TriangleAlert size={22} />
              <strong>This artifact hit a runtime error.</strong>
              <small>{error}</small>
              <button type="button" onClick={() => onRepair(`Update the artifact with identifier “${artifact.identifier}” to repair revision ${artifact.revision}. The isolated runtime failed with: ${error}. Return the complete replacement artifact, not a diff.`)}><RefreshCw size={15} />Repair with Claude</button>
            </div>
          ) : null}
          <iframe
            ref={frameRef}
            title={`${artifact.title} preview`}
            sandbox={import.meta.env.DEV ? "allow-scripts allow-same-origin" : "allow-scripts"}
            src="/artifact-runtime.html"
            height={height}
            onLoad={renderArtifact}
          />
        </div>
      ) : (
        <div className="artifact-source">
          <button type="button" onClick={() => void copySource()}>{copied ? <Check size={14} /> : <Clipboard size={14} />}{copied ? "Copied" : "Copy source"}</button>
          <pre><code>{artifact.content}</code></pre>
        </div>
      )}

      {logs.length > 0 ? (
        <footer className="artifact-console">
          <button type="button" aria-expanded={showConsole} onClick={() => setShowConsole((current) => !current)}><TerminalSquare size={14} />Console · {logs.length}</button>
          {showConsole ? <pre>{logs.map((log) => <code key={log.id}>[{log.level}] {log.message}{"\n"}</code>)}</pre> : null}
        </footer>
      ) : null}
    </section>
  );
}
