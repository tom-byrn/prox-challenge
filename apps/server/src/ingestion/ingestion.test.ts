import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { IngestionConfigSchema, KnowledgeManifestSchema, type PreparedDocument } from "./schemas.js";
import { IngestionSourceReader } from "./source-reader.js";
import { IngestionToolController } from "./tools.js";
import type { IngestionCheckpoint, IngestionWorkspace, PreparedSources } from "./types.js";
import { validateSections, validateVideoSegments } from "./validate.js";
import { atomicPromote, packagePath, sha256Value, slugifyId, writeJsonAtomic } from "./workspace.js";
import { runIngestionStage } from "./runner.js";
import { loadKnowledgePackage } from "../knowledge-package.js";

const HASH = "a".repeat(64);

function temporaryWorkspace(): { root: string; workspace: IngestionWorkspace; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "prox-ingestion-test-"));
  const workspace = {
    runId: "run-test",
    root,
    preparedDir: join(root, "prepared"),
    checkpointsDir: join(root, "checkpoints"),
    previewsDir: join(root, "previews"),
    finalizedDir: join(root, "finalized"),
    targetDir: join(root, "target")
  };
  for (const path of [workspace.preparedDir, workspace.checkpointsDir, workspace.previewsDir]) mkdirSync(path, { recursive: true });
  return { root, workspace, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

async function fixtureDocument(workspace: IngestionWorkspace): Promise<PreparedDocument> {
  const sourcePath = join(workspace.preparedDir, "guide");
  mkdirSync(join(sourcePath, "pages"), { recursive: true });
  writeFileSync(join(sourcePath, "pages", "0001.txt"), "Installation Guide\nConnect the labeled ports.\n");
  await sharp({
    create: { width: 400, height: 300, channels: 3, background: "white" }
  }).composite([{ input: Buffer.from('<svg width="400" height="300" xmlns="http://www.w3.org/2000/svg"><rect x="80" y="60" width="220" height="150" fill="#222"/><text x="100" y="130" fill="white" font-size="25">PORT A</text></svg>') }]).png().toFile(join(sourcePath, "pages", "0001.png"));
  return {
    schemaVersion: 1,
    id: "guide",
    sourceFile: "guide.pdf",
    sourcePath,
    sha256: HASH,
    pageCount: 1,
    metadata: {},
    outline: [],
    outlineAvailable: false,
    authority: "authoritative-manual",
    pages: [{
      page: 1,
      width: 400,
      height: 300,
      rotation: 0,
      textFile: "pages/0001.txt",
      imageFile: "pages/0001.png",
      textAvailable: true,
      regions: [{ type: "drawing", bounds: { x1: 0.2, y1: 0.2, x2: 0.75, y2: 0.7 } }]
    }]
  };
}

function emptyCheckpoint(): IngestionCheckpoint {
  return { documentTitles: {}, sections: [], figures: [], datasets: [], videoSegments: [], ready: false };
}

test("accepts generic source ids and semantic ids while rejecting package traversal", () => {
  const config = IngestionConfigSchema.parse({
    schemaVersion: 1,
    productId: "fixture-product",
    productName: "Fixture Product",
    documents: [{ path: "anything.pdf", sourceId: "installation-guide" }]
  });
  assert.equal(config.documents[0]?.sourceId, "installation-guide");
  assert.equal(KnowledgeManifestSchema.shape.sections.element.shape.id.parse("installation-guide:setup"), "installation-guide:setup");
  assert.throws(() => packagePath("/safe/package", "../secret.json"), /escapes|Invalid/);
  assert.equal(slugifyId("A New / Guide.pdf"), "a-new-guide-pdf");
});

test("validates section heading evidence and reports uncovered pages", async () => {
  const fixture = temporaryWorkspace();
  try {
    const document = await fixtureDocument(fixture.workspace);
    const report = validateSections([{
      id: "guide:installation",
      documentId: "guide",
      title: "Installation",
      startPage: 1,
      endPage: 1,
      summary: "Installation and labeled port routing.",
      headingEvidence: [{ page: 1, text: "Installation Guide" }],
      generatedBy: "run-test"
    }], [document]);
    assert.equal(report.valid, true);
    assert.deepEqual(report.uncoveredPages.guide, []);
    const invalid = validateSections([{
      id: "guide:invented",
      documentId: "guide",
      title: "Invented",
      startPage: 1,
      endPage: 1,
      summary: "This heading is not present.",
      headingEvidence: [{ page: 1, text: "Not in the source" }],
      generatedBy: "run-test"
    }], [document]);
    assert.match(invalid.issues.join(" "), /does not occur/);
  } finally {
    fixture.cleanup();
  }
});

test("requires full-page inspection and an exact current crop preview hash", async () => {
  const fixture = temporaryWorkspace();
  try {
    const document = await fixtureDocument(fixture.workspace);
    const controller = new IngestionToolController({
      stage: "figures",
      reader: new IngestionSourceReader(fixture.workspace.preparedDir, [document], []),
      workspace: fixture.workspace,
      runId: fixture.workspace.runId,
      sourceId: "guide",
      checkpoint: emptyCheckpoint()
    });
    assert.throws(() => controller.assertSource("other-guide"), /scoped to guide/);
    await controller.inspectPageImage("guide", 1);
    const preview = await controller.previewCrop("guide", 1, { x1: 0.18, y1: 0.18, x2: 0.78, y2: 0.75 }, "ports");
    const metadata = JSON.parse(preview.content[0]?.type === "text" ? preview.content[0].text : "{}") as { valid: boolean; previewHash: string };
    assert.equal(metadata.valid, true);
    const input = {
      id: "guide-ports",
      documentId: "guide",
      page: 1,
      type: "diagram" as const,
      title: "Labeled ports",
      caption: "The labeled ports and their physical arrangement.",
      bounds: { x1: 0.18, y1: 0.18, x2: 0.78, y2: 0.75 },
      keywords: ["ports", "routing"],
      previewHash: metadata.previewHash
    };
    assert.equal(controller.saveFigure(input).saved, true);
    assert.throws(() => controller.saveFigure({ ...input, id: "changed-crop", bounds: { ...input.bounds, x2: 0.79 } }), /do not match/);
  } finally {
    fixture.cleanup();
  }
});

test("rejects video segments without transcript overlap or an in-range frame", () => {
  const video = {
    schemaVersion: 1 as const,
    id: "demo",
    videoId: "abc1234",
    title: "Demo",
    url: "https://www.youtube.com/watch?v=abc1234",
    language: "en",
    isGenerated: false,
    durationSeconds: 20,
    sha256: HASH,
    authority: "supplemental-demonstration",
    captions: [{ startSeconds: 0, durationSeconds: 5, text: "First topic" }]
  };
  const issues = validateVideoSegments([{
    id: "video:demo@10-15",
    videoId: "demo",
    title: "Missing captions",
    startSeconds: 10,
    endSeconds: 15,
    summary: "A segment outside the available transcript.",
    keywords: ["missing"],
    frameSeconds: 16,
    frame: "video/demo/frames/missing.jpg",
    previewHash: HASH,
    generatedBy: "run-test"
  }], [video]);
  assert.match(issues.join(" "), /frame is outside|no transcript/);
});

test("atomic promotion preserves the previous package when validation fails", () => {
  const fixture = temporaryWorkspace();
  try {
    mkdirSync(fixture.workspace.finalizedDir, { recursive: true });
    mkdirSync(fixture.workspace.targetDir, { recursive: true });
    writeFileSync(join(fixture.workspace.finalizedDir, "manifest.json"), "new");
    writeFileSync(join(fixture.workspace.targetDir, "manifest.json"), "old");
    assert.throws(() => atomicPromote(fixture.workspace.finalizedDir, fixture.workspace.targetDir, () => { throw new Error("invalid"); }), /invalid/);
    assert.equal(readFileSync(join(fixture.workspace.targetDir, "manifest.json"), "utf8"), "old");
  } finally {
    fixture.cleanup();
  }
});

test("generic runtime package loader validates manifest-defined document ids", async () => {
  const fixture = temporaryWorkspace();
  try {
    const packageRoot = join(fixture.root, "package");
    mkdirSync(join(packageRoot, "pages"), { recursive: true });
    await sharp({ create: { width: 20, height: 20, channels: 3, background: "white" } }).png().toFile(join(packageRoot, "pages", "field-guide-01.png"));
    writeJsonAtomic(join(packageRoot, "search-documents.json"), [{ id: "field-guide-01", documentId: "field-guide", source: "field-guide", page: 1, title: "Start", text: "Exact fixture text", image: "pages/field-guide-01.png" }]);
    writeJsonAtomic(join(packageRoot, "manifest.json"), {
      schemaVersion: 1,
      product: { id: "field-product", name: "Field Product" },
      documents: [{ id: "field-guide", title: "Field Guide", sourceFile: "field-guide.pdf", sha256: HASH, pageCount: 1, authority: "authoritative-manual", outlineAvailable: false }],
      sections: [],
      figures: [],
      datasets: [],
      videos: [],
      videoSegments: [],
      ingestionRuns: [{ id: "run-test", createdAt: "2026-07-19T00:00:00.000Z", model: "test-model", promptVersion: "ingestion-v1", sourceHashes: { "field-guide": HASH }, stages: [{ name: "finalize", status: "complete", attempts: 1 }], validation: { valid: true, issues: [] } }]
    });
    const loaded = loadKnowledgePackage(packageRoot);
    assert.equal(loaded.manifest.documents[0]?.id, "field-guide");
    assert.equal(loaded.searchDocuments[0]?.text, "Exact fixture text");
  } finally {
    fixture.cleanup();
  }
});

test("stage runner performs exactly one bounded repair when required saves are missing", async () => {
  const fixture = temporaryWorkspace();
  try {
    const document = await fixtureDocument(fixture.workspace);
    const sources: PreparedSources = {
      config: { schemaVersion: 1, productId: "fixture", productName: "Fixture", documents: [{ path: "guide.pdf", sourceId: "guide", authority: "authoritative-manual" }], videos: [] },
      documents: [document],
      videos: []
    };
    let calls = 0;
    const fakeQuery = (({ options }: { options: { maxTurns: number; maxBudgetUsd: number } }) => {
      calls += 1;
      assert.ok(options.maxTurns <= 24);
      assert.ok(options.maxBudgetUsd <= 1.5);
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: "result", subtype: "success", session_id: "session-test", total_cost_usd: 0, duration_api_ms: 0, num_turns: 1, modelUsage: {}, result: "done", is_error: false, usage: {} };
        },
        close() {}
      };
    }) as unknown as typeof import("@anthropic-ai/claude-agent-sdk").query;
    await assert.rejects(() => runIngestionStage({ stage: "sections", sources, workspace: fixture.workspace, checkpoint: emptyCheckpoint(), sourceId: "guide", queryAgent: fakeQuery }), /after one repair attempt/);
    assert.equal(calls, 2);
  } finally {
    fixture.cleanup();
  }
});
