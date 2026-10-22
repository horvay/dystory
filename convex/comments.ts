import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { shape } from "./schema";
import { recordFeedback } from "./feedback";

export const forVersion = query({
  args: { versionId: v.id("versions") },
  handler: async (ctx, { versionId }) =>
    ctx.db
      .query("comments")
      .withIndex("by_version", (q) => q.eq("versionId", versionId))
      .collect(),
});

const clean = (body: string) => body.trim().slice(0, 5000);

export const add = mutation({
  args: {
    versionId: v.id("versions"),
    authorId: v.id("users"),
    body: v.string(),
    time: v.number(),
    endTime: v.optional(v.number()),
    drawing: v.optional(v.array(shape)),
  },
  handler: async (ctx, { versionId, authorId, body, time, endTime, drawing }) => {
    const version = await ctx.db.get(versionId);
    if (!version) throw new Error("Version not found");
    if (!clean(body) && !drawing?.length) throw new Error("Empty comment");
    const start = Math.max(0, time);
    const id = await ctx.db.insert("comments", {
      videoId: version.videoId,
      versionId,
      authorId,
      body: clean(body),
      time: start,
      endTime: endTime !== undefined && endTime > start ? endTime : undefined,
      drawing: drawing?.length ? drawing : undefined,
      resolved: false,
    });
    await ctx.db.patch(version.videoId, { updatedAt: Date.now() });
    await recordFeedback(ctx, version.videoId, "comment", id, authorId);
    return id;
  },
});

export const reply = mutation({
  args: { parentId: v.id("comments"), authorId: v.id("users"), body: v.string() },
  handler: async (ctx, { parentId, authorId, body }) => {
    const parent = await ctx.db.get(parentId);
    if (!parent) throw new Error("Comment not found");
    if (!clean(body)) throw new Error("Empty reply");
    const id = await ctx.db.insert("comments", {
      videoId: parent.videoId,
      versionId: parent.versionId,
      parentId: parent.parentId ?? parent._id,
      authorId,
      body: clean(body),
      resolved: false,
    });
    await recordFeedback(ctx, parent.videoId, "reply", id, authorId);
    return id;
  },
});

export const edit = mutation({
  args: { commentId: v.id("comments"), body: v.string() },
  handler: async (ctx, { commentId, body }) => {
    await ctx.db.patch(commentId, { body: clean(body), editedAt: Date.now() });
  },
});

export const setResolved = mutation({
  args: { commentId: v.id("comments"), userId: v.id("users"), resolved: v.boolean() },
  handler: async (ctx, { commentId, userId, resolved }) => {
    await ctx.db.patch(commentId, { resolved, resolvedBy: resolved ? userId : undefined });
  },
});

export const remove = mutation({
  args: { commentId: v.id("comments") },
  handler: async (ctx, { commentId }) => {
    const comment = await ctx.db.get(commentId);
    if (!comment) return;
    if (!comment.parentId) {
      const thread = await ctx.db
        .query("comments")
        .withIndex("by_version", (q) => q.eq("versionId", comment.versionId))
        .collect();
      for (const r of thread) if (r.parentId === commentId) await ctx.db.delete(r._id);
    }
    await ctx.db.delete(commentId);
  },
});
