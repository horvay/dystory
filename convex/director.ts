// What the director worker (worker/director.ts) calls: claiming turns of the
// production AI, recording what it does, and the app tools it uses (posting
// cuts and images, replying to comments, asking for review, waiting on jobs).
import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { COMPACT_TOKENS } from "../shared/director";
import { STAGES, stageInfo } from "../shared/stages";
import { applyEdits, docMarkdown } from "./ai";
import { directorUser } from "./bots";
import { fileInfo } from "./schema";
import { takeSnapshot } from "./snapshots";
import { openRequest } from "./requests";
import { queueTurn } from "./turns";

// ---------------------------------------------------------------------------
// The worker's loop
// ---------------------------------------------------------------------------

export const queued = query({
  args: {},
  handler: async (ctx) =>
    (
      await ctx.db
        .query("turns")
        .withIndex("by_status", (q) => q.eq("status", "queued"))
        .collect()
    ).map((t) => ({ _id: t._id, storyId: t.storyId })),
});

export const status = query({
  args: { turnId: v.id("turns") },
  handler: async (ctx, { turnId }) => (await ctx.db.get(turnId))?.status ?? null,
});

/** On worker startup: turns still "running" were cut off by a restart. */
/** Restarts cut off at most this many turns in a row before it asks people. */
const MAX_RESUMES = 2;

/**
 * At startup: turns that were running when the director stopped were cut off
 * mid-work. The session has everything up to that point, so each story picks
 * up where it was with a new turn in the same session.
 */
export const resetStale = mutation({
  args: {},
  handler: async (ctx) => {
    const running = await ctx.db
      .query("turns")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .collect();
    for (const t of running) await resumeCutOff(ctx, t);
  },
});

async function resumeCutOff(ctx: MutationCtx, turn: Doc<"turns">) {
  const resumes = (turn.resumes ?? 0) + 1;
  const giveUp = resumes > MAX_RESUMES;
  await ctx.db.patch(turn._id, {
    status: "error",
    error: giveUp
      ? "Cut off by a restart again, so it stopped retrying."
      : "Cut off by a restart. It picks up where it left off below.",
    finishedAt: Date.now(),
  });
  const story = await ctx.db.get(turn.storyId);
  if (!story || story.trashed) return;
  // Where the story stood: what the cut-off turn set (review, a question), else as it was.
  const state = story.stateSet ? story.state : story.prevState ?? story.state;
  if (giveUp) {
    await ctx.db.patch(story._id, {
      prevState: undefined,
      stateSet: undefined,
      ...(story.stateSet || story.stage === "script" || story.stage === "done"
        ? {}
        : { state: "waiting" as const, statusLine: "Restarts kept cutting the director off. Tell it to carry on." }),
    });
    return;
  }
  await ctx.db.patch(story._id, { prevState: undefined, stateSet: undefined, state });
  const what = turn.resumes
    ? "the turn that was picking up after the previous restart"
    : `the turn you were on (${turn.display})`;
  await queueTurn(ctx, story._id, {
    kind: "wake",
    display: "Picking up after a restart",
    resumes,
    prompt: [
      `Dynastory restarted while you were working, which cut off ${what}.`,
      "Anything you were running in the foreground (commands, renders, scripts, subagents) was killed. Background jobs started with start_job kept running and will still wake you.",
      "Check what got finished and what was left half-done (partial or missing files, a render that never wrote its output), redo what's needed, and carry on from there.",
    ].join("\n\n"),
  });
}

/** Picks up a turn that a restart cut off (for turns cut off before this existed). */
export const resumeTurn = mutation({
  args: { turnId: v.id("turns") },
  handler: async (ctx, { turnId }) => {
    const turn = await ctx.db.get(turnId);
    if (!turn) throw new ConvexError("Turn not found");
    await resumeCutOff(ctx, { ...turn, resumes: undefined });
  },
});

/** Records the session as soon as a turn starts, so a cut-off first turn can still be resumed. */
export const setSession = mutation({
  args: { turnId: v.id("turns"), sessionId: v.string() },
  handler: async (ctx, { turnId, sessionId }) => {
    const turn = await ctx.db.get(turnId);
    if (!turn || turn.status !== "running") return;
    const story = await ctx.db.get(turn.storyId);
    if (story && story.sessionId !== sessionId) await ctx.db.patch(story._id, { sessionId });
  },
});

export const claim = mutation({
  args: { turnId: v.id("turns") },
  handler: async (ctx, { turnId }) => {
    const turn = await ctx.db.get(turnId);
    if (!turn || turn.status !== "queued") return null;
    const story = await ctx.db.get(turn.storyId);
    if (!story || story.trashed) {
      await ctx.db.patch(turnId, { status: "cancelled", finishedAt: Date.now() });
      return null;
    }
    await ctx.db.patch(turnId, { status: "running", startedAt: Date.now() });
    // Whatever it was doing, it's working on it now. finish() decides where
    // the story stands afterwards.
    await ctx.db.patch(story._id, {
      prevState: story.state,
      stateSet: false,
      ...(story.state === "review" || story.state === "waiting" ? { state: "working" as const } : {}),
    });
    const requester = turn.requestedBy && (await ctx.db.get(turn.requestedBy));
    return {
      turnId,
      kind: turn.kind,
      prompt: turn.prompt,
      requesterName: requester ? requester.name : null,
      story: {
        _id: story._id,
        title: story.title,
        slug: story.slug,
        stage: story.stage,
        docId: story.docId,
        videoId: story.videoId,
        sessionId: story.sessionId,
      },
    };
  },
});

export const progress = mutation({
  args: { turnId: v.id("turns"), response: v.optional(v.string()), activity: v.optional(v.string()) },
  handler: async (ctx, { turnId, response, activity }) => {
    const turn = await ctx.db.get(turnId);
    if (!turn || turn.status !== "running") return;
    await ctx.db.patch(turnId, {
      ...(response !== undefined ? { response } : {}),
      ...(activity ? { activity: [...turn.activity, activity].slice(-60) } : {}),
    });
  },
});

export const finish = mutation({
  args: {
    turnId: v.id("turns"),
    response: v.string(),
    sessionId: v.optional(v.string()),
    // Context size at the end of the turn.
    tokens: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { turnId, response, sessionId, tokens, error }) => {
    const turn = await ctx.db.get(turnId);
    if (!turn) return;
    const cancelled = turn.status === "cancelled";
    await ctx.db.patch(turnId, {
      status: cancelled ? "cancelled" : error ? "error" : "done",
      response,
      error,
      finishedAt: Date.now(),
    });
    const story = await ctx.db.get(turn.storyId);
    if (!story) return;

    const patch: Partial<Doc<"stories">> = {};
    if (sessionId) {
      patch.sessionId = sessionId;
      patch.sessionTokens = turn.kind === "compact" ? undefined : tokens;
    }

    const waiting = await ctx.db
      .query("wakeups")
      .withIndex("by_story", (q) => q.eq("storyId", story._id))
      .filter((q) => q.eq(q.field("status"), "waiting"))
      .first();
    const prev = story.prevState ?? story.state;
    if (story.stage === "script" || story.stage === "done") {
      // Before production and after it, talking to the director doesn't change anything.
      patch.state = story.stage === "done" ? "done" : "writing";
      patch.statusLine = undefined;
    } else if (story.stateSet) {
      // It asked for review or asked a question itself.
    } else if (error && !cancelled) {
      patch.state = "waiting";
      patch.statusLine = `The last turn failed: ${error.slice(0, 200)}`;
    } else if (waiting) {
      patch.state = "working";
    } else if (prev !== "working" && (turn.kind === "message" || turn.kind === "compact" || turn.resumes || cancelled)) {
      // A question answered or a turn stopped: back to where things were.
      patch.state = prev;
    } else if (cancelled) {
      patch.state = "waiting";
      patch.statusLine = "Stopped. Write to the director to carry on.";
    } else {
      patch.state = "waiting";
      patch.statusLine = "The director stopped without asking for review. Its last message says why.";
    }
    patch.prevState = undefined;
    patch.stateSet = undefined;
    await ctx.db.patch(story._id, patch);

    const total = sessionId ? tokens ?? 0 : 0;
    if (!cancelled && turn.kind !== "compact" && total > COMPACT_TOKENS) {
      await queueTurn(ctx, story._id, {
        kind: "compact",
        prompt: "/compact",
        display: `Compacting the conversation (${Math.round(total / 1000)}k tokens)`,
      });
      return null;
    }
    if (cancelled || turn.kind === "compact") return null;
    const after = { ...story, ...patch };
    // Still on it (a background job), or more work already queued: not yet.
    if (after.state === "working") return null;
    const next = await ctx.db
      .query("turns")
      .withIndex("by_story", (q) => q.eq("storyId", story._id))
      .filter((q) => q.eq(q.field("status"), "queued"))
      .first();
    if (next) return null;
    return handBack(after, response, !!error);
  },
});

/** The notification for a story the director just handed back to people. */
export function handBack(story: Doc<"stories">, response: string, failed: boolean) {
  const headline =
    story.state === "review"
      ? "Ready for review"
      : failed
        ? "The director hit a problem"
        : story.state === "waiting"
          ? "The director needs you"
          : "The director replied";
  const body = (story.state === "review" || story.state === "waiting") && story.statusLine ? story.statusLine : response;
  return {
    title: `${story.title}: ${headline}`,
    // Plain text: notifications don't render Markdown.
    body: clean(body.replace(/[*_`#>]/g, "").replace(/\s+/g, " "), 180) || stageInfo(story.stage).label,
    url: `/s/${story._id}`,
    tag: `story-${story._id}`,
  };
}

// ---------------------------------------------------------------------------
// Tools the production AI calls during a turn
// ---------------------------------------------------------------------------

async function runningTurn(ctx: MutationCtx, turnId: Id<"turns">) {
  const turn = await ctx.db.get(turnId);
  if (!turn) throw new ConvexError("Turn not found");
  if (turn.status !== "running") throw new ConvexError("This turn was stopped.");
  const story = await ctx.db.get(turn.storyId);
  if (!story) throw new ConvexError("Story not found");
  return { turn, story };
}

const clean = (s: string, max = 5000) => s.trim().slice(0, max);

export const setStatus = mutation({
  args: { turnId: v.id("turns"), line: v.string() },
  handler: async (ctx, { turnId, line }) => {
    const { story } = await runningTurn(ctx, turnId);
    await ctx.db.patch(story._id, { statusLine: clean(line, 300), updatedAt: Date.now() });
  },
});

export const requestReview = mutation({
  args: {
    turnId: v.id("turns"),
    message: v.string(),
    // What to show; by default everything posted since the last request.
    cuts: v.optional(v.array(v.number())),
    images: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { turnId, message, cuts, images }) => {
    const { story } = await runningTurn(ctx, turnId);
    const line = clean(message, 300) || `${stageInfo(story.stage).label} is ready for review`;
    await openRequest(ctx, story, turnId, "review", line, { cuts, images });
    await ctx.db.patch(story._id, {
      state: "review",
      stateSet: true,
      statusLine: line,
      updatedAt: Date.now(),
    });
  },
});

export const askUser = mutation({
  args: { turnId: v.id("turns"), question: v.string() },
  handler: async (ctx, { turnId, question }) => {
    const { story } = await runningTurn(ctx, turnId);
    await openRequest(ctx, story, turnId, "question", clean(question, 1000));
    await ctx.db.patch(story._id, {
      state: "waiting",
      stateSet: true,
      statusLine: clean(question, 300),
      updatedAt: Date.now(),
    });
  },
});

/** Everything the production AI needs to know about where the story stands. */
export const storyInfo = mutation({
  args: { turnId: v.id("turns") },
  handler: async (ctx, { turnId }) => {
    const { story } = await runningTurn(ctx, turnId);
    const versions = await ctx.db
      .query("versions")
      .withIndex("by_video", (q) => q.eq("videoId", story.videoId))
      .collect();
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_video", (q) => q.eq("videoId", story.videoId))
      .collect();
    const images = await ctx.db
      .query("images")
      .withIndex("by_video", (q) => q.eq("videoId", story.videoId))
      .collect();
    const notes = await ctx.db
      .query("notes")
      .withIndex("by_video", (q) => q.eq("videoId", story.videoId))
      .collect();
    const jobs = await ctx.db
      .query("wakeups")
      .withIndex("by_story", (q) => q.eq("storyId", story._id))
      .filter((q) => q.eq(q.field("status"), "waiting"))
      .collect();
    return {
      title: story.title,
      slug: story.slug,
      stage: story.stage,
      stages: STAGES.map((s) => s.id),
      state: story.state,
      statusLine: story.statusLine,
      cuts: versions.map((ver) => {
        const top = comments.filter((c) => c.versionId === ver._id && !c.parentId);
        return {
          number: ver.number,
          stage: ver.stage,
          summary: ver.summary,
          fileName: ver.fileName,
          duration: ver.duration,
          comments: top.length,
          open: top.filter((c) => !c.resolved).length,
        };
      }),
      images: images.length,
      notes: notes.map((n) => n.title || "Untitled"),
      waitingOn: jobs.map((j) => ({ note: j.note, unit: j.unit, at: j.at, log: j.log })),
    };
  },
});

/** Open comments on the newest cuts, image comments and notes. */
export const openFeedback = mutation({
  args: { turnId: v.id("turns") },
  handler: async (ctx, { turnId }) => {
    const { story } = await runningTurn(ctx, turnId);
    const users = new Map((await ctx.db.query("users").collect()).map((u) => [u._id, u.name]));
    const versions = await ctx.db
      .query("versions")
      .withIndex("by_video", (q) => q.eq("videoId", story.videoId))
      .collect();
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_video", (q) => q.eq("videoId", story.videoId))
      .collect();
    const cut = (id: Id<"versions">) => versions.find((x) => x._id === id)?.number;
    const open = comments
      .filter((c) => !c.parentId && !c.resolved)
      .map((c) => ({
        id: c._id,
        cut: cut(c.versionId),
        time: c.time,
        endTime: c.endTime,
        by: users.get(c.authorId),
        body: c.body,
        drawing: c.drawing?.length ? c.drawing.map((d) => d.tool).join(", ") : undefined,
        replies: comments
          .filter((r) => r.parentId === c._id)
          .map((r) => ({ id: r._id, by: users.get(r.authorId), body: r.body })),
      }));
    const images = await ctx.db
      .query("images")
      .withIndex("by_video", (q) => q.eq("videoId", story.videoId))
      .collect();
    const imageComments = [];
    for (const img of images) {
      for (const c of await ctx.db
        .query("imageComments")
        .withIndex("by_image", (q) => q.eq("imageId", img._id))
        .collect()) {
        imageComments.push({ image: img.fileName, caption: img.caption, by: users.get(c.authorId), body: c.body, x: c.x, y: c.y });
      }
    }
    const notes = await ctx.db
      .query("notes")
      .withIndex("by_video", (q) => q.eq("videoId", story.videoId))
      .collect();
    return {
      openComments: open,
      imageComments,
      notes: notes.map((n) => ({ id: n._id, title: n.title, by: users.get(n.updatedBy), body: n.body.slice(0, 4000) })),
    };
  },
});

export const readScript = mutation({
  args: { turnId: v.id("turns") },
  handler: async (ctx, { turnId }) => {
    const { story } = await runningTurn(ctx, turnId);
    const doc = await ctx.db.get(story.docId);
    return { title: doc?.title ?? story.title, markdown: await docMarkdown(ctx, story.docId) };
  },
});

export const editScript = mutation({
  args: {
    turnId: v.id("turns"),
    edits: v.array(v.object({ find: v.string(), replace: v.string() })),
    reason: v.string(),
  },
  handler: async (ctx, { turnId, edits, reason }) => {
    const { story } = await runningTurn(ctx, turnId);
    await takeSnapshot(ctx, story.docId, "ai-before");
    await applyEdits(ctx, story.docId, edits, "director");
    const now = Date.now();
    await ctx.db.patch(story.docId, { updatedAt: now, lastChangedAt: now });
    await takeSnapshot(ctx, story.docId, "ai-after", { byAi: true, label: `Director: ${clean(reason, 80)}` });
  },
});

export const addVersion = mutation({
  args: { turnId: v.id("turns"), summary: v.string(), ...fileInfo },
  handler: async (ctx, { turnId, summary, ...file }) => {
    const { story } = await runningTurn(ctx, turnId);
    const video = await ctx.db.get(story.videoId);
    if (!video) throw new ConvexError("The story's video is gone");
    const userId = await directorUser(ctx);
    const number = video.latestVersion + 1;
    await ctx.db.insert("versions", {
      videoId: video._id,
      number,
      uploadedBy: userId,
      stage: story.stage,
      summary: clean(summary, 2000) || undefined,
      turnId,
      ...file,
    });
    await ctx.db.patch(video._id, {
      latestVersion: number,
      latestFileId: file.fileId,
      latestDuration: file.duration,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(story._id, { updatedAt: Date.now() });
    return { number, videoId: video._id };
  },
});

export const addImage = mutation({
  args: {
    turnId: v.id("turns"),
    file: v.string(),
    thumb: v.string(),
    fileName: v.string(),
    size: v.number(),
    width: v.number(),
    height: v.number(),
    caption: v.optional(v.string()),
  },
  handler: async (ctx, { turnId, caption, fileName, ...rest }) => {
    const { story } = await runningTurn(ctx, turnId);
    const userId = await directorUser(ctx);
    await ctx.db.patch(story.videoId, { updatedAt: Date.now() });
    return ctx.db.insert("images", {
      videoId: story.videoId,
      uploadedBy: userId,
      fileName: fileName.slice(0, 200),
      caption: caption ? clean(caption, 300) : undefined,
      turnId,
      ...rest,
    });
  },
});

/** Writes the note with this title, or a new one. */
export const writeNote = mutation({
  args: { turnId: v.id("turns"), title: v.string(), body: v.string() },
  handler: async (ctx, { turnId, title, body }) => {
    const { story } = await runningTurn(ctx, turnId);
    const userId = await directorUser(ctx);
    const notes = await ctx.db
      .query("notes")
      .withIndex("by_video", (q) => q.eq("videoId", story.videoId))
      .collect();
    const name = clean(title, 200);
    const existing = notes.find((n) => n.title.trim().toLowerCase() === name.toLowerCase());
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        body: body.slice(0, 200_000),
        updatedBy: userId,
        updatedAt: Math.max(now, existing.updatedAt + 1),
      });
    } else {
      await ctx.db.insert("notes", {
        videoId: story.videoId,
        title: name,
        body: body.slice(0, 200_000),
        createdBy: userId,
        updatedBy: userId,
        updatedAt: now,
      });
    }
    await ctx.db.patch(story.videoId, { updatedAt: now });
    return existing ? "updated" : "created";
  },
});

async function storyComment(ctx: MutationCtx, story: Doc<"stories">, commentId: string) {
  const id = ctx.db.normalizeId("comments", commentId);
  const comment = id && (await ctx.db.get(id));
  if (!comment || comment.videoId !== story.videoId) throw new ConvexError(`No comment ${commentId} on this story`);
  return comment;
}

export const replyToComment = mutation({
  args: { turnId: v.id("turns"), commentId: v.string(), body: v.string() },
  handler: async (ctx, { turnId, commentId, body }) => {
    const { story } = await runningTurn(ctx, turnId);
    const parent = await storyComment(ctx, story, commentId);
    if (!clean(body)) throw new ConvexError("Empty reply");
    await ctx.db.insert("comments", {
      videoId: parent.videoId,
      versionId: parent.versionId,
      parentId: parent.parentId ?? parent._id,
      authorId: await directorUser(ctx),
      body: clean(body),
      resolved: false,
    });
  },
});

export const resolveComment = mutation({
  args: { turnId: v.id("turns"), commentId: v.string() },
  handler: async (ctx, { turnId, commentId }) => {
    const { story } = await runningTurn(ctx, turnId);
    const comment = await storyComment(ctx, story, commentId);
    await ctx.db.patch(comment._id, { resolved: true, resolvedBy: await directorUser(ctx) });
  },
});

// ---------------------------------------------------------------------------
// Waiting between turns: background jobs and timers
// ---------------------------------------------------------------------------

export const addWakeup = mutation({
  args: {
    turnId: v.id("turns"),
    note: v.string(),
    unit: v.optional(v.string()),
    log: v.optional(v.string()),
    at: v.optional(v.number()),
  },
  handler: async (ctx, { turnId, note, unit, log, at }) => {
    const { story } = await runningTurn(ctx, turnId);
    await ctx.db.patch(story._id, { statusLine: clean(note, 300), updatedAt: Date.now() });
    return ctx.db.insert("wakeups", { storyId: story._id, note: clean(note, 500), unit, log, at, status: "waiting" });
  },
});

export const cancelWakeups = mutation({
  args: { turnId: v.id("turns") },
  handler: async (ctx, { turnId }) => {
    const { story } = await runningTurn(ctx, turnId);
    const rows = await ctx.db
      .query("wakeups")
      .withIndex("by_story", (q) => q.eq("storyId", story._id))
      .filter((q) => q.eq(q.field("status"), "waiting"))
      .collect();
    for (const w of rows) await ctx.db.patch(w._id, { status: "cancelled", stopUnit: w.unit ? true : undefined });
    return rows.length;
  },
});

export const waitingWakeups = query({
  args: {},
  handler: async (ctx) =>
    ctx.db
      .query("wakeups")
      .withIndex("by_status", (q) => q.eq("status", "waiting"))
      .collect(),
});

/** A job finished or a timer came due: wake the production AI with what happened. */
export const fireWakeup = mutation({
  args: { wakeupId: v.id("wakeups"), report: v.string() },
  handler: async (ctx, { wakeupId, report }) => {
    const w = await ctx.db.get(wakeupId);
    if (!w || w.status !== "waiting") return;
    await ctx.db.patch(wakeupId, { status: "fired", firedAt: Date.now() });
    const story = await ctx.db.get(w.storyId);
    if (!story || story.trashed) return;
    // The status was this job's note; it's done now.
    if (story.statusLine === w.note.slice(0, 300)) await ctx.db.patch(story._id, { statusLine: undefined });
    await queueTurn(ctx, w.storyId, {
      kind: "wake",
      prompt: report,
      display: w.unit ? `Job finished: ${w.note}` : `Timer: ${w.note}`,
    });
  },
});

/** Stops a job the story is waiting on (the Stop button next to it). */
export const cancelWakeup = mutation({
  args: { wakeupId: v.id("wakeups"), userId: v.id("users") },
  handler: async (ctx, { wakeupId, userId }) => {
    const w = await ctx.db.get(wakeupId);
    if (w?.status !== "waiting") return;
    await ctx.db.patch(wakeupId, { status: "cancelled", stopUnit: w.unit ? true : undefined });
    const who = (await ctx.db.get(userId))?.name ?? "Someone";
    await queueTurn(ctx, w.storyId, {
      kind: "wake",
      prompt: `${who} stopped the background job "${w.note}"${w.unit ? ` (unit ${w.unit})` : ""}. Say what that means for the work and wait for instructions unless the next step is obvious.`,
      display: `Stopped: ${w.note}`,
      requestedBy: userId,
    });
  },
});

/** Jobs whose units the director should stop. */
/** A queued B70 job's place in line (cleared once it runs). */
export const setWakeupQueue = mutation({
  args: { wakeupId: v.id("wakeups"), queue: v.optional(v.string()) },
  handler: async (ctx, { wakeupId, queue }) => {
    const w = await ctx.db.get(wakeupId);
    if (w && w.status === "waiting" && w.queue !== queue) await ctx.db.patch(wakeupId, { queue });
  },
});

export const unitsToStop = query({
  args: {},
  handler: async (ctx) =>
    (
      await ctx.db
        .query("wakeups")
        .withIndex("by_status", (q) => q.eq("status", "cancelled"))
        .collect()
    ).filter((w) => w.stopUnit && w.unit),
});

export const unitStopped = mutation({
  args: { wakeupId: v.id("wakeups") },
  handler: async (ctx, { wakeupId }) => {
    await ctx.db.patch(wakeupId, { stopUnit: undefined });
  },
});

// ---------------------------------------------------------------------------
// The voice catalog
// ---------------------------------------------------------------------------

export const addVoice = mutation({
  args: {
    turnId: v.id("turns"),
    name: v.string(),
    character: v.optional(v.string()),
    description: v.string(),
    refPath: v.string(),
    refText: v.string(),
    notes: v.optional(v.string()),
    audioFile: v.string(),
    duration: v.number(),
  },
  handler: async (ctx, { turnId, ...voice }) => {
    const { story } = await runningTurn(ctx, turnId);
    return ctx.db.insert("voices", {
      ...voice,
      name: clean(voice.name, 80),
      description: clean(voice.description, 2000),
      storyId: story._id,
      createdBy: await directorUser(ctx),
      trashed: false,
    });
  },
});
