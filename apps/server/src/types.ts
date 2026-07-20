import type { VisualPayload } from "./visual-spec.js";
import type { EvidenceSource } from "./evidence.js";
import type { ArtifactPayload } from "./artifacts.js";

export type Process = "MIG" | "FLUX_CORED" | "TIG" | "STICK";

export type PhotoAttachment = {
  id: string;
  url: string;
  mimeType: "image/jpeg";
  width: number;
  height: number;
  sizeBytes: number;
  alt: string;
};

export type SourceRef = {
  source: string;
  pages: number[];
};

export type FigurePayload = {
  id: string;
  title: string;
  caption: string;
  url: string;
  source: string;
  pages: number[];
};

/** Legacy stream shape retained so previously persisted chat snapshots remain readable. */
export type WidgetPayload = {
  name: "duty_cycle" | "polarity" | "troubleshooting" | "settings_guide";
  title: string;
  data: unknown;
};

export type VideoPayload = {
  id: string;
  source: Extract<EvidenceSource, { kind: "video" }>;
};

export type ClarificationRequest = {
  id: string;
  originalQuestion: string;
  question: string;
  options: Array<{ id: string; label: string; description?: string }>;
  allowOther: boolean;
};

export type TurnMetrics = {
  status: "success" | "degraded" | "error";
  model: string;
  costUsd: number;
  durationMs: number;
  apiDurationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  sdkTurns: number;
  toolCalls: number;
  toolErrors: number;
  repaired: boolean;
  validationIssues: number;
};

export type AgentEvent =
  | { type: "meta"; conversationId: string }
  | { type: "text_delta"; text: string }
  | { type: "clarification"; text: string }
  | { type: "clarification_request"; clarification: ClarificationRequest }
  | { type: "tool_start"; id: string; name: string; label: string; input: Record<string, unknown> }
  | { type: "tool_end"; id: string; name: string; ok: boolean }
  | { type: "evidence"; sources: EvidenceSource[] }
  | { type: "figure"; figure: FigurePayload }
  | { type: "video"; video: VideoPayload }
  | { type: "widget"; widget: WidgetPayload }
  | { type: "visual"; visual: VisualPayload }
  | { type: "artifact"; artifact: ArtifactPayload }
  | { type: "error"; message: string; retryable: boolean }
  | { type: "done"; sessionId?: string; costUsd?: number; metrics?: TurnMetrics };

export type EmitEvent = (event: AgentEvent) => void | Promise<void>;
