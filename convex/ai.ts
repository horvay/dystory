import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { ReplaceStep, type Transform } from "@tiptap/pm/transform";
import { getDocSchema, markdownTransform, toMarkdown } from "../shared/markdown";
import { prosemirrorSync } from "./sync";
import { takeSnapshot } from "./snapshots";
import { aiComedyStyle, aiEffort } from "./schema";

const AI_CLIENT_ID = "claude";

// ---------------------------------------------------------------------------
// Browser-facing
// ---------------------------------------------------------------------------

export const ask = mutation({
  args: {
    docId: v.id("docs"),
    userId: v.id("users"),
    prompt: v.string(),
    selection: v.optional(v.string()),
    effort: v.optional(aiEffort),
    comedyStyle: v.optional(aiComedyStyle),
  },
  handler: async (ctx, { docId, userId, prompt, selection, effort, comedyStyle }) => {
    const doc = await ctx.db.get(docId);
    if (!doc) throw new Error("Document not found");
    return ctx.db.insert("aiRequests", {
      docId,
      prompt: prompt.trim(),
      selection: selection?.trim() || undefined,
      requestedBy: userId,
      effort,
      comedyStyle,
      status: "queued",
      response: "",
      activity: [],
      editCount: 0,
    });
  },
});

export const cancel = mutation({
  args: { requestId: v.id("aiRequests") },
  handler: async (ctx, { requestId }) => {
    const req = await ctx.db.get(requestId);
    if (req && (req.status === "queued" || req.status === "running")) {
      await ctx.db.patch(requestId, { status: "cancelled", finishedAt: Date.now() });
    }
  },
});

export const newConversation = mutation({
  args: { docId: v.id("docs") },
  handler: async (ctx, { docId }) => {
    await ctx.db.patch(docId, {
      aiSessionId: undefined,
      conversationStartedAt: Date.now(),
    });
  },
});

export const listForDoc = query({
  args: { docId: v.id("docs") },
  handler: async (ctx, { docId }) => {
    const rows = await ctx.db
      .query("aiRequests")
      .withIndex("by_doc", (q) => q.eq("docId", docId))
      .order("desc")
      .take(60);
    return rows.reverse();
  },
});

export const workerStatus = query({
  args: { name: v.optional(v.string()) },
  handler: async (ctx, { name = "ai" }) => {
    const w = await ctx.db
      .query("workers")
      .withIndex("by_name", (q) => q.eq("name", name))
      .first();
    return w ? { lastSeen: w.lastSeen } : null;
  },
});

// ---------------------------------------------------------------------------
// AI worker-facing
// ---------------------------------------------------------------------------

export const heartbeat = mutation({
  args: { name: v.optional(v.string()) },
  handler: async (ctx, { name = "ai" }) => {
    const w = await ctx.db
      .query("workers")
      .withIndex("by_name", (q) => q.eq("name", name))
      .first();
    if (w) await ctx.db.patch(w._id, { lastSeen: Date.now() });
    else await ctx.db.insert("workers", { name, lastSeen: Date.now() });
  },
});

export const queued = query({
  args: {},
  handler: async (ctx) =>
    ctx.db
      .query("aiRequests")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .collect(),
});

export const status = query({
  args: { requestId: v.id("aiRequests") },
  handler: async (ctx, { requestId }) => (await ctx.db.get(requestId))?.status ?? null,
});

/** On worker startup: anything still "running" was orphaned by a crash. */
export const resetStale = mutation({
  args: {},
  handler: async (ctx) => {
    const running = await ctx.db
      .query("aiRequests")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .collect();
    for (const r of running) {
      await ctx.db.patch(r._id, {
        status: "error",
        error: "The AI worker restarted while this was running.",
        finishedAt: Date.now(),
      });
    }
  },
});

export const claim = mutation({
  args: { requestId: v.id("aiRequests") },
  handler: async (ctx, { requestId }) => {
    const req = await ctx.db.get(requestId);
    if (!req || req.status !== "queued") return null;
    const doc = await ctx.db.get(req.docId);
    if (!doc) {
      await ctx.db.patch(requestId, { status: "error", error: "Document was deleted" });
      return null;
    }
    // Save what the document looked like before Claude touched it.
    const snapshotId = await takeSnapshot(ctx, req.docId, "ai-before", { aiRequestId: requestId });
    const latest = await ctx.db
      .query("docVersions")
      .withIndex("by_doc", (q) => q.eq("docId", req.docId))
      .order("desc")
      .first();
    await ctx.db.patch(requestId, {
      status: "running",
      startedAt: Date.now(),
      beforeVersionId: snapshotId ?? latest?._id,
    });
    const requester = await ctx.db.get(req.requestedBy);
    const { doc: node } = await prosemirrorSync.getDoc(ctx, req.docId, getDocSchema());
    return {
      docId: req.docId,
      prompt: req.prompt,
      selection: req.selection,
      effort: req.effort ?? "medium",
      comedyStyle: req.comedyStyle,
      requesterName: requester?.name ?? "Someone",
      title: doc.title,
      markdown: toMarkdown(node.toJSON()),
      // The worker runs one request per document at a time, so this is the
      // session left by the previous request (cleared by "New conversation").
      sessionId: doc.aiSessionId,
    };
  },
});

async function runningRequest(ctx: MutationCtx, requestId: Id<"aiRequests">) {
  const req = await ctx.db.get(requestId);
  if (!req) throw new ConvexError("Request not found");
  if (req.status !== "running") throw new ConvexError("The request was cancelled.");
  return req;
}

async function noteEdit(
  ctx: MutationCtx,
  requestId: Id<"aiRequests">,
  docId: Id<"docs">,
  range?: { from: number; to: number },
) {
  const req = await ctx.db.get(requestId);
  if (req) {
    await ctx.db.patch(requestId, {
      editCount: req.editCount + 1,
      ...(range ? { lastEdit: { ...range, at: Date.now() } } : {}),
    });
  }
  const now = Date.now();
  await ctx.db.patch(docId, { updatedAt: now, lastChangedAt: now });
}

export const readDoc = mutation({
  args: { requestId: v.id("aiRequests") },
  handler: async (ctx, { requestId }) => {
    const req = await runningRequest(ctx, requestId);
    const doc = await ctx.db.get(req.docId);
    const { doc: node } = await prosemirrorSync.getDoc(ctx, req.docId, getDocSchema());
    return { title: doc?.title ?? "", markdown: toMarkdown(node.toJSON()) };
  },
});

/** The span of the new document that a block replacement produced. */
function changedRange(tr: Transform): { from: number; to: number } | undefined {
  const step = tr.steps[0];
  if (!(step instanceof ReplaceStep)) return undefined;
  return { from: step.from, to: step.from + step.slice.size };
}

function countOccurrences(haystack: string, needle: string) {
  let count = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    count++;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return count;
}

/** Markdown of the document as it is now. */
export async function docMarkdown(ctx: MutationCtx, docId: Id<"docs">) {
  const { doc: node } = await prosemirrorSync.getDoc(ctx, docId, getDocSchema());
  return toMarkdown(node.toJSON());
}

/**
 * Applies find/replace edits to the document's Markdown as ProseMirror steps
 * that only replace the changed blocks. Returns where the change landed.
 */
export async function applyEdits(
  ctx: MutationCtx,
  docId: Id<"docs">,
  edits: { find: string; replace: string }[],
  clientId = AI_CLIENT_ID,
) {
  let range: { from: number; to: number } | undefined;
  await prosemirrorSync.transform(
    ctx,
    docId,
    getDocSchema(),
    (doc) => {
      let markdown = toMarkdown(doc.toJSON());
      for (const { find, replace } of edits) {
        if (!find) throw new ConvexError("`find` must not be empty.");
        const n = countOccurrences(markdown, find);
        if (n === 0) {
          throw new ConvexError(
            `Could not find this text in the document (it may have just been changed by someone): "${find.slice(0, 120)}". Re-read the document and try again.`,
          );
        }
        if (n > 1) {
          throw new ConvexError(
            `This text appears ${n} times; include more surrounding text so it is unique: "${find.slice(0, 120)}"`,
          );
        }
        markdown = markdown.replace(find, () => replace);
      }
      const tr = markdownTransform(doc, markdown);
      range = tr ? changedRange(tr) : undefined;
      return tr;
    },
    { clientId },
  );
  return range;
}

export const editDoc = mutation({
  args: {
    requestId: v.id("aiRequests"),
    edits: v.array(v.object({ find: v.string(), replace: v.string() })),
  },
  handler: async (ctx, { requestId, edits }) => {
    const req = await runningRequest(ctx, requestId);
    const range = await applyEdits(ctx, req.docId, edits);
    await noteEdit(ctx, requestId, req.docId, range);
  },
});

export const rewriteDoc = mutation({
  args: { requestId: v.id("aiRequests"), markdown: v.string() },
  handler: async (ctx, { requestId, markdown }) => {
    const req = await runningRequest(ctx, requestId);
    let range: { from: number; to: number } | undefined;
    await prosemirrorSync.transform(
      ctx,
      req.docId,
      getDocSchema(),
      (doc) => {
        const tr = markdownTransform(doc, markdown);
        range = tr ? changedRange(tr) : undefined;
        return tr;
      },
      { clientId: AI_CLIENT_ID },
    );
    await noteEdit(ctx, requestId, req.docId, range);
  },
});

export const setTitle = mutation({
  args: { requestId: v.id("aiRequests"), title: v.string() },
  handler: async (ctx, { requestId, title }) => {
    const req = await runningRequest(ctx, requestId);
    await ctx.db.patch(req.docId, { title: title.slice(0, 200) });
    await noteEdit(ctx, requestId, req.docId);
  },
});

export const progress = mutation({
  args: {
    requestId: v.id("aiRequests"),
    response: v.optional(v.string()),
    activity: v.optional(v.string()),
  },
  handler: async (ctx, { requestId, response, activity }) => {
    const req = await ctx.db.get(requestId);
    if (!req || req.status !== "running") return;
    await ctx.db.patch(requestId, {
      ...(response !== undefined ? { response } : {}),
      ...(activity ? { activity: [...req.activity, activity].slice(-30) } : {}),
    });
  },
});

export const finish = mutation({
  args: {
    requestId: v.id("aiRequests"),
    response: v.string(),
    sessionId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { requestId, response, sessionId, error }) => {
    const req = await ctx.db.get(requestId);
    if (!req) return;
    const cancelled = req.status === "cancelled";
    await ctx.db.patch(requestId, {
      status: cancelled ? "cancelled" : error ? "error" : "done",
      response,
      error,
      finishedAt: Date.now(),
    });
    if (sessionId && !cancelled) {
      await ctx.db.patch(req.docId, { aiSessionId: sessionId });
    }
    if (req.editCount === 0 && req.beforeVersionId) {
      // Claude only answered; the "before" snapshot just holds people's edits.
      const before = await ctx.db.get(req.beforeVersionId);
      if (before?.kind === "ai-before" && before.aiRequestId === requestId) {
        await ctx.db.patch(before._id, { kind: "auto", aiRequestId: undefined });
      }
    }
    if (req.editCount > 0) {
      await takeSnapshot(ctx, req.docId, "ai-after", {
        byAi: true,
        aiRequestId: requestId,
        label: req.prompt.slice(0, 80),
      });
    }
  },
});
