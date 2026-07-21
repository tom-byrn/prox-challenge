import type { StreamEvent } from "../types";
import type { ArtifactPayload } from "../artifacts";

type ChatRequest = {
  message: string;
  sessionId?: string;
  conversationContext?: Array<{ role: "user" | "assistant"; content: string }>;
  artifacts?: Array<Omit<ArtifactPayload, "id">>;
  conversationId: string;
  photoId?: string;
  signal: AbortSignal;
  onEvent: (event: StreamEvent) => void;
};

function parseEventBlock(block: string): StreamEvent | undefined {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return undefined;
  return JSON.parse(data) as StreamEvent;
}

export async function streamChat({ message, sessionId, conversationContext, artifacts, conversationId, photoId, signal, onEvent }: ChatRequest) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ message, sessionId, conversationContext, artifacts, conversationId, photoId }),
    signal
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: `Request failed (${response.status})` })) as { error?: string };
    throw new Error(payload.error ?? `Request failed (${response.status})`);
  }
  if (!response.body) throw new Error("The server returned an empty stream.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let receivedDone = false;
  const dispatch = (event: StreamEvent) => {
    if (event.type === "done") receivedDone = true;
    onEvent(event);
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = parseEventBlock(block);
      if (event) dispatch(event);
      boundary = buffer.indexOf("\n\n");
    }
    if (done) break;
  }

  const finalEvent = parseEventBlock(buffer);
  if (finalEvent) dispatch(finalEvent);
  if (!receivedDone && !signal.aborted) {
    throw new Error("The response stream ended before completion. Please retry.");
  }
}
