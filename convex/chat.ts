import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { CHAT_MAX_QUOTE, CHAT_MAX_TEXT, chatPreview } from "../shared/chat";
import { chatQuote } from "./schema";

// The chat shows this many of a document's latest messages.
const LIMIT = 200;

export const list = query({
  args: { docId: v.id("docs") },
  handler: async (ctx, { docId }) => {
    const rows = (
      await ctx.db
        .query("chatMessages")
        .withIndex("by_doc", (q) => q.eq("docId", docId))
        .order("desc")
        .take(LIMIT)
    ).reverse();
    const byId = new Map(rows.map((r) => [r._id, r]));
    const out = [];
    for (const m of rows) {
      let reply: { authorId: Id<"users"> | null; preview: string; deleted: boolean } | null = null;
      if (m.replyTo) {
        // The answered message can be older than the ones shown.
        const t = byId.get(m.replyTo) ?? (await ctx.db.get(m.replyTo));
        reply = t
          ? { authorId: t.authorId, preview: t.deletedAt ? "" : chatPreview(t), deleted: !!t.deletedAt }
          : { authorId: null, preview: "", deleted: true };
      }
      out.push({
        _id: m._id,
        _creationTime: m._creationTime,
        clientId: m.clientId,
        authorId: m.authorId,
        text: m.deletedAt ? "" : m.text,
        quote: m.deletedAt ? undefined : m.quote,
        replyTo: m.replyTo,
        reply,
        deleted: !!m.deletedAt,
      });
    }
    return out;
  },
});

export const send = mutation({
  args: {
    docId: v.id("docs"),
    userId: v.id("users"),
    sessionId: v.string(),
    clientId: v.string(),
    text: v.string(),
    quote: v.optional(chatQuote),
    replyTo: v.optional(v.id("chatMessages")),
  },
  handler: async (ctx, { docId, userId, sessionId, clientId, text, quote, replyTo }) => {
    const body = text.trim();
    const passage = quote && { ...quote, text: quote.text.slice(0, CHAT_MAX_QUOTE) };
    if (!body && !passage?.text) throw new ConvexError("The message is empty");
    if (body.length > CHAT_MAX_TEXT) {
      throw new ConvexError(`Messages can be up to ${CHAT_MAX_TEXT.toLocaleString()} characters`);
    }
    if (!(await ctx.db.get(docId))) throw new ConvexError("Document not found");
    if (replyTo) {
      const target = await ctx.db.get(replyTo);
      if (!target || target.docId !== docId) throw new ConvexError("The message you replied to is gone");
    }
    await ctx.db.insert("chatMessages", {
      docId,
      authorId: userId,
      text: body,
      quote: passage?.text ? passage : undefined,
      replyTo,
      clientId,
    });
    // Sending ends "… is typing" right away rather than when it times out.
    const presence = await ctx.db
      .query("presence")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();
    if (presence?.typingAt) await ctx.db.patch(presence._id, { typingAt: undefined });
  },
});

/** Deletes one of your own messages. Undone with `restore`. */
export const remove = mutation({
  args: { messageId: v.id("chatMessages"), userId: v.id("users") },
  handler: async (ctx, { messageId, userId }) => {
    const m = await ctx.db.get(messageId);
    if (!m || m.authorId !== userId) throw new ConvexError("You can only delete your own messages");
    if (!m.deletedAt) await ctx.db.patch(messageId, { deletedAt: Date.now() });
  },
});

export const restore = mutation({
  args: { messageId: v.id("chatMessages"), userId: v.id("users") },
  handler: async (ctx, { messageId, userId }) => {
    const m = await ctx.db.get(messageId);
    if (!m || m.authorId !== userId) throw new ConvexError("You can only restore your own messages");
    await ctx.db.patch(messageId, { deletedAt: undefined });
  },
});

/** Called (throttled) while someone types in the chat box, and with `false` when they clear it. */
export const typing = mutation({
  args: { sessionId: v.string(), typing: v.boolean() },
  handler: async (ctx, { sessionId, typing }) => {
    const row = await ctx.db
      .query("presence")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();
    if (row) await ctx.db.patch(row._id, { typingAt: typing ? Date.now() : undefined });
  },
});
