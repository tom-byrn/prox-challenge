import { createHash } from "node:crypto";
import sharp from "sharp";
import { activeProductId } from "./knowledge-package.js";
import { getFigure, getKnowledgeAssetPath, getPage, getVideoSegment } from "./knowledge.js";
import { prepareVisualAsset, visualContentDensity, type PreparedVisualAsset } from "./visual-assets.js";
import {
  AnnotatedImageSchema,
  VisualSpecSchema,
  type AnnotatedImageSpec,
  type VisualAsset,
  type VisualPayload,
  type VisualSourceRef,
  type VisualSpec
} from "./visual-spec.js";

type VisualAssetSource = {
  assetBase: Omit<VisualAsset, "url" | "width" | "height" | "original" | "crop">;
  imagePath: string | Buffer;
};

function resolveVisualAssetSource(assetId: string, allowedUploadAssetId?: string, uploadedPhotoImage?: Buffer): VisualAssetSource & { trim?: boolean } {
  if (assetId.startsWith("upload:")) {
    if (!allowedUploadAssetId || assetId !== allowedUploadAssetId) throw new Error("That uploaded photo is not available in this turn.");
    if (!uploadedPhotoImage) throw new Error("That uploaded photo is no longer available.");
    return {
      assetBase: {
        assetId,
        title: "Your photo",
        source: "user-photo",
        pages: []
      },
      imagePath: uploadedPhotoImage,
      trim: false
    };
  }
  if (assetId.startsWith("figure:")) {
    const figure = getFigure(assetId.slice("figure:".length));
    return {
      assetBase: {
        assetId,
        title: figure.title,
        source: figure.source,
        pages: figure.pages
      },
      imagePath: getKnowledgeAssetPath(figure.file)
    };
  }

  const parts = assetId.split(":");
  const source = parts.length === 4 ? parts[2] : parts[1];
  const pageText = parts.length === 4 ? parts[3] : parts[2];
  if (parts.length === 4 && parts[1] !== activeProductId()) throw new Error(`Visual asset belongs to inactive product ${parts[1]}.`);
  const page = getPage(source ?? "", Number(pageText));
  return {
    assetBase: {
      assetId,
      title: page.title,
      source: page.source,
      pages: [page.page]
    },
    imagePath: page.imagePath
  };
}

export async function resolveVisualAsset(assetId: string, allowedUploadAssetId?: string, uploadedPhotoImage?: Buffer): Promise<PreparedVisualAsset> {
  const source = resolveVisualAssetSource(assetId, allowedUploadAssetId, uploadedPhotoImage);
  return prepareVisualAsset(source.assetBase, source.imagePath, { trim: source.trim });
}

function collectSourceRefs(spec: VisualSpec): VisualSourceRef[] {
  const refs = [...spec.sourceRefs];
  if (spec.kind === "annotated-image") {
    for (const annotation of spec.annotations) if (annotation.evidence) refs.push(annotation.evidence);
  } else if (spec.kind === "connection-diagram") {
    for (const connection of spec.connections) if (connection.evidence) refs.push(connection.evidence);
  } else if (spec.kind === "procedure") {
    for (const step of spec.steps) if (step.evidence) refs.push(step.evidence);
  } else if (spec.kind === "comparison") {
    for (const row of spec.rows) if (row.evidence) refs.push(row.evidence);
  } else if (spec.kind === "metric-summary") {
    for (const metric of spec.metrics) if (metric.evidence) refs.push(metric.evidence);
    if (spec.callout?.evidence) refs.push(spec.callout.evidence);
  } else {
    for (const group of spec.groups) for (const item of group.items) if (item.evidence) refs.push(item.evidence);
    for (const callout of spec.callouts ?? []) if (callout.evidence) refs.push(callout.evidence);
  }
  return refs;
}

function pointBounds(point: { x: number; y: number }, asset: VisualAsset) {
  const radius = Math.max(14, Math.round(Math.min(asset.width, asset.height) * 0.025));
  return { x1: point.x - radius, y1: point.y - radius, x2: point.x + radius, y2: point.y + radius };
}

export function validateAnnotationGrounding(spec: AnnotatedImageSpec, prepared: PreparedVisualAsset): void {
  const issues = annotationGroundingIssues(spec, prepared);
  if (issues.length > 0) throw new Error(issues.map((issue) => issue.message).join(" "));
}

export type AnnotationGroundingIssue = {
  annotationId: string;
  message: string;
};

export function annotationGroundingIssues(spec: AnnotatedImageSpec, prepared: PreparedVisualAsset): AnnotationGroundingIssue[] {
  const issues: AnnotationGroundingIssue[] = [];
  const { width, height } = prepared.asset;
  for (const annotation of spec.annotations) {
    const points = annotation.shape === "arrow" ? [annotation.from, annotation.to]
      : annotation.shape === "pin" ? [annotation.point]
        : [];
    for (const point of points) {
      if (point.x > width || point.y > height) {
        issues.push({ annotationId: annotation.id, message: `Annotation ${annotation.id} is outside the inspected ${width}×${height} pixel image.` });
        break;
      }
    }
    if (annotation.shape === "box" && (
      annotation.bounds.x2 > width || annotation.bounds.y2 > height
    )) {
      issues.push({ annotationId: annotation.id, message: `Annotation ${annotation.id} is outside the inspected ${width}×${height} pixel image.` });
    }

    if (issues.some((issue) => issue.annotationId === annotation.id)) continue;

    const targetBounds = annotation.shape === "pin" ? pointBounds(annotation.point, prepared.asset)
      : annotation.shape === "arrow" ? pointBounds(annotation.to, prepared.asset)
        : annotation.bounds;
    const density = visualContentDensity(prepared, targetBounds);
    if (density < 0.008) {
      const target = annotation.shape === "pin" ? annotation.point
        : annotation.shape === "arrow" ? annotation.to
          : { x: Math.round((annotation.bounds.x1 + annotation.bounds.x2) / 2), y: Math.round((annotation.bounds.y1 + annotation.bounds.y2) / 2) };
      issues.push({
        annotationId: annotation.id,
        message: `Annotation ${annotation.id} at (${target.x}, ${target.y}) appears to target blank background (${(density * 100).toFixed(2)}% visual content). Use the returned numbered preview and coordinate grid to move it onto the named target.`
      });
    }
  }
  return issues;
}

export function visualSpecHash(spec: VisualSpec): string {
  return createHash("sha256").update(JSON.stringify(spec)).digest("hex");
}

function previewSvg(spec: AnnotatedImageSpec, width: number, height: number): string {
  const markerSize = Math.max(18, Math.round(Math.min(width, height) * 0.025));
  const stroke = Math.max(3, Math.round(markerSize * 0.18));
  const fontSize = Math.max(13, Math.round(markerSize * 0.72));
  const gridSpacing = Math.max(100, Math.round(Math.min(width, height) / 8 / 50) * 50);
  const verticalGrid = Array.from({ length: Math.floor((width - 1) / gridSpacing) }, (_, index) => (index + 1) * gridSpacing)
    .map((x) => `<g><line x1="${x}" y1="0" x2="${x}" y2="${height}"/><text x="${x + 4}" y="18" fill="#075cc7" stroke="none" font-family="sans-serif" font-size="12" font-weight="700">x ${x}</text></g>`)
    .join("");
  const horizontalGrid = Array.from({ length: Math.floor((height - 1) / gridSpacing) }, (_, index) => (index + 1) * gridSpacing)
    .map((y) => `<g><line x1="0" y1="${y}" x2="${width}" y2="${y}"/><text x="4" y="${y - 5}" fill="#075cc7" stroke="none" font-family="sans-serif" font-size="12" font-weight="700">y ${y}</text></g>`)
    .join("");
  const grid = `<g stroke="#1677ff" stroke-width="1" stroke-dasharray="6 6" opacity="0.42">${verticalGrid}${horizontalGrid}</g>`;
  const shapes = spec.annotations.map((annotation, index) => {
    const number = index + 1;
    if (annotation.shape === "box") {
      const { x1, y1, x2, y2 } = annotation.bounds;
      return `<g><rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" rx="8" fill="rgba(239,116,64,.12)" stroke="#ef7440" stroke-width="${stroke}"/><circle cx="${x1 + markerSize * 0.5}" cy="${y1 + markerSize * 0.5}" r="${markerSize * 0.5}" fill="#ef7440" stroke="#fff" stroke-width="${Math.max(2, stroke / 2)}"/><text x="${x1 + markerSize * 0.5}" y="${y1 + markerSize * 0.5 + fontSize * 0.34}" text-anchor="middle" font-family="sans-serif" font-size="${fontSize}" font-weight="800" fill="#fff">${number}</text></g>`;
    }
    if (annotation.shape === "arrow") {
      return `<g><line x1="${annotation.from.x}" y1="${annotation.from.y}" x2="${annotation.to.x}" y2="${annotation.to.y}" stroke="#ef7440" stroke-width="${stroke}" stroke-linecap="round" marker-end="url(#arrow)"/><circle cx="${annotation.from.x}" cy="${annotation.from.y}" r="${markerSize * 0.5}" fill="#ef7440" stroke="#fff" stroke-width="${Math.max(2, stroke / 2)}"/><text x="${annotation.from.x}" y="${annotation.from.y + fontSize * 0.34}" text-anchor="middle" font-family="sans-serif" font-size="${fontSize}" font-weight="800" fill="#fff">${number}</text></g>`;
    }
    return `<g><circle cx="${annotation.point.x}" cy="${annotation.point.y}" r="${markerSize * 0.58}" fill="rgba(239,116,64,.18)" stroke="#ef7440" stroke-width="${stroke}"/><circle cx="${annotation.point.x}" cy="${annotation.point.y}" r="${markerSize * 0.38}" fill="#ef7440"/><text x="${annotation.point.x}" y="${annotation.point.y + fontSize * 0.34}" text-anchor="middle" font-family="sans-serif" font-size="${fontSize}" font-weight="800" fill="#fff">${number}</text></g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><marker id="arrow" markerUnits="userSpaceOnUse" markerWidth="${markerSize}" markerHeight="${markerSize}" refX="${markerSize - 2}" refY="${markerSize / 2}" orient="auto"><path d="M 0 0 L ${markerSize} ${markerSize / 2} L 0 ${markerSize} z" fill="#ef7440"/></marker></defs>${grid}${shapes}</svg>`;
}

export async function buildAnnotationPreview(input: unknown, allowedUploadAssetId?: string, uploadedPhotoImage?: Buffer): Promise<{ spec: AnnotatedImageSpec; prepared: PreparedVisualAsset; preview: Buffer; hash: string; valid: boolean; issues: AnnotationGroundingIssue[] }> {
  const spec = AnnotatedImageSchema.parse(input);
  const prepared = await resolveVisualAsset(spec.image.assetId, allowedUploadAssetId, uploadedPhotoImage);
  const issues = annotationGroundingIssues(spec, prepared);
  const svg = previewSvg(spec, prepared.asset.width, prepared.asset.height);
  const preview = await sharp(prepared.image).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
  return { spec, prepared, preview, hash: visualSpecHash(spec), valid: issues.length === 0, issues };
}

export async function buildVisualPayload(id: string, input: unknown, allowedUploadAssetId?: string, uploadedPhotoImage?: Buffer): Promise<VisualPayload> {
  const spec = VisualSpecSchema.parse(input);
  for (const ref of collectSourceRefs(spec)) {
    if (ref.kind === "figure") getFigure(ref.figureId);
    else if (ref.kind === "video") getVideoSegment(ref.segmentId);
    else for (const page of ref.pages) getPage(ref.sourceId, page);
  }
  if (spec.kind !== "annotated-image") return { id, spec, assets: [] };
  const prepared = await resolveVisualAsset(spec.image.assetId, allowedUploadAssetId, uploadedPhotoImage);
  validateAnnotationGrounding(spec, prepared);
  return { id, spec, assets: [prepared.asset] };
}
