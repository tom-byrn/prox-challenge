import { z } from "zod";

export const DocumentSourceIdSchema = z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/);

const DocumentEvidenceRefSchema = z.object({
  kind: z.literal("document"),
  sourceId: DocumentSourceIdSchema,
  pages: z.array(z.number().int().positive()).min(1).max(8)
});

const FigureEvidenceRefSchema = z.object({
  kind: z.literal("figure"),
  figureId: z.string().min(1).max(80)
});

const VideoEvidenceRefSchema = z.object({
  kind: z.literal("video"),
  segmentId: z.string().min(1).max(120)
});

const StructuredEvidenceRefSchema = z.object({
  kind: z.literal("structured-data"),
  dataset: z.string().min(1).max(80),
  recordIds: z.array(z.string().min(1).max(100)).min(1).max(20),
  sourceId: DocumentSourceIdSchema,
  pages: z.array(z.number().int().positive()).min(1).max(12)
});

export const EvidenceRefSchema = z.discriminatedUnion("kind", [
  DocumentEvidenceRefSchema,
  FigureEvidenceRefSchema,
  VideoEvidenceRefSchema,
  StructuredEvidenceRefSchema
]);

export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

type EvidenceBase = {
  id: string;
  title: string;
  ref: EvidenceRef;
  excerpt?: string;
  url?: string;
  previewUrl?: string;
  derivedFrom?: EvidenceRef[];
};

export type EvidenceSource = EvidenceBase & (
  | { kind: "document"; sourceId: z.infer<typeof DocumentSourceIdSchema>; pages: number[] }
  | { kind: "figure"; sourceId: string; pages: number[]; caption: string }
  | { kind: "video"; sourceId: string; videoId: string; startSeconds: number; endSeconds: number; captionType: string }
  | { kind: "structured-data"; dataset: string; recordIds: string[]; sourceId: string; pages: number[] }
);

export function evidenceRefId(ref: EvidenceRef): string {
  if (ref.kind === "document") return `document:${ref.sourceId}:p${ref.pages.join("-")}`;
  if (ref.kind === "figure") return `figure:${ref.figureId}`;
  if (ref.kind === "video") return ref.segmentId;
  return `table:${ref.dataset}:${ref.recordIds.join(",")}`;
}

export function uniqueEvidence(sources: EvidenceSource[]): EvidenceSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.id)) return false;
    seen.add(source.id);
    return true;
  });
}
