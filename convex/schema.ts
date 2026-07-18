import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  conversations: defineTable({
    ownerId: v.string(),
    conversationId: v.string(),
    title: v.string(),
    sessionId: v.optional(v.string()),
    messageCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_owner_conversation", ["ownerId", "conversationId"])
    .index("by_owner_updated", ["ownerId", "updatedAt"]),

  messages: defineTable({
    ownerId: v.string(),
    conversationId: v.string(),
    messageId: v.string(),
    sequence: v.number(),
    payload: v.any(),
    updatedAt: v.number()
  })
    .index("by_owner_conversation_sequence", ["ownerId", "conversationId", "sequence"])
    .index("by_owner_conversation_message", ["ownerId", "conversationId", "messageId"])
});
