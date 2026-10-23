import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { FEEDBACK_QUIET_MS } from "../shared/director";
import { stageInfo } from "../shared/stages";
import { closeRequests } from "./requests";
import { queueTurn } from "./turns";

type Kind = Doc<"feedback">["kind"];

/**
 * Notes a review comment, image comment or note edit on a story's video, to
 * go to the production AI once people have been quiet for a few minutes.
 * Comments on plain reviews and the AI's own posts are ignored.
 */
export async function recordFeedback(
  ctx: MutationCtx,
  videoId: Id<"videos">,
  kind: Kind,
  refId: string,
  authorId: Id<"users">,
) {
  const video = await ctx.db.get(videoId);
  if (!video?.storyId) return;
  if ((await ctx.db.get(authorId))?.bot) return;
  const storyId = video.storyId;
  const unsent = await ctx.db
    .query("feedback")
    .withIndex("by_story_sent", (q) => q.eq("storyId", storyId).eq("sentAt", undefined))
    .collect();
  // A note saved on every keystroke is one piece of feedback.
  if (!unsent.some((f) => f.refId === refId)) {
    await ctx.db.insert("feedback", { storyId, kind, refId, authorId });
  }
  const dueAt = Date.now() + FEEDBACK_QUIET_MS;
  await ctx.db.patch(storyId, { feedbackDueAt: dueAt });
  await ctx.scheduler.runAt(dueAt, internal.feedback.flush, { storyId });
}

const clock = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
};

function describeDrawing(drawing: Doc<"comments">["drawing"]) {
  if (!drawing?.length) return "";
  const shapes = drawing.map((d) => {
    const xs = d.points.filter((_, i) => i % 2 === 0);
    const ys = d.points.filter((_, i) => i % 2 === 1);
    const box = `x ${Math.min(...xs).toFixed(2)}-${Math.max(...xs).toFixed(2)}, y ${Math.min(...ys).toFixed(2)}-${Math.max(...ys).toFixed(2)}`;
    return `${d.tool === "rect" ? "box" : d.tool} around ${box}`;
  });
  return ` [drawn on the frame: ${shapes.join("; ")} (0..1 of the frame, origin top left)]`;
}

/** The feedback as the production AI reads it. */
export async function describe(ctx: QueryCtx, rows: Doc<"feedback">[]) {
  const name = async (id: Id<"users">) => (await ctx.db.get(id))?.name ?? "Someone";
  const lines: string[] = [];
  for (const f of rows) {
    const who = await name(f.authorId);
    if (f.kind === "comment" || f.kind === "reply") {
      const c = await ctx.db.get(f.refId as Id<"comments">);
      if (!c) continue;
      const version = await ctx.db.get(c.versionId);
      const at = `cut v${version?.number ?? "?"}`;
      if (c.parentId) {
        const parent = await ctx.db.get(c.parentId);
        lines.push(
          `- ${who} replied on ${at} (comment ${c.parentId}, "${(parent?.body ?? "").slice(0, 160)}"): ${c.body}`,
        );
      } else {
        const when =
          c.time !== undefined ? (c.endTime !== undefined ? `${clock(c.time)}-${clock(c.endTime)}` : clock(c.time)) : "";
        lines.push(`- ${who} on ${at} at ${when} (comment ${c._id}): ${c.body}${describeDrawing(c.drawing)}`);
      }
    } else if (f.kind === "imageComment") {
      const c = await ctx.db.get(f.refId as Id<"imageComments">);
      if (!c) continue;
      const image = await ctx.db.get(c.imageId);
      const pin = c.x !== undefined && c.y !== undefined ? ` pinned at x ${c.x.toFixed(2)}, y ${c.y.toFixed(2)}` : "";
      lines.push(
        `- ${who} on image ${image?.fileName ?? "(deleted)"}${image?.caption ? ` (${image.caption})` : ""}${pin}: ${c.body}`,
      );
    } else if (f.kind === "note") {
      const n = await ctx.db.get(f.refId as Id<"notes">);
      if (!n) continue;
      lines.push(`- ${who} edited the note "${n.title || "Untitled"}" (note ${n._id}). It now reads:\n${n.body.slice(0, 4000)}`);
    }
  }
  return lines;
}

/** Marks the story's unsent feedback sent and returns it as the production AI reads it. */
export async function takePending(ctx: MutationCtx, storyId: Id<"stories">) {
  const rows = await ctx.db
    .query("feedback")
    .withIndex("by_story_sent", (q) => q.eq("storyId", storyId).eq("sentAt", undefined))
    .collect();
  await ctx.db.patch(storyId, { feedbackDueAt: undefined });
  const lines = await describe(ctx, rows);
  const now = Date.now();
  for (const f of rows) await ctx.db.patch(f._id, { sentAt: now });
  return lines;
}

/**
 * Sends the collected feedback to the production AI if it's due (or now, with
 * `force`). `sentBack`: someone pressed "Not good" and said why.
 */
async function flushStory(
  ctx: MutationCtx,
  storyId: Id<"stories">,
  force?: boolean,
  sentBack?: { userId: Id<"users">; text: string; anchored: boolean },
) {
    const story = await ctx.db.get(storyId);
    if (!story) return;
    if (!sentBack) {
      if (!story.feedbackDueAt) return;
      if (!force && story.feedbackDueAt > Date.now()) return; // a newer comment pushed it back
    }
    const lines = await takePending(ctx, storyId);
    if (!lines.length && !sentBack) return;
    const n = lines.length;
    const label = stageInfo(story.stage).label;
    const who = sentBack && ((await ctx.db.get(sentBack.userId))?.name ?? "Someone");
    const lead = sentBack
      ? `${who} looked at ${label} and says it's not good yet.${sentBack.text && !sentBack.anchored ? ` In their words: ${sentBack.text}` : ""}${n ? "\n\nTheir notes:" : ""}`
      : `New review feedback on "${story.title}" (stage: ${label}):`;
    await queueTurn(ctx, storyId, {
      kind: "feedback",
      display: sentBack
        ? `Not good${sentBack.text ? `: ${sentBack.text}` : ""}`
        : `${n} piece${n === 1 ? "" : "s"} of review feedback`,
      requestedBy: sentBack?.userId,
      prompt: `${lead}

${lines.join("\n")}

Work through every item. Fix what's asked and post a new cut (or new images) that includes all the fixes, then request review. Reply to a comment (reply_to_comment) when you need to explain something or can't do it, and resolve the comments you fixed (resolve_comment). If an item is a question, answer it in your reply here and on the comment.`,
    });
}

export const flush = internalMutation({
  args: { storyId: v.id("stories"), force: v.optional(v.boolean()) },
  handler: (ctx, { storyId, force }) => flushStory(ctx, storyId, force),
});

/**
 * "Not good": the open review goes back to the director now, with why, any
 * notes still waiting, and a note on each image or cut moment it points at.
 */
export const sendBack = mutation({
  args: {
    storyId: v.id("stories"),
    userId: v.id("users"),
    text: v.string(),
    imageIds: v.optional(v.array(v.id("images"))),
    cut: v.optional(v.object({ versionId: v.id("versions"), time: v.number() })),
  },
  handler: async (ctx, { storyId, userId, text, imageIds, cut }) => {
    const body = text.trim().slice(0, 5000);
    const anchored = !!imageIds?.length || !!cut;
    if (!body && !anchored) throw new Error("Say what's wrong");
    await addAnchoredNotes(ctx, userId, body || "Not good", imageIds, cut);
    await closeRequests(ctx, storyId, "changes", userId, "review");
    await flushStory(ctx, storyId, true, { userId, text: body, anchored });
  },
});

/** A note on images or a moment of a cut, made from the thread; it goes to the director with the next batch. */
export async function addAnchoredNotes(
  ctx: MutationCtx,
  userId: Id<"users">,
  body: string,
  imageIds?: Id<"images">[],
  cut?: { versionId: Id<"versions">; time: number },
) {
  for (const imageId of imageIds ?? []) {
    const image = await ctx.db.get(imageId);
    if (!image) continue;
    const id = await ctx.db.insert("imageComments", { imageId, authorId: userId, body });
    await recordFeedback(ctx, image.videoId, "imageComment", id, userId);
  }
  if (cut) {
    const version = await ctx.db.get(cut.versionId);
    if (version) {
      const id = await ctx.db.insert("comments", {
        videoId: version.videoId,
        versionId: version._id,
        authorId: userId,
        body,
        time: Math.max(0, cut.time),
        resolved: false,
      });
      await recordFeedback(ctx, version.videoId, "comment", id, userId);
    }
  }
}

/** A note typed in the thread with images or a cut moment attached. */
export const addNote = mutation({
  args: {
    userId: v.id("users"),
    text: v.string(),
    imageIds: v.optional(v.array(v.id("images"))),
    cut: v.optional(v.object({ versionId: v.id("versions"), time: v.number() })),
  },
  handler: async (ctx, { userId, text, imageIds, cut }) => {
    const body = text.trim().slice(0, 5000);
    if (!body) throw new Error("Empty note");
    await addAnchoredNotes(ctx, userId, body, imageIds, cut);
  },
});

/** "Send now": skip the quiet period. */
export const sendNow = mutation({
  args: { storyId: v.id("stories") },
  handler: async (ctx, { storyId }) => {
    await flushStory(ctx, storyId, true);
  },
});

/** How much feedback is waiting and when it goes. */
export const pending = query({
  args: { storyId: v.id("stories") },
  handler: async (ctx, { storyId }) => {
    const story = await ctx.db.get(storyId);
    const rows = await ctx.db
      .query("feedback")
      .withIndex("by_story_sent", (q) => q.eq("storyId", storyId).eq("sentAt", undefined))
      .collect();
    return { count: rows.length, dueAt: story?.feedbackDueAt ?? null };
  },
});
