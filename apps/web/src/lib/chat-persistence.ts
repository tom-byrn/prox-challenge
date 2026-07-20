import { useCallback, useEffect, useState } from "react";
import type { ChatMessage, TurnMetrics } from "../types";

const OWNER_STORAGE_KEY = "arcwell-chat-owner";

export type ConversationSummary = {
  conversationId: string;
  title: string;
  sessionId?: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
};

export type TelemetrySummary = {
  storage?: "sqlite" | "turso" | "disabled";
  sampledTurns: number;
  totals: {
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
    repairs: number;
    validationIssues: number;
    errors: number;
    degraded: number;
  };
  averages: { costUsd: number; durationMs: number; apiDurationMs: number; toolCalls: number };
  recent: Array<{
    id: string;
    conversationId: string;
    conversationTitle: string;
    status: TurnMetrics["status"];
    model: string;
    costUsd: number;
    durationMs: number;
    toolCalls: number;
    toolErrors: number;
    repaired: boolean;
    validationIssues: number;
    createdAt: number;
  }>;
};

function readOwnerId(): string {
  const existing = window.localStorage.getItem(OWNER_STORAGE_KEY);
  if (existing) return existing;
  const ownerId = crypto.randomUUID();
  window.localStorage.setItem(OWNER_STORAGE_KEY, ownerId);
  return ownerId;
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<ChatMessage>;
  return typeof message.id === "string"
    && (message.role === "user" || message.role === "assistant")
    && Array.isArray(message.parts);
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(body?.error || `Local storage request failed (${response.status}).`);
  return body as T;
}

export async function loadTelemetrySummary(ownerId: string, signal?: AbortSignal): Promise<TelemetrySummary> {
  const query = new URLSearchParams({ ownerId, limit: "500" });
  return responseJson<TelemetrySummary>(await fetch(`/api/telemetry?${query}`, { signal }));
}

export function useChatPersistence() {
  const [ownerId] = useState(readOwnerId);
  const [conversations, setConversations] = useState<ConversationSummary[]>();
  const [persistenceAvailable, setPersistenceAvailable] = useState<boolean>();
  const [storageError, setStorageError] = useState<string>();

  const refreshConversations = useCallback(async (signal?: AbortSignal) => {
    try {
      const query = new URLSearchParams({ ownerId, limit: "100" });
      const result = await responseJson<{ conversations: ConversationSummary[]; storage?: "sqlite" | "turso" | "disabled" }>(await fetch(`/api/chats?${query}`, { signal }));
      setConversations(result.conversations);
      setPersistenceAvailable(result.storage !== "disabled");
      setStorageError(undefined);
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      setConversations([]);
      setPersistenceAvailable(false);
      setStorageError(error instanceof Error ? error.message : "Chat storage is unavailable.");
    }
  }, [ownerId]);

  useEffect(() => {
    const controller = new AbortController();
    void refreshConversations(controller.signal);
    return () => controller.abort();
  }, [refreshConversations]);

  const loadConversation = useCallback(async (conversationId: string) => {
    try {
      const query = new URLSearchParams({ ownerId });
      const response = await fetch(`/api/chats/${encodeURIComponent(conversationId)}?${query}`);
      if (response.status === 404) return null;
      const stored = await responseJson<ConversationSummary & { messages: Array<{ sequence: number; payload: unknown }> }>(response);
      setStorageError(undefined);
      const messages = stored.messages
        .filter((message): message is { sequence: number; payload: ChatMessage } => isChatMessage(message.payload));
      return { title: stored.title, sessionId: stored.sessionId, messages };
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Local chat storage is unavailable.");
      throw error;
    }
  }, [ownerId]);

  const saveMessage = useCallback(async ({
    conversationId,
    title,
    sessionId,
    sequence,
    message
  }: {
    conversationId: string;
    title: string;
    sessionId?: string;
    sequence: number;
    message: ChatMessage;
  }) => {
    try {
      const result = await responseJson<{ persisted?: boolean; storage?: "sqlite" | "turso" | "disabled" }>(await fetch(`/api/chats/${encodeURIComponent(conversationId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerId, title, sessionId, messageId: message.id, sequence, payload: message })
      }));
      if (result.storage === "disabled" || result.persisted === false) {
        setPersistenceAvailable(false);
        setStorageError(undefined);
        return;
      }
      setPersistenceAvailable(true);
      setStorageError(undefined);
      await refreshConversations();
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "This chat could not be saved.");
    }
  }, [ownerId, refreshConversations]);

  const removeConversation = useCallback(async (conversationId: string) => {
    try {
      const query = new URLSearchParams({ ownerId });
      const result = await responseJson<{ removed: boolean; storage?: "sqlite" | "turso" | "disabled" }>(await fetch(`/api/chats/${encodeURIComponent(conversationId)}?${query}`, { method: "DELETE" }));
      if (result.storage === "disabled") setPersistenceAvailable(false);
      setStorageError(undefined);
      await refreshConversations();
      return result.removed;
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "This chat could not be deleted.");
      return false;
    }
  }, [ownerId, refreshConversations]);

  const recordTelemetry = useCallback(async ({
    conversationId,
    messageId,
    conversationTitle,
    metrics
  }: {
    conversationId: string;
    messageId: string;
    conversationTitle: string;
    metrics: TurnMetrics;
  }) => {
    try {
      const result = await responseJson<{ persisted?: boolean; storage?: "sqlite" | "turso" | "disabled" }>(await fetch("/api/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerId, conversationId, messageId, conversationTitle, metrics })
      }));
      if (result.storage === "disabled" || result.persisted === false) setPersistenceAvailable(false);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Telemetry could not be saved locally.");
    }
  }, [ownerId]);

  return { conversations, loadConversation, ownerId, persistenceAvailable, recordTelemetry, removeConversation, saveMessage, storageError };
}
