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

export type AgentEvent =
  | { type: "meta"; conversationId: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; id: string; name: string; label: string }
  | { type: "tool_end"; id: string; name: string; ok: boolean }
  | { type: "figure"; figure: FigurePayload }
  | { type: "widget"; widget: WidgetPayload }
  | { type: "artifact"; artifact: ArtifactPayload }
  | { type: "error"; message: string; retryable: boolean }
  | { type: "done"; sessionId?: string; costUsd?: number };

export type EmitEvent = (event: AgentEvent) => void | Promise<void>;
