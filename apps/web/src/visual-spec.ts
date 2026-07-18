import type { EvidenceRef } from "./evidence";

export type VisualTone = "neutral" | "primary" | "positive" | "warning" | "negative";
export type VisualSourceRef = EvidenceRef;

type Evidence = { evidence?: VisualSourceRef };
type Tone = { tone?: VisualTone };
type VisualBase = {
  schemaVersion: 1;
  title: string;
  description?: string;
  sourceRefs: VisualSourceRef[];
};

export type VisualAnnotation = ({
  id: string;
  label: string;
  body?: string;
} & Tone & Evidence) & (
  | { shape: "pin"; point: { x: number; y: number } }
  | { shape: "box"; bounds: { x1: number; y1: number; x2: number; y2: number } }
  | { shape: "arrow"; from: { x: number; y: number }; to: { x: number; y: number } }
);

export type AnnotatedImageSpec = VisualBase & {
  kind: "annotated-image";
  image: { assetId: string; alt: string };
  annotations: VisualAnnotation[];
};

export type DiagramPort = {
  id: string;
  label: string;
  side?: "top" | "right" | "bottom" | "left";
  tone?: VisualTone;
};

export type DiagramNode = {
  id: string;
  role: "device" | "endpoint" | "process" | "junction" | "decision" | "note";
  label: string;
  detail?: string;
  tone?: VisualTone;
  ports?: DiagramPort[];
};

export type DiagramEnd = { node: string; port?: string };

export type DiagramConnection = {
  id: string;
  from: DiagramEnd;
  to: DiagramEnd;
  label?: string;
  tone?: VisualTone;
  emphasis?: "normal" | "primary" | "muted";
  evidence?: VisualSourceRef;
};

export type ConnectionDiagramSpec = VisualBase & {
  kind: "connection-diagram";
  layout: { direction: "left-to-right" | "top-to-bottom" };
  nodes: DiagramNode[];
  connections: DiagramConnection[];
  callouts?: Array<{ target: DiagramEnd; text: string; tone?: VisualTone }>;
};

export type ProcedureSpec = VisualBase & {
  kind: "procedure";
  steps: Array<{
    id: string;
    title: string;
    body: string;
    tone?: VisualTone;
    evidence?: VisualSourceRef;
  }>;
};

export type ComparisonSpec = VisualBase & {
  kind: "comparison";
  columns: Array<{ id: string; label: string }>;
  rows: Array<{
    id: string;
    label: string;
    values: Array<{ columnId: string; text: string; tone?: VisualTone }>;
    evidence?: VisualSourceRef;
  }>;
};

export type VisualSpec = AnnotatedImageSpec | ConnectionDiagramSpec | ProcedureSpec | ComparisonSpec;

export type VisualAsset = {
  assetId: string;
  url: string;
  title: string;
  source: string;
  pages: number[];
  width: number;
  height: number;
  original: { width: number; height: number };
  crop: { x: number; y: number; width: number; height: number };
};

export type VisualPayload = {
  id: string;
  spec: VisualSpec;
  assets: VisualAsset[];
};
