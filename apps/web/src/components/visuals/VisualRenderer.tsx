import { useState } from "react";
import { Columns3, Eye, EyeOff, Gauge, ListChecks, PanelsTopLeft, ScanSearch, Waypoints } from "lucide-react";
import type { ProcedureSpec, VisualPayload, VisualSourceRef } from "../../visual-spec";
import { AnnotatedImageVisual } from "./AnnotatedImageVisual";
import { ComparisonVisual } from "./ComparisonVisual";
import { ConnectionDiagramVisual } from "./ConnectionDiagramVisual";
import { MetricSummaryVisual } from "./MetricSummaryVisual";
import { ProcedureVisual } from "./ProcedureVisual";
import { ReferenceCardVisual } from "./ReferenceCardVisual";

function sourceLabel(ref: VisualSourceRef): string {
  if (ref.kind === "figure") return `Manual figure · ${ref.figureId}`;
  if (ref.kind === "video") return `Video · ${ref.segmentId.replace("video:", "")}`;
  const source = ({
    "owner-manual": "Owner's Manual",
    "quick-start": "Quick Start Guide",
    "selection-chart": "Process Selection Chart"
  } as const)[ref.sourceId];
  if (ref.kind === "structured-data") return `${source} verified data, p${ref.pages.length > 1 ? "p" : ""}. ${ref.pages.join(", ")}`;
  return `${source}, p${ref.pages.length > 1 ? "p" : ""}. ${ref.pages.join(", ")}`;
}

function sourceKey(ref: VisualSourceRef, index: number): string {
  if (ref.kind === "figure") return `figure:${ref.figureId}:${index}`;
  if (ref.kind === "video") return `video:${ref.segmentId}:${index}`;
  if (ref.kind === "structured-data") return `table:${ref.dataset}:${ref.recordIds.join("-")}:${index}`;
  return `document:${ref.sourceId}:${ref.pages.join("-")}:${index}`;
}

function VisualIcon({ kind }: { kind: VisualPayload["spec"]["kind"] }) {
  if (kind === "annotated-image") return <ScanSearch size={17} />;
  if (kind === "connection-diagram") return <Waypoints size={17} />;
  if (kind === "procedure") return <ListChecks size={17} />;
  if (kind === "comparison") return <Columns3 size={17} />;
  if (kind === "metric-summary") return <Gauge size={17} />;
  return <PanelsTopLeft size={17} />;
}

export function VisualRenderer({ visual, onStepHelp, stepHelpDisabled }: { visual: VisualPayload; onStepHelp: (stepNumber: number, step: ProcedureSpec["steps"][number]) => void; stepHelpDisabled: boolean }) {
  const { spec } = visual;
  const [showAnnotations, setShowAnnotations] = useState(() => visual.assets.some((asset) => asset.source === "user-photo"));
  const annotationOverlayId = `annotation-overlay-${visual.id}`;

  return (
    <section className={`visual-card visual-${spec.kind}`} aria-labelledby={`visual-title-${visual.id}`}>
      <header className="visual-heading">
        <span className="visual-icon"><VisualIcon kind={spec.kind} /></span>
        <div className="visual-heading-copy">
          <span className="eyebrow">Dynamic visual</span>
          <h3 id={`visual-title-${visual.id}`}>{spec.title}</h3>
          {spec.description ? <p>{spec.description}</p> : null}
        </div>
        {spec.kind === "annotated-image" ? (
          <button
            type="button"
            className={`annotation-toggle${showAnnotations ? " active" : ""}`}
            aria-controls={annotationOverlayId}
            aria-pressed={showAnnotations}
            onClick={() => setShowAnnotations((visible) => !visible)}
          >
            {showAnnotations ? <Eye size={14} /> : <EyeOff size={14} />}
            <span>Annotations</span>
            <small>{showAnnotations ? "On" : "Off"}</small>
          </button>
        ) : null}
      </header>

      {spec.kind === "annotated-image" ? <AnnotatedImageVisual spec={spec} assets={visual.assets} visualId={visual.id} overlayId={annotationOverlayId} showOverlay={showAnnotations} /> : null}
      {spec.kind === "connection-diagram" ? <ConnectionDiagramVisual spec={spec} visualId={visual.id} /> : null}
      {spec.kind === "procedure" ? <ProcedureVisual spec={spec} onStepHelp={onStepHelp} helpDisabled={stepHelpDisabled} /> : null}
      {spec.kind === "comparison" ? <ComparisonVisual spec={spec} /> : null}
      {spec.kind === "metric-summary" ? <MetricSummaryVisual spec={spec} /> : null}
      {spec.kind === "reference-card" ? <ReferenceCardVisual spec={spec} /> : null}

      <footer className="visual-sources">
        <strong>Sources</strong>
        {spec.sourceRefs.map((ref, index) => <span key={sourceKey(ref, index)}>{sourceLabel(ref)}</span>)}
      </footer>
    </section>
  );
}
