import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import sharp from "sharp";
import { z } from "zod";
import {
  DatasetRecordSchema,
  DatasetSchema,
  DatasetValueTypeSchema,
  FigureTypeSchema,
  NormalizedBoundsSchema,
  SafeIdSchema,
  SavedSectionsSchema,
  SectionSchema,
  VideoSegmentSchema,
  type Dataset,
  type DatasetRecord,
  type Figure,
  type NormalizedBounds,
  type Section,
  type VideoSegment
} from "./schemas.js";
import { IngestionSourceReader } from "./source-reader.js";
import type { IngestionCheckpoint, IngestionTelemetryEvent, IngestionWorkspace, StageName } from "./types.js";
import { validateDataset, validateFigures, validateSections, validateVideoSegments } from "./validate.js";
import { REPOSITORY_ROOT, sha256Value, writeJsonAtomic } from "./workspace.js";

const execFileAsync = promisify(execFile);
const MAX_CROP_PREVIEWS_PER_PAGE = 8;
const MAX_CROP_PREVIEWS_PER_FIGURE = 4;
const MAX_FRAME_PREVIEWS_PER_VIDEO = 24;

type CropPreview = {
  figureKey: string;
  documentId: string;
  page: number;
  bounds: NormalizedBounds;
  type: z.infer<typeof FigureTypeSchema>;
  hash: string;
  valid: boolean;
  density: number;
  width: number;
  height: number;
  crop: Buffer;
  context: Buffer;
};

type FramePreview = { videoId: string; seconds: number; hash: string; path: string; valid: boolean };

export type IngestionToolContext = {
  stage: StageName;
  reader: IngestionSourceReader;
  workspace: IngestionWorkspace;
  runId: string;
  sourceId?: string;
  checkpoint?: IngestionCheckpoint;
  onTelemetry?: (event: IngestionTelemetryEvent) => void;
};

function emptyCheckpoint(): IngestionCheckpoint {
  return { documentTitles: {}, sections: [], figures: [], datasets: [], videoSegments: [], ready: false };
}

function jsonResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

type IngestionToolResult = {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
};

function canonicalBounds(bounds: NormalizedBounds): NormalizedBounds {
  return Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, Number(value.toFixed(6))])) as NormalizedBounds;
}

function cropKey(documentId: string, page: number, label: string): string {
  return `${documentId}:${page}:${label}`;
}

function sourceIds(args: Record<string, unknown>): string[] {
  return [args.documentId, args.videoId].filter((value): value is string => typeof value === "string");
}

export class IngestionToolController {
  readonly checkpoint: IngestionCheckpoint;
  readonly cropPreviews = new Map<string, CropPreview>();
  readonly framePreviews = new Map<string, FramePreview>();
  private readonly cropAttemptsByPage = new Map<string, number>();
  private readonly cropAttemptsByFigure = new Map<string, number>();
  private readonly frameAttemptsByVideo = new Map<string, number>();
  private readonly inspectedPages = new Set<string>();

  constructor(readonly context: IngestionToolContext) {
    this.checkpoint = context.checkpoint ?? emptyCheckpoint();
  }

  assertSource(sourceId: string): void {
    if (this.context.sourceId && sourceId !== this.context.sourceId) throw new Error(`Stage is scoped to ${this.context.sourceId}; source ${sourceId} is not available in this session.`);
  }

  private persist(name: string, value: unknown): void {
    writeJsonAtomic(join(this.context.workspace.checkpointsDir, `${name}.json`), value);
    writeJsonAtomic(join(this.context.workspace.checkpointsDir, "state.json"), this.checkpoint);
  }

  async instrument<T extends Record<string, unknown>>(name: string, args: T, operation: () => Promise<IngestionToolResult>): Promise<IngestionToolResult> {
    const startedAt = Date.now();
    try {
      const result = await operation();
      this.context.onTelemetry?.({ stage: this.context.stage, tool: name, sourceIds: sourceIds(args), durationMs: Date.now() - startedAt, success: true });
      return result;
    } catch (error) {
      this.context.onTelemetry?.({
        stage: this.context.stage,
        tool: name,
        sourceIds: sourceIds(args),
        durationMs: Date.now() - startedAt,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  listSources() {
    return {
      runId: this.context.runId,
      stage: this.context.stage,
      documents: [...this.context.reader.documents.values()].filter((document) => !this.context.sourceId || document.id === this.context.sourceId).map((document) => ({
        id: document.id,
        pageCount: document.pageCount,
        sha256: document.sha256,
        authority: document.authority,
        outlineAvailable: document.outlineAvailable,
        savedSections: this.checkpoint.sections.filter((section) => section.documentId === document.id).length,
        savedFigures: this.checkpoint.figures.filter((figure) => figure.documentId === document.id).length
      })),
      videos: [...this.context.reader.videos.values()].filter((video) => !this.context.sourceId || video.id === this.context.sourceId).map((video) => ({
        id: video.id,
        videoId: video.videoId,
        durationSeconds: video.durationSeconds,
        sha256: video.sha256,
        authority: video.authority,
        savedSegments: this.checkpoint.videoSegments.filter((segment) => segment.videoId === video.id).length
      }))
    };
  }

  async inspectPageImage(documentId: string, pageNumber: number, maxEdge = 1400) {
    this.assertSource(documentId);
    const page = this.context.reader.page(documentId, pageNumber);
    const path = this.context.reader.preparedPath(documentId, page.imageFile);
    const result = await sharp(path).resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
    this.inspectedPages.add(`${documentId}:${pageNumber}`);
    return {
      content: [
        { type: "text" as const, text: JSON.stringify({ documentId, page: pageNumber, width: result.info.width, height: result.info.height, textAvailable: page.textAvailable }, null, 2) },
        { type: "image" as const, data: result.data.toString("base64"), mimeType: "image/png" }
      ]
    };
  }

  async previewCrop(documentId: string, pageNumber: number, boundsInput: NormalizedBounds, temporaryLabel: string, figureType: z.infer<typeof FigureTypeSchema> = "diagram") {
    this.assertSource(documentId);
    const bounds = canonicalBounds(NormalizedBoundsSchema.parse(boundsInput));
    const figureKey = cropKey(documentId, pageNumber, temporaryLabel);
    const pageKey = `${documentId}:${pageNumber}`;
    const pageAttempts = (this.cropAttemptsByPage.get(pageKey) ?? 0) + 1;
    const figureAttempts = (this.cropAttemptsByFigure.get(figureKey) ?? 0) + 1;
    this.cropAttemptsByPage.set(pageKey, pageAttempts);
    this.cropAttemptsByFigure.set(figureKey, figureAttempts);
    if (pageAttempts > MAX_CROP_PREVIEWS_PER_PAGE || figureAttempts > MAX_CROP_PREVIEWS_PER_FIGURE) {
      return jsonResult({ valid: false, attemptLimitReached: true, issues: ["Crop preview attempt limit reached for this page or label."] });
    }

    const page = this.context.reader.page(documentId, pageNumber);
    const pagePath = this.context.reader.preparedPath(documentId, page.imageFile);
    const metadata = await sharp(pagePath).metadata();
    if (!metadata.width || !metadata.height) throw new Error(`Could not inspect ${documentId} page ${pageNumber}.`);
    const left = Math.floor(bounds.x1 * metadata.width);
    const top = Math.floor(bounds.y1 * metadata.height);
    const right = Math.ceil(bounds.x2 * metadata.width);
    const bottom = Math.ceil(bounds.y2 * metadata.height);
    const width = Math.max(1, right - left);
    const height = Math.max(1, bottom - top);
    const crop = await sharp(pagePath).extract({ left, top, width, height }).png().toBuffer();
    const raw = await sharp(crop).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let contentPixels = 0;
    for (let offset = 0; offset < raw.data.length; offset += raw.info.channels) {
      const red = raw.data[offset] ?? 255;
      const green = raw.data[offset + 1] ?? red;
      const blue = raw.data[offset + 2] ?? red;
      if (red + green + blue < 720) contentPixels += 1;
    }
    const density = contentPixels / Math.max(1, raw.info.width * raw.info.height);
    const issues: string[] = [];
    if (width < 80 || height < 80) issues.push("Crop is smaller than 80 pixels in one dimension.");
    if (density < 0.006) issues.push("Crop is predominantly blank.");
    if ((bounds.x2 - bounds.x1) * (bounds.y2 - bounds.y1) > 0.94 && figureType !== "full-page") issues.push("Crop is effectively the entire page; preview it as type full-page only when the whole page is technically useful.");
    const valid = issues.length === 0;
    const hash = sha256Value(JSON.stringify({ documentId, pageNumber, bounds, figureType, cropHash: sha256Value(crop) }));
    const contextBase = await sharp(pagePath).resize({ width: 1000, height: 1000, fit: "inside", withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
    const scaleX = contextBase.info.width / metadata.width;
    const scaleY = contextBase.info.height / metadata.height;
    const contextLeft = Math.floor(left * scaleX);
    const contextTop = Math.floor(top * scaleY);
    const contextWidth = Math.max(1, Math.min(contextBase.info.width - contextLeft, Math.ceil(width * scaleX)));
    const contextHeight = Math.max(1, Math.min(contextBase.info.height - contextTop, Math.ceil(height * scaleY)));
    const labelHeight = Math.min(42, contextHeight);
    const overlay = Buffer.from(`<svg width="${contextBase.info.width}" height="${contextBase.info.height}" xmlns="http://www.w3.org/2000/svg"><rect x="${contextLeft}" y="${contextTop}" width="${contextWidth}" height="${contextHeight}" fill="none" stroke="#f97316" stroke-width="${Math.max(3, Math.round(contextBase.info.width / 250))}"/><rect x="${contextLeft}" y="${contextTop}" width="${Math.min(contextWidth, 460)}" height="${labelHeight}" fill="#f97316"/><text x="${contextLeft + 8}" y="${contextTop + Math.min(29, labelHeight - 5)}" font-family="sans-serif" font-size="20" fill="white">${temporaryLabel.replace(/[<>&]/g, "")}</text></svg>`);
    const contextImage = await sharp(contextBase.data).composite([{ input: overlay, top: 0, left: 0 }]).png().toBuffer();
    const preview: CropPreview = { figureKey, documentId, page: pageNumber, bounds, type: figureType, hash, valid, density, width, height, crop, context: contextImage };
    this.cropPreviews.set(hash, preview);
    const previewDir = join(this.context.workspace.previewsDir, "figures");
    mkdirSync(previewDir, { recursive: true });
    writeFileSync(join(previewDir, `${hash}.png`), crop);
    return {
      content: [
        { type: "text" as const, text: JSON.stringify({ valid, previewHash: hash, documentId, page: pageNumber, bounds, figureType, pixelDimensions: { width, height }, contentDensity: Number(density.toFixed(5)), issues, attempt: figureAttempts }, null, 2) },
        { type: "image" as const, data: crop.toString("base64"), mimeType: "image/png" },
        { type: "image" as const, data: contextImage.toString("base64"), mimeType: "image/png" }
      ]
    };
  }

  saveSections(documentId: string, title: string, sectionsInput: Array<Omit<Section, "generatedBy">>, uncoveredPages: number[]) {
    this.assertSource(documentId);
    const sections = sectionsInput.map((section) => SectionSchema.parse({ ...section, generatedBy: this.context.runId }));
    const saved = SavedSectionsSchema.parse({ documentId, title, sections, uncoveredPages });
    if (sections.some((section) => section.documentId !== documentId)) throw new Error("Every submitted section must belong to the requested document.");
    for (const section of sections) {
      for (const evidence of section.headingEvidence.filter((item) => item.visualOnly)) {
        if (!this.inspectedPages.has(`${documentId}:${evidence.page}`)) throw new Error(`Visual-only heading evidence on page ${evidence.page} must be inspected first.`);
      }
    }
    const report = validateSections(sections, [this.context.reader.document(documentId)]);
    if (!report.valid) throw new Error(report.issues.join(" "));
    const computedUncovered = report.uncoveredPages[documentId] ?? [];
    if (computedUncovered.join(",") !== [...uncoveredPages].sort((a, b) => a - b).join(",")) throw new Error("uncoveredPages does not match the submitted section spans.");
    this.checkpoint.documentTitles[documentId] = title;
    this.checkpoint.sections = [...this.checkpoint.sections.filter((section) => section.documentId !== documentId), ...sections];
    this.persist(`sections-${documentId}`, saved);
    return { saved: true, documentId, sectionCount: sections.length, warnings: report.warnings, uncoveredPages: computedUncovered };
  }

  saveFigure(input: Omit<Figure, "asset" | "generatedBy">) {
    this.assertSource(input.documentId);
    const preview = this.cropPreviews.get(input.previewHash);
    if (!preview || !preview.valid) throw new Error("Figure must reference a valid crop preview from this run.");
    if (!this.inspectedPages.has(`${input.documentId}:${input.page}`)) throw new Error("Inspect the full prepared page before saving a figure crop.");
    const bounds = canonicalBounds(input.bounds);
    if (preview.documentId !== input.documentId || preview.page !== input.page || preview.type !== input.type || JSON.stringify(preview.bounds) !== JSON.stringify(bounds)) {
      throw new Error("Figure bounds or source do not match the approved preview hash.");
    }
    const figure = {
      ...input,
      bounds,
      asset: `figures/${input.id.replace(/[^a-z0-9-]+/g, "-")}.png`,
      generatedBy: this.context.runId
    } satisfies Figure;
    const withoutExisting = this.checkpoint.figures.filter((candidate) => candidate.id !== figure.id);
    const issues = validateFigures([...withoutExisting, figure], [...this.context.reader.documents.values()]);
    if (issues.length) throw new Error(issues.join(" "));
    this.checkpoint.figures = [...withoutExisting, figure];
    this.persist(`figure-${figure.id}`, figure);
    return { saved: true, id: figure.id, asset: figure.asset, previewHash: figure.previewHash };
  }

  saveDataset(datasetInput: Omit<Dataset, "recordsFile" | "generatedBy" | "verificationStatus">, recordsInput: DatasetRecord[]) {
    for (const evidence of recordsInput.flatMap((record) => record.evidence)) this.assertSource(evidence.documentId);
    const dataset = DatasetSchema.parse({
      ...datasetInput,
      recordsFile: `tables/${datasetInput.id}.json`,
      generatedBy: this.context.runId,
      verificationStatus: "verified"
    });
    const records = recordsInput.map((record) => DatasetRecordSchema.parse(record));
    for (const evidence of records.flatMap((record) => record.evidence)) {
      if (!this.inspectedPages.has(`${evidence.documentId}:${evidence.page}`)) throw new Error(`Dataset evidence page ${evidence.documentId}:${evidence.page} must be visually inspected before verification.`);
    }
    const issues = validateDataset(dataset, records, [...this.context.reader.documents.values()]);
    if (issues.length) throw new Error(issues.join(" "));
    this.checkpoint.datasets = [...this.checkpoint.datasets.filter((candidate) => candidate.dataset.id !== dataset.id), { dataset, records }];
    this.persist(`dataset-${dataset.id}`, { dataset, records });
    return { saved: true, id: dataset.id, recordCount: records.length };
  }

  async inspectVideoFrame(videoId: string, seconds: number) {
    this.assertSource(videoId);
    const video = this.context.reader.video(videoId);
    if (!video.sourcePath) throw new Error(`Prepared video ${videoId} has no local frame source.`);
    if (seconds < 0 || seconds > video.durationSeconds) throw new Error(`Frame timestamp is outside ${videoId}.`);
    const attempts = (this.frameAttemptsByVideo.get(videoId) ?? 0) + 1;
    this.frameAttemptsByVideo.set(videoId, attempts);
    if (attempts > MAX_FRAME_PREVIEWS_PER_VIDEO) return jsonResult({ valid: false, attemptLimitReached: true });
    const timestamp = Number(seconds.toFixed(3));
    const framesDir = join(this.context.workspace.previewsDir, "video", videoId);
    mkdirSync(framesDir, { recursive: true });
    const destination = join(framesDir, `${String(timestamp).replace(".", "-")}.jpg`);
    await execFileAsync(process.env.INGESTION_PYTHON?.trim() || "python3", [join(REPOSITORY_ROOT, "scripts", "ingest", "prepare-video.py"), "frame", "--video", video.sourcePath, "--seconds", String(timestamp), "--output", destination]);
    const image = readFileSync(destination);
    const statistics = await sharp(image).stats();
    const valid = (statistics.entropy ?? 0) >= 0.05;
    const hash = sha256Value(JSON.stringify({ videoId, seconds: timestamp, imageHash: sha256Value(image) }));
    this.framePreviews.set(`${videoId}:${timestamp}`, { videoId, seconds: timestamp, hash, path: destination, valid });
    return {
      content: [
        { type: "text" as const, text: JSON.stringify({ valid, previewHash: hash, videoId, seconds: timestamp, issues: valid ? [] : ["Frame is predominantly blank."] }, null, 2) },
        { type: "image" as const, data: image.toString("base64"), mimeType: "image/jpeg" }
      ]
    };
  }

  saveVideoSegments(videoId: string, segmentsInput: Array<Omit<VideoSegment, "frame" | "generatedBy">>) {
    this.assertSource(videoId);
    const segments = segmentsInput.map((segment) => {
      const timestamp = Number(segment.frameSeconds.toFixed(3));
      const preview = this.framePreviews.get(`${videoId}:${timestamp}`);
      if (!preview || !preview.valid || preview.hash !== segment.previewHash) throw new Error(`Segment ${segment.id} does not reference its approved representative frame.`);
      const slug = segment.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "segment";
      return VideoSegmentSchema.parse({ ...segment, frame: `video/${videoId}/frames/${slug}.jpg`, generatedBy: this.context.runId });
    });
    if (segments.some((segment) => segment.videoId !== videoId)) throw new Error("Every segment must belong to the requested video.");
    const issues = validateVideoSegments(segments, [this.context.reader.video(videoId)]);
    if (issues.length) throw new Error(issues.join(" "));
    this.checkpoint.videoSegments = [...this.checkpoint.videoSegments.filter((segment) => segment.videoId !== videoId), ...segments];
    this.persist(`video-${videoId}`, segments);
    return { saved: true, videoId, segmentCount: segments.length };
  }

  finalize() {
    const documents = [...this.context.reader.documents.values()];
    const videos = [...this.context.reader.videos.values()];
    const issues = [
      ...validateSections(this.checkpoint.sections, documents).issues,
      ...validateFigures(this.checkpoint.figures, documents),
      ...this.checkpoint.datasets.flatMap(({ dataset, records }) => validateDataset(dataset, records, documents)),
      ...validateVideoSegments(this.checkpoint.videoSegments, videos)
    ];
    for (const document of documents) {
      if (!this.checkpoint.documentTitles[document.id]) issues.push(`Document ${document.id} has no saved identity and sections.`);
    }
    for (const video of videos) {
      if (!this.checkpoint.videoSegments.some((segment) => segment.videoId === video.id)) issues.push(`Video ${video.id} has no saved semantic segments.`);
    }
    this.checkpoint.ready = issues.length === 0;
    this.persist("finalize", { ready: this.checkpoint.ready, issues });
    return { ready: this.checkpoint.ready, issues };
  }
}

type DatasetInput = {
  id: string;
  title: string;
  schema: Record<string, "string" | "number" | "boolean">;
  evidence: Array<{ documentId: string; pages: number[] }>;
};

export const INGESTION_TOOL_NAMES = [
  "mcp__knowledge-ingestion__list_ingestion_sources",
  "mcp__knowledge-ingestion__read_page_text",
  "mcp__knowledge-ingestion__inspect_page_image",
  "mcp__knowledge-ingestion__list_page_regions",
  "mcp__knowledge-ingestion__preview_figure_crop",
  "mcp__knowledge-ingestion__save_sections",
  "mcp__knowledge-ingestion__save_figure",
  "mcp__knowledge-ingestion__save_dataset",
  "mcp__knowledge-ingestion__read_transcript",
  "mcp__knowledge-ingestion__inspect_video_frame",
  "mcp__knowledge-ingestion__save_video_segments",
  "mcp__knowledge-ingestion__finalize_ingestion"
] as const;

const STAGE_TOOLS: Record<StageName, Set<string>> = {
  sections: new Set(["list_ingestion_sources", "read_page_text", "inspect_page_image", "save_sections"]),
  figures: new Set(["list_ingestion_sources", "read_page_text", "inspect_page_image", "list_page_regions", "preview_figure_crop", "save_figure"]),
  datasets: new Set(["list_ingestion_sources", "read_page_text", "inspect_page_image", "list_page_regions", "save_dataset"]),
  video: new Set(["list_ingestion_sources", "read_transcript", "inspect_video_frame", "save_video_segments"]),
  finalize: new Set(INGESTION_TOOL_NAMES.map((name) => name.replace("mcp__knowledge-ingestion__", "")))
};

export function ingestionToolNamesForStage(stage: StageName): string[] {
  return [...STAGE_TOOLS[stage]].map((name) => `mcp__knowledge-ingestion__${name}`);
}

export function createIngestionTools(context: IngestionToolContext) {
  const controller = new IngestionToolController(context);
  const instrument = <T extends Record<string, unknown>>(name: string, handler: (args: T) => Promise<IngestionToolResult> | IngestionToolResult) => (
    (args: T) => controller.instrument(name, args, async () => handler(args))
  );
  const tools = [
    tool("list_ingestion_sources", "List only the sources registered for this ingestion run, their deterministic metadata, and stage status.", {}, instrument("list_ingestion_sources", async () => jsonResult(controller.listSources())), { alwaysLoad: true }),
    tool("read_page_text", "Read exact extracted page text and block geometry. At most eight consecutive pages; paths are never accepted.", { documentId: SafeIdSchema, startPage: z.number().int().positive(), endPage: z.number().int().positive() }, instrument("read_page_text", async ({ documentId, startPage, endPage }) => { controller.assertSource(documentId); return jsonResult(controller.context.reader.readPageText(documentId, startPage, endPage)); }), { alwaysLoad: true }),
    tool("inspect_page_image", "Inspect prepared page pixels before making visual or ambiguous heading decisions.", { documentId: SafeIdSchema, page: z.number().int().positive(), maxEdge: z.number().int().min(600).max(1800).optional() }, instrument("inspect_page_image", ({ documentId, page, maxEdge }) => controller.inspectPageImage(documentId, page, maxEdge)), { alwaysLoad: true }),
    tool("list_page_regions", "List deterministic text, image, and drawing rectangles for one page. Regions are candidates, not semantic conclusions.", { documentId: SafeIdSchema, page: z.number().int().positive() }, instrument("list_page_regions", async ({ documentId, page }) => { controller.assertSource(documentId); return jsonResult({ documentId, page, regions: controller.context.reader.page(documentId, page).regions }); })),
    tool("preview_figure_crop", "Render the exact proposed crop and full-page context. Inspect both returned images and revise until valid before saving. Declare full-page only when the whole page is itself a technically useful chart or guide.", { documentId: SafeIdSchema, page: z.number().int().positive(), bounds: NormalizedBoundsSchema, temporaryLabel: z.string().trim().min(1).max(80), type: FigureTypeSchema.optional() }, instrument("preview_figure_crop", ({ documentId, page, bounds, temporaryLabel, type }) => controller.previewCrop(documentId, page, bounds, temporaryLabel, type)), { alwaysLoad: true }),
    tool("save_sections", "Save a complete ordered section set and document title for exactly one registered document.", {
      documentId: SafeIdSchema,
      title: z.string().trim().min(1).max(300),
      sections: z.array(SectionSchema.omit({ generatedBy: true })).min(1),
      uncoveredPages: z.array(z.number().int().positive())
    }, instrument("save_sections", async ({ documentId, title, sections, uncoveredPages }) => jsonResult(controller.saveSections(documentId, title, sections, uncoveredPages))), { alwaysLoad: true }),
    tool("save_figure", "Save one technically useful figure only after an exact valid preview. The preview hash must be current and source/bounds-identical.", {
      id: SafeIdSchema,
      documentId: SafeIdSchema,
      page: z.number().int().positive(),
      type: FigureTypeSchema,
      title: z.string().trim().min(1).max(200),
      caption: z.string().trim().min(1).max(800),
      bounds: NormalizedBoundsSchema,
      keywords: z.array(z.string().trim().min(1).max(80)).min(1).max(30),
      previewHash: z.string().regex(/^[a-f0-9]{64}$/)
    }, instrument("save_figure", async (args) => jsonResult(controller.saveFigure(args))), { alwaysLoad: true }),
    tool("save_dataset", "Save an exact structured dataset after visually verifying every supplied record against its evidence regions.", {
      dataset: z.object({ id: SafeIdSchema, title: z.string().trim().min(1).max(200), schema: z.record(z.string().min(1).max(80), DatasetValueTypeSchema), evidence: z.array(z.object({ documentId: SafeIdSchema, pages: z.array(z.number().int().positive()).min(1).max(100) })).min(1) }),
      records: z.array(DatasetRecordSchema).min(1).max(10_000)
    }, instrument("save_dataset", async ({ dataset, records }: { dataset: DatasetInput; records: DatasetRecord[] }) => jsonResult(controller.saveDataset(dataset, records)))),
    tool("read_transcript", "Read exact captions from one registered video over at most ten minutes.", { videoId: SafeIdSchema, startSeconds: z.number().finite().nonnegative(), endSeconds: z.number().finite().positive() }, instrument("read_transcript", async ({ videoId, startSeconds, endSeconds }) => { controller.assertSource(videoId); return jsonResult({ videoId, startSeconds, endSeconds, captions: controller.context.reader.transcript(videoId, startSeconds, endSeconds) }); }), { alwaysLoad: true }),
    tool("inspect_video_frame", "Extract and inspect one exact representative-frame candidate before saving any segment that uses it.", { videoId: SafeIdSchema, seconds: z.number().finite().nonnegative() }, instrument("inspect_video_frame", ({ videoId, seconds }) => controller.inspectVideoFrame(videoId, seconds)), { alwaysLoad: true }),
    tool("save_video_segments", "Save the complete ordered semantic segment set for one video. Every segment needs its own accepted representative-frame preview hash.", { videoId: SafeIdSchema, segments: z.array(VideoSegmentSchema.omit({ frame: true, generatedBy: true })).min(1).max(100) }, instrument("save_video_segments", async ({ videoId, segments }) => jsonResult(controller.saveVideoSegments(videoId, segments))), { alwaysLoad: true }),
    tool("finalize_ingestion", "Run cross-stage validation and mark staging ready. The orchestrator, never Claude, performs atomic promotion afterward.", {}, instrument("finalize_ingestion", async () => jsonResult(controller.finalize())), { alwaysLoad: true })
  ];
  const stageTools = tools.filter((candidate) => STAGE_TOOLS[context.stage].has(candidate.name));
  return { controller, server: createSdkMcpServer({ name: "knowledge-ingestion", version: "1.0.0", tools: stageTools }) };
}
