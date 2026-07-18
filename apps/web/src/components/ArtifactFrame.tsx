import { useEffect, useMemo, useRef, useState } from "react";
import { Code2, RefreshCw, TriangleAlert } from "lucide-react";
import type { ArtifactPayload } from "../types";

function artifactDocument(artifact: ArtifactPayload) {
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'">`;
  const bridge = `<script>(()=>{const send=(value)=>parent.postMessage({type:'arcwell-artifact-error',artifactId:${JSON.stringify(artifact.id)},message:String(value)},'*');window.addEventListener('error',e=>send(e.message||'Unknown render error'));window.addEventListener('unhandledrejection',e=>send(e.reason||'Unhandled promise rejection'));})();</script>`;
  const baseStyle = `<style>:root{color-scheme:light dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif}body{margin:0;background:#f4f1e8;color:#25251f}@media(prefers-color-scheme:dark){body{background:#1b1c19;color:#f4f1e8}}</style>`;
  const injection = `${policy}${baseStyle}${bridge}`;
  if (/<head[^>]*>/i.test(artifact.html)) return artifact.html.replace(/<head[^>]*>/i, (head) => `${head}${injection}`);
  return `<!doctype html><html><head>${injection}</head><body>${artifact.html}</body></html>`;
}

export function ArtifactFrame({ artifact, onRepair }: { artifact: ArtifactPayload; onRepair: (message: string) => void }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<string>();
  const srcDoc = useMemo(() => artifactDocument(artifact), [artifact]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const payload = event.data as { type?: string; artifactId?: string; message?: string };
      if (payload.type === "arcwell-artifact-error" && payload.artifactId === artifact.id) setError(payload.message ?? "The artifact failed to render.");
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [artifact.id]);

  return (
    <section className="artifact-card">
      <div className="artifact-title"><span><Code2 size={16} /> Interactive artifact</span><strong>{artifact.title}</strong></div>
      {error ? (
        <div className="artifact-error"><TriangleAlert size={22} /><strong>This interactive view hit an error.</strong><small>{error}</small><button type="button" onClick={() => onRepair(`Repair the “${artifact.title}” artifact. It failed with: ${error}`)}><RefreshCw size={15} /> Ask Arcwell to repair</button></div>
      ) : null}
      <iframe ref={frameRef} title={artifact.title} sandbox="allow-scripts" srcDoc={srcDoc} />
    </section>
  );
}
