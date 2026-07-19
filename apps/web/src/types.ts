import type { VisualPayload } from "./visual-spec";
import type { EvidenceSource } from "./evidence";

export type FigurePayload = {
  id: string;
  title: string;
  caption: string;
  url: string;
  source: string;
  pages: number[];
};

export type WidgetPayload = {
  name: "duty_cycle" | "polarity" | "troubleshooting" | "settings_guide";
  title: string;
  data: unknown;
};

export type ArtifactPayload = {
  id: string;
  title: string;
  html: string;
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

export type PhotoAttachment = {
  id: string;
  url: string;
  mimeType: "image/jpeg";
  width: number;
  height: number;
  sizeBytes: number;
  alt: string;
};

export type ChatPart =
  | { id: string; type: "text"; text: string }
  | { id: string; type: "photo"; photo: PhotoAttachment }
  | { id: string; type: "figure"; figure: FigurePayload }
  | { id: string; type: "video"; video: VideoPayload }
  | { id: string; type: "widget"; widget: WidgetPayload }
  | { id: string; type: "visual"; visual: VisualPayload }
  | { id: string; type: "artifact"; artifact: ArtifactPayload }
  | { id: string; type: "clarification"; clarification: ClarificationRequest };

export type ToolCall = {
  id: string;
  name: string;
  label: string;
  input: Record<string, unknown>;
  status: "running" | "complete" | "error";
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  parts: ChatPart[];
  toolCalls?: ToolCall[];
  sources?: EvidenceSource[];
  startedAt?: number;
  metrics?: TurnMetrics;
  status?: "streaming" | "done" | "error";
  error?: string;
};

export type StreamEvent =
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
