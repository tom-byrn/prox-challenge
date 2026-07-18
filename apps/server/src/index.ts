import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { config } from "dotenv";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { runAgentTurn } from "./agent.js";
import type { AgentEvent } from "./types.js";

const app = new Hono();
const rootDir = fileURLToPath(new URL("../../../", import.meta.url));
const webDist = fileURLToPath(new URL("../../web/dist/", import.meta.url));
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

app.use("/api/*", cors({ origin: ["http://localhost:5173", "http://127.0.0.1:5173"], allowMethods: ["GET", "POST", "OPTIONS"] }));

app.get("/api/health", (context) => context.json({ ok: true, product: "Vulcan OmniPro 220", agentSdk: true }));

const ChatRequest = z.object({
  message: z.string().trim().min(1).max(8_000),
  sessionId: z.string().uuid().optional(),
  conversationId: z.string().max(100).optional()
});

app.post("/api/chat", async (context) => {
  const parsed = ChatRequest.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ error: "Send a non-empty message and, optionally, a valid session id." }, 400);
  }
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return context.json({ error: "ANTHROPIC_API_KEY is missing. Copy .env.example to .env and add your key." }, 503);
  }

  return streamSSE(context, async (stream) => {
    const abortController = new AbortController();
    stream.onAbort(() => abortController.abort());
    let eventId = 0;
    const emit = async (event: AgentEvent) => {
      await stream.writeSSE({ id: String(++eventId), event: event.type, data: JSON.stringify(event) });
    };

    await emit({ type: "meta", conversationId: parsed.data.conversationId ?? crypto.randomUUID() });
    try {
      await runAgentTurn({
        message: parsed.data.message,
        sessionId: parsed.data.sessionId,
        emit,
        signal: abortController.signal
      });
    } catch (error) {
      if (!abortController.signal.aborted) {
        const message = error instanceof Error ? error.message : "Unexpected agent error.";
        await emit({ type: "error", message, retryable: true });
        await emit({ type: "done" });
      }
    }
  });
});

app.use("/knowledge/*", serveStatic({ root: rootDir }));
app.use("/files/*", serveStatic({ root: rootDir }));

if (existsSync(webDist)) {
  app.use("/*", serveStatic({ root: webDist }));
  app.get("/*", serveStatic({ path: `${webDist}/index.html` }));
}

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Arcwell server listening on http://localhost:${info.port}`);
});
