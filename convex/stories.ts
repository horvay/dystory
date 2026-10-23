import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { slugify } from "../shared/director";
import { nextStage, stageIndex, stageInfo, type StageId } from "../shared/stages";
import { insertDoc } from "./docs";
import { takePending } from "./feedback";
import { closeRequests } from "./requests";
import { stage as stageValidator } from "./schema";
import { queueTurn } from "./turns";

async function uniqueSlug(ctx: QueryCtx, title: string) {
  const base = slugify(title);
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const taken = await ctx.db
      .query("stories")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!taken) return slug;
  }
}

/** What the story cards and the sidebar show. */
async function summary(ctx: QueryCtx, story: Doc<"stories">) {
  const video = await ctx.db.get(story.videoId);
  const latest =
    video && video.latestVersion
      ? await ctx.db
          .query("versions")
          .withIndex("by_video", (q) => q.eq("videoId", video._id).eq("number", video.latestVersion))
          .unique()
      : null;
  const comments = latest
    ? await ctx.db
        .query("comments")
        .withIndex("by_version", (q) => q.eq("versionId", latest._id))
        .collect()
    : [];
  const cover = video?.latestFileId
    ? undefined
    : (
        await ctx.db
          .query("images")
          .withIndex("by_video", (q) => q.eq("videoId", story.videoId))
          .order("desc")
          .first()
      )?.thumb;
  const doc = await ctx.db.get(story.docId);
  return {
    ...story,
    snippet: doc?.snippet ?? "",
    latestVersion: video?.latestVersion ?? 0,
    latestFileId: video?.latestFileId,
    latestDuration: video?.latestDuration,
    coverThumb: cover,
    openComments: comments.filter((c) => !c.parentId && !c.resolved).length,
  };
}

export const list = query({
  args: { trashed: v.optional(v.boolean()) },
  handler: async (ctx, { trashed }) => {
    const stories = await ctx.db
      .query("stories")
      .withIndex("by_trashed_updated", (q) => q.eq("trashed", trashed ?? false))
      .order("desc")
      .collect();
    return Promise.all(stories.map((s) => summary(ctx, s)));
  },
});

export const get = query({
  args: { storyId: v.string() },
  handler: async (ctx, { storyId }) => {
    const id = ctx.db.normalizeId("stories", storyId);
    const story = id && (await ctx.db.get(id));
    if (!story) return null;
    const running = await ctx.db
      .query("turns")
      .withIndex("by_story", (q) => q.eq("storyId", story._id))
      .order("desc")
      .take(20);
    const waiting = await ctx.db
      .query("wakeups")
      .withIndex("by_story", (q) => q.eq("storyId", story._id))
      .filter((q) => q.eq(q.field("status"), "waiting"))
      .collect();
    const open = (
      await ctx.db
        .query("requests")
        .withIndex("by_story", (q) => q.eq("storyId", story._id))
        .order("desc")
        .take(5)
    ).find((r) => r.status === "open");
    return {
      ...(await summary(ctx, story)),
      openRequest: open ? { _id: open._id, kind: open.kind } : null,
      busy: running.some((t) => t.status === "running"),
      queued: running.filter((t) => t.status === "queued").length,
      jobs: waiting.map((w) => ({ _id: w._id, note: w.note, at: w.at, unit: w.unit, queue: w.queue })),
    };
  },
});

/** The story whose script this document is, if any. */
export const byDoc = query({
  args: { docId: v.id("docs") },
  handler: async (ctx, { docId }) => {
    const story = await ctx.db
      .query("stories")
      .withIndex("by_doc", (q) => q.eq("docId", docId))
      .first();
    return story && !story.trashed ? { _id: story._id, title: story.title, stage: story.stage } : null;
  },
});

/** The story a review video belongs to, if any. */
export const byVideo = query({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }) => {
    const story = await ctx.db
      .query("stories")
      .withIndex("by_video", (q) => q.eq("videoId", videoId))
      .first();
    return story ? { _id: story._id, title: story.title } : null;
  },
});

/**
 * A new story. Its script is a new document, or an existing one (a script
 * already written on its own) when `docId` is given.
 */
export const create = mutation({
  args: { userId: v.id("users"), title: v.string(), docId: v.optional(v.id("docs")) },
  handler: async (ctx, { userId, title, docId }) => {
    const existing = docId && (await ctx.db.get(docId));
    const name = (title.trim() || existing?.title || "Untitled story").slice(0, 120);
    if (existing) {
      const taken = await ctx.db
        .query("stories")
        .withIndex("by_doc", (q) => q.eq("docId", existing._id))
        .first();
      if (taken && !taken.trashed) return taken._id;
    }
    const scriptId = existing ? existing._id : await insertDoc(ctx, userId, name);
    const now = Date.now();
    const videoId = await ctx.db.insert("videos", {
      title: name,
      createdBy: userId,
      updatedAt: now,
      trashed: false,
      latestVersion: 0,
    });
    const storyId = await ctx.db.insert("stories", {
      title: name,
      slug: await uniqueSlug(ctx, name),
      docId: scriptId,
      videoId,
      createdBy: userId,
      updatedAt: now,
      trashed: false,
      stage: "script",
      state: "writing",
      conversationStartedAt: now,
    });
    await ctx.db.patch(videoId, { storyId });
    return storyId;
  },
});

export const rename = mutation({
  args: { storyId: v.id("stories"), title: v.string() },
  handler: async (ctx, { storyId, title }) => {
    const story = await ctx.db.get(storyId);
    if (!story) return;
    const name = title.trim().slice(0, 120) || "Untitled story";
    await ctx.db.patch(storyId, { title: name });
    await ctx.db.patch(story.videoId, { title: name });
  },
});

export const setTrashed = mutation({
  args: { storyId: v.id("stories"), trashed: v.boolean() },
  handler: async (ctx, { storyId, trashed }) => {
    const story = await ctx.db.get(storyId);
    if (!story) return;
    await ctx.db.patch(storyId, { trashed });
    await ctx.db.patch(story.videoId, { trashed });
    if (trashed) await stopEverything(ctx, storyId);
  },
});

/** Cancels the story's queued and running turns and the jobs it was waiting on. */
async function stopEverything(ctx: MutationCtx, storyId: Id<"stories">) {
  const turns = await ctx.db
    .query("turns")
    .withIndex("by_story", (q) => q.eq("storyId", storyId))
    .collect();
  for (const t of turns) {
    if (t.status === "queued" || t.status === "running") {
      await ctx.db.patch(t._id, { status: "cancelled", finishedAt: Date.now() });
    }
  }
  const wakeups = await ctx.db
    .query("wakeups")
    .withIndex("by_story", (q) => q.eq("storyId", storyId))
    .collect();
  for (const w of wakeups) {
    if (w.status === "waiting") await ctx.db.patch(w._id, { status: "cancelled", stopUnit: w.unit ? true : undefined });
  }
}

/** What the production AI is told when a stage starts. */
function stageKickoff(stage: StageId, from: StageId, who: string, note: string | undefined, back: boolean) {
  const info = stageInfo(stage);
  const prev = stageInfo(from);
  const opening = back
    ? `${who} moved the story back from ${prev.label} to ${info.label}.`
    : from === "script"
      ? `${who} put the script into production. The first stage is ${info.label}.`
      : `${who} approved ${prev.label}. The next stage is ${info.label}.`;
  const casting =
    !back && from === "casting"
      ? "\n\nThe cast is approved: add every newly designed voice that was approved to the voice catalog now (add_voice), with its reference wav, the reference's exact transcript and how it was made."
      : "";
  const redo = back
    ? "\n\nWork out what has to be redone from here on (for example, re-voiced lines break lip sync on their talk shots) and say so before starting."
    : "";
  return `${opening}${note ? `\n\n${who} adds: ${note}` : ""}${casting}${redo}

Goal for ${info.label}: ${info.goal}

When the work is ready, post it (post_cut, post_image), then call request_review.`;
}

async function moveTo(
  ctx: MutationCtx,
  story: Doc<"stories">,
  userId: Id<"users">,
  to: StageId,
  note?: string,
  /** More for the AI only (notes that came with an approval). */
  extra?: string,
) {
  const who = (await ctx.db.get(userId))?.name ?? "Someone";
  const back = stageIndex(to) < stageIndex(story.stage);
  if (to === "script") {
    await stopEverything(ctx, story._id);
    await ctx.db.patch(story._id, { stage: "script", state: "writing", statusLine: undefined, updatedAt: Date.now() });
    return;
  }
  if (to === "done") {
    await ctx.db.patch(story._id, { stage: "done", state: "done", statusLine: undefined, updatedAt: Date.now() });
    return;
  }
  await ctx.db.patch(story._id, {
    stage: to,
    state: "working",
    statusLine: `Starting ${stageInfo(to).label}`,
    updatedAt: Date.now(),
  });
  await queueTurn(ctx, story._id, {
    kind: "stage",
    prompt: stageKickoff(to, story.stage, who, note?.trim() || undefined, back) + (extra ? `\n\n${extra}` : ""),
    display: back
      ? `Moved back to ${stageInfo(to).label}${note?.trim() ? `: ${note.trim()}` : ""}`
      : story.stage === "script"
        ? "Script went into production"
        : `${stageInfo(story.stage).label} approved${note?.trim() ? `: ${note.trim()}` : ""}`,
    requestedBy: userId,
  });
}

/** Approves the current stage (or puts the script into production) and starts the next one. */
export const approve = mutation({
  args: { storyId: v.id("stories"), userId: v.id("users"), note: v.optional(v.string()) },
  handler: async (ctx, { storyId, userId, note }) => {
    const story = await ctx.db.get(storyId);
    if (!story) throw new Error("Story not found");
    if (story.stage === "done") return;
    await closeRequests(ctx, storyId, "approved", userId);
    // Notes still waiting to go out ride along with the approval.
    const pending = await takePending(ctx, storyId);
    const extra = pending.length
      ? `Notes that came in with the approval (small fixes, not blockers; do them as part of the next stage):\n${pending.join("\n")}`
      : "";
    await moveTo(ctx, story, userId, nextStage(story.stage), note, extra);
  },
});

/** Moves the story to any stage: back to redo work, or forward to skip one. */
export const setStage = mutation({
  args: {
    storyId: v.id("stories"),
    userId: v.id("users"),
    stage: stageValidator,
    note: v.optional(v.string()),
  },
  handler: async (ctx, { storyId, userId, stage, note }) => {
    const story = await ctx.db.get(storyId);
    if (!story) throw new Error("Story not found");
    if (stage === story.stage) return;
    await closeRequests(ctx, storyId, "superseded", userId);
    await moveTo(ctx, story, userId, stage, note);
  },
});
