import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { recordFeedback } from "./feedback";

export const list = query({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }) =>
    ctx.db
      .query("notes")
      .withIndex("by_video", (q) => q.eq("videoId", videoId))
      .order("desc")
      .collect(),
});

export const create = mutation({
  args: { videoId: v.id("videos"), userId: v.id("users") },
  handler: async (ctx, { videoId, userId }) => {
    const now = Date.now();
    await ctx.db.patch(videoId, { updatedAt: now });
    return ctx.db.insert("notes", {
      videoId,
      title: "",
      body: "",
      createdBy: userId,
      updatedBy: userId,
      updatedAt: now,
    });
  },
});

/**
 * Saves a note the editor last saw at `base` (its updatedAt). If someone else
 * saved in between, nothing is written and the editor asks whose text wins;
 * pass `force` to overwrite theirs.
 */
export const save = mutation({
  args: {
    noteId: v.id("notes"),
    userId: v.id("users"),
    title: v.string(),
    body: v.string(),
    base: v.number(),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, { noteId, userId, title, body, base, force }) => {
    const note = await ctx.db.get(noteId);
    if (!note) throw new Error("Note not found");
    if (note.updatedAt !== base && !force) return { conflict: true as const };
    const updatedAt = Math.max(Date.now(), note.updatedAt + 1);
    await ctx.db.patch(noteId, {
      title: title.slice(0, 200),
      body: body.slice(0, 200_000),
      updatedBy: userId,
      updatedAt,
    });
    await ctx.db.patch(note.videoId, { updatedAt });
    if (body.trim() || title.trim()) await recordFeedback(ctx, note.videoId, "note", noteId, userId);
    return { conflict: false as const, updatedAt };
  },
});

export const remove = mutation({
  args: { noteId: v.id("notes") },
  handler: async (ctx, { noteId }) => {
    if (await ctx.db.get(noteId)) await ctx.db.delete(noteId);
  },
});
