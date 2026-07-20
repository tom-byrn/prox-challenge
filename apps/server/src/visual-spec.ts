import { z } from "zod";
import { EvidenceRefSchema } from "./evidence.js";

const IdSchema = z.string().min(1).max(60).regex(/^[a-z0-9][a-z0-9_-]*$/i, "Use a short alphanumeric id.");
const ShortTextSchema = z.string().trim().min(1).max(120);
const BodyTextSchema = z.string().trim().min(1).max(500);
const PixelCoordinateSchema = z.number().finite().nonnegative();
export const VisualAssetIdSchema = z.string().regex(/^(?:figure:[a-z0-9][a-z0-9-]{0,79}|page:(?:[a-z0-9][a-z0-9-]{0,79}:)?[a-z0-9][a-z0-9-]{0,79}:[1-9]\d*|upload:photo-[a-f0-9]{24})$/i);

export const VisualSourceRefSchema = EvidenceRefSchema;

const EvidenceSchema = VisualSourceRefSchema.optional();
const ToneSchema = z.enum(["neutral", "primary", "positive", "warning", "negative"]).optional();
const PointSchema = z.object({ x: PixelCoordinateSchema, y: PixelCoordinateSchema });
const BoundsSchema = z.object({
  x1: PixelCoordinateSchema,
  y1: PixelCoordinateSchema,
  x2: PixelCoordinateSchema,
  y2: PixelCoordinateSchema
}).superRefine((bounds, context) => {
  if (bounds.x2 <= bounds.x1) context.addIssue({ code: "custom", message: "Annotation x2 must be greater than x1." });
  if (bounds.y2 <= bounds.y1) context.addIssue({ code: "custom", message: "Annotation y2 must be greater than y1." });
});

const AnnotationBase = {
  id: IdSchema,
  label: ShortTextSchema,
  body: BodyTextSchema.optional(),
  tone: ToneSchema,
  evidence: EvidenceSchema
};

const AnnotationSchema = z.discriminatedUnion("shape", [
  z.object({ ...AnnotationBase, shape: z.literal("pin"), point: PointSchema }),
  z.object({ ...AnnotationBase, shape: z.literal("box"), bounds: BoundsSchema }),
  z.object({ ...AnnotationBase, shape: z.literal("arrow"), from: PointSchema, to: PointSchema })
]);

export const AnnotatedImageSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("annotated-image"),
  title: ShortTextSchema,
  description: BodyTextSchema.optional(),
  sourceRefs: z.array(VisualSourceRefSchema).min(1).max(8),
  image: z.object({
    assetId: VisualAssetIdSchema,
    alt: z.string().trim().min(8).max(240)
  }),
  annotations: z.array(AnnotationSchema).min(1).max(20)
});

const PortSchema = z.object({
  id: IdSchema,
  label: ShortTextSchema,
  side: z.enum(["top", "right", "bottom", "left"]).optional(),
  tone: ToneSchema
});

const DiagramNodeSchema = z.object({
  id: IdSchema,
  role: z.enum(["device", "endpoint", "process", "junction", "decision", "note"]),
  label: ShortTextSchema,
  detail: z.string().trim().min(1).max(180).optional(),
  tone: ToneSchema,
  ports: z.array(PortSchema).max(8).optional()
});

const ConnectionEndSchema = z.object({ node: IdSchema, port: IdSchema.optional() });
const DiagramConnectionSchema = z.object({
  id: IdSchema,
  from: ConnectionEndSchema,
  to: ConnectionEndSchema,
  label: z.string().trim().min(1).max(100).optional(),
  tone: ToneSchema,
  emphasis: z.enum(["normal", "primary", "muted"]).optional(),
  evidence: EvidenceSchema
});

const DiagramCalloutSchema = z.object({
  target: z.object({ node: IdSchema, port: IdSchema.optional() }),
  text: BodyTextSchema,
  tone: ToneSchema
});

const ConnectionDiagramSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("connection-diagram"),
  title: ShortTextSchema,
  description: BodyTextSchema.optional(),
  sourceRefs: z.array(VisualSourceRefSchema).min(1).max(8),
  layout: z.object({ direction: z.enum(["left-to-right", "top-to-bottom"]) }),
  nodes: z.array(DiagramNodeSchema).min(2).max(40),
  connections: z.array(DiagramConnectionSchema).min(1).max(60),
  callouts: z.array(DiagramCalloutSchema).max(12).optional()
});

const ProcedureSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("procedure"),
  title: ShortTextSchema,
  description: BodyTextSchema.optional(),
  sourceRefs: z.array(VisualSourceRefSchema).min(1).max(8),
  steps: z.array(z.object({
    id: IdSchema,
    title: ShortTextSchema,
    body: BodyTextSchema,
    tone: ToneSchema,
    evidence: EvidenceSchema
  })).min(2).max(16)
});

const ComparisonSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("comparison"),
  title: ShortTextSchema,
  description: BodyTextSchema.optional(),
  sourceRefs: z.array(VisualSourceRefSchema).min(1).max(8),
  columns: z.array(z.object({ id: IdSchema, label: ShortTextSchema })).min(2).max(6),
  rows: z.array(z.object({
    id: IdSchema,
    label: ShortTextSchema,
    values: z.array(z.object({
      columnId: IdSchema,
      text: z.string().trim().min(1).max(240),
      tone: ToneSchema
    })).min(2).max(6),
    evidence: EvidenceSchema
  })).min(1).max(16)
});

const MetricSummarySchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("metric-summary"),
  title: ShortTextSchema,
  description: BodyTextSchema.optional(),
  sourceRefs: z.array(VisualSourceRefSchema).min(1).max(8),
  metrics: z.array(z.object({
    id: IdSchema,
    label: ShortTextSchema,
    value: z.string().trim().min(1).max(80),
    unit: z.string().trim().min(1).max(30).optional(),
    detail: z.string().trim().min(1).max(240).optional(),
    tone: ToneSchema,
    evidence: EvidenceSchema
  })).min(1).max(8),
  callout: z.object({
    title: ShortTextSchema.optional(),
    body: BodyTextSchema,
    tone: ToneSchema,
    evidence: EvidenceSchema
  }).optional()
});

const ReferenceCardSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("reference-card"),
  title: ShortTextSchema,
  description: BodyTextSchema.optional(),
  sourceRefs: z.array(VisualSourceRefSchema).min(1).max(8),
  groups: z.array(z.object({
    id: IdSchema,
    title: ShortTextSchema,
    items: z.array(z.object({
      id: IdSchema,
      label: ShortTextSchema,
      value: z.string().trim().min(1).max(120).optional(),
      detail: z.string().trim().min(1).max(300).optional(),
      tone: ToneSchema,
      evidence: EvidenceSchema
    }).refine((item) => item.value || item.detail, { message: "Reference items need a value or detail." })).min(1).max(12)
  })).min(1).max(6),
  callouts: z.array(z.object({
    id: IdSchema,
    title: ShortTextSchema.optional(),
    body: BodyTextSchema,
    tone: ToneSchema,
    evidence: EvidenceSchema
  })).max(6).optional()
});

const BaseVisualSpecSchema = z.discriminatedUnion("kind", [
  AnnotatedImageSchema,
  ConnectionDiagramSchema,
  ProcedureSchema,
  ComparisonSchema,
  MetricSummarySchema,
  ReferenceCardSchema
]);

export const VisualSpecSchema = BaseVisualSpecSchema.superRefine((spec, context) => {
  const unique = (values: string[]) => new Set(values).size === values.length;

  if (spec.kind === "annotated-image" && !unique(spec.annotations.map((annotation) => annotation.id))) {
    context.addIssue({ code: "custom", message: "Annotation ids must be unique.", path: ["annotations"] });
  }

  if (spec.kind === "procedure" && !unique(spec.steps.map((step) => step.id))) {
    context.addIssue({ code: "custom", message: "Procedure step ids must be unique.", path: ["steps"] });
  }

  if (spec.kind === "connection-diagram") {
    const nodeIds = spec.nodes.map((node) => node.id);
    if (!unique(nodeIds)) context.addIssue({ code: "custom", message: "Diagram node ids must be unique.", path: ["nodes"] });
    if (!unique(spec.connections.map((connection) => connection.id))) context.addIssue({ code: "custom", message: "Connection ids must be unique.", path: ["connections"] });
    const nodes = new Map(spec.nodes.map((node) => [node.id, new Set((node.ports ?? []).map((port) => port.id))]));
    const validateEnd = (end: { node: string; port?: string }, path: Array<string | number>) => {
      const ports = nodes.get(end.node);
      if (!ports) context.addIssue({ code: "custom", message: `Unknown diagram node: ${end.node}`, path });
      else if (end.port && !ports.has(end.port)) context.addIssue({ code: "custom", message: `Unknown port ${end.port} on node ${end.node}.`, path });
    };
    spec.connections.forEach((connection, index) => {
      validateEnd(connection.from, ["connections", index, "from"]);
      validateEnd(connection.to, ["connections", index, "to"]);
    });
    spec.callouts?.forEach((callout, index) => validateEnd(callout.target, ["callouts", index, "target"]));
  }

  if (spec.kind === "comparison") {
    const columnIds = spec.columns.map((column) => column.id);
    const knownColumns = new Set(columnIds);
    if (!unique(columnIds)) context.addIssue({ code: "custom", message: "Comparison column ids must be unique.", path: ["columns"] });
    if (!unique(spec.rows.map((row) => row.id))) context.addIssue({ code: "custom", message: "Comparison row ids must be unique.", path: ["rows"] });
    spec.rows.forEach((row, rowIndex) => {
      const valueIds = row.values.map((value) => value.columnId);
      if (!unique(valueIds)) context.addIssue({ code: "custom", message: "Each row may contain only one value per column.", path: ["rows", rowIndex, "values"] });
      for (const [valueIndex, value] of row.values.entries()) {
        if (!knownColumns.has(value.columnId)) context.addIssue({ code: "custom", message: `Unknown comparison column: ${value.columnId}`, path: ["rows", rowIndex, "values", valueIndex] });
      }
    });
  }

  if (spec.kind === "metric-summary" && !unique(spec.metrics.map((metric) => metric.id))) {
    context.addIssue({ code: "custom", message: "Metric ids must be unique.", path: ["metrics"] });
  }

  if (spec.kind === "reference-card") {
    if (!unique(spec.groups.map((group) => group.id))) {
      context.addIssue({ code: "custom", message: "Reference group ids must be unique.", path: ["groups"] });
    }
    for (const [groupIndex, group] of spec.groups.entries()) {
      if (!unique(group.items.map((item) => item.id))) {
        context.addIssue({ code: "custom", message: "Reference item ids must be unique within a group.", path: ["groups", groupIndex, "items"] });
      }
    }
    if (spec.callouts && !unique(spec.callouts.map((callout) => callout.id))) {
      context.addIssue({ code: "custom", message: "Reference callout ids must be unique.", path: ["callouts"] });
    }
  }
});

export type VisualSpec = z.infer<typeof VisualSpecSchema>;
export type AnnotatedImageSpec = z.infer<typeof AnnotatedImageSchema>;
export type MetricSummarySpec = z.infer<typeof MetricSummarySchema>;
export type ReferenceCardSpec = z.infer<typeof ReferenceCardSchema>;
export type VisualKind = VisualSpec["kind"];
export type VisualSourceRef = z.infer<typeof VisualSourceRefSchema>;

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
