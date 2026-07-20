import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import mermaid from "mermaid";
import { transform } from "sucrase";
import type { ArtifactPayload } from "./artifacts";
import "./artifact-runtime.css";

type RuntimeMessage = { protocol: "prox-artifact-v2"; type: "render"; artifact: ArtifactPayload };

function send(type: string, detail: Record<string, unknown> = {}) {
  window.parent.postMessage({ protocol: "prox-artifact-v2", type, ...detail }, "*");
}

function serializeConsoleValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack || value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

for (const level of ["log", "warn", "error"] as const) {
  const original = console[level].bind(console);
  console[level] = (...values: unknown[]) => {
    original(...values);
    send("console", { level, message: values.map(serializeConsoleValue).join(" ") });
  };
}

window.addEventListener("error", (event) => send("error", { message: event.message || "Unknown runtime error" }));
window.addEventListener("unhandledrejection", (event) => send("error", { message: serializeConsoleValue(event.reason || "Unhandled promise rejection") }));

function embeddedDocument(artifact: ArtifactPayload): string {
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'">`;
  const bridge = `<script>(()=>{const send=(value)=>parent.postMessage({protocol:'prox-artifact-inner',type:'error',message:String(value)},'*');window.addEventListener('error',e=>send(e.message||'Unknown render error'));window.addEventListener('unhandledrejection',e=>send(e.reason||'Unhandled promise rejection'));})();</script>`;
  const baseStyle = `<style>:root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;padding:20px;background:#f5f2e9;color:#23231f}</style>`;
  const injection = `${policy}${baseStyle}${bridge}`;
  if (artifact.type === "image/svg+xml") {
    return `<!doctype html><html><head>${injection}</head><body>${artifact.content}</body></html>`;
  }
  if (/<head[^>]*>/i.test(artifact.content)) {
    return artifact.content.replace(/<head[^>]*>/i, (head) => `${head}${injection}`);
  }
  return `<!doctype html><html><head>${injection}</head><body>${artifact.content}</body></html>`;
}

function EmbeddedArtifact({ artifact }: { artifact: ArtifactPayload }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const relay = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const payload = event.data as { protocol?: string; type?: string; message?: string };
      if (payload.protocol === "prox-artifact-inner" && payload.type === "error") send("error", { message: payload.message || "Embedded artifact error" });
    };
    window.addEventListener("message", relay);
    return () => window.removeEventListener("message", relay);
  }, []);
  return <iframe ref={frameRef} className="runtime-embedded" title={artifact.title} sandbox="allow-scripts" srcDoc={embeddedDocument(artifact)} />;
}

function MermaidArtifact({ artifact }: { artifact: ArtifactPayload }) {
  const [markup, setMarkup] = useState("");
  useEffect(() => {
    let cancelled = false;
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral", suppressErrorRendering: true });
    void mermaid.render(`artifact-${artifact.id.replace(/[^a-z0-9]/gi, "")}`, artifact.content)
      .then(({ svg }) => {
        if (!cancelled) setMarkup(svg);
      })
      .catch((error: unknown) => send("error", { message: serializeConsoleValue(error) }));
    return () => { cancelled = true; };
  }, [artifact]);
  return markup
    ? <div className="runtime-mermaid" dangerouslySetInnerHTML={{ __html: markup }} />
    : <div className="runtime-empty">Rendering diagram…</div>;
}

function compileReactComponent(source: string): React.ComponentType {
  const compiled = transform(source, {
    transforms: ["typescript", "jsx", "imports"],
    jsxPragma: "React.createElement",
    jsxFragmentPragma: "React.Fragment",
    production: true
  }).code;
  const module = { exports: {} as Record<string, unknown> };
  const factory = new Function(
    "React",
    "module",
    "exports",
    `${compiled}\nreturn module.exports.default || module.exports.App || (typeof App !== 'undefined' ? App : undefined);`
  ) as (react: typeof React, module: { exports: Record<string, unknown> }, exports: Record<string, unknown>) => unknown;
  const component = factory(React, module, module.exports);
  if (typeof component !== "function" && (typeof component !== "object" || component === null)) {
    throw new Error("React artifact must export a default component (for example: export default function App() { ... }).");
  }
  return component as React.ComponentType;
}

function ReactArtifact({ artifact }: { artifact: ArtifactPayload }) {
  const Component = useMemo(() => compileReactComponent(artifact.content), [artifact.content]);
  return <Component />;
}

class ArtifactErrorBoundary extends React.Component<{ artifactId?: string; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    send("error", { artifactId: this.props.artifactId, message: error.stack || error.message });
  }

  render() {
    return this.state.failed ? <div className="runtime-empty">This artifact could not be rendered.</div> : this.props.children;
  }
}

function Runtime({ artifact }: { artifact?: ArtifactPayload }) {
  useEffect(() => {
    if (artifact) send("rendered", { artifactId: artifact.id });
  }, [artifact]);
  if (!artifact) return <div className="runtime-empty">Waiting for artifact…</div>;
  if (artifact.type === "text/html" || artifact.type === "image/svg+xml") return <EmbeddedArtifact artifact={artifact} />;
  if (artifact.type === "application/vnd.ant.mermaid") return <main className="runtime-shell"><MermaidArtifact artifact={artifact} /></main>;
  if (artifact.type === "application/vnd.ant.react") return <main className="runtime-shell"><div className="runtime-document"><ReactArtifact artifact={artifact} /></div></main>;
  if (artifact.type === "text/markdown") {
    return <main className="runtime-shell"><article className="runtime-document"><ReactMarkdown remarkPlugins={[remarkGfm]}>{artifact.content}</ReactMarkdown></article></main>;
  }
  return <main className="runtime-shell"><article className="runtime-document"><pre><code>{artifact.content}</code></pre></article></main>;
}

let currentArtifact: ArtifactPayload | undefined;
const root = createRoot(document.getElementById("artifact-root")!);
const render = () => {
  try {
    root.render(<ArtifactErrorBoundary key={currentArtifact?.id} artifactId={currentArtifact?.id}><Runtime artifact={currentArtifact} /></ArtifactErrorBoundary>);
  } catch (error) {
    send("error", { message: serializeConsoleValue(error) });
  }
};

window.addEventListener("message", (event: MessageEvent<RuntimeMessage>) => {
  if (event.source !== window.parent || event.data?.protocol !== "prox-artifact-v2" || event.data.type !== "render") return;
  currentArtifact = event.data.artifact;
  render();
});

new ResizeObserver(() => send("resize", { height: Math.ceil(document.documentElement.scrollHeight) })).observe(document.documentElement);
render();
send("ready");
