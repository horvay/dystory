import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: { trashed: v.optional(v.boolean()) },
  handler: async (ctx, { trashed }) => {
    const voices = await ctx.db
      .query("voices")
      .withIndex("by_trashed", (q) => q.eq("trashed", trashed ?? false))
      .order("desc")
      .collect();
    return Promise.all(
      voices.map(async (voice) => {
        const story = voice.storyId && (await ctx.db.get(voice.storyId));
        return { ...voice, storyTitle: story ? story.title : null };
      }),
    );
  },
});

export const update = mutation({
  args: {
    voiceId: v.id("voices"),
    name: v.string(),
    character: v.optional(v.string()),
    description: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { voiceId, name, character, description, notes }) => {
    await ctx.db.patch(voiceId, {
      name: name.trim().slice(0, 80) || "Unnamed voice",
      character: character?.trim().slice(0, 120) || undefined,
      description: description.trim().slice(0, 2000),
      notes: notes?.trim().slice(0, 5000) || undefined,
    });
  },
});

export const setTrashed = mutation({
  args: { voiceId: v.id("voices"), trashed: v.boolean() },
  handler: async (ctx, { voiceId, trashed }) => {
    await ctx.db.patch(voiceId, { trashed });
  },
});
