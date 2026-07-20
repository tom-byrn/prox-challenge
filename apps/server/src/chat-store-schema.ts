export const CHAT_STORE_SCHEMA = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS conversations (
    owner_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    title TEXT NOT NULL,
    session_id TEXT,
    message_count INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (owner_id, conversation_id)
  );
  CREATE INDEX IF NOT EXISTS conversations_owner_updated
    ON conversations (owner_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS messages (
    owner_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (owner_id, conversation_id, message_id),
    FOREIGN KEY (owner_id, conversation_id)
      REFERENCES conversations (owner_id, conversation_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS messages_owner_conversation_sequence
    ON messages (owner_id, conversation_id, sequence);

  CREATE TABLE IF NOT EXISTS telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    conversation_title TEXT NOT NULL,
    status TEXT NOT NULL,
    model TEXT NOT NULL,
    cost_usd REAL NOT NULL,
    duration_ms INTEGER NOT NULL,
    api_duration_ms INTEGER NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cache_read_input_tokens INTEGER NOT NULL,
    cache_creation_input_tokens INTEGER NOT NULL,
    sdk_turns INTEGER NOT NULL,
    tool_calls INTEGER NOT NULL,
    tool_errors INTEGER NOT NULL,
    repaired INTEGER NOT NULL,
    validation_issues INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (owner_id, message_id)
  );
  CREATE INDEX IF NOT EXISTS telemetry_owner_created
    ON telemetry (owner_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS telemetry_owner_conversation
    ON telemetry (owner_id, conversation_id);
`;
