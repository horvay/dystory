import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { fileInfo } from "./schema";

/** Plain reviews (videos that aren't a story's); a story's cuts live on its own page. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const videos = (
      await ctx.db
        .query("videos")
        .withIndex("by_trashed_updated", (q) => q.eq("trashed", false))
        .order("desc")
        .collect()
    ).filter((video) => !video.storyId);
    return Promise.all(
      videos.map(async (video) => {
        // Counts are for the newest version, which is what the card shows.
        const latest = await ctx.db
          .query("versions")
          .withIndex("by_video", (q) => q.eq("videoId", video._id).eq("number", video.latestVersion))
          .unique();
        const comments = latest
          ? await ctx.db
              .query("comments")
              .withIndex("by_version", (q) => q.eq("versionId", latest._id))
              .collect()
          : [];
        const notes = comments.filter((c) => !c.parentId);
        const images = await ctx.db
          .query("images")
          .withIndex("by_video", (q) => q.eq("videoId", video._id))
          .order("desc")
          .collect();
        const pages = await ctx.db
          .query("notes")
          .withIndex("by_video", (q) => q.eq("videoId", video._id))
          .collect();
        return {
          ...video,
          openNotes: notes.filter((c) => !c.resolved).length,
          notes: notes.length,
          imageCount: images.length,
          noteCount: pages.length,
          // Before the first cut, the card shows the newest image instead.
          coverThumb: images[0]?.thumb,
        };
      }),
    );
  },
});

export const get = query({
  args: { videoId: v.string() },
  handler: async (ctx, { videoId }) => {
    const id = ctx.db.normalizeId("videos", videoId);
    const video = id && (await ctx.db.get(id));
    if (!video) return null;
    const versions = await ctx.db
      .query("versions")
      .withIndex("by_video", (q) => q.eq("videoId", video._id))
      .collect();
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_video", (q) => q.eq("videoId", video._id))
      .collect();
    const images = await ctx.db
      .query("images")
      .withIndex("by_video", (q) => q.eq("videoId", video._id))
      .collect();
    const pages = await ctx.db
      .query("notes")
      .withIndex("by_video", (q) => q.eq("videoId", video._id))
      .collect();
    return {
      ...video,
      imageCount: images.length,
      noteCount: pages.length,
      versions: versions.map((ver) => {
        const notes = comments.filter((c) => c.versionId === ver._id && !c.parentId);
        return { ...ver, notes: notes.length, openNotes: notes.filter((c) => !c.resolved).length };
      }),
    };
  },
});

function titleFrom(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim().slice(0, 120) || "Untitled video";
}

export const create = mutation({
  args: { userId: v.id("users"), ...fileInfo },
  handler: async (ctx, { userId, ...file }) => {
    const videoId = await ctx.db.insert("videos", {
      title: titleFrom(file.fileName),
      createdBy: userId,
      updatedAt: Date.now(),
      trashed: false,
      latestVersion: 1,
      latestFileId: file.fileId,
      latestDuration: file.duration,
    });
    await ctx.db.insert("versions", { videoId, number: 1, uploadedBy: userId, ...file });
    return videoId;
  },
});

/** A video with no cut yet, to start with notes and images. */
export const createEmpty = mutation({
  args: { userId: v.id("users"), title: v.string() },
  handler: async (ctx, { userId, title }) =>
    ctx.db.insert("videos", {
      title: title.trim().slice(0, 120) || "Untitled video",
      createdBy: userId,
      updatedAt: Date.now(),
      trashed: false,
      latestVersion: 0,
    }),
});

export const addVersion = mutation({
  args: { videoId: v.id("videos"), userId: v.id("users"), ...fileInfo },
  handler: async (ctx, { videoId, userId, ...file }) => {
    const video = await ctx.db.get(videoId);
    if (!video) throw new Error("Video not found");
    const number = video.latestVersion + 1;
    await ctx.db.insert("versions", { videoId, number, uploadedBy: userId, ...file });
    await ctx.db.patch(videoId, {
      latestVersion: number,
      latestFileId: file.fileId,
      latestDuration: file.duration,
      updatedAt: Date.now(),
    });
    return number;
  },
});

export const rename = mutation({
  args: { videoId: v.id("videos"), title: v.string() },
  handler: async (ctx, { videoId, title }) => {
    await ctx.db.patch(videoId, { title: title.trim().slice(0, 120) || "Untitled video" });
  },
});

export const setTrashed = mutation({
  args: { videoId: v.id("videos"), trashed: v.boolean() },
  handler: async (ctx, { videoId, trashed }) => {
    await ctx.db.patch(videoId, { trashed });
  },
});
