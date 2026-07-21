import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ChatStore } from "./chat-store.js";

test("stores, restores, summarizes, and deletes a complete local conversation", () => {
  const directory = mkdtempSync(join(tmpdir(), "prox-chat-store-"));
  const databasePath = join(directory, "test.sqlite");
  let store = new ChatStore(databasePath);
  try {
    const photoId = "photo-0123456789abcdef01234567";
    store.savePhoto({
      ownerId: "browser-one",
      conversationId: "chat-one",
      attachment: {
        id: photoId,
        url: `/api/photos/${photoId}`,
        mimeType: "image/jpeg",
        width: 2,
        height: 2,
        sizeBytes: 4,
        alt: "User-uploaded welder photo"
      },
      image: Buffer.from([1, 2, 3, 4])
    });
    store.saveMessage({
      ownerId: "browser-one",
      conversationId: "chat-one",
      title: "Saved setup question",
      messageId: "message-user",
      sequence: 0,
      payload: { id: "message-user", role: "user", parts: [{ type: "text", text: "How do I connect TIG?" }] }
    });
    store.saveMessage({
      ownerId: "browser-one",
      conversationId: "chat-one",
      title: "Ignored replacement title",
      sessionId: "sdk-session-one",
      messageId: "message-assistant",
      sequence: 1,
      payload: {
        id: "message-assistant",
        role: "assistant",
        toolCalls: [{ name: "lookup_polarity", input: { process: "TIG" }, status: "complete" }],
        parts: [{ type: "figure", figure: { url: "/knowledge/figures/interior-controls.png" } }]
      }
    });
    store.saveMessage({
      ownerId: "browser-one",
      conversationId: "chat-one",
      title: "Ignored replacement title",
      sessionId: "sdk-session-one",
      messageId: "message-assistant",
      sequence: 1,
      payload: { id: "message-assistant", role: "assistant", status: "done", parts: [{ type: "text", text: "Restored answer" }] }
    });

    store.close();
    store = new ChatStore(databasePath);

    const listed = store.listConversations("browser-one");
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.title, "Saved setup question");
    assert.equal(listed[0]?.messageCount, 2);

    const restored = store.getConversation("browser-one", "chat-one");
    assert.equal(restored?.sessionId, "sdk-session-one");
    assert.deepEqual(restored?.messages.map((message) => message.sequence), [0, 1]);
    assert.deepEqual(restored?.messages[1]?.payload, {
      id: "message-assistant",
      role: "assistant",
      status: "done",
      parts: [{ type: "text", text: "Restored answer" }]
    });
    const restoredPhoto = store.getPhoto(photoId);
    assert.equal(restoredPhoto?.attachment.width, 2);
    assert.deepEqual([...restoredPhoto!.image], [1, 2, 3, 4]);

    store.recordTelemetry({
      ownerId: "browser-one",
      conversationId: "chat-one",
      messageId: "message-assistant",
      conversationTitle: "Saved setup question",
      metrics: {
        status: "success", model: "claude-test", costUsd: 0.012, durationMs: 1_200,
        apiDurationMs: 900, inputTokens: 100, outputTokens: 40, cacheReadInputTokens: 20,
        cacheCreationInputTokens: 5, sdkTurns: 2, toolCalls: 1, toolErrors: 0,
        repaired: false, validationIssues: 0
      }
    });
    const telemetry = store.telemetrySummary("browser-one");
    assert.equal(telemetry.sampledTurns, 1);
    assert.equal(telemetry.totals.costUsd, 0.012);
    assert.equal(telemetry.recent[0]?.conversationTitle, "Saved setup question");

    assert.equal(store.removeConversation("browser-one", "chat-one"), true);
    assert.equal(store.getConversation("browser-one", "chat-one"), null);
    assert.equal(store.listConversations("browser-one").length, 0);
    assert.equal(store.telemetrySummary("browser-one").sampledTurns, 0);
    assert.equal(store.getPhoto(photoId), null);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
