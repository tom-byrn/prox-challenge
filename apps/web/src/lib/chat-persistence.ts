import { useCallback, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { ChatMessage } from "../types";

const OWNER_STORAGE_KEY = "arcwell-chat-owner";

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

export function useChatPersistence() {
  const convex = useConvex();
  const saveMutation = useMutation(api.chats.saveMessage);
  const [ownerId] = useState(readOwnerId);
  const [storageError, setStorageError] = useState<string>();
  const conversations = useQuery(api.chats.list, { ownerId, limit: 100 });

  const loadConversation = useCallback(async (conversationId: string) => {
    try {
      const stored = await convex.query(api.chats.get, { ownerId, conversationId });
      setStorageError(undefined);
      if (!stored) return null;
      const messages = stored.messages
        .map((message) => ({ sequence: message.sequence, payload: message.payload }))
        .filter((message): message is { sequence: number; payload: ChatMessage } => isChatMessage(message.payload));
      return {
        title: stored.conversation.title,
        sessionId: stored.conversation.sessionId,
        messages
      };
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Chat storage is unavailable.");
      throw error;
    }
  }, [convex, ownerId]);

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
      await saveMutation({ ownerId, conversationId, title, sessionId, messageId: message.id, sequence, payload: message });
      setStorageError(undefined);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "This chat could not be saved.");
    }
  }, [ownerId, saveMutation]);

  return { conversations, loadConversation, saveMessage, storageError };
}
