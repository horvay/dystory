import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { EMPTY_DOC } from "../shared/extensions";
import { prosemirrorSync } from "./sync";
import { takeSnapshot } from "./snapshots";

/** Documents, leaving out stories' scripts (they're listed under their story). */
export const list = query({
  args: { trashed: v.optional(v.boolean()) },
  handler: async (ctx, { trashed }) => {
    const scripts = new Set((await ctx.db.query("stories").collect()).map((s) => s.docId));
    const docs = (
      await ctx.db
        .query("docs")
        .withIndex("by_trashed_updated", (q) => q.eq("trashed", trashed ?? false))
        .order("desc")
        .collect()
    ).filter((d) => !scripts.has(d._id));
    return docs.map((d) => ({
      _id: d._id,
      _creationTime: d._creationTime,
      title: d.title,
      categoryId: d.categoryId ?? null,
      updatedAt: d.updatedAt,
      lastEditedBy: d.lastEditedBy,
      snippet: d.snippet ?? "",
      activeAt: d.lastOpenedAt ?? d.updatedAt,
    }));
  },
});

export const get = query({
  args: { docId: v.string() },
  handler: async (ctx, { docId }) => {
    const id = ctx.db.normalizeId("docs", docId);
    if (!id) return null;
    const doc = await ctx.db.get(id);
    if (!doc) return null;
    return {
      _id: doc._id,
      _creationTime: doc._creationTime,
      title: doc.title,
      categoryId: doc.categoryId ?? null,
      trashed: doc.trashed,
      updatedAt: doc.updatedAt,
      createdBy: doc.createdBy,
      hasAiConversation: !!doc.aiSessionId,
      conversationStartedAt: doc.conversationStartedAt ?? 0,
    };
  },
});

/** A new, empty document with its first version. */
export async function insertDoc(
  ctx: MutationCtx,
  userId: Id<"users">,
  title?: string,
  categoryId?: Id<"categories">,
) {
  const now = Date.now();
  // The category may have been deleted by someone else a moment ago.
  const category = categoryId && (await ctx.db.get(categoryId));
  const docId = await ctx.db.insert("docs", {
    title: title ?? "",
    categoryId: category ? category._id : undefined,
    createdBy: userId,
    updatedAt: now,
    lastEditedBy: userId,
    trashed: false,
    lastChangedAt: now,
    lastSnapshotAt: 0,
    lastSnapshotVersion: -1,
    pendingAuthors: [userId],
    lastOpenedAt: now,
  });
  await prosemirrorSync.create(ctx, docId, EMPTY_DOC);
  await takeSnapshot(ctx, docId, "initial", { authors: [userId] });
  return docId;
}

export const create = mutation({
  args: {
    userId: v.id("users"),
    title: v.optional(v.string()),
    categoryId: v.optional(v.id("categories")),
  },
  handler: async (ctx, { userId, title, categoryId }) => insertDoc(ctx, userId, title, categoryId),
});

export const rename = mutation({
  args: { docId: v.id("docs"), userId: v.id("users"), title: v.string() },
  handler: async (ctx, { docId, userId, title }) => {
    const doc = await ctx.db.get(docId);
    if (!doc || doc.title === title) return;
    const now = Date.now();
    await ctx.db.patch(docId, {
      title: title.slice(0, 200),
      updatedAt: now,
      lastChangedAt: now,
      lastEditedBy: userId,
      pendingAuthors: doc.pendingAuthors.includes(userId)
        ? doc.pendingAuthors
        : [...doc.pendingAuthors, userId],
    });
  },
});

/** Called (throttled) by clients while their user is typing. */
export const touch = mutation({
  args: { docId: v.id("docs"), userId: v.id("users") },
  handler: async (ctx, { docId, userId }) => {
    const doc = await ctx.db.get(docId);
    if (!doc) return;
    const now = Date.now();
    await ctx.db.patch(docId, {
      updatedAt: now,
      lastChangedAt: now,
      lastOpenedAt: now,
      lastEditedBy: userId,
      pendingAuthors: doc.pendingAuthors.includes(userId)
        ? doc.pendingAuthors
        : [...doc.pendingAuthors, userId],
    });
  },
});

/** Files a document under a category, or under none with `null`. Not an edit, so it leaves updatedAt alone. */
export const setCategory = mutation({
  args: { docId: v.id("docs"), categoryId: v.union(v.id("categories"), v.null()) },
  handler: async (ctx, { docId, categoryId }) => {
    if (categoryId && !(await ctx.db.get(categoryId))) throw new Error("That category no longer exists");
    await ctx.db.patch(docId, { categoryId: categoryId ?? undefined });
  },
});

/** Called when someone opens the document; it stays active for another two days. */
export const markOpened = mutation({
  args: { docId: v.id("docs") },
  handler: async (ctx, { docId }) => {
    if (await ctx.db.get(docId)) await ctx.db.patch(docId, { lastOpenedAt: Date.now() });
  },
});

/** Makes the document inactive now rather than in two days. Opening it makes it active again. */
export const markInactive = mutation({
  args: { docId: v.id("docs") },
  handler: async (ctx, { docId }) => {
    await ctx.db.patch(docId, { lastOpenedAt: 0 });
  },
});

export const setTrashed = mutation({
  args: { docId: v.id("docs"), trashed: v.boolean() },
  handler: async (ctx, { docId, trashed }) => {
    await ctx.db.patch(docId, { trashed });
  },
});

export const deleteForever = mutation({
  args: { docId: v.id("docs") },
  handler: async (ctx, { docId }) => {
    const doc = await ctx.db.get(docId);
    if (!doc?.trashed) throw new Error("Only trashed documents can be deleted");
    for (const table of ["docVersions", "aiRequests", "presence", "chatMessages"] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_doc", (q) => q.eq("docId", docId))
        .collect();
      for (const row of rows) await ctx.db.delete(row._id);
    }
    await ctx.db.delete(docId);
  },
});
