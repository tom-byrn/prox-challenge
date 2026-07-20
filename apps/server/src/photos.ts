import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";
import type { PhotoAttachment } from "./types.js";

export const MAX_PHOTO_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTO_INPUT_PIXELS = 40_000_000;
const MAX_PHOTO_EDGE = 1568;
const PHOTO_ID_PATTERN = /^photo-[a-f0-9]{24}$/;
const DEFAULT_UPLOAD_DIR = fileURLToPath(new URL("../../../.prox/uploads/", import.meta.url));

export class PhotoUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotoUploadError";
  }
}

function uploadDirectory(override?: string): string {
  return override ?? process.env.PHOTO_UPLOAD_DIR?.trim() ?? DEFAULT_UPLOAD_DIR;
}

export function isPhotoId(value: string): boolean {
  return PHOTO_ID_PATTERN.test(value);
}

export function photoFilePath(photoId: string, directory?: string): string {
  if (!isPhotoId(photoId)) throw new PhotoUploadError("Invalid photo id.");
  return path.join(uploadDirectory(directory), `${photoId}.jpg`);
}

async function decodeMetadata(input: Buffer) {
  try {
    return await sharp(input, { failOn: "error", limitInputPixels: MAX_PHOTO_INPUT_PIXELS }).metadata();
  } catch {
    throw new PhotoUploadError("The selected file is not a readable image.");
  }
}

export async function storeUploadedPhoto(input: Buffer, directory?: string): Promise<PhotoAttachment> {
  if (input.length === 0) throw new PhotoUploadError("The selected photo is empty.");
  if (input.length > MAX_PHOTO_UPLOAD_BYTES) throw new PhotoUploadError("Photos must be 10 MB or smaller.");

  const metadata = await decodeMetadata(input);
  if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) {
    throw new PhotoUploadError("Use a JPEG, PNG, or WebP photo.");
  }

  let normalized: Buffer;
  try {
    normalized = await sharp(input, { failOn: "error", limitInputPixels: MAX_PHOTO_INPUT_PIXELS })
      .rotate()
      .resize({ width: MAX_PHOTO_EDGE, height: MAX_PHOTO_EDGE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new PhotoUploadError("The photo could not be normalized safely.");
  }

  const normalizedMetadata = await sharp(normalized).metadata();
  if (!normalizedMetadata.width || !normalizedMetadata.height) throw new PhotoUploadError("The photo has invalid dimensions.");
  const id = `photo-${createHash("sha256").update(normalized).digest("hex").slice(0, 24)}`;
  const directoryPath = uploadDirectory(directory);
  await mkdir(directoryPath, { recursive: true });
  const filePath = photoFilePath(id, directory);
  await writeFile(filePath, normalized, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });

  return {
    id,
    url: `/api/photos/${id}`,
    mimeType: "image/jpeg",
    width: normalizedMetadata.width,
    height: normalizedMetadata.height,
    sizeBytes: normalized.length,
    alt: "User-uploaded welder photo"
  };
}

export async function getUploadedPhoto(photoId: string, directory?: string): Promise<{ attachment: PhotoAttachment; filePath: string; image: Buffer }> {
  const filePath = photoFilePath(photoId, directory);
  let image: Buffer;
  try {
    image = await readFile(filePath);
  } catch {
    throw new PhotoUploadError("That uploaded photo is no longer available. Attach it again and retry.");
  }
  const [metadata, fileStats] = await Promise.all([sharp(image).metadata(), stat(filePath)]);
  if (!metadata.width || !metadata.height) throw new PhotoUploadError("The uploaded photo is invalid.");
  return {
    filePath,
    image,
    attachment: {
      id: photoId,
      url: `/api/photos/${photoId}`,
      mimeType: "image/jpeg",
      width: metadata.width,
      height: metadata.height,
      sizeBytes: fileStats.size,
      alt: "User-uploaded welder photo"
    }
  };
}
