import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";

const ONLINE_MS = 30_000;

export const heartbeat = mutation({
  args: {
    docId: v.id("docs"),
    sessionId: v.string(),
    userId: v.id("users"),
    cursor: v.optional(v.object({ anchor: v.number(), head: v.number() })),
  },
  handler: async (ctx, { docId, sessionId, userId, cursor }) => {
    const existing = await ctx.db
      .query("presence")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();
    const row = { docId, sessionId, userId, cursor, lastSeen: Date.now() };
    // Patch rather than replace so "… is typing" in the chat survives the
    // beat, unless this tab has moved to another document.
    if (existing) {
      await ctx.db.patch(existing._id, existing.docId === docId ? row : { ...row, typingAt: undefined });
    } else await ctx.db.insert("presence", row);
  },
});

export const leave = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const rows = await ctx.db
      .query("presence")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
  },
});

/** Everyone currently online, with the document they have open. */
export const online = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("presence")
      .withIndex("by_lastSeen", (q) => q.gt("lastSeen", Date.now() - ONLINE_MS))
      .collect();
    const out = [];
    for (const row of rows) {
      const user = await ctx.db.get(row.userId);
      if (!user) continue;
      out.push({
        sessionId: row.sessionId,
        docId: row.docId,
        userId: row.userId,
        name: user.name,
        color: user.color,
        cursor: row.cursor,
        typingAt: row.typingAt,
        lastSeen: row.lastSeen,
      });
    }
    return out;
  },
});

export const cleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stale = await ctx.db
      .query("presence")
      .withIndex("by_lastSeen", (q) => q.lt("lastSeen", Date.now() - 10 * 60_000))
      .collect();
    for (const row of stale) await ctx.db.delete(row._id);
  },
});
