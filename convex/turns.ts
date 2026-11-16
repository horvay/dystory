import { ConvexError, v, type Infer } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { takePending } from "./feedback";
import { closeRequests } from "./requests";
import { attachment } from "./schema";

type TurnKind = Doc<"turns">["kind"];
export type Attachment = Infer<typeof attachment>;

/** The media server's own names for an image and its thumbnail; nothing else is a path we hand the AI. */
const IMAGE_FILE = /^[0-9a-f-]{36}(\.thumb)?\.(jpg|png|webp|gif|avif)$/;
const MAX_ATTACHMENTS = 12;

/** Checks the images sent with a message. Returns undefined when there are none. */
export function cleanAttachments(images: Attachment[] | undefined): Attachment[] | undefined {
  if (!images?.length) return undefined;
  if (images.length > MAX_ATTACHMENTS) throw new ConvexError(`At most ${MAX_ATTACHMENTS} images per message`);
  return images.map((a) => {
    if (!IMAGE_FILE.test(a.file) || !IMAGE_FILE.test(a.thumb)) throw new ConvexError("That image didn't upload properly. Try again.");
    return { ...a, fileName: a.fileName.slice(0, 200) };
  });
}

/** Queues a turn for a story's production AI; the director runs them one at a time, oldest first. */
export async function queueTurn(
  ctx: MutationCtx,
  storyId: Id<"stories">,
  turn: {
    kind: TurnKind;
    prompt: string;
    display: string;
    requestedBy?: Id<"users">;
    resumes?: number;
    attachments?: Attachment[];
  },
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

/** Someone writes to the production AI, with or without images for it to look at. */
export const send = mutation({
  args: { storyId: v.id("stories"), userId: v.id("users"), text: v.string(), images: v.optional(v.array(attachment)) },
  handler: async (ctx, { storyId, userId, text, images }) => {
    const story = await ctx.db.get(storyId);
    if (!story) throw new Error("Story not found");
    const body = text.trim().slice(0, 20_000);
    const attachments = cleanAttachments(images);
    if (!body && !attachments) return null;
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
      prompt: `${who} writes to you in the story's thread:\n\n${body || "(no text, only the attached images)"}${withNotes}`,
      display: body,
      requestedBy: userId,
      attachments,
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
