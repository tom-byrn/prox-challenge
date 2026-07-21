import { randomBytes } from "node:crypto";
import sharp from "sharp";
import type { PhotoAttachment } from "./types.js";

export const MAX_PHOTO_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTO_INPUT_PIXELS = 40_000_000;
const MAX_PHOTO_EDGE = 1568;
const PHOTO_ID_PATTERN = /^photo-[a-f0-9]{24}$/;

export type NormalizedPhoto = {
  attachment: PhotoAttachment;
  image: Buffer;
};

export class PhotoUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotoUploadError";
  }
}

export function isPhotoId(value: string): boolean {
  return PHOTO_ID_PATTERN.test(value);
}

async function decodeMetadata(input: Buffer) {
  try {
    return await sharp(input, { failOn: "error", limitInputPixels: MAX_PHOTO_INPUT_PIXELS }).metadata();
  } catch {
    throw new PhotoUploadError("The selected file is not a readable image.");
  }
}

export async function normalizeUploadedPhoto(input: Buffer): Promise<NormalizedPhoto> {
  if (input.length === 0) throw new PhotoUploadError("The selected photo is empty.");
  if (input.length > MAX_PHOTO_UPLOAD_BYTES) throw new PhotoUploadError("Photos must be 10 MB or smaller.");

  const metadata = await decodeMetadata(input);
  if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) {
    throw new PhotoUploadError("Use a JPEG, PNG, or WebP photo.");
  }

  let image: Buffer;
  try {
    image = await sharp(input, { failOn: "error", limitInputPixels: MAX_PHOTO_INPUT_PIXELS })
      .rotate()
      .resize({ width: MAX_PHOTO_EDGE, height: MAX_PHOTO_EDGE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new PhotoUploadError("The photo could not be normalized safely.");
  }

  const normalizedMetadata = await sharp(image).metadata();
  if (!normalizedMetadata.width || !normalizedMetadata.height) throw new PhotoUploadError("The uploaded photo has invalid dimensions.");
  const id = `photo-${randomBytes(12).toString("hex")}`;
  return {
    image,
    attachment: {
      id,
      url: `/api/photos/${id}`,
      mimeType: "image/jpeg",
      width: normalizedMetadata.width,
      height: normalizedMetadata.height,
      sizeBytes: image.length,
      alt: "User-uploaded welder photo"
    }
  };
}
