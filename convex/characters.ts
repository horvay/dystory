import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: { trashed: v.optional(v.boolean()) },
  handler: async (ctx, { trashed }) => {
    const characters = await ctx.db
      .query("characters")
      .withIndex("by_trashed", (q) => q.eq("trashed", trashed ?? false))
      .order("desc")
      .collect();
    return Promise.all(
      characters.map(async (character) => {
        const story = character.storyId && (await ctx.db.get(character.storyId));
        return { ...character, storyTitle: story ? story.title : null };
      }),
    );
  },
});

export const update = mutation({
  args: {
    characterId: v.id("characters"),
    name: v.string(),
    description: v.string(),
    style: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { characterId, name, description, style, notes }) => {
    await ctx.db.patch(characterId, {
      name: name.trim().slice(0, 80) || "Unnamed character",
      description: description.trim().slice(0, 3000),
      style: style?.trim().slice(0, 300) || undefined,
      notes: notes?.trim().slice(0, 5000) || undefined,
    });
  },
});

export const setTrashed = mutation({
  args: { characterId: v.id("characters"), trashed: v.boolean() },
  handler: async (ctx, { characterId, trashed }) => {
    await ctx.db.patch(characterId, { trashed });
  },
});
