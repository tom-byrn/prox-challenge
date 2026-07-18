import { useState } from "react";
import { Expand, FileText, X } from "lucide-react";
import type { FigurePayload } from "../types";

function sourceLabel(source: string) {
  if (source === "owner-manual") return "Owner’s Manual";
  if (source === "quick-start") return "Quick Start Guide";
  return "Process Selection Chart";
}

function sourceUrl(source: string, page: number) {
  const filename = source === "owner-manual"
    ? "owner-manual.pdf"
    : source === "quick-start"
      ? "quick-start-guide.pdf"
      : "selection-chart.pdf";
  return `/files/${filename}#page=${page}`;
}

export function SourceFigure({ figure }: { figure: FigurePayload }) {
  const [expanded, setExpanded] = useState(false);
  const firstPage = figure.pages[0] ?? 1;

  return (
    <>
      <figure className="source-figure">
        <button className="figure-image-button" type="button" onClick={() => setExpanded(true)} aria-label={`Expand ${figure.title}`}>
          <img src={figure.url} alt={figure.caption} loading="lazy" />
          <span className="expand-pill"><Expand size={14} /> Expand</span>
        </button>
        <figcaption>
          <div>
            <span className="eyebrow">Manual figure</span>
            <h3>{figure.title}</h3>
            <p>{figure.caption}</p>
          </div>
          <a className="source-link" href={sourceUrl(figure.source, firstPage)} target="_blank" rel="noreferrer">
            <FileText size={15} /> {sourceLabel(figure.source)}, p. {figure.pages.join("–")}
          </a>
        </figcaption>
      </figure>

      {expanded ? (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={figure.title} onClick={() => setExpanded(false)}>
          <button className="lightbox-close" type="button" onClick={() => setExpanded(false)} aria-label="Close expanded figure"><X size={20} /></button>
          <div className="lightbox-content" onClick={(event) => event.stopPropagation()}>
            <img src={figure.url} alt={figure.caption} />
            <div><strong>{figure.title}</strong><span>{sourceLabel(figure.source)}, p. {figure.pages.join("–")}</span></div>
          </div>
        </div>
      ) : null}
    </>
  );
}
