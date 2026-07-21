import type { PhotoAttachment } from "../types";

export const MAX_PHOTO_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type PhotoDraft = {
  file: File;
  previewUrl: string;
};

export function validatePhotoFile(file: File): string | undefined {
  if (!(ACCEPTED_PHOTO_TYPES as readonly string[]).includes(file.type)) return "Use a JPEG, PNG, or WebP photo.";
  if (file.size === 0) return "The selected photo is empty.";
  if (file.size > MAX_PHOTO_UPLOAD_BYTES) return "Photos must be 10 MB or smaller.";
  return undefined;
}

export async function uploadPhoto(file: File, ownerId: string, conversationId: string, signal: AbortSignal): Promise<PhotoAttachment> {
  const form = new FormData();
  form.set("photo", file);
  form.set("ownerId", ownerId);
  form.set("conversationId", conversationId);
  const response = await fetch("/api/photos", { method: "POST", body: form, signal });
  const payload = await response.json().catch(() => ({ error: `Upload failed (${response.status})` })) as { attachment?: PhotoAttachment; error?: string };
  if (!response.ok || !payload.attachment) throw new Error(payload.error ?? `Upload failed (${response.status})`);
  return payload.attachment;
}
