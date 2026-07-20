import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { CHAT_STORE_SCHEMA } from "./chat-store-schema.js";
import type { TurnMetrics } from "./types.js";

type Awaitable<T> = T | Promise<T>;

export type SaveMessageInput = {
  ownerId: string;
  conversationId: string;
  title: string;
  sessionId?: string;
  messageId: string;
  sequence: number;
  payload: unknown;
};

export type RecordTelemetryInput = {
  ownerId: string;
  conversationId: string;
  messageId: string;
  conversationTitle: string;
  metrics: TurnMetrics;
};

export interface ChatStoreLike {
  readonly kind: "sqlite" | "turso";
  listConversations(ownerId: string, limit?: number): Awaitable<ConversationSummary[]>;
  getConversation(ownerId: string, conversationId: string): Awaitable<StoredConversation | null>;
  saveMessage(input: SaveMessageInput): Awaitable<void>;
  removeConversation(ownerId: string, conversationId: string): Awaitable<boolean>;
  recordTelemetry(input: RecordTelemetryInput): Awaitable<void>;
  telemetrySummary(ownerId: string, limit?: number): Awaitable<TelemetrySummary>;
  close(): Awaitable<void>;
}

export type ConversationSummary = {
  conversationId: string;
  title: string;
  sessionId?: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
};

export type StoredConversation = ConversationSummary & {
  messages: Array<{ sequence: number; payload: unknown }>;
};

export type TelemetrySummary = {
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

export type ConversationRow = {
  conversation_id: string;
  title: string;
  session_id: string | null;
  message_count: number;
  created_at: number;
  updated_at: number;
};

export type MessageRow = { sequence: number; payload_json: string };
export type TelemetryRow = {
  id: number;
  conversation_id: string;
  conversation_title: string;
  status: TurnMetrics["status"];
  model: string;
  cost_usd: number;
  duration_ms: number;
  api_duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  sdk_turns: number;
  tool_calls: number;
  tool_errors: number;
  repaired: number;
  validation_issues: number;
  created_at: number;
};

function defaultDatabasePath(): string {
  return process.env.ARCWELL_DB_PATH?.trim()
    || fileURLToPath(new URL("../../../.arcwell/arcwell.sqlite", import.meta.url));
}

export function conversationFromRow(row: ConversationRow): ConversationSummary {
  return {
    conversationId: row.conversation_id,
    title: row.title,
    ...(row.session_id ? { sessionId: row.session_id } : {}),
    messageCount: row.message_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function telemetrySummaryFromRows(events: TelemetryRow[]): TelemetrySummary {
  const totals = events.reduce((summary, event) => {
    summary.costUsd += event.cost_usd;
    summary.durationMs += event.duration_ms;
    summary.apiDurationMs += event.api_duration_ms;
    summary.inputTokens += event.input_tokens;
    summary.outputTokens += event.output_tokens;
    summary.cacheReadInputTokens += event.cache_read_input_tokens;
    summary.cacheCreationInputTokens += event.cache_creation_input_tokens;
    summary.sdkTurns += event.sdk_turns;
    summary.toolCalls += event.tool_calls;
    summary.toolErrors += event.tool_errors;
    summary.repairs += event.repaired ? 1 : 0;
    summary.validationIssues += event.validation_issues;
    summary.errors += event.status === "error" ? 1 : 0;
    summary.degraded += event.status === "degraded" ? 1 : 0;
    return summary;
  }, {
    costUsd: 0, durationMs: 0, apiDurationMs: 0, inputTokens: 0, outputTokens: 0,
    cacheReadInputTokens: 0, cacheCreationInputTokens: 0, sdkTurns: 0, toolCalls: 0,
    toolErrors: 0, repairs: 0, validationIssues: 0, errors: 0, degraded: 0
  });
  const count = events.length;
  return {
    sampledTurns: count,
    totals,
    averages: {
      costUsd: count ? totals.costUsd / count : 0,
      durationMs: count ? totals.durationMs / count : 0,
      apiDurationMs: count ? totals.apiDurationMs / count : 0,
      toolCalls: count ? totals.toolCalls / count : 0
    },
    recent: events.slice(0, 12).map((event) => ({
      id: String(event.id),
      conversationId: event.conversation_id,
      conversationTitle: event.conversation_title,
      status: event.status,
      model: event.model,
      costUsd: event.cost_usd,
      durationMs: event.duration_ms,
      toolCalls: event.tool_calls,
      toolErrors: event.tool_errors,
      repaired: Boolean(event.repaired),
      validationIssues: event.validation_issues,
      createdAt: event.created_at
    }))
  };
}

export class ChatStore implements ChatStoreLike {
  readonly kind = "sqlite" as const;
  private readonly database: Database.Database;

  constructor(filePath = defaultDatabasePath()) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.database = new Database(filePath);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("foreign_keys = ON");
    this.database.exec(CHAT_STORE_SCHEMA);
  }

  listConversations(ownerId: string, limit = 100): ConversationSummary[] {
    const boundedLimit = Math.max(1, Math.min(limit, 100));
    const rows = this.database.prepare(`
      SELECT conversation_id, title, session_id, message_count, created_at, updated_at
      FROM conversations
      WHERE owner_id = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(ownerId, boundedLimit) as ConversationRow[];
    return rows.map(conversationFromRow);
  }

  getConversation(ownerId: string, conversationId: string): StoredConversation | null {
    const row = this.database.prepare(`
      SELECT conversation_id, title, session_id, message_count, created_at, updated_at
      FROM conversations
      WHERE owner_id = ? AND conversation_id = ?
    `).get(ownerId, conversationId) as ConversationRow | undefined;
    if (!row) return null;

    const messages = this.database.prepare(`
      SELECT sequence, payload_json
      FROM messages
      WHERE owner_id = ? AND conversation_id = ?
      ORDER BY sequence ASC
    `).all(ownerId, conversationId) as MessageRow[];
    return {
      ...conversationFromRow(row),
      messages: messages.map((message) => ({ sequence: message.sequence, payload: JSON.parse(message.payload_json) as unknown }))
    };
  }

  saveMessage(input: SaveMessageInput): void {
    const now = Date.now();
    this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO conversations (
          owner_id, conversation_id, title, session_id, message_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (owner_id, conversation_id) DO UPDATE SET
          session_id = COALESCE(excluded.session_id, conversations.session_id),
          message_count = MAX(conversations.message_count, excluded.message_count),
          updated_at = excluded.updated_at
      `).run(
        input.ownerId,
        input.conversationId,
        input.title,
        input.sessionId ?? null,
        input.sequence + 1,
        now,
        now
      );
      this.database.prepare(`
        INSERT INTO messages (
          owner_id, conversation_id, message_id, sequence, payload_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (owner_id, conversation_id, message_id) DO UPDATE SET
          sequence = excluded.sequence,
          payload_json = excluded.payload_json,
          updated_at = excluded.updated_at
      `).run(
        input.ownerId,
        input.conversationId,
        input.messageId,
        input.sequence,
        JSON.stringify(input.payload),
        now
      );
    })();
  }

  removeConversation(ownerId: string, conversationId: string): boolean {
    return this.database.transaction(() => {
      this.database.prepare("DELETE FROM telemetry WHERE owner_id = ? AND conversation_id = ?").run(ownerId, conversationId);
      const result = this.database.prepare("DELETE FROM conversations WHERE owner_id = ? AND conversation_id = ?").run(ownerId, conversationId);
      return result.changes > 0;
    })();
  }

  recordTelemetry(input: RecordTelemetryInput): void {
    const now = Date.now();
    const metrics = input.metrics;
    this.database.prepare(`
      INSERT INTO telemetry (
        owner_id, conversation_id, message_id, conversation_title, status, model,
        cost_usd, duration_ms, api_duration_ms, input_tokens, output_tokens,
        cache_read_input_tokens, cache_creation_input_tokens, sdk_turns, tool_calls,
        tool_errors, repaired, validation_issues, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (owner_id, message_id) DO UPDATE SET
        conversation_id = excluded.conversation_id,
        conversation_title = excluded.conversation_title,
        status = excluded.status,
        model = excluded.model,
        cost_usd = excluded.cost_usd,
        duration_ms = excluded.duration_ms,
        api_duration_ms = excluded.api_duration_ms,
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        cache_read_input_tokens = excluded.cache_read_input_tokens,
        cache_creation_input_tokens = excluded.cache_creation_input_tokens,
        sdk_turns = excluded.sdk_turns,
        tool_calls = excluded.tool_calls,
        tool_errors = excluded.tool_errors,
        repaired = excluded.repaired,
        validation_issues = excluded.validation_issues,
        updated_at = excluded.updated_at
    `).run(
      input.ownerId, input.conversationId, input.messageId, input.conversationTitle,
      metrics.status, metrics.model, metrics.costUsd, metrics.durationMs, metrics.apiDurationMs,
      metrics.inputTokens, metrics.outputTokens, metrics.cacheReadInputTokens,
      metrics.cacheCreationInputTokens, metrics.sdkTurns, metrics.toolCalls, metrics.toolErrors,
      metrics.repaired ? 1 : 0, metrics.validationIssues, now, now
    );
  }

  telemetrySummary(ownerId: string, limit = 500): TelemetrySummary {
    const boundedLimit = Math.max(1, Math.min(limit, 1_000));
    const events = this.database.prepare(`
      SELECT * FROM telemetry
      WHERE owner_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(ownerId, boundedLimit) as TelemetryRow[];
    return telemetrySummaryFromRows(events);
  }

  close(): void {
    this.database.close();
  }
}

let store: ChatStore | undefined;

export function getChatStore(): ChatStore {
  store ??= new ChatStore();
  return store;
}
