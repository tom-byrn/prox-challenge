import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { getFigure, getPage } from "./knowledge.js";
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
  imagePath: string;
};

function resolveVisualAssetSource(assetId: string): VisualAssetSource {
  if (assetId.startsWith("figure:")) {
    const figure = getFigure(assetId.slice("figure:".length));
    return {
      assetBase: {
        assetId,
        title: figure.title,
        source: figure.source,
        pages: figure.pages
      },
      imagePath: fileURLToPath(new URL(`../../../knowledge/${figure.file}`, import.meta.url))
    };
  }

  const [, source, pageText] = assetId.split(":");
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

export async function resolveVisualAsset(assetId: string): Promise<PreparedVisualAsset> {
  const source = resolveVisualAssetSource(assetId);
  return prepareVisualAsset(source.assetBase, source.imagePath);
}

function collectSourceRefs(spec: VisualSpec): VisualSourceRef[] {
  const refs = [...spec.sourceRefs];
  if (spec.kind === "annotated-image") {
    for (const annotation of spec.annotations) if (annotation.evidence) refs.push(annotation.evidence);
  } else if (spec.kind === "connection-diagram") {
    for (const connection of spec.connections) if (connection.evidence) refs.push(connection.evidence);
  } else if (spec.kind === "procedure") {
    for (const step of spec.steps) if (step.evidence) refs.push(step.evidence);
  } else {
    for (const row of spec.rows) if (row.evidence) refs.push(row.evidence);
  }
  return refs;
}

function pointBounds(point: { x: number; y: number }, asset: VisualAsset) {
  const radius = Math.max(14, Math.round(Math.min(asset.width, asset.height) * 0.025));
  return { x1: point.x - radius, y1: point.y - radius, x2: point.x + radius, y2: point.y + radius };
}

export function validateAnnotationGrounding(spec: AnnotatedImageSpec, prepared: PreparedVisualAsset): void {
  const { width, height } = prepared.asset;
  for (const annotation of spec.annotations) {
    const points = annotation.shape === "arrow" ? [annotation.from, annotation.to]
      : annotation.shape === "pin" ? [annotation.point]
        : [];
    for (const point of points) {
      if (point.x > width || point.y > height) {
        throw new Error(`Annotation ${annotation.id} is outside the inspected ${width}×${height} pixel image.`);
      }
    }
    if (annotation.shape === "box" && (
      annotation.bounds.x2 > width || annotation.bounds.y2 > height
    )) {
      throw new Error(`Annotation ${annotation.id} is outside the inspected ${width}×${height} pixel image.`);
    }

    const targetBounds = annotation.shape === "pin" ? pointBounds(annotation.point, prepared.asset)
      : annotation.shape === "arrow" ? pointBounds(annotation.to, prepared.asset)
        : annotation.bounds;
    const density = visualContentDensity(prepared, targetBounds);
    if (density < 0.008) {
      throw new Error(`Annotation ${annotation.id} appears to target blank background (${(density * 100).toFixed(2)}% visual content). Inspect the prepared image again and use absolute pixel coordinates around the actual target.`);
    }
  }
}

export function visualSpecHash(spec: VisualSpec): string {
  return createHash("sha256").update(JSON.stringify(spec)).digest("hex");
}

function previewSvg(spec: AnnotatedImageSpec, width: number, height: number): string {
  const markerSize = Math.max(18, Math.round(Math.min(width, height) * 0.025));
  const stroke = Math.max(3, Math.round(markerSize * 0.18));
  const fontSize = Math.max(13, Math.round(markerSize * 0.72));
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
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><marker id="arrow" markerUnits="userSpaceOnUse" markerWidth="${markerSize}" markerHeight="${markerSize}" refX="${markerSize - 2}" refY="${markerSize / 2}" orient="auto"><path d="M 0 0 L ${markerSize} ${markerSize / 2} L 0 ${markerSize} z" fill="#ef7440"/></marker></defs>${shapes}</svg>`;
}

export async function buildAnnotationPreview(input: unknown): Promise<{ spec: AnnotatedImageSpec; prepared: PreparedVisualAsset; preview: Buffer; hash: string }> {
  const spec = AnnotatedImageSchema.parse(input);
  const prepared = await resolveVisualAsset(spec.image.assetId);
  validateAnnotationGrounding(spec, prepared);
  const svg = previewSvg(spec, prepared.asset.width, prepared.asset.height);
  const preview = await sharp(prepared.image).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
  return { spec, prepared, preview, hash: visualSpecHash(spec) };
}

export async function buildVisualPayload(id: string, input: unknown): Promise<VisualPayload> {
  const spec = VisualSpecSchema.parse(input);
  for (const ref of collectSourceRefs(spec)) {
    for (const page of ref.pages) getPage(ref.source, page);
  }
  if (spec.kind !== "annotated-image") return { id, spec, assets: [] };
  const prepared = await resolveVisualAsset(spec.image.assetId);
  validateAnnotationGrounding(spec, prepared);
  return { id, spec, assets: [prepared.asset] };
}
