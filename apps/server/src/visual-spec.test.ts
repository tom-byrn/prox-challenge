import assert from "node:assert/strict";
import test from "node:test";
import { visionSafeSize } from "./visual-assets.js";
import { VisualSpecSchema } from "./visual-spec.js";
import { buildAnnotationPreview, buildVisualPayload } from "./visuals.js";

test("accepts an arbitrary content-agnostic connection graph", () => {
  const result = VisualSpecSchema.safeParse({
    schemaVersion: 1,
    kind: "connection-diagram",
    title: "Cooling loop",
    description: "A held-out graph unrelated to a fixed product renderer.",
    sourceRefs: [{ kind: "document", sourceId: "owner-manual", pages: [7] }],
    layout: { direction: "left-to-right" },
    nodes: [
      { id: "reservoir", role: "endpoint", label: "Reservoir", ports: [{ id: "out", label: "Outlet", side: "right" }] },
      { id: "pump", role: "device", label: "Pump", ports: [{ id: "in", label: "Inlet", side: "left" }, { id: "out", label: "Outlet", side: "right" }] },
      { id: "radiator", role: "process", label: "Radiator", ports: [{ id: "in", label: "Inlet", side: "left" }] }
    ],
    connections: [
      { id: "feed", from: { node: "reservoir", port: "out" }, to: { node: "pump", port: "in" } },
      { id: "cool", from: { node: "pump", port: "out" }, to: { node: "radiator", port: "in" } }
    ]
  });
  assert.equal(result.success, true);
});

test("rejects graph connections to unknown nodes or ports", () => {
  const result = VisualSpecSchema.safeParse({
    schemaVersion: 1,
    kind: "connection-diagram",
    title: "Broken graph",
    sourceRefs: [{ kind: "document", sourceId: "owner-manual", pages: [7] }],
    layout: { direction: "left-to-right" },
    nodes: [{ id: "known", role: "device", label: "Known node" }, { id: "other", role: "endpoint", label: "Other node" }],
    connections: [{ id: "bad", from: { node: "known", port: "missing" }, to: { node: "unknown" } }]
  });
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.error.message, /Unknown port|Unknown diagram node/);
});

test("prepares an approved image into a trimmed, controlled pixel space", async () => {
  const payload = await buildVisualPayload("interior", {
    schemaVersion: 1,
    kind: "annotated-image",
    title: "Interior controls",
    sourceRefs: [{ kind: "document", sourceId: "owner-manual", pages: [9] }],
    image: { assetId: "figure:interior-controls", alt: "Interior controls shown in the owner's manual" },
    annotations: [
      { id: "pedal", shape: "pin", point: { x: 725, y: 585 }, label: "Foot pedal socket" },
      { id: "control", shape: "arrow", from: { x: 850, y: 720 }, to: { x: 804, y: 585 }, label: "Wire-feed control socket" }
    ]
  });
  assert.equal(payload.spec.kind, "annotated-image");
  assert.equal(payload.assets[0]?.assetId, "figure:interior-controls");
  assert.match(payload.assets[0]?.url ?? "", /^\/api\/visual-assets\//);
  const asset = payload.assets[0]!;
  assert.ok(asset.width <= asset.original.width);
  assert.ok(asset.height <= asset.original.height);
  assert.ok(asset.width < asset.original.width || asset.height < asset.original.height);
});

test("rejects external image URLs and annotations outside prepared pixel bounds", async () => {
  const external = VisualSpecSchema.safeParse({
    schemaVersion: 1,
    kind: "annotated-image",
    title: "External image",
    sourceRefs: [{ kind: "document", sourceId: "owner-manual", pages: [12] }],
    image: { assetId: "https://example.com/image.png", alt: "An external untrusted source image" },
    annotations: [{ id: "pin", shape: "pin", point: { x: 20, y: 20 }, label: "Pin" }]
  });
  const overflow = {
    schemaVersion: 1,
    kind: "annotated-image",
    title: "Overflow image",
    sourceRefs: [{ kind: "document", sourceId: "owner-manual", pages: [12] }],
    image: { assetId: "figure:feed-roller-guide", alt: "Feed roller controls shown in the owner's manual" },
    annotations: [{ id: "box", shape: "box", bounds: { x1: 800, y1: 200, x2: 4000, y2: 500 }, label: "Overflow" }]
  };
  assert.equal(external.success, false);
  await assert.rejects(buildVisualPayload("overflow", overflow), /outside the inspected/);
});

test("rejects a marker that lands on trimmed image whitespace", async () => {
  const blankSpec = {
    schemaVersion: 1,
    kind: "annotated-image" as const,
    title: "Blank target",
    sourceRefs: [{ kind: "document" as const, sourceId: "owner-manual" as const, pages: [9] }],
    image: { assetId: "figure:interior-controls", alt: "Interior controls shown in the owner's manual" },
    annotations: [{ id: "blank", shape: "pin" as const, point: { x: 1050, y: 730 }, label: "Incorrect blank target" }]
  };
  const preview = await buildAnnotationPreview(blankSpec);
  assert.equal(preview.valid, false);
  assert.equal(preview.issues[0]?.annotationId, "blank");
  assert.match(preview.issues[0]?.message ?? "", /blank background/);
  assert.ok(preview.preview.length > 0, "Invalid placement should still return a visual overlay for correction.");
  await assert.rejects(buildVisualPayload("blank", blankSpec), /blank background/);
});

test("builds a source-preserving annotation preview in the prepared coordinate space", async () => {
  const preview = await buildAnnotationPreview({
    schemaVersion: 1,
    kind: "annotated-image",
    title: "Interior sockets",
    sourceRefs: [{ kind: "document", sourceId: "owner-manual", pages: [9] }],
    image: { assetId: "figure:interior-controls", alt: "Interior controls shown in the owner's manual" },
    annotations: [{ id: "pedal", shape: "pin", point: { x: 725, y: 585 }, label: "Foot pedal socket" }]
  });
  assert.ok(preview.prepared.asset.width > 0);
  assert.ok(preview.prepared.asset.height > 0);
  assert.ok(preview.prepared.asset.width <= preview.prepared.asset.original.width);
  assert.ok(preview.prepared.asset.height <= preview.prepared.asset.original.height);
  assert.equal(preview.valid, true);
  assert.deepEqual(preview.issues, []);
  assert.ok(preview.preview.byteLength > preview.prepared.image.byteLength / 2);
  assert.match(preview.hash, /^[a-f0-9]{64}$/);
});

test("pre-sizing keeps images inside the standard vision patch budget", () => {
  const resized = visionSafeSize(1920, 1080);
  assert.deepEqual(resized, { width: 1456, height: 819 });
  assert.ok(Math.ceil(resized.width / 28) * Math.ceil(resized.height / 28) <= 1568);
});

test("rejects comparison values that reference nonexistent columns", () => {
  const result = VisualSpecSchema.safeParse({
    schemaVersion: 1,
    kind: "comparison",
    title: "Process comparison",
    sourceRefs: [{ kind: "document", sourceId: "owner-manual", pages: [7] }],
    columns: [{ id: "mig", label: "MIG" }, { id: "tig", label: "TIG" }],
    rows: [{ id: "gas", label: "Gas", values: [{ columnId: "mig", text: "Required" }, { columnId: "stick", text: "None" }] }]
  });
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.error.message, /Unknown comparison column/);
});

test("accepts generic metric summaries and grouped reference cards", () => {
  const metric = VisualSpecSchema.safeParse({
    schemaVersion: 1,
    kind: "metric-summary",
    title: "Operating window",
    sourceRefs: [{ kind: "document", sourceId: "owner-manual", pages: [7] }],
    metrics: [{ id: "output", label: "Output", value: "200", unit: "A", detail: "Published operating point", tone: "primary" }]
  });
  const reference = VisualSpecSchema.safeParse({
    schemaVersion: 1,
    kind: "reference-card",
    title: "Setup reference",
    sourceRefs: [{ kind: "document", sourceId: "owner-manual", pages: [8] }],
    groups: [{ id: "inputs", title: "Inputs", items: [{ id: "material", label: "Material", value: "Steel" }] }]
  });
  assert.equal(metric.success, true);
  assert.equal(reference.success, true);
});
