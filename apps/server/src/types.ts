import type { VisualPayload } from "./visual-spec.js";
import type { EvidenceSource } from "./evidence.js";

export type Process = "MIG" | "FLUX_CORED" | "TIG" | "STICK";

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
  | { type: "done"; sessionId?: string; costUsd?: number };

export type EmitEvent = (event: AgentEvent) => void | Promise<void>;
