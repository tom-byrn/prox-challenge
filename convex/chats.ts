import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const conversationArgs = {
  ownerId: v.string(),
  conversationId: v.string()
};

export const get = query({
  args: conversationArgs,
  handler: async (ctx, args) => {
    const conversation = await ctx.db
      .query("conversations")
      .withIndex("by_owner_conversation", (q) => q.eq("ownerId", args.ownerId).eq("conversationId", args.conversationId))
      .unique();
    if (!conversation) return null;

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_owner_conversation_sequence", (q) => q.eq("ownerId", args.ownerId).eq("conversationId", args.conversationId))
      .collect();

    return { conversation, messages };
  }
});

export const list = query({
  args: { ownerId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? 50, 100));
    return ctx.db
      .query("conversations")
      .withIndex("by_owner_updated", (q) => q.eq("ownerId", args.ownerId))
      .order("desc")
      .take(limit);
  }
});

export const saveMessage = mutation({
  args: {
    ...conversationArgs,
    title: v.string(),
    sessionId: v.optional(v.string()),
    messageId: v.string(),
    sequence: v.number(),
    payload: v.any()
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const conversation = await ctx.db
      .query("conversations")
      .withIndex("by_owner_conversation", (q) => q.eq("ownerId", args.ownerId).eq("conversationId", args.conversationId))
      .unique();

    if (conversation) {
      const update: { updatedAt: number; messageCount: number; sessionId?: string } = {
        updatedAt: now,
        messageCount: Math.max(conversation.messageCount, args.sequence + 1)
      };
      if (args.sessionId !== undefined) update.sessionId = args.sessionId;
      await ctx.db.patch(conversation._id, update);
    } else {
      await ctx.db.insert("conversations", {
        ownerId: args.ownerId,
        conversationId: args.conversationId,
        title: args.title,
        ...(args.sessionId === undefined ? {} : { sessionId: args.sessionId }),
        messageCount: args.sequence + 1,
        createdAt: now,
        updatedAt: now
      });
    }

    const message = await ctx.db
      .query("messages")
      .withIndex("by_owner_conversation_message", (q) => q.eq("ownerId", args.ownerId).eq("conversationId", args.conversationId).eq("messageId", args.messageId))
      .unique();

    if (message) {
      await ctx.db.patch(message._id, { sequence: args.sequence, payload: args.payload, updatedAt: now });
      return message._id;
    }

    return ctx.db.insert("messages", {
      ownerId: args.ownerId,
      conversationId: args.conversationId,
      messageId: args.messageId,
      sequence: args.sequence,
      payload: args.payload,
      updatedAt: now
    });
  }
});

export const remove = mutation({
  args: conversationArgs,
  handler: async (ctx, args) => {
    const conversation = await ctx.db
      .query("conversations")
      .withIndex("by_owner_conversation", (q) => q.eq("ownerId", args.ownerId).eq("conversationId", args.conversationId))
      .unique();
    if (!conversation) return false;

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_owner_conversation_sequence", (q) => q.eq("ownerId", args.ownerId).eq("conversationId", args.conversationId))
      .collect();
    await Promise.all(messages.map((message) => ctx.db.delete(message._id)));
    await ctx.db.delete(conversation._id);
    return true;
  }
});
