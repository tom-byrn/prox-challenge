import { memo, useId, useState, type KeyboardEvent } from "react";
import type { AnnotatedImageSpec, VisualAsset, VisualTone } from "../../visual-spec";

type Props = {
  spec: AnnotatedImageSpec;
  assets: VisualAsset[];
  visualId: string;
  overlayId: string;
  showOverlay: boolean;
};

function annotationToneClass(tone: VisualTone | undefined): string {
  if (tone === "warning" || tone === "negative") return `tone-${tone}`;
  return "tone-primary";
}

export const AnnotatedImageVisual = memo(function AnnotatedImageVisual({ spec, assets, visualId, overlayId, showOverlay }: Props) {
  const [selectedId, setSelectedId] = useState<string>();
  const [hoveredId, setHoveredId] = useState<string>();
  const markerId = `annotation-arrow-${useId().replaceAll(":", "")}`;
  const asset = assets.find((candidate) => candidate.assetId === spec.image.assetId);
  if (!asset) return <div className="visual-render-error">The referenced source image is unavailable.</div>;
  const activeId = hoveredId ?? selectedId;
  const markerRadius = Math.max(16, Math.round(Math.min(asset.width, asset.height) * 0.025));
  const markerSize = markerRadius * 2.2;
  const fontSize = Math.max(13, Math.round(markerRadius * 0.9));
  const select = (id: string) => setSelectedId((current) => current === id ? undefined : id);

  return (
    <div className="annotated-layout">
      <figure className="annotated-canvas">
        <div className="annotated-image-wrap">
          <img src={asset.url} alt={spec.image.alt} />
          <svg id={overlayId} className={`annotation-overlay${showOverlay ? "" : " hidden"}`} viewBox={`0 0 ${asset.width} ${asset.height}`} role="group" aria-label={`Interactive annotations for ${spec.title}`} aria-hidden={!showOverlay}>
            <defs>
              <marker id={markerId} markerUnits="userSpaceOnUse" viewBox="0 0 10 10" refX="9" refY="5" markerWidth={markerSize} markerHeight={markerSize} orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" />
              </marker>
            </defs>
            {spec.annotations.map((annotation, index) => {
              const className = `annotation-shape ${annotationToneClass(annotation.tone)}${activeId === annotation.id ? " active" : ""}`;
              const interaction = {
                role: "button",
                tabIndex: showOverlay ? 0 : -1,
                "aria-label": `${index + 1}. ${annotation.label}`,
                "aria-pressed": selectedId === annotation.id,
                onClick: () => select(annotation.id),
                onFocus: () => setHoveredId(annotation.id),
                onBlur: () => setHoveredId(undefined),
                onMouseEnter: () => setHoveredId(annotation.id),
                onMouseLeave: () => setHoveredId(undefined),
                onKeyDown: (event: KeyboardEvent<SVGGElement>) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    select(annotation.id);
                  }
                }
              };
              if (annotation.shape === "box") {
                return <g key={annotation.id} className={className} {...interaction}><rect x={annotation.bounds.x1} y={annotation.bounds.y1} width={annotation.bounds.x2 - annotation.bounds.x1} height={annotation.bounds.y2 - annotation.bounds.y1} rx="12" /><circle className="annotation-number" cx={annotation.bounds.x1 + markerRadius} cy={annotation.bounds.y1 + markerRadius} r={markerRadius} /><text x={annotation.bounds.x1 + markerRadius} y={annotation.bounds.y1 + markerRadius + fontSize * 0.34} fontSize={fontSize} textAnchor="middle">{index + 1}</text></g>;
              }
              if (annotation.shape === "arrow") {
                return <g key={annotation.id} className={className} {...interaction}><line x1={annotation.from.x} y1={annotation.from.y} x2={annotation.to.x} y2={annotation.to.y} markerEnd={`url(#${markerId})`} /><circle className="annotation-number" cx={annotation.from.x} cy={annotation.from.y} r={markerRadius} /><text x={annotation.from.x} y={annotation.from.y + fontSize * 0.34} fontSize={fontSize} textAnchor="middle">{index + 1}</text></g>;
              }
              return <g key={annotation.id} className={className} {...interaction}><circle className="annotation-halo" cx={annotation.point.x} cy={annotation.point.y} r={markerRadius * 1.3} /><circle className="annotation-number" cx={annotation.point.x} cy={annotation.point.y} r={markerRadius} /><text x={annotation.point.x} y={annotation.point.y + fontSize * 0.34} fontSize={fontSize} textAnchor="middle">{index + 1}</text></g>;
            })}
          </svg>
        </div>
        <figcaption>{asset.title}</figcaption>
      </figure>

      <ol className="annotation-list" aria-label={`Annotations for ${spec.title}`}>
        {spec.annotations.map((annotation, index) => (
          <li key={annotation.id} className={`${annotationToneClass(annotation.tone)}${activeId === annotation.id ? " active" : ""}`}>
            <button
              type="button"
              aria-describedby={`visual-title-${visualId}`}
              aria-pressed={selectedId === annotation.id}
              onClick={() => select(annotation.id)}
              onFocus={() => setHoveredId(annotation.id)}
              onBlur={() => setHoveredId(undefined)}
              onMouseEnter={() => setHoveredId(annotation.id)}
              onMouseLeave={() => setHoveredId(undefined)}
            >
              <span>{index + 1}</span>
              <span><strong>{annotation.label}</strong>{annotation.body ? <small>{annotation.body}</small> : null}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
});
