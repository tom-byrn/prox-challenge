import { memo } from "react";
import { ChevronDown, ExternalLink, FileText, Image, Play, TableProperties } from "lucide-react";
import type { EvidenceSource } from "../evidence";

function formatTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function sourceMeta(source: EvidenceSource): string {
  if (source.kind === "video") return `Setup Demo · ${formatTime(source.startSeconds)}–${formatTime(source.endSeconds)} · ${source.captionType} captions`;
  if (source.kind === "structured-data") return `Verified data · pp. ${source.pages.join(", ")}`;
  if (source.kind === "figure") return `Manual figure · pp. ${source.pages.join(", ")}`;
  return `pp. ${source.pages.join(", ")}`;
}

function SourceIcon({ source }: { source: EvidenceSource }) {
  if (source.kind === "video") return <Play size={13} fill="currentColor" />;
  if (source.kind === "figure") return <Image size={13} />;
  if (source.kind === "structured-data") return <TableProperties size={13} />;
  return <FileText size={13} />;
}

export const SourcesDrawer = memo(function SourcesDrawer({ sources }: { sources: EvidenceSource[] }) {
  if (sources.length === 0) return null;
  return (
    <details className="sources-drawer">
      <summary>
        <span><FileText size={14} /> Sources <small>{sources.length}</small></span>
        <ChevronDown size={14} />
      </summary>
      <ol>
        {sources.map((source) => {
          const content = (
            <>
              <span className={`source-kind-icon source-kind-${source.kind}`}><SourceIcon source={source} /></span>
              {source.previewUrl ? <img src={source.previewUrl} alt="" loading="lazy" /> : null}
              <div className="source-entry-copy">
                <strong>{source.title}</strong>
                <small>{sourceMeta(source)}</small>
                {source.excerpt ? <p>{source.excerpt}</p> : null}
              </div>
              {source.url ? <span className="source-entry-open" aria-hidden="true"><ExternalLink size={13} /></span> : null}
            </>
          );

          return (
            <li key={source.id}>
              {source.url ? (
                <a className="source-entry" href={source.url} target="_blank" rel="noreferrer" aria-label={`Open ${source.title}`}>
                  {content}
                </a>
              ) : <div className="source-entry">{content}</div>}
            </li>
          );
        })}
      </ol>
    </details>
  );
});
