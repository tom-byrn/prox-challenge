export type DocumentSourceId = "owner-manual" | "quick-start" | "selection-chart";

export type EvidenceRef =
  | { kind: "document"; sourceId: DocumentSourceId; pages: number[] }
  | { kind: "figure"; figureId: string }
  | { kind: "video"; segmentId: string }
  | { kind: "structured-data"; dataset: string; recordIds: string[]; sourceId: DocumentSourceId; pages: number[] };

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
  | { kind: "document"; sourceId: DocumentSourceId; pages: number[] }
  | { kind: "figure"; sourceId: string; pages: number[]; caption: string }
  | { kind: "video"; sourceId: string; videoId: string; startSeconds: number; endSeconds: number; captionType: string }
  | { kind: "structured-data"; dataset: string; recordIds: string[]; sourceId: string; pages: number[] }
);
