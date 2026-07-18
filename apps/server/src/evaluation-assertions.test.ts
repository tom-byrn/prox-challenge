import assert from "node:assert/strict";
import test from "node:test";
import { annotationTargetsRegion, containsUnsupportedExactMigOutput, diagramConnects, toolStartsBefore } from "./evaluation-assertions.js";
import type { AgentEvent } from "./types.js";
import type { VisualPayload } from "./visual-spec.js";

const toolEvents: AgentEvent[] = [
  { type: "tool_start", id: "1", name: "lookup_polarity", label: "lookup", input: {} },
  { type: "tool_end", id: "1", name: "lookup_polarity", ok: true },
  { type: "tool_start", id: "2", name: "render_visual", label: "render", input: {} }
];

const diagram: VisualPayload = {
  id: "diagram",
  assets: [],
  spec: {
    schemaVersion: 1,
    kind: "connection-diagram",
    title: "TIG routing",
    sourceRefs: [{ source: "quick-start", pages: [2] }],
    layout: { direction: "left-to-right" },
    nodes: [
      { id: "torch", role: "endpoint", label: "TIG torch" },
      { id: "machine", role: "device", label: "Welder", ports: [{ id: "negative", label: "Negative socket" }, { id: "positive", label: "Positive socket" }] },
      { id: "clamp", role: "endpoint", label: "Ground clamp" }
    ],
    connections: [
      { id: "torch-negative", from: { node: "torch" }, to: { node: "machine", port: "negative" } },
      { id: "clamp-positive", from: { node: "clamp" }, to: { node: "machine", port: "positive" } }
    ]
  }
};

test("checks evidence prerequisites without requiring adjacent calls", () => {
  assert.equal(toolStartsBefore(toolEvents, "lookup_polarity", "render_visual"), true);
  assert.equal(toolStartsBefore(toolEvents, "render_visual", "lookup_polarity"), false);
});

test("checks connection meaning through labels and ports rather than node ids", () => {
  assert.equal(diagramConnects(diagram, /torch/i, /negative/i), true);
  assert.equal(diagramConnects(diagram, /clamp|work/i, /positive/i), true);
  assert.equal(diagramConnects(diagram, /torch/i, /positive/i), false);
});

test("normalizes annotation targets against the prepared source asset", () => {
  const visual: VisualPayload = {
    id: "annotation",
    assets: [{
      assetId: "figure:guide",
      url: "/api/visual-assets/guide",
      title: "Guide",
      source: "owner-manual",
      pages: [12],
      width: 1000,
      height: 800,
      original: { width: 1200, height: 1600 },
      crop: { x: 0, y: 0, width: 1200, height: 960 }
    }],
    spec: {
      schemaVersion: 1,
      kind: "annotated-image",
      title: "Target",
      sourceRefs: [{ source: "owner-manual", pages: [12] }],
      image: { assetId: "figure:guide", alt: "A sufficiently descriptive source image" },
      annotations: [{ id: "target", shape: "pin", point: { x: 700, y: 500 }, label: "Target" }]
    }
  };
  assert.equal(annotationTargetsRegion(visual, (_target, normalized) => normalized.x > 0.6 && normalized.y > 0.5), true);
});

test("flags invented MIG output settings but not input-voltage context", () => {
  assert.equal(containsUnsupportedExactMigOutput("Start at 19.5 V and 310 IPM."), true);
  assert.equal(containsUnsupportedExactMigOutput("You could try 18 V."), true);
  assert.equal(containsUnsupportedExactMigOutput("Choose 120 V or 240 V input, then use the LCD recommendation."), false);
});
