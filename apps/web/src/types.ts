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

export type ChatPart =
  | { id: string; type: "text"; text: string }
  | { id: string; type: "figure"; figure: FigurePayload }
  | { id: string; type: "widget"; widget: WidgetPayload }
  | { id: string; type: "artifact"; artifact: ArtifactPayload };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  parts: ChatPart[];
  activeTools?: Array<{ id: string; label: string }>;
  status?: "streaming" | "done" | "error";
  error?: string;
};

export type StreamEvent =
  | { type: "meta"; conversationId: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; id: string; name: string; label: string }
  | { type: "tool_end"; id: string; name: string; ok: boolean }
  | { type: "figure"; figure: FigurePayload }
  | { type: "widget"; widget: WidgetPayload }
  | { type: "artifact"; artifact: ArtifactPayload }
  | { type: "error"; message: string; retryable: boolean }
  | { type: "done"; sessionId?: string; costUsd?: number };
