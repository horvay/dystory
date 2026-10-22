import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";

const cleanName = (name: string) => name.trim().replace(/\s+/g, " ").slice(0, 60);

export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("categories").withIndex("by_order").collect();
    return rows.map((c) => ({ _id: c._id, name: c.name, color: c.color, parentId: c.parentId ?? null }));
  },
});

export const create = mutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    color: v.string(),
    parentId: v.optional(v.id("categories")),
  },
  handler: async (ctx, { userId, name, color, parentId }) => {
    const clean = cleanName(name);
    if (!clean) throw new Error("A category needs a name");
    if (parentId && !(await ctx.db.get(parentId))) throw new Error("That category no longer exists");
    const all = await ctx.db.query("categories").collect();
    // Two people creating "Scripts" in the same place at once should end up with one category.
    const same = all.find(
      (c) => (c.parentId ?? null) === (parentId ?? null) && c.name.toLowerCase() === clean.toLowerCase(),
    );
    if (same) return same._id;
    // New categories go first among their siblings, where the name was typed in the sidebar.
    const order = Math.min(0, ...all.map((c) => c.order - 1));
    return ctx.db.insert("categories", { name: clean, color, parentId, order, createdBy: userId });
  },
});

export const update = mutation({
  args: {
    categoryId: v.id("categories"),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
  },
  handler: async (ctx, { categoryId, name, color }) => {
    const patch: { name?: string; color?: string } = {};
    if (name !== undefined && cleanName(name)) patch.name = cleanName(name);
    if (color !== undefined) patch.color = color;
    await ctx.db.patch(categoryId, patch);
  },
});

/** True if `id` is `ancestor` or somewhere inside it. */
async function isWithin(ctx: MutationCtx, id: Id<"categories"> | undefined, ancestor: Id<"categories">) {
  for (let i = 0; id && i < 100; i++) {
    if (id === ancestor) return true;
    id = (await ctx.db.get(id))?.parentId;
  }
  return false;
}

/**
 * Puts a category under `parentId` (null for the top level) and saves the
 * order of everything at that level; `siblingIds` is that level, top to bottom.
 */
export const move = mutation({
  args: {
    categoryId: v.id("categories"),
    parentId: v.union(v.id("categories"), v.null()),
    siblingIds: v.array(v.id("categories")),
  },
  handler: async (ctx, { categoryId, parentId, siblingIds }) => {
    if (parentId && !(await ctx.db.get(parentId))) throw new Error("That category no longer exists");
    if (parentId && (await isWithin(ctx, parentId, categoryId))) {
      throw new Error("A category can't go inside itself");
    }
    await ctx.db.patch(categoryId, { parentId: parentId ?? undefined });
    for (const [i, id] of siblingIds.entries()) {
      const c = await ctx.db.get(id);
      if (c && (c.parentId ?? null) === parentId) await ctx.db.patch(id, { order: i });
    }
  },
});

/** Deletes the category; its documents (trashed ones too) and subcategories move up a level. */
export const remove = mutation({
  args: { categoryId: v.id("categories") },
  handler: async (ctx, { categoryId }) => {
    const category = await ctx.db.get(categoryId);
    if (!category) return;
    const docs = await ctx.db
      .query("docs")
      .withIndex("by_category", (q) => q.eq("categoryId", categoryId))
      .collect();
    for (const d of docs) await ctx.db.patch(d._id, { categoryId: category.parentId });
    const children: Doc<"categories">[] = (await ctx.db.query("categories").collect()).filter(
      (c) => c.parentId === categoryId,
    );
    for (const c of children) await ctx.db.patch(c._id, { parentId: category.parentId });
    await ctx.db.delete(categoryId);
  },
});
