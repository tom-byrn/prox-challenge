import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { config } from "dotenv";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { runAgentTurn } from "./agent.js";
import {
  ACCESS_COOKIE_MAX_AGE_SECONDS,
  ACCESS_COOKIE_NAME,
  createAccessSessionToken,
  isValidAccessPassword,
  isValidAccessSession,
  readAccessControlConfig
} from "./access-control.js";
import type { ChatStoreLike, TelemetrySummary } from "./chat-store.js";
import { getUploadedPhoto, isPhotoId, MAX_PHOTO_UPLOAD_BYTES, PhotoUploadError, storeUploadedPhoto } from "./photos.js";
import type { AgentEvent } from "./types.js";
import { getPreparedVisualAsset } from "./visual-assets.js";
import { resolveVisualAsset } from "./visuals.js";

const app = new Hono();
const rootDir = fileURLToPath(new URL("../../../", import.meta.url));
const webDist = fileURLToPath(new URL("../../web/dist/", import.meta.url));
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

type ChatStorageMode = "sqlite" | "turso" | "disabled";
type PhotoStorageMode = "local" | "disabled";

function configuredChatStorageMode(): ChatStorageMode {
  const configured = process.env.ARCWELL_CHAT_STORAGE?.trim().toLowerCase();
  if (configured === "sqlite" || configured === "turso" || configured === "disabled") return configured;
  if (!process.env.VERCEL) return "sqlite";
  return process.env.TURSO_DATABASE_URL?.trim() && process.env.TURSO_AUTH_TOKEN?.trim() ? "turso" : "disabled";
}

function configuredPhotoStorageMode(): PhotoStorageMode {
  const configured = process.env.ARCWELL_PHOTO_STORAGE?.trim().toLowerCase();
  if (configured === "local" || configured === "disabled") return configured;
  return process.env.VERCEL ? "disabled" : "local";
}

let chatStorePromise: Promise<ChatStoreLike | undefined> | undefined;

function optionalChatStore(): Promise<ChatStoreLike | undefined> {
  const mode = configuredChatStorageMode();
  if (mode === "disabled") return Promise.resolve(undefined);
  chatStorePromise ??= (mode === "turso"
    ? import("./turso-chat-store.js").then(({ getTursoChatStore }) => getTursoChatStore())
    : import("./chat-store.js").then(({ getChatStore }) => getChatStore()))
    .catch((error: unknown) => {
      console.error("Chat persistence is unavailable; continuing without saved chats.", error);
      return undefined;
    });
  return chatStorePromise;
}

function emptyTelemetrySummary(): TelemetrySummary {
  return {
    sampledTurns: 0,
    totals: {
      costUsd: 0,
      durationMs: 0,
      apiDurationMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      sdkTurns: 0,
      toolCalls: 0,
      toolErrors: 0,
      repairs: 0,
      validationIssues: 0,
      errors: 0,
      degraded: 0
    },
    averages: { costUsd: 0, durationMs: 0, apiDurationMs: 0, toolCalls: 0 },
    recent: []
  };
}

app.use("/api/*", cors({ origin: ["http://localhost:5173", "http://127.0.0.1:5173"], allowMethods: ["GET", "POST", "DELETE", "OPTIONS"] }));

const publicApiPaths = new Set(["/api/health", "/api/auth/session", "/api/auth/login"]);

app.use("/api/*", async (context, next) => {
  if (publicApiPaths.has(context.req.path)) return next();
  const access = readAccessControlConfig();
  if (!access.required) return next();
  if (!access.configured) {
    return context.json({ error: "Site access is not configured for this deployment." }, 503);
  }
  if (!isValidAccessSession(getCookie(context, ACCESS_COOKIE_NAME), access)) {
    return context.json({ error: "Authentication required." }, 401);
  }
  return next();
});

app.get("/api/auth/session", (context) => {
  const access = readAccessControlConfig();
  return context.json({
    configured: !access.required || access.configured,
    authenticated: !access.required || isValidAccessSession(getCookie(context, ACCESS_COOKIE_NAME), access)
  });
});

const AccessLogin = z.object({ password: z.string().min(1).max(256) });

app.post("/api/auth/login", async (context) => {
  const access = readAccessControlConfig();
  if (!access.required) return context.json({ authenticated: true });
  if (!access.configured) {
    return context.json({ error: "Site access is not configured for this deployment." }, 503);
  }
  const body = AccessLogin.safeParse(await context.req.json().catch(() => null));
  if (!body.success || !isValidAccessPassword(body.data.password, access)) {
    return context.json({ error: "That password is not correct." }, 401);
  }
  setCookie(context, ACCESS_COOKIE_NAME, createAccessSessionToken(access), {
    httpOnly: true,
    secure: Boolean(process.env.VERCEL),
    sameSite: "Lax",
    path: "/",
    maxAge: ACCESS_COOKIE_MAX_AGE_SECONDS
  });
  return context.json({ authenticated: true });
});

app.post("/api/auth/logout", (context) => {
  deleteCookie(context, ACCESS_COOKIE_NAME, {
    secure: Boolean(process.env.VERCEL),
    sameSite: "Lax",
    path: "/"
  });
  return context.json({ authenticated: false });
});

app.get("/api/health", (context) => context.json({
  ok: true,
  product: "Vulcan OmniPro 220",
  agentSdk: true,
  chatStorage: configuredChatStorageMode(),
  photoStorage: configuredPhotoStorageMode()
}));

const OwnerId = z.string().trim().min(1).max(100);
const ConversationId = z.string().trim().min(1).max(100);
const TelemetryMetrics = z.object({
  status: z.enum(["success", "degraded", "error"]),
  model: z.string().max(100),
  costUsd: z.number().nonnegative(),
  durationMs: z.number().nonnegative(),
  apiDurationMs: z.number().nonnegative(),
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  cacheReadInputTokens: z.number().nonnegative(),
  cacheCreationInputTokens: z.number().nonnegative(),
  sdkTurns: z.number().nonnegative(),
  toolCalls: z.number().nonnegative(),
  toolErrors: z.number().nonnegative(),
  repaired: z.boolean(),
  validationIssues: z.number().nonnegative()
});

app.get("/api/chats", async (context) => {
  const ownerId = OwnerId.safeParse(context.req.query("ownerId"));
  const limit = z.coerce.number().int().min(1).max(100).catch(100).parse(context.req.query("limit"));
  if (!ownerId.success) return context.json({ error: "A valid ownerId is required." }, 400);
  const chatStore = await optionalChatStore();
  return context.json({
    conversations: chatStore ? await chatStore.listConversations(ownerId.data, limit) : [],
    storage: chatStore?.kind ?? "disabled"
  });
});

app.get("/api/chats/:conversationId", async (context) => {
  const ownerId = OwnerId.safeParse(context.req.query("ownerId"));
  const conversationId = ConversationId.safeParse(context.req.param("conversationId"));
  if (!ownerId.success || !conversationId.success) return context.json({ error: "Valid owner and conversation ids are required." }, 400);
  const chatStore = await optionalChatStore();
  if (!chatStore) return context.json({ error: "Saved chat history is disabled in this deployment.", storage: "disabled" }, 404);
  const conversation = await chatStore.getConversation(ownerId.data, conversationId.data);
  return conversation ? context.json(conversation) : context.json({ error: "Conversation not found." }, 404);
});

const StoredMessage = z.object({
  ownerId: OwnerId,
  title: z.string().trim().min(1).max(100),
  sessionId: z.string().max(200).optional(),
  messageId: z.string().trim().min(1).max(100),
  sequence: z.number().int().nonnegative(),
  payload: z.unknown()
});

app.post("/api/chats/:conversationId/messages", async (context) => {
  const conversationId = ConversationId.safeParse(context.req.param("conversationId"));
  const body = StoredMessage.safeParse(await context.req.json().catch(() => null));
  if (!conversationId.success || !body.success) return context.json({ error: "The stored message payload is invalid." }, 400);
  const chatStore = await optionalChatStore();
  if (!chatStore) return context.json({ ok: true, persisted: false, storage: "disabled" }, 202);
  await chatStore.saveMessage({ conversationId: conversationId.data, ...body.data });
  return context.json({ ok: true, persisted: true, storage: chatStore.kind }, 201);
});

app.delete("/api/chats/:conversationId", async (context) => {
  const ownerId = OwnerId.safeParse(context.req.query("ownerId"));
  const conversationId = ConversationId.safeParse(context.req.param("conversationId"));
  if (!ownerId.success || !conversationId.success) return context.json({ error: "Valid owner and conversation ids are required." }, 400);
  const chatStore = await optionalChatStore();
  return context.json({ removed: chatStore ? await chatStore.removeConversation(ownerId.data, conversationId.data) : false, storage: chatStore?.kind ?? "disabled" });
});

const StoredTelemetry = z.object({
  ownerId: OwnerId,
  conversationId: ConversationId,
  messageId: z.string().trim().min(1).max(100),
  conversationTitle: z.string().trim().min(1).max(100),
  metrics: TelemetryMetrics
});

app.post("/api/telemetry", async (context) => {
  const body = StoredTelemetry.safeParse(await context.req.json().catch(() => null));
  if (!body.success) return context.json({ error: "The telemetry payload is invalid." }, 400);
  const chatStore = await optionalChatStore();
  if (!chatStore) return context.json({ ok: true, persisted: false, storage: "disabled" }, 202);
  await chatStore.recordTelemetry(body.data);
  return context.json({ ok: true, persisted: true, storage: chatStore.kind }, 201);
});

app.get("/api/telemetry", async (context) => {
  const ownerId = OwnerId.safeParse(context.req.query("ownerId"));
  const limit = z.coerce.number().int().min(1).max(1_000).catch(500).parse(context.req.query("limit"));
  if (!ownerId.success) return context.json({ error: "A valid ownerId is required." }, 400);
  const chatStore = await optionalChatStore();
  return context.json({
    ...(chatStore ? await chatStore.telemetrySummary(ownerId.data, limit) : emptyTelemetrySummary()),
    storage: chatStore?.kind ?? "disabled"
  });
});

app.post("/api/photos", async (context) => {
  if (configuredPhotoStorageMode() === "disabled") {
    return context.json({ error: "Photo uploads are disabled in this deployment." }, 503);
  }
  const contentLength = Number(context.req.header("content-length") ?? 0);
  if (contentLength > MAX_PHOTO_UPLOAD_BYTES + 64 * 1024) {
    return context.json({ error: "Photos must be 10 MB or smaller." }, 413);
  }
  try {
    const form = await context.req.raw.formData();
    const file = form.get("photo");
    if (!(file instanceof File)) return context.json({ error: "Attach one photo using the photo field." }, 400);
    const attachment = await storeUploadedPhoto(Buffer.from(await file.arrayBuffer()));
    return context.json({ attachment }, 201);
  } catch (error) {
    const message = error instanceof PhotoUploadError ? error.message : "The photo upload failed.";
    return context.json({ error: message }, 400);
  }
});

app.get("/api/photos/:photoId", async (context) => {
  if (configuredPhotoStorageMode() === "disabled") return context.json({ error: "Photo not found." }, 404);
  const photoId = context.req.param("photoId");
  if (!isPhotoId(photoId)) return context.json({ error: "Photo not found." }, 404);
  try {
    const photo = await getUploadedPhoto(photoId);
    return context.body(new Uint8Array(photo.image), 200, {
      "Content-Type": photo.attachment.mimeType,
      "Content-Length": String(photo.image.length),
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff"
    });
  } catch {
    return context.json({ error: "Photo not found." }, 404);
  }
});

app.get("/api/visual-assets/:assetId", async (context) => {
  const assetId = decodeURIComponent(context.req.param("assetId"));
  const prepared = getPreparedVisualAsset(assetId)
    ?? await resolveVisualAsset(assetId, assetId.startsWith("upload:") ? assetId : undefined).catch(() => undefined);
  if (!prepared) return context.json({ error: "Prepared visual asset not found." }, 404);
  return context.body(new Uint8Array(prepared.image), 200, {
    "Content-Type": "image/png",
    "Cache-Control": "private, max-age=3600"
  });
});

const ChatRequest = z.object({
  message: z.string().trim().min(1).max(8_000),
  sessionId: z.string().uuid().optional(),
  conversationId: z.string().max(100).optional(),
  photoId: z.string().refine(isPhotoId, "Invalid photo id.").optional(),
  conversationContext: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(8_000)
  })).max(12).optional()
});

app.post("/api/chat", async (context) => {
  const parsed = ChatRequest.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ error: "Send a non-empty message and, optionally, a valid session id." }, 400);
  }
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return context.json({ error: "ANTHROPIC_API_KEY is missing. Copy .env.example to .env and add your key." }, 503);
  }
  const photo = parsed.data.photoId
    ? await getUploadedPhoto(parsed.data.photoId).then((result) => result.attachment).catch(() => undefined)
    : undefined;
  if (parsed.data.photoId && !photo) {
    return context.json({ error: "That uploaded photo is no longer available. Attach it again and retry." }, 400);
  }

  return streamSSE(context, async (stream) => {
    const abortController = new AbortController();
    const turnStartedAt = Date.now();
    stream.onAbort(() => abortController.abort());
    let eventId = 0;
    const emit = async (event: AgentEvent) => {
      await stream.writeSSE({ id: String(++eventId), event: event.type, data: JSON.stringify(event) });
    };

    await emit({ type: "meta", conversationId: parsed.data.conversationId ?? crypto.randomUUID() });
    try {
      await runAgentTurn({
        message: parsed.data.message,
        sessionId: process.env.VERCEL ? undefined : parsed.data.sessionId,
        conversationContext: process.env.VERCEL ? parsed.data.conversationContext : undefined,
        photo,
        emit,
        signal: abortController.signal
      });
    } catch (error) {
      if (!abortController.signal.aborted) {
        const message = error instanceof Error ? error.message : "Unexpected agent error.";
        await emit({ type: "error", message, retryable: true });
        await emit({
          type: "done",
          metrics: {
            status: "error",
            model: process.env.CLAUDE_MODEL?.trim() || "claude-sonnet-4-6",
            costUsd: 0,
            durationMs: Date.now() - turnStartedAt,
            apiDurationMs: 0,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            sdkTurns: 0,
            toolCalls: 0,
            toolErrors: 0,
            repaired: false,
            validationIssues: 0
          }
        });
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
if (!process.env.VERCEL) {
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`Arcwell server listening on http://localhost:${info.port}`);
  });
}

export default app;
