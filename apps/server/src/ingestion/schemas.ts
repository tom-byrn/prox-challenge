import { z } from "zod";

export const INGESTION_SCHEMA_VERSION = 1 as const;
export const INGESTION_PROMPT_VERSION = "ingestion-v1";

export const SafeIdSchema = z.string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "Use lowercase letters, numbers, and hyphens.");

export const SemanticIdSchema = z.string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9][a-z0-9:@.-]*$/, "Use a stable lowercase semantic id.");

export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const RelativePackagePathSchema = z.string().trim().min(1).max(240).superRefine((value, context) => {
  const segments = value.replaceAll("\\", "/").split("/");
  if (value.startsWith("/") || /^[a-z]:/i.test(value) || segments.some((segment) => segment === ".." || segment === "")) {
    context.addIssue({ code: "custom", message: "Package paths must be normalized relative paths without traversal." });
  }
});

export const AuthoritySchema = z.string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

const InputDocumentSchema = z.object({
  path: z.string().trim().min(1),
  sourceId: SafeIdSchema.optional(),
  authority: AuthoritySchema.default("authoritative-manual")
});

const InputVideoSchema = z.object({
  url: z.url().refine((value) => value.startsWith("https://"), "Video URLs must use HTTPS."),
  sourceId: SafeIdSchema.optional(),
  authority: AuthoritySchema.default("supplemental-demonstration"),
  captionLanguages: z.array(z.string().trim().min(2).max(20)).min(1).max(8).default(["en"])
});

export const IngestionConfigSchema = z.object({
  schemaVersion: z.literal(INGESTION_SCHEMA_VERSION),
  productId: SafeIdSchema,
  productName: z.string().trim().min(1).max(160),
  documents: z.array(InputDocumentSchema).max(24).default([]),
  videos: z.array(InputVideoSchema).max(8).default([])
}).superRefine((config, context) => {
  if (config.documents.length + config.videos.length === 0) {
    context.addIssue({ code: "custom", message: "At least one document or video is required." });
  }
  const suppliedIds = [
    ...config.documents.map((source) => source.sourceId),
    ...config.videos.map((source) => source.sourceId)
  ].filter((id): id is string => Boolean(id));
  if (new Set(suppliedIds).size !== suppliedIds.length) {
    context.addIssue({ code: "custom", message: "Supplied source ids must be unique." });
  }
});

export const NormalizedBoundsSchema = z.object({
  x1: z.number().finite().min(0).max(1),
  y1: z.number().finite().min(0).max(1),
  x2: z.number().finite().min(0).max(1),
  y2: z.number().finite().min(0).max(1)
}).superRefine((bounds, context) => {
  if (bounds.x2 <= bounds.x1) context.addIssue({ code: "custom", path: ["x2"], message: "x2 must be greater than x1." });
  if (bounds.y2 <= bounds.y1) context.addIssue({ code: "custom", path: ["y2"], message: "y2 must be greater than y1." });
});

export const PageRegionSchema = z.object({
  type: z.enum(["text", "image", "drawing"]),
  bounds: NormalizedBoundsSchema,
  text: z.string().max(20_000).optional()
});

export const PreparedPageSchema = z.object({
  page: z.number().int().positive(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  rotation: z.number().int(),
  textFile: RelativePackagePathSchema,
  imageFile: RelativePackagePathSchema,
  textAvailable: z.boolean(),
  regions: z.array(PageRegionSchema)
});

export const PreparedDocumentSchema = z.object({
  schemaVersion: z.literal(INGESTION_SCHEMA_VERSION),
  id: SafeIdSchema,
  sourceFile: z.string().trim().min(1).max(240),
  sourcePath: z.string().trim().min(1),
  sha256: Sha256Schema,
  pageCount: z.number().int().positive(),
  metadata: z.record(z.string(), z.string()),
  outline: z.array(z.object({ level: z.number().int().positive(), title: z.string().trim().min(1).max(500), page: z.number().int().positive() })),
  outlineAvailable: z.boolean(),
  authority: AuthoritySchema,
  pages: z.array(PreparedPageSchema).min(1)
});

export const PreparedCaptionSchema = z.object({
  startSeconds: z.number().finite().nonnegative(),
  durationSeconds: z.number().finite().positive(),
  text: z.string().trim().min(1).max(4_000)
});

export const PreparedVideoSchema = z.object({
  schemaVersion: z.literal(INGESTION_SCHEMA_VERSION),
  id: SafeIdSchema,
  videoId: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(300),
  url: z.url(),
  sourcePath: z.string().trim().min(1).optional(),
  language: z.string().trim().min(1).max(20),
  isGenerated: z.boolean(),
  durationSeconds: z.number().finite().positive(),
  sha256: Sha256Schema,
  authority: AuthoritySchema,
  captions: z.array(PreparedCaptionSchema).min(1)
});

export const HeadingEvidenceSchema = z.object({
  page: z.number().int().positive(),
  text: z.string().trim().min(1).max(500),
  visualOnly: z.boolean().optional()
});

export const SectionSchema = z.object({
  id: SemanticIdSchema,
  documentId: SafeIdSchema,
  title: z.string().trim().min(1).max(200),
  startPage: z.number().int().positive(),
  endPage: z.number().int().positive(),
  summary: z.string().trim().min(1).max(1_000),
  headingEvidence: z.array(HeadingEvidenceSchema).min(1).max(12),
  generatedBy: SafeIdSchema
});

export const FigureTypeSchema = z.enum(["diagram", "controls", "chart", "schematic", "diagnosis", "mechanism", "full-page"]);

export const FigureSchema = z.object({
  id: SemanticIdSchema,
  documentId: SafeIdSchema,
  page: z.number().int().positive(),
  type: FigureTypeSchema,
  title: z.string().trim().min(1).max(200),
  caption: z.string().trim().min(1).max(800),
  bounds: NormalizedBoundsSchema,
  keywords: z.array(z.string().trim().min(1).max(80)).min(1).max(30),
  asset: RelativePackagePathSchema,
  previewHash: Sha256Schema,
  generatedBy: SafeIdSchema
});

export const DatasetValueTypeSchema = z.enum(["string", "number", "boolean"]);

export const DatasetEvidenceSchema = z.object({
  documentId: SafeIdSchema,
  page: z.number().int().positive(),
  region: NormalizedBoundsSchema.optional()
});

export const DatasetRecordSchema = z.object({
  id: z.string().trim().min(1).max(120),
  values: z.record(z.string().min(1).max(80), z.union([z.string(), z.number().finite(), z.boolean()])),
  evidence: z.array(DatasetEvidenceSchema).min(1).max(20)
});

export const DatasetSchema = z.object({
  id: SafeIdSchema,
  title: z.string().trim().min(1).max(200),
  schema: z.record(z.string().min(1).max(80), DatasetValueTypeSchema),
  recordsFile: RelativePackagePathSchema,
  evidence: z.array(z.object({ documentId: SafeIdSchema, pages: z.array(z.number().int().positive()).min(1).max(100) })).min(1),
  verificationStatus: z.literal("verified"),
  generatedBy: SafeIdSchema
});

export const VideoManifestEntrySchema = z.object({
  id: SafeIdSchema,
  videoId: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(300),
  url: z.url(),
  captionType: z.enum(["auto-generated", "manual"]),
  transcriptFile: RelativePackagePathSchema,
  sha256: Sha256Schema,
  authority: AuthoritySchema
});

export const VideoSegmentSchema = z.object({
  id: z.string().trim().min(1).max(160).regex(/^video:[a-z0-9-]+@[0-9]+(?:\.[0-9]+)?-[0-9]+(?:\.[0-9]+)?$/),
  videoId: SafeIdSchema,
  title: z.string().trim().min(1).max(200),
  startSeconds: z.number().finite().nonnegative(),
  endSeconds: z.number().finite().positive(),
  summary: z.string().trim().min(1).max(1_000),
  keywords: z.array(z.string().trim().min(1).max(80)).min(1).max(30),
  frameSeconds: z.number().finite().nonnegative(),
  frame: RelativePackagePathSchema,
  previewHash: Sha256Schema,
  generatedBy: SafeIdSchema
});

export const IngestionStageRecordSchema = z.object({
  name: z.enum(["prepare", "sections", "figures", "datasets", "video", "validate", "finalize"]),
  status: z.enum(["complete", "failed"]),
  attempts: z.number().int().positive(),
  durationMs: z.number().int().nonnegative().optional(),
  toolCalls: z.number().int().nonnegative().optional(),
  failures: z.number().int().nonnegative().optional()
});

export const IngestionRunSchema = z.object({
  id: SafeIdSchema,
  createdAt: z.iso.datetime(),
  model: z.string().trim().min(1).max(200),
  promptVersion: z.string().trim().min(1).max(80),
  sourceHashes: z.record(SafeIdSchema, Sha256Schema),
  stages: z.array(IngestionStageRecordSchema),
  costUsd: z.number().finite().nonnegative().optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  sdkTurns: z.number().int().nonnegative().optional(),
  validation: z.object({ valid: z.boolean(), issues: z.array(z.string().max(1_000)) })
});

export const DocumentManifestEntrySchema = z.object({
  id: SafeIdSchema,
  title: z.string().trim().min(1).max(300),
  sourceFile: z.string().trim().min(1).max(240),
  sha256: Sha256Schema,
  pageCount: z.number().int().positive(),
  authority: AuthoritySchema,
  outlineAvailable: z.boolean()
});

export const KnowledgeManifestSchema = z.object({
  schemaVersion: z.literal(INGESTION_SCHEMA_VERSION),
  product: z.object({ id: SafeIdSchema, name: z.string().trim().min(1).max(160) }),
  documents: z.array(DocumentManifestEntrySchema),
  sections: z.array(SectionSchema),
  figures: z.array(FigureSchema),
  datasets: z.array(DatasetSchema),
  videos: z.array(VideoManifestEntrySchema),
  videoSegments: z.array(VideoSegmentSchema),
  ingestionRuns: z.array(IngestionRunSchema).min(1)
});

export const SavedSectionsSchema = z.object({
  documentId: SafeIdSchema,
  title: z.string().trim().min(1).max(300),
  sections: z.array(SectionSchema).min(1),
  uncoveredPages: z.array(z.number().int().positive())
});

export const SavedDatasetSchema = z.object({
  dataset: DatasetSchema,
  records: z.array(DatasetRecordSchema).min(1).max(10_000)
});

export type IngestionConfig = z.infer<typeof IngestionConfigSchema>;
export type PreparedDocument = z.infer<typeof PreparedDocumentSchema>;
export type PreparedVideo = z.infer<typeof PreparedVideoSchema>;
export type NormalizedBounds = z.infer<typeof NormalizedBoundsSchema>;
export type Section = z.infer<typeof SectionSchema>;
export type Figure = z.infer<typeof FigureSchema>;
export type Dataset = z.infer<typeof DatasetSchema>;
export type DatasetRecord = z.infer<typeof DatasetRecordSchema>;
export type VideoSegment = z.infer<typeof VideoSegmentSchema>;
export type IngestionRun = z.infer<typeof IngestionRunSchema>;
export type KnowledgeManifest = z.infer<typeof KnowledgeManifestSchema>;
