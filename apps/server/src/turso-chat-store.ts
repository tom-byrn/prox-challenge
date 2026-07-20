import { createClient, type Client, type InValue } from "@tursodatabase/serverless/compat";
import {
  conversationFromRow,
  telemetrySummaryFromRows,
  type ChatStoreLike,
  type ConversationRow,
  type MessageRow,
  type RecordTelemetryInput,
  type SaveMessageInput,
  type StoredConversation,
  type TelemetryRow,
  type TelemetrySummary
} from "./chat-store.js";
import { CHAT_STORE_SCHEMA } from "./chat-store-schema.js";

type DatabaseRow = Record<string, InValue>;

function text(row: DatabaseRow, key: string): string {
  return String(row[key] ?? "");
}

function nullableText(row: DatabaseRow, key: string): string | null {
  const value = row[key];
  return value === null || value === undefined ? null : String(value);
}

function number(row: DatabaseRow, key: string): number {
  return Number(row[key] ?? 0);
}

function conversationRow(row: DatabaseRow): ConversationRow {
  return {
    conversation_id: text(row, "conversation_id"),
    title: text(row, "title"),
    session_id: nullableText(row, "session_id"),
    message_count: number(row, "message_count"),
    created_at: number(row, "created_at"),
    updated_at: number(row, "updated_at")
  };
}

function telemetryRow(row: DatabaseRow): TelemetryRow {
  return {
    id: number(row, "id"),
    conversation_id: text(row, "conversation_id"),
    conversation_title: text(row, "conversation_title"),
    status: text(row, "status") as TelemetryRow["status"],
    model: text(row, "model"),
    cost_usd: number(row, "cost_usd"),
    duration_ms: number(row, "duration_ms"),
    api_duration_ms: number(row, "api_duration_ms"),
    input_tokens: number(row, "input_tokens"),
    output_tokens: number(row, "output_tokens"),
    cache_read_input_tokens: number(row, "cache_read_input_tokens"),
    cache_creation_input_tokens: number(row, "cache_creation_input_tokens"),
    sdk_turns: number(row, "sdk_turns"),
    tool_calls: number(row, "tool_calls"),
    tool_errors: number(row, "tool_errors"),
    repaired: number(row, "repaired"),
    validation_issues: number(row, "validation_issues"),
    created_at: number(row, "created_at")
  };
}

export class TursoChatStore implements ChatStoreLike {
  readonly kind = "turso" as const;
  private readonly ready: Promise<void>;

  constructor(private readonly client: Client) {
    this.ready = client.executeMultiple(CHAT_STORE_SCHEMA);
  }

  async initialize(): Promise<void> {
    await this.ready;
  }

  async listConversations(ownerId: string, limit = 100) {
    await this.ready;
    const boundedLimit = Math.max(1, Math.min(limit, 100));
    const result = await this.client.execute({
      sql: `
        SELECT conversation_id, title, session_id, message_count, created_at, updated_at
        FROM conversations
        WHERE owner_id = ?
        ORDER BY updated_at DESC
        LIMIT ?
      `,
      args: [ownerId, boundedLimit]
    });
    return result.rows.map((row) => conversationFromRow(conversationRow(row as DatabaseRow)));
  }

  async getConversation(ownerId: string, conversationId: string): Promise<StoredConversation | null> {
    await this.ready;
    const [conversationResult, messageResult] = await this.client.batch([
      {
        sql: `
          SELECT conversation_id, title, session_id, message_count, created_at, updated_at
          FROM conversations
          WHERE owner_id = ? AND conversation_id = ?
        `,
        args: [ownerId, conversationId]
      },
      {
        sql: `
          SELECT sequence, payload_json
          FROM messages
          WHERE owner_id = ? AND conversation_id = ?
          ORDER BY sequence ASC
        `,
        args: [ownerId, conversationId]
      }
    ], "read");
    const rawConversation = conversationResult?.rows[0] as DatabaseRow | undefined;
    if (!rawConversation) return null;
    const messages = (messageResult?.rows ?? []).map((row) => ({
      sequence: number(row as DatabaseRow, "sequence"),
      payload_json: text(row as DatabaseRow, "payload_json")
    } satisfies MessageRow));
    return {
      ...conversationFromRow(conversationRow(rawConversation)),
      messages: messages.map((message) => ({
        sequence: message.sequence,
        payload: JSON.parse(message.payload_json) as unknown
      }))
    };
  }

  async saveMessage(input: SaveMessageInput): Promise<void> {
    await this.ready;
    const now = Date.now();
    await this.client.batch([
      {
        sql: `
          INSERT INTO conversations (
            owner_id, conversation_id, title, session_id, message_count, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (owner_id, conversation_id) DO UPDATE SET
            session_id = COALESCE(excluded.session_id, conversations.session_id),
            message_count = MAX(conversations.message_count, excluded.message_count),
            updated_at = excluded.updated_at
        `,
        args: [
          input.ownerId, input.conversationId, input.title, input.sessionId ?? null,
          input.sequence + 1, now, now
        ]
      },
      {
        sql: `
          INSERT INTO messages (
            owner_id, conversation_id, message_id, sequence, payload_json, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (owner_id, conversation_id, message_id) DO UPDATE SET
            sequence = excluded.sequence,
            payload_json = excluded.payload_json,
            updated_at = excluded.updated_at
        `,
        args: [
          input.ownerId, input.conversationId, input.messageId, input.sequence,
          JSON.stringify(input.payload), now
        ]
      }
    ], "write");
  }

  async removeConversation(ownerId: string, conversationId: string): Promise<boolean> {
    await this.ready;
    const results = await this.client.batch([
      { sql: "DELETE FROM telemetry WHERE owner_id = ? AND conversation_id = ?", args: [ownerId, conversationId] },
      { sql: "DELETE FROM messages WHERE owner_id = ? AND conversation_id = ?", args: [ownerId, conversationId] },
      { sql: "DELETE FROM conversations WHERE owner_id = ? AND conversation_id = ?", args: [ownerId, conversationId] }
    ], "write");
    return (results[2]?.rowsAffected ?? 0) > 0;
  }

  async recordTelemetry(input: RecordTelemetryInput): Promise<void> {
    await this.ready;
    const now = Date.now();
    const metrics = input.metrics;
    await this.client.execute({
      sql: `
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
      `,
      args: [
        input.ownerId, input.conversationId, input.messageId, input.conversationTitle,
        metrics.status, metrics.model, metrics.costUsd, metrics.durationMs, metrics.apiDurationMs,
        metrics.inputTokens, metrics.outputTokens, metrics.cacheReadInputTokens,
        metrics.cacheCreationInputTokens, metrics.sdkTurns, metrics.toolCalls, metrics.toolErrors,
        metrics.repaired ? 1 : 0, metrics.validationIssues, now, now
      ]
    });
  }

  async telemetrySummary(ownerId: string, limit = 500): Promise<TelemetrySummary> {
    await this.ready;
    const boundedLimit = Math.max(1, Math.min(limit, 1_000));
    const result = await this.client.execute({
      sql: `
        SELECT * FROM telemetry
        WHERE owner_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `,
      args: [ownerId, boundedLimit]
    });
    return telemetrySummaryFromRows(result.rows.map((row) => telemetryRow(row as DatabaseRow)));
  }

  close(): void {
    this.client.close();
  }
}

let storePromise: Promise<TursoChatStore> | undefined;

export function getTursoChatStore(): Promise<TursoChatStore> {
  storePromise ??= Promise.resolve().then(async () => {
    const url = process.env.TURSO_DATABASE_URL?.trim();
    const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
    if (!url || !authToken) {
      throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required for Turso chat storage.");
    }
    const store = new TursoChatStore(createClient({ url, authToken }));
    await store.initialize();
    return store;
  });
  return storePromise;
}
