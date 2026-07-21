import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { multimodalPrompt } from "./agent.js";
import { normalizeUploadedPhoto, PhotoUploadError } from "./photos.js";
import { buildAnnotationPreview, buildVisualPayload, resolveVisualAsset } from "./visuals.js";

test("normalizes a supported user photo for database storage", async () => {
  const input = await sharp({ create: { width: 2200, height: 1100, channels: 3, background: "#c2633e" } }).png().toBuffer();
  const photo = await normalizeUploadedPhoto(input);
  assert.match(photo.attachment.id, /^photo-[a-f0-9]{24}$/);
  assert.equal(photo.attachment.mimeType, "image/jpeg");
  assert.equal(photo.attachment.width, 1568);
  assert.equal(photo.attachment.height, 784);
  assert.equal(photo.image.length, photo.attachment.sizeBytes);
  assert.equal((await sharp(photo.image).metadata()).format, "jpeg");
});

test("rejects unsupported or malformed photo uploads", async () => {
  await assert.rejects(
    () => normalizeUploadedPhoto(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>") ),
    (error: unknown) => error instanceof PhotoUploadError && /JPEG, PNG, or WebP|readable image/.test(error.message)
  );
  await assert.rejects(
    () => normalizeUploadedPhoto(Buffer.alloc(10 * 1024 * 1024 + 1)),
    (error: unknown) => error instanceof PhotoUploadError && /10 MB/.test(error.message)
  );
});

test("builds an Agent SDK user message with image and text blocks", async () => {
  const attachment = {
    id: "photo-0123456789abcdef01234567",
    url: "/api/photos/photo-0123456789abcdef01234567",
    mimeType: "image/jpeg" as const,
    width: 2,
    height: 2,
    sizeBytes: 4,
    alt: "User-uploaded welder photo"
  };
  const prompt = multimodalPrompt("What is wrong with this bead?", { attachment, image: Buffer.from([1, 2, 3, 4]) });
  assert.notEqual(typeof prompt, "string");
  if (typeof prompt === "string") return;
  const messages = [];
  for await (const message of prompt) messages.push(message);
  assert.equal(messages.length, 1);
  const content = messages[0]?.message.content;
  assert.ok(Array.isArray(content));
  if (!Array.isArray(content)) return;
  assert.equal(content[0]?.type, "image");
  assert.equal(content[1]?.type, "text");
  if (content[1]?.type === "text") assert.match(content[1].text, /What is wrong with this bead/);
});

test("only exposes the current turn's upload to the visual pipeline", async () => {
  const input = await sharp({ create: { width: 320, height: 240, channels: 3, background: "#6e4f3d" } })
    .composite([{ input: Buffer.from('<svg width="320" height="240"><rect x="90" y="60" width="140" height="120" rx="20" fill="#e9d2b2"/></svg>') }])
    .jpeg()
    .toBuffer();
  const photo = await normalizeUploadedPhoto(input);
  const assetId = `upload:${photo.attachment.id}`;
  const prepared = await resolveVisualAsset(assetId, assetId, photo.image);
  assert.equal(prepared.asset.source, "user-photo");
  assert.deepEqual(prepared.asset.crop, { x: 0, y: 0, width: 320, height: 240 });
  const spec = {
    schemaVersion: 1 as const,
    kind: "annotated-image" as const,
    title: "Visible area to inspect",
    sourceRefs: [{ kind: "document" as const, sourceId: "owner-manual" as const, pages: [43] }],
    image: { assetId, alt: "User photo with a visible highlighted test area" },
    annotations: [{ id: "area", shape: "box" as const, bounds: { x1: 95, y1: 65, x2: 225, y2: 175 }, label: "Visible area" }]
  };
  const preview = await buildAnnotationPreview(spec, assetId, photo.image);
  assert.ok(preview.preview.length > 0);
  const payload = await buildVisualPayload("photo-diagnostic", spec, assetId, photo.image);
  assert.equal(payload.assets[0]?.assetId, assetId);
  await assert.rejects(
    () => resolveVisualAsset(assetId, "upload:photo-ffffffffffffffffffffffff", photo.image),
    /not available in this turn/
  );
});
