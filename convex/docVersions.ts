import { v } from "convex/values";
import { Node } from "@tiptap/pm/model";
import { internalMutation, mutation, query } from "./_generated/server";
import { getDocSchema, replaceBlocks } from "../shared/markdown";
import { prosemirrorSync } from "./sync";
import { takeSnapshot } from "./snapshots";

export const list = query({
  args: { docId: v.id("docs") },
  handler: async (ctx, { docId }) => {
    const rows = await ctx.db
      .query("docVersions")
      .withIndex("by_doc", (q) => q.eq("docId", docId))
      .order("desc")
      .take(500);
    return rows.map(({ content: _c, markdown: _m, ...rest }) => rest);
  },
});

/** One version plus the version before it, for showing a diff. */
export const get = query({
  args: { versionId: v.id("docVersions") },
  handler: async (ctx, { versionId }) => {
    const version = await ctx.db.get(versionId);
    if (!version) return null;
    const previous = await ctx.db
      .query("docVersions")
      .withIndex("by_doc", (q) =>
        q.eq("docId", version.docId).lt("_creationTime", version._creationTime),
      )
      .order("desc")
      .first();
    return {
      ...version,
      previousMarkdown: previous?.markdown ?? "",
      previousTitle: previous?.title ?? "",
      previousAt: previous?._creationTime ?? null,
    };
  },
});

/** People who changed the document after `since` (saved or not yet saved). */
export const editorsSince = query({
  args: { docId: v.id("docs"), since: v.number() },
  handler: async (ctx, { docId, since }) => {
    const doc = await ctx.db.get(docId);
    if (!doc) return [];
    const later = await ctx.db
      .query("docVersions")
      .withIndex("by_doc", (q) => q.eq("docId", docId).gt("_creationTime", since))
      .collect();
    const ids = new Set(later.filter((v) => !v.byAi).flatMap((v) => v.authors));
    if (doc.lastChangedAt > since) for (const a of doc.pendingAuthors) ids.add(a);
    return [...ids];
  },
});

export const saveNamed = mutation({
  args: { docId: v.id("docs"), userId: v.id("users"), label: v.string() },
  handler: async (ctx, { docId, userId, label }) => {
    await takeSnapshot(ctx, docId, "manual", {
      label: label.trim().slice(0, 80) || "Saved version",
      authors: [userId],
      force: true,
    });
  },
});

export const restore = mutation({
  args: { versionId: v.id("docVersions"), userId: v.id("users") },
  handler: async (ctx, { versionId, userId }) => {
    const version = await ctx.db.get(versionId);
    if (!version) throw new Error("Version not found");
    const docId = version.docId;
    await takeSnapshot(ctx, docId, "before-restore");

    const schema = getDocSchema();
    const target = Node.fromJSON(schema, JSON.parse(version.content));
    await prosemirrorSync.transform(ctx, docId, schema, (doc) => replaceBlocks(doc, target));
    const now = Date.now();
    await ctx.db.patch(docId, {
      title: version.title,
      updatedAt: now,
      lastChangedAt: now,
      lastEditedBy: userId,
    });
    const when = new Date(version._creationTime).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    await takeSnapshot(ctx, docId, "restore", {
      label: `Restored version from ${when}`,
      authors: [userId],
      force: true,
    });
  },
});

/** Cron: snapshot every document that changed since its last snapshot. */
export const autoSnapshot = internalMutation({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db
      .query("docs")
      .withIndex("by_trashed_updated", (q) => q.eq("trashed", false))
      .order("desc")
      .take(200);
    for (const doc of docs) {
      if (doc.lastChangedAt > doc.lastSnapshotAt) {
        await takeSnapshot(ctx, doc._id, "auto");
      }
    }
  },
});
