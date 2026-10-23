import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { takePending } from "./feedback";
import { closeRequests } from "./requests";

type TurnKind = Doc<"turns">["kind"];

/** Queues a turn for a story's production AI; the director runs them one at a time, oldest first. */
export async function queueTurn(
  ctx: MutationCtx,
  storyId: Id<"stories">,
  turn: { kind: TurnKind; prompt: string; display: string; requestedBy?: Id<"users">; resumes?: number },
) {
  const story = await ctx.db.get(storyId);
  await ctx.db.patch(storyId, { updatedAt: Date.now() });
  return ctx.db.insert("turns", {
    storyId,
    stage: story?.stage,
    ...turn,
    status: "queued",
    response: "",
    activity: [],
  });
}

/** A story's turns, newest 80 (the thread uses requests.thread). */
export const list = query({
  args: { storyId: v.id("stories") },
  handler: async (ctx, { storyId }) => {
    const rows = await ctx.db
      .query("turns")
      .withIndex("by_story", (q) => q.eq("storyId", storyId))
      .order("desc")
      .take(80);
    return rows.reverse();
  },
});

/** Someone writes to the production AI. */
export const send = mutation({
  args: { storyId: v.id("stories"), userId: v.id("users"), text: v.string() },
  handler: async (ctx, { storyId, userId, text }) => {
    const story = await ctx.db.get(storyId);
    if (!story) throw new Error("Story not found");
    const body = text.trim().slice(0, 20_000);
    if (!body) return null;
    const who = (await ctx.db.get(userId))?.name ?? "Someone";
    // A message while the director's question is open answers it.
    await closeRequests(ctx, storyId, "answered", userId, "question");
    // Notes still waiting for their quiet spell go along with the message.
    const notes = await takePending(ctx, storyId);
    const withNotes = notes.length
      ? `\n\nReview notes that came in before this message (handle them like a feedback turn: fix, resolve_comment what you fixed, reply_to_comment where needed):\n${notes.join("\n")}`
      : "";
    return queueTurn(ctx, storyId, {
      kind: "message",
      prompt: `${who} writes to you in the story's thread:\n\n${body}${withNotes}`,
      display: body,
      requestedBy: userId,
    });
  },
});

/** Stops a queued or running turn; the director aborts the running one. */
export const cancel = mutation({
  args: { turnId: v.id("turns") },
  handler: async (ctx, { turnId }) => {
    const turn = await ctx.db.get(turnId);
    if (turn && (turn.status === "queued" || turn.status === "running")) {
      await ctx.db.patch(turnId, { status: "cancelled", finishedAt: Date.now() });
    }
  },
});

/** Starts the production AI on a fresh session; it forgets everything said so far. */
export const newSession = mutation({
  args: { storyId: v.id("stories") },
  handler: async (ctx, { storyId }) => {
    await ctx.db.patch(storyId, {
      sessionId: undefined,
      sessionTokens: undefined,
      conversationStartedAt: Date.now(),
    });
  },
});
