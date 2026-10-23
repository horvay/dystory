// What the production AI asks people for (request_review, ask_user), and the
// story's thread: its turns with those requests and everything it posted.
import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { STAGES, nextStage, stageIndex, type StageId } from "../shared/stages";

type Request = Doc<"requests">;

async function openRequests(ctx: QueryCtx, storyId: Id<"stories">) {
  const rows = await ctx.db
    .query("requests")
    .withIndex("by_story", (q) => q.eq("storyId", storyId))
    .collect();
  return rows.filter((r) => r.status === "open");
}

/** Closes the story's open requests (only questions or reviews, with `kind`). */
export async function closeRequests(
  ctx: MutationCtx,
  storyId: Id<"stories">,
  status: Exclude<Request["status"], "open">,
  userId?: Id<"users">,
  kind?: Request["kind"],
) {
  for (const r of await openRequests(ctx, storyId)) {
    if (kind && r.kind !== kind) continue;
    await ctx.db.patch(r._id, { status, decidedBy: userId, decidedAt: Date.now() });
  }
}

/** When this round of work began: the last request, or the start of the stage. */
async function roundStart(ctx: QueryCtx, story: Doc<"stories">) {
  const last = await ctx.db
    .query("requests")
    .withIndex("by_story", (q) => q.eq("storyId", story._id))
    .order("desc")
    .first();
  const turns = await ctx.db
    .query("turns")
    .withIndex("by_story", (q) => q.eq("storyId", story._id))
    .order("desc")
    .take(200);
  const stageStart = turns.find((t) => t.kind === "stage")?._creationTime ?? 0;
  // _creationTime, not `at`: it orders strictly with the posts made in the same millisecond.
  return Math.max(last?._creationTime ?? 0, stageStart);
}

/**
 * A new request from the production AI. What it shows: the cut and images
 * named, or else everything the AI posted since the last request (or since the
 * stage started), or else the latest cut.
 */
export async function openRequest(
  ctx: MutationCtx,
  story: Doc<"stories">,
  turnId: Id<"turns">,
  kind: Request["kind"],
  message: string,
  show: { cuts?: number[]; images?: string[] } = {},
) {
  const since = await roundStart(ctx, story);
  const versions = await ctx.db
    .query("versions")
    .withIndex("by_video", (q) => q.eq("videoId", story.videoId))
    .collect();
  const images = await ctx.db
    .query("images")
    .withIndex("by_video", (q) => q.eq("videoId", story.videoId))
    .collect();
  let versionIds: Id<"versions">[];
  let imageIds: Id<"images">[];
  if (show.cuts?.length || show.images?.length) {
    versionIds = versions.filter((x) => show.cuts?.includes(x.number)).map((x) => x._id);
    const wanted = new Set(show.images ?? []);
    imageIds = images.filter((i) => wanted.has(i._id)).map((i) => i._id);
  } else {
    versionIds = versions.filter((x) => x.turnId && x._creationTime > since).map((x) => x._id);
    imageIds = images.filter((i) => i.turnId && i._creationTime > since).map((i) => i._id);
    // One cut per card: the newest of the round.
    versionIds = versionIds.slice(-1);
    if (kind === "review" && !versionIds.length && !imageIds.length && versions.length) {
      versionIds = [versions[versions.length - 1]!._id];
    }
  }
  await closeRequests(ctx, story._id, "superseded");
  return ctx.db.insert("requests", {
    storyId: story._id,
    stage: story.stage,
    turnId,
    kind,
    message,
    versionIds,
    imageIds,
    status: "open",
    at: Date.now(),
  });
}

/**
 * The story's thread: the newest turns, the requests among them, and the
 * cuts and images the director posted in them.
 */
export const thread = query({
  args: { storyId: v.id("stories"), limit: v.optional(v.number()) },
  handler: async (ctx, { storyId, limit }) => {
    const story = await ctx.db.get(storyId);
    if (!story) return null;
    const turns = (
      await ctx.db
        .query("turns")
        .withIndex("by_story", (q) => q.eq("storyId", storyId))
        .order("desc")
        .take(limit ?? 60)
    ).reverse();
    const more = turns.length === (limit ?? 60);
    const from = more ? turns[0]!._creationTime : 0;
    const requests = (
      await ctx.db
        .query("requests")
        .withIndex("by_story", (q) => q.eq("storyId", storyId).gte("at", from))
        .collect()
    );
    const turnIds = new Set<string>(turns.map((t) => t._id));
    const wantedVersions = new Set<string>(requests.flatMap((r) => r.versionIds));
    const wantedImages = new Set<string>(requests.flatMap((r) => r.imageIds));

    const versions = (
      await ctx.db
        .query("versions")
        .withIndex("by_video", (q) => q.eq("videoId", story.videoId))
        .collect()
    )
      .filter((x) => (x.turnId && turnIds.has(x.turnId)) || wantedVersions.has(x._id))
      .map((x) => ({
        _id: x._id,
        number: x.number,
        stage: x.stage,
        summary: x.summary,
        turnId: x.turnId,
        fileId: x.fileId,
        duration: x.duration,
        width: x.width,
        height: x.height,
      }));
    const images = await Promise.all(
      (
        await ctx.db
          .query("images")
          .withIndex("by_video", (q) => q.eq("videoId", story.videoId))
          .collect()
      )
        .filter((i) => (i.turnId && turnIds.has(i.turnId)) || wantedImages.has(i._id))
        .map(async (i) => ({
          _id: i._id,
          file: i.file,
          thumb: i.thumb,
          width: i.width,
          height: i.height,
          caption: i.caption,
          turnId: i.turnId,
          comments: (
            await ctx.db
              .query("imageComments")
              .withIndex("by_image", (q) => q.eq("imageId", i._id))
              .collect()
          ).length,
        })),
    );
    return { turns, requests, versions, images, more };
  },
});

/** Who approved each finished stage and when, for the stage rail. */
export const approvals = query({
  args: { storyId: v.id("stories") },
  handler: async (ctx, { storyId }) => {
    const turns = await ctx.db
      .query("turns")
      .withIndex("by_story", (q) => q.eq("storyId", storyId))
      .filter((q) => q.eq(q.field("kind"), "stage"))
      .collect();
    const out: Partial<Record<StageId, { by?: Id<"users">; at: number }>> = {};
    for (const t of turns) {
      // The turn that starts a stage approved the one before it.
      const started = t.stage;
      if (!started || started === "script" || !/approved|into production/.test(t.display)) continue;
      const prev = STAGES[stageIndex(started) - 1]?.id;
      if (prev && nextStage(prev) === started) out[prev] = { by: t.requestedBy, at: t._creationTime };
    }
    return out;
  },
});

// ---------------------------------------------------------------------------
// One-off: fills in what older stories lack (turn stages, which turn posted
// each cut and image, requests from "Asked for review" steps).
// ---------------------------------------------------------------------------

const STAGE_BY_LABEL = new Map<string, StageId>(STAGES.map((s) => [s.label.toLowerCase(), s.id]));

export const backfill = mutation({
  args: {},
  handler: async (ctx) => {
    let changed = 0;
    for (const story of await ctx.db.query("stories").collect()) {
      const turns = await ctx.db
        .query("turns")
        .withIndex("by_story", (q) => q.eq("storyId", story._id))
        .collect();
      // Stages: walk the stage turns in order.
      let stage: StageId = "script";
      for (const t of turns) {
        if (t.kind === "stage") {
          const d = t.display;
          const label = (s: string) => STAGE_BY_LABEL.get(s.trim().toLowerCase());
          if (d.startsWith("Script went into production")) stage = "casting";
          else if (d.startsWith("Moved back to ")) stage = label(d.slice(14).split(":")[0]!) ?? stage;
          else {
            const m = /^(.+?) approved/.exec(d);
            const was = m && label(m[1]!);
            if (was) stage = nextStage(was);
          }
        }
        if (!t.stage) {
          await ctx.db.patch(t._id, { stage });
          changed++;
        }
        t.stage = t.stage ?? stage;
      }
      // Posts: the turn that was running when each was made.
      const ran = turns.filter((t) => t.startedAt);
      const owner = (at: number) =>
        ran.find((t) => t.startedAt! <= at && at <= (t.finishedAt ?? Infinity))?._id;
      for (const x of await ctx.db
        .query("versions")
        .withIndex("by_video", (q) => q.eq("videoId", story.videoId))
        .collect()) {
        const id = !x.turnId && owner(x._creationTime);
        if (id) {
          await ctx.db.patch(x._id, { turnId: id });
          changed++;
        }
      }
      for (const i of await ctx.db
        .query("images")
        .withIndex("by_video", (q) => q.eq("videoId", story.videoId))
        .collect()) {
        const id = !i.turnId && owner(i._creationTime);
        if (id) {
          await ctx.db.patch(i._id, { turnId: id });
          changed++;
        }
      }
      // Requests, from the steps that asked.
      const existing = await ctx.db
        .query("requests")
        .withIndex("by_story", (q) => q.eq("storyId", story._id))
        .first();
      if (existing) continue;
      const versions = await ctx.db
        .query("versions")
        .withIndex("by_video", (q) => q.eq("videoId", story.videoId))
        .collect();
      const images = await ctx.db
        .query("images")
        .withIndex("by_video", (q) => q.eq("videoId", story.videoId))
        .collect();
      let since = 0;
      const made: Id<"requests">[] = [];
      for (const t of turns) {
        if (t.kind === "stage") since = t._creationTime;
        const asked = t.activity.findLast((a) => a.startsWith("Asked for review: ") || a.startsWith("Asked: "));
        if (!asked || !t.finishedAt) continue;
        const review = asked.startsWith("Asked for review: ");
        const at = t.finishedAt;
        const inRound = <T extends { turnId?: Id<"turns">; _creationTime: number }>(x: T) =>
          !!x.turnId && x._creationTime > since && x._creationTime <= at;
        made.push(
          await ctx.db.insert("requests", {
            storyId: story._id,
            stage: t.stage ?? stage,
            turnId: t._id,
            kind: review ? "review" : "question",
            message: asked.slice(review ? 18 : 7),
            versionIds: versions.filter(inRound).slice(-1).map((x) => x._id),
            imageIds: images.filter(inRound).map((i) => i._id),
            status: "superseded",
            at,
          }),
        );
        since = at;
      }
      // The last request of each stage before it was approved was the approved one.
      const rows = await Promise.all(made.map((id) => ctx.db.get(id)));
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!;
        const later = rows.slice(i + 1).find((x) => x!.stage === r.stage);
        const isOpen = !later && r.stage === story.stage && (story.state === "review" || story.state === "waiting");
        if (isOpen) await ctx.db.patch(r._id, { status: "open" });
        else if (!later && r.kind === "review" && stageIndex(story.stage) > stageIndex(r.stage)) {
          await ctx.db.patch(r._id, { status: "approved" });
        }
      }
      changed += made.length;
    }
    return changed;
  },
});
