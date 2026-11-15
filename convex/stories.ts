import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { slugify } from "../shared/director";
import { isSetupStage, nextStage, stageIndex, stageInfo, type StageId } from "../shared/stages";
import { docMarkdown } from "./ai";
import { insertDoc } from "./docs";
import { takePending } from "./feedback";
import { closeRequests } from "./requests";
import { remakeSource, stage as stageValidator } from "./schema";
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

/** One line saying what a remake is made from, for its card. */
function sourceLine(source: Doc<"stories">["source"]) {
  if (!source) return "";
  const from = source.adopt ? `work/${source.adopt}` : (source.url ?? source.file?.fileName ?? "");
  return [from, source.notes].filter(Boolean).join(" · ").slice(0, 220);
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
  const doc = story.docId ? await ctx.db.get(story.docId) : null;
  return {
    ...story,
    snippet: story.kind === "remake" ? sourceLine(story.source) : (doc?.snippet ?? ""),
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
      openRequest: open ? { _id: open._id, kind: open.kind, step: open.step } : null,
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

/**
 * The live screenplay for a story, by its folder name. A mutation because
 * reading the document goes through prosemirror sync, which only runs in one.
 * The workers call it from list_stories / read_story. Trashed stories are hidden.
 */
export const scriptBySlug = mutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const story = await ctx.db
      .query("stories")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!story || story.trashed || !story.docId) return null;
    const doc = await ctx.db.get(story.docId);
    if (!doc) return null;
    return { title: story.title, slug: story.slug, stage: story.stage, markdown: await docMarkdown(ctx, story.docId) };
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

/** Folder names make_real accepts: what slugify makes, as typed for an existing song. */
const FOLDER = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * A new remake: a cartoon video remade as live action. It has no script. It
 * starts on its Source stage, where people say what to remake. `adopt` is the
 * name of a song folder that already exists under make_real's work/ (started
 * outside the app); the remake then works in that folder.
 */
export const createRemake = mutation({
  args: { userId: v.id("users"), title: v.string(), adopt: v.optional(v.string()) },
  handler: async (ctx, { userId, title, adopt }) => {
    const name = (title.trim() || adopt || "Untitled remake").slice(0, 120);
    let slug: string;
    if (adopt) {
      if (!FOLDER.test(adopt)) throw new ConvexError(`"${adopt}" isn't a song folder name`);
      const taken = await ctx.db
        .query("stories")
        .withIndex("by_slug", (q) => q.eq("slug", adopt))
        .first();
      if (taken) throw new ConvexError(`“${taken.title}” already uses the folder ${adopt}${taken.trashed ? " (it's in the trash)" : ""}`);
      slug = adopt;
    } else {
      slug = await uniqueSlug(ctx, name);
    }
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
      kind: "remake",
      slug,
      source: adopt ? { adopt, notes: "" } : undefined,
      videoId,
      createdBy: userId,
      updatedAt: now,
      trashed: false,
      stage: "source",
      state: "writing",
      conversationStartedAt: now,
    });
    await ctx.db.patch(videoId, { storyId });
    return storyId;
  },
});

/** Whether a remake's source says enough to start on. */
export function sourceReady(source: Doc<"stories">["source"]) {
  return !!source && [source.url?.trim(), source.file, source.adopt].filter(Boolean).length === 1;
}

/** Sets what a remake is made from. Only while it is on its Source stage. */
export const setSource = mutation({
  args: { storyId: v.id("stories"), source: remakeSource },
  handler: async (ctx, { storyId, source }) => {
    const story = await ctx.db.get(storyId);
    if (!story || story.kind !== "remake") throw new ConvexError("Remake not found");
    if (story.stage !== "source") throw new ConvexError("The remake has already started. Write to the director instead.");
    // An adopted song keeps its folder: the slug was taken from it.
    if (story.source?.adopt && source.adopt !== story.source.adopt) {
      throw new ConvexError("This remake was made for an existing song folder. Make a new remake for another source.");
    }
    if (!story.source?.adopt && source.adopt) throw new ConvexError("Pick the existing song when making the remake.");
    const url = source.url?.trim().slice(0, 2000) || undefined;
    if (url && !/^https?:\/\/\S+$/.test(url)) throw new ConvexError("That doesn't look like a link");
    const startAt = source.adopt && source.startAt && stageIndex(source.startAt, "remake") > 0 && source.startAt !== "done" ? source.startAt : undefined;
    await ctx.db.patch(storyId, {
      source: { ...source, url, startAt, notes: source.notes.slice(0, 20_000) },
      updatedAt: Date.now(),
    });
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

/** What a remake's director is told about its source when production starts. */
function sourceBrief(story: Doc<"stories">) {
  const src = story.source;
  if (!src) return "";
  const what = src.adopt
    ? `This remake adopts a song that was started outside Dynastory: the song root already exists (work/${src.adopt}/depth). Read its README and look through the folder to learn where it stands and what was decided, before changing anything. Its earlier cuts were reviewed on the old review site (docs/PUBLISHING.md says how to read those comments); from now on cuts are posted here. Post the newest cut it has here first, so the thread has it, then say in two or three sentences where the song stands.`
    : src.url
      ? `The source is this link: ${src.url}`
      : `The source is an uploaded file, "${src.file?.fileName}" (its path is in BRIEF.md).`;
  return `\n\n${what}${src.notes.trim() ? `\n\nNotes from the people who started it:\n${src.notes.trim()}` : ""}`;
}

/** What the production AI is told when a stage starts. */
function stageKickoff(story: Doc<"stories">, stage: StageId, who: string, note: string | undefined, back: boolean) {
  const kind = story.kind;
  const from = story.stage;
  const info = stageInfo(stage, kind);
  const prev = stageInfo(from, kind);
  const opening = back
    ? `${who} moved the story back from ${prev.label} to ${info.label}.`
    : from === "script"
      ? `${who} put the script into production. The first stage is ${info.label}.`
      : from === "source"
        ? story.source?.adopt
          ? `${who} brought this song into Dynastory. It starts at ${info.label}.`
          : `${who} started the remake. The first stage is ${info.label}.`
        : `${who} approved ${prev.label}. The next stage is ${info.label}.`;
  const source = from === "source" ? sourceBrief(story) : "";
  const casting =
    !back && from === "casting"
      ? "\n\nThe cast is approved: add every newly designed voice that was approved to the voice catalog now (add_voice), with its reference wav, the reference's exact transcript and how it was made."
      : "";
  const redo = back
    ? "\n\nWork out what has to be redone from here on (for example, re-voiced lines break lip sync on their talk shots) and say so before starting."
    : "";
  return `${opening}${source}${note ? `\n\n${who} adds: ${note}` : ""}${casting}${redo}

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
  const kind = story.kind;
  if (stageIndex(to, kind) < 0) throw new ConvexError(`${stageInfo(to).label} isn't a stage of this ${kind === "remake" ? "remake" : "story"}`);
  const back = stageIndex(to, kind) < stageIndex(story.stage, kind);
  if (isSetupStage(to)) {
    await stopEverything(ctx, story._id);
    await ctx.db.patch(story._id, { stage: to, state: "writing", statusLine: undefined, updatedAt: Date.now() });
    return;
  }
  if (to === "done") {
    await ctx.db.patch(story._id, { stage: "done", state: "done", statusLine: undefined, updatedAt: Date.now() });
    return;
  }
  await ctx.db.patch(story._id, {
    stage: to,
    state: "working",
    statusLine: `Starting ${stageInfo(to, kind).label}`,
    updatedAt: Date.now(),
  });
  await queueTurn(ctx, story._id, {
    kind: "stage",
    prompt: stageKickoff(story, to, who, note?.trim() || undefined, back) + (extra ? `\n\n${extra}` : ""),
    display: back
      ? `Moved back to ${stageInfo(to, kind).label}${note?.trim() ? `: ${note.trim()}` : ""}`
      : story.stage === "script"
        ? "Script went into production"
        : story.stage === "source"
          ? story.source?.adopt
            ? `Song brought in at ${stageInfo(to, kind).label}`
            : "Remake started"
          : `${stageInfo(story.stage, kind).label} approved${note?.trim() ? `: ${note.trim()}` : ""}`,
    requestedBy: userId,
  });
}

/**
 * Approves the current stage (or puts the script into production) and starts
 * the next one. When the open review is for a step inside the stage (the
 * character looks), the director carries on with the stage instead.
 */
export const approve = mutation({
  args: { storyId: v.id("stories"), userId: v.id("users"), note: v.optional(v.string()) },
  handler: async (ctx, { storyId, userId, note }) => {
    const story = await ctx.db.get(storyId);
    if (!story) throw new Error("Story not found");
    if (story.stage === "done") return;
    const step = (await openReview(ctx, storyId))?.step;
    await closeRequests(ctx, storyId, "approved", userId);
    // Notes still waiting to go out ride along with the approval.
    const pending = await takePending(ctx, storyId);
    const extra = pending.length
      ? `Notes that came in with the approval (small fixes, not blockers; do them as part of ${step ? "the rest of this stage" : "the next stage"}):\n${pending.join("\n")}`
      : "";
    if (step) return approveStep(ctx, story, userId, step, note?.trim() || undefined, extra);
    if (story.stage === "source") {
      if (!sourceReady(story.source)) throw new ConvexError("Say what to remake first: a link, a file, or an existing song.");
      // An adopted song starts at the stage it had reached.
      return moveTo(ctx, story, userId, story.source?.startAt ?? nextStage("source", "remake"), note, extra);
    }
    await moveTo(ctx, story, userId, nextStage(story.stage, story.kind), note, extra);
  },
});

async function openReview(ctx: QueryCtx, storyId: Id<"stories">) {
  const recent = await ctx.db
    .query("requests")
    .withIndex("by_story", (q) => q.eq("storyId", storyId))
    .order("desc")
    .take(5);
  return recent.find((r) => r.status === "open" && r.kind === "review");
}

async function approveStep(
  ctx: MutationCtx,
  story: Doc<"stories">,
  userId: Id<"users">,
  step: string,
  note: string | undefined,
  extra: string,
) {
  const who = (await ctx.db.get(userId))?.name ?? "Someone";
  const info = stageInfo(story.stage, story.kind);
  await ctx.db.patch(story._id, {
    state: "working",
    statusLine: `Carrying on with ${info.label}`,
    updatedAt: Date.now(),
  });
  await queueTurn(ctx, story._id, {
    kind: "step",
    prompt: `${who} approved ${step}. Carry on with ${info.label}; the stage itself isn't approved yet.${note ? `\n\n${who} adds: ${note}` : ""}

Goal for ${info.label}: ${info.goal}${extra ? `\n\n${extra}` : ""}`,
    display: `${step.charAt(0).toUpperCase()}${step.slice(1)} approved${note ? `: ${note}` : ""}`,
    requestedBy: userId,
  });
}

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
