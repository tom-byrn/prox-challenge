import sharp from "sharp";
import type { VisualAsset } from "./visual-spec.js";

const MAX_EDGE = 1568;
const MAX_VISUAL_TOKENS = 1568;
const PATCH_SIZE = 28;
const TRIM_THRESHOLD = 12;
const CROP_MARGIN = 24;

export type PreparedVisualAsset = {
  asset: VisualAsset;
  imagePath: string;
  image: Buffer;
  pixels: Buffer;
  channels: number;
  background: [number, number, number];
};

const preparedByAssetId = new Map<string, Promise<PreparedVisualAsset>>();
const preparedForServing = new Map<string, PreparedVisualAsset>();

function visualTokenCount(width: number, height: number): number {
  return Math.ceil(width / PATCH_SIZE) * Math.ceil(height / PATCH_SIZE);
}

export function visionSafeSize(width: number, height: number): { width: number; height: number } {
  const fits = (candidateWidth: number, candidateHeight: number) => (
    Math.ceil(candidateWidth / PATCH_SIZE) * PATCH_SIZE <= MAX_EDGE
    && Math.ceil(candidateHeight / PATCH_SIZE) * PATCH_SIZE <= MAX_EDGE
    && visualTokenCount(candidateWidth, candidateHeight) <= MAX_VISUAL_TOKENS
  );
  if (fits(width, height)) return { width, height };
  if (height > width) {
    const swapped = visionSafeSize(height, width);
    return { width: swapped.height, height: swapped.width };
  }

  const aspect = width / height;
  let low = 1;
  let high = width;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    const candidateHeight = Math.max(1, Math.round(middle / aspect));
    if (fits(middle, candidateHeight)) low = middle;
    else high = middle;
  }
  return { width: low, height: Math.max(1, Math.round(low / aspect)) };
}

function pixelAt(buffer: Buffer, width: number, channels: number, x: number, y: number): [number, number, number] {
  const offset = (y * width + x) * channels;
  return [buffer[offset] ?? 255, buffer[offset + 1] ?? 255, buffer[offset + 2] ?? 255];
}

async function prepare(
  assetBase: Omit<VisualAsset, "url" | "width" | "height" | "original" | "crop">,
  imagePath: string,
  options: { trim: boolean }
): Promise<PreparedVisualAsset> {
  const metadata = await sharp(imagePath).metadata();
  const originalWidth = metadata.width;
  const originalHeight = metadata.height;
  if (!originalWidth || !originalHeight) throw new Error(`Could not read dimensions for ${assetBase.assetId}.`);

  const corner = await sharp(imagePath).ensureAlpha().extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
  const background: [number, number, number] = [corner[0] ?? 255, corner[1] ?? 255, corner[2] ?? 255];
  let crop = { x: 0, y: 0, width: originalWidth, height: originalHeight };
  if (options.trim) {
    const trimmed = await sharp(imagePath)
      .trim({ background: { r: background[0], g: background[1], b: background[2] }, threshold: TRIM_THRESHOLD })
      .png()
      .toBuffer({ resolveWithObject: true });
    const trimLeft = Math.max(0, trimmed.info.trimOffsetLeft ?? 0);
    const trimTop = Math.max(0, trimmed.info.trimOffsetTop ?? 0);
    const cropLeft = Math.max(0, trimLeft - CROP_MARGIN);
    const cropTop = Math.max(0, trimTop - CROP_MARGIN);
    const cropRight = Math.min(originalWidth, trimLeft + trimmed.info.width + CROP_MARGIN);
    const cropBottom = Math.min(originalHeight, trimTop + trimmed.info.height + CROP_MARGIN);
    crop = {
      x: cropLeft,
      y: cropTop,
      width: Math.max(1, cropRight - cropLeft),
      height: Math.max(1, cropBottom - cropTop)
    };
  }
  const safeSize = visionSafeSize(crop.width, crop.height);
  const extracted = sharp(imagePath).extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height });
  const image = await (safeSize.width === crop.width && safeSize.height === crop.height
    ? extracted
    : extracted.resize(safeSize.width, safeSize.height, { fit: "fill" }))
    .png()
    .toBuffer();
  const raw = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const preparedBackground = pixelAt(raw.data, raw.info.width, raw.info.channels, 0, 0);
  const asset: VisualAsset = {
    ...assetBase,
    url: `/api/visual-assets/${encodeURIComponent(assetBase.assetId)}`,
    width: raw.info.width,
    height: raw.info.height,
    original: { width: originalWidth, height: originalHeight },
    crop
  };
  const prepared: PreparedVisualAsset = {
    asset,
    imagePath,
    image,
    pixels: raw.data,
    channels: raw.info.channels,
    background: preparedBackground
  };
  preparedForServing.set(assetBase.assetId, prepared);
  return prepared;
}

export function prepareVisualAsset(
  assetBase: Omit<VisualAsset, "url" | "width" | "height" | "original" | "crop">,
  imagePath: string,
  options: { trim?: boolean } = {}
): Promise<PreparedVisualAsset> {
  const cached = preparedByAssetId.get(assetBase.assetId);
  if (cached) return cached;
  const pending = prepare(assetBase, imagePath, { trim: options.trim ?? true });
  preparedByAssetId.set(assetBase.assetId, pending);
  pending.catch(() => preparedByAssetId.delete(assetBase.assetId));
  return pending;
}

export function getPreparedVisualAsset(assetId: string): PreparedVisualAsset | undefined {
  return preparedForServing.get(assetId);
}

export function visualContentDensity(prepared: PreparedVisualAsset, bounds: { x1: number; y1: number; x2: number; y2: number }): number {
  const { width, height } = prepared.asset;
  const x1 = Math.max(0, Math.floor(bounds.x1));
  const y1 = Math.max(0, Math.floor(bounds.y1));
  const x2 = Math.min(width, Math.ceil(bounds.x2));
  const y2 = Math.min(height, Math.ceil(bounds.y2));
  if (x2 <= x1 || y2 <= y1) return 0;
  let different = 0;
  let total = 0;
  for (let y = y1; y < y2; y += 1) {
    for (let x = x1; x < x2; x += 1) {
      const [r, g, b] = pixelAt(prepared.pixels, width, prepared.channels, x, y);
      const distance = Math.abs(r - prepared.background[0]) + Math.abs(g - prepared.background[1]) + Math.abs(b - prepared.background[2]);
      if (distance > 54) different += 1;
      total += 1;
    }
  }
  return total ? different / total : 0;
}
