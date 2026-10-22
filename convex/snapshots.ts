import { diffWords } from "diff";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { getDocSchema, plainText, toMarkdown, wordCount } from "../shared/markdown";
import { prosemirrorSync } from "./sync";

type Kind =
  | "initial"
  | "auto"
  | "manual"
  | "ai-before"
  | "ai-after"
  | "before-restore"
  | "restore";

/**
 * Record a version of the document if it changed since the last one
 * (or always, with `force`). Returns the new version id, or null if skipped.
 */
export async function takeSnapshot(
  ctx: MutationCtx,
  docId: Id<"docs">,
  kind: Kind,
  opts: {
    label?: string;
    byAi?: boolean;
    aiRequestId?: Id<"aiRequests">;
    authors?: Id<"users">[];
    force?: boolean;
  } = {},
) {
  const doc = await ctx.db.get(docId);
  if (!doc) return null;
  const { doc: node, version } = await prosemirrorSync.getDoc(ctx, docId, getDocSchema());
  const prev = await ctx.db
    .query("docVersions")
    .withIndex("by_doc", (q) => q.eq("docId", docId))
    .order("desc")
    .first();

  const now = Date.now();
  const unchanged = prev && version === doc.lastSnapshotVersion && doc.title === prev.title;
  if (unchanged && !opts.force) {
    await ctx.db.patch(docId, { lastSnapshotAt: now });
    return null;
  }

  const markdown = toMarkdown(node.toJSON());
  // Structural no-ops (e.g. the editor adding a trailing empty paragraph)
  // bump the version without changing anything a person would notice.
  if (!opts.force && prev && prev.markdown === markdown && prev.title === doc.title) {
    await ctx.db.patch(docId, {
      lastSnapshotAt: now,
      lastSnapshotVersion: version,
      snippet: plainText(node).replace(/\s+/g, " ").trim().slice(0, 220),
    });
    return null;
  }
  let added = 0;
  let removed = 0;
  if (prev) {
    for (const part of diffWords(prev.markdown, markdown)) {
      if (part.added) added += wordCount(part.value);
      else if (part.removed) removed += wordCount(part.value);
    }
  } else {
    added = wordCount(plainText(node));
  }

  const authors = [...new Set([...(opts.authors ?? []), ...doc.pendingAuthors])];
  const id = await ctx.db.insert("docVersions", {
    docId,
    kind,
    label: opts.label,
    title: doc.title,
    content: JSON.stringify(node.toJSON()),
    markdown,
    pmVersion: version,
    authors,
    byAi: opts.byAi ?? false,
    aiRequestId: opts.aiRequestId,
    words: wordCount(plainText(node)),
    added,
    removed,
  });
  await ctx.db.patch(docId, {
    lastSnapshotAt: now,
    lastSnapshotVersion: version,
    pendingAuthors: [],
    snippet: plainText(node).replace(/\s+/g, " ").trim().slice(0, 220),
  });
  return id;
}
