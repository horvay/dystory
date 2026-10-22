import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { recordFeedback } from "./feedback";

/** Newest first, with how many comments each has. */
export const list = query({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }) => {
    const images = await ctx.db
      .query("images")
      .withIndex("by_video", (q) => q.eq("videoId", videoId))
      .order("desc")
      .collect();
    return Promise.all(
      images.map(async (img) => {
        const comments = await ctx.db
          .query("imageComments")
          .withIndex("by_image", (q) => q.eq("imageId", img._id))
          .collect();
        return { ...img, comments: comments.length };
      }),
    );
  },
});

export const add = mutation({
  args: {
    videoId: v.id("videos"),
    userId: v.id("users"),
    file: v.string(),
    thumb: v.string(),
    fileName: v.string(),
    size: v.number(),
    width: v.number(),
    height: v.number(),
    caption: v.optional(v.string()),
  },
  handler: async (ctx, { videoId, userId, fileName, ...rest }) => {
    await ctx.db.patch(videoId, { updatedAt: Date.now() });
    return ctx.db.insert("images", { videoId, uploadedBy: userId, fileName: fileName.slice(0, 200), ...rest });
  },
});

/** Removes the image and its comments. The file stays on disk, like a deleted video's. */
export const remove = mutation({
  args: { imageId: v.id("images") },
  handler: async (ctx, { imageId }) => {
    const comments = await ctx.db
      .query("imageComments")
      .withIndex("by_image", (q) => q.eq("imageId", imageId))
      .collect();
    for (const c of comments) await ctx.db.delete(c._id);
    if (await ctx.db.get(imageId)) await ctx.db.delete(imageId);
  },
});

export const comments = query({
  args: { imageId: v.id("images") },
  handler: async (ctx, { imageId }) =>
    ctx.db
      .query("imageComments")
      .withIndex("by_image", (q) => q.eq("imageId", imageId))
      .collect(),
});

const clean = (body: string) => body.trim().slice(0, 5000);
const unit = (n: number) => Math.min(1, Math.max(0, n));

export const addComment = mutation({
  args: {
    imageId: v.id("images"),
    authorId: v.id("users"),
    body: v.string(),
    x: v.optional(v.number()),
    y: v.optional(v.number()),
  },
  handler: async (ctx, { imageId, authorId, body, x, y }) => {
    const image = await ctx.db.get(imageId);
    if (!image) throw new Error("Image not found");
    if (!clean(body)) throw new Error("Empty comment");
    const pinned = x !== undefined && y !== undefined;
    await ctx.db.patch(image.videoId, { updatedAt: Date.now() });
    const id = await ctx.db.insert("imageComments", {
      imageId,
      authorId,
      body: clean(body),
      x: pinned ? unit(x) : undefined,
      y: pinned ? unit(y) : undefined,
    });
    await recordFeedback(ctx, image.videoId, "imageComment", id, authorId);
    return id;
  },
});

export const editComment = mutation({
  args: { commentId: v.id("imageComments"), body: v.string() },
  handler: async (ctx, { commentId, body }) => {
    if (!clean(body)) throw new Error("Empty comment");
    await ctx.db.patch(commentId, { body: clean(body), editedAt: Date.now() });
  },
});

export const removeComment = mutation({
  args: { commentId: v.id("imageComments") },
  handler: async (ctx, { commentId }) => {
    if (await ctx.db.get(commentId)) await ctx.db.delete(commentId);
  },
});
