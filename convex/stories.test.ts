/// <reference types="vite/client" />
// How a story moves: stage moves, where it stands after each kind of turn,
// feedback batching, and compaction. The director worker drives these
// mutations; here they're called the way it calls them.
import { convexTest } from "convex-test";
import prosemirrorSync from "@convex-dev/prosemirror-sync/test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { COMPACT_TOKENS } from "../shared/director";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  prosemirrorSync.register(t);
  const userId = await t.mutation(api.users.create, { name: "Greg", color: "#e5484d" });
  const storyId = await t.mutation(api.stories.create, { userId, title: "Toaster Overlord" });
  const story = async () => (await t.query(api.stories.get, { storyId }))!;
  /** The worker's side of a turn: claim the oldest queued one. */
  const claimNext = async () => {
    const [next] = await t.query(api.director.queued, {});
    expect(next).toBeDefined();
    const job = await t.mutation(api.director.claim, { turnId: next!._id });
    expect(job).not.toBeNull();
    return job!;
  };
  const finish = (turnId: Id<"turns">, extra: { tokens?: number; error?: string } = {}) =>
    t.mutation(api.director.finish, { turnId, response: "ok", sessionId: "session-1", ...extra });
  return { t, userId, storyId, story, claimNext, finish };
}

describe("stage moves", () => {
  test("a new story starts on the script, writing, with its own folder name", async () => {
    const { story } = await setup();
    const s = await story();
    expect(s.stage).toBe("script");
    expect(s.state).toBe("writing");
    expect(s.slug).toBe("toaster-overlord");
  });

  test("slugs stay unique", async () => {
    const { t, userId } = await setup();
    const id = await t.mutation(api.stories.create, { userId, title: "Toaster Overlord" });
    expect((await t.query(api.stories.get, { storyId: id }))!.slug).toBe("toaster-overlord-2");
  });

  test("starting production moves to casting and queues the kickoff turn", async () => {
    const { t, userId, storyId, story } = await setup();
    await t.mutation(api.stories.approve, { storyId, userId, note: "Make the toaster sound like HAL" });
    const s = await story();
    expect(s.stage).toBe("casting");
    expect(s.state).toBe("working");
    const [turn] = await t.query(api.turns.list, { storyId });
    expect(turn!.kind).toBe("stage");
    expect(turn!.prompt).toContain("put the script into production");
    expect(turn!.prompt).toContain("Make the toaster sound like HAL");
    expect(turn!.prompt).toContain("Goal for Casting");
  });

  test("approving casting tells the director to fill the voice catalog", async () => {
    const { t, userId, storyId } = await setup();
    await t.mutation(api.stories.setStage, { storyId, userId, stage: "casting" });
    await t.mutation(api.stories.approve, { storyId, userId });
    const turns = await t.query(api.turns.list, { storyId });
    expect(turns.at(-1)!.prompt).toContain("add_voice");
  });

  test("moving back says so, and going back to the script stops everything", async () => {
    const { t, userId, storyId, story } = await setup();
    await t.mutation(api.stories.setStage, { storyId, userId, stage: "animation" });
    await t.mutation(api.stories.setStage, { storyId, userId, stage: "voiceover", note: "Gary's lines are too fast" });
    const turns = await t.query(api.turns.list, { storyId });
    expect(turns.at(-1)!.prompt).toContain("moved the story back from Animation to Voice-over");
    await t.mutation(api.stories.setStage, { storyId, userId, stage: "script" });
    expect((await story()).state).toBe("writing");
    const after = await t.query(api.turns.list, { storyId });
    expect(after.every((x) => x.status === "cancelled")).toBe(true);
  });
});

describe("where the story stands after a turn", () => {
  test("asking for review leaves it ready for review", async () => {
    const { t, userId, storyId, story, claimNext, finish } = await setup();
    await t.mutation(api.stories.approve, { storyId, userId });
    const job = await claimNext();
    await t.mutation(api.director.requestReview, { turnId: job.turnId, message: "Auditions are up" });
    await finish(job.turnId);
    const s = await story();
    expect(s.state).toBe("review");
    expect(s.statusLine).toBe("Auditions are up");
    expect(s.sessionId).toBe("session-1");
  });

  test("stopping without asking for review leaves it waiting on people", async () => {
    const { t, userId, storyId, story, claimNext, finish } = await setup();
    await t.mutation(api.stories.approve, { storyId, userId });
    const job = await claimNext();
    await finish(job.turnId);
    expect((await story()).state).toBe("waiting");
  });

  test("a question answered during review goes back to review", async () => {
    const { t, userId, storyId, story, claimNext, finish } = await setup();
    await t.mutation(api.stories.approve, { storyId, userId });
    const first = await claimNext();
    await t.mutation(api.director.requestReview, { turnId: first.turnId, message: "Ready" });
    await finish(first.turnId);
    await t.mutation(api.turns.send, { storyId, userId, text: "Which voice is candidate B?" });
    const second = await claimNext();
    expect((await story()).state).toBe("working");
    await finish(second.turnId);
    expect((await story()).state).toBe("review");
  });

  test("a turn that started a background job stays working", async () => {
    const { t, userId, storyId, story, claimNext, finish } = await setup();
    await t.mutation(api.stories.approve, { storyId, userId });
    const job = await claimNext();
    await t.mutation(api.director.addWakeup, { turnId: job.turnId, note: "8 takes per line", unit: "dystory-x", log: "/tmp/x.log" });
    await finish(job.turnId);
    const s = await story();
    expect(s.state).toBe("working");
    expect(s.statusLine).toBe("8 takes per line");
    expect(s.jobs).toHaveLength(1);
  });

  test("a finished job wakes the director with a turn", async () => {
    const { t, userId, storyId, claimNext, finish } = await setup();
    await t.mutation(api.stories.approve, { storyId, userId });
    const job = await claimNext();
    await t.mutation(api.director.addWakeup, { turnId: job.turnId, note: "renders", unit: "dystory-y", log: "/tmp/y.log" });
    await finish(job.turnId);
    const [w] = await t.query(api.director.waitingWakeups, {});
    await t.mutation(api.director.fireWakeup, { wakeupId: w!._id, report: "exited 0" });
    const turns = await t.query(api.turns.list, { storyId });
    expect(turns.at(-1)).toMatchObject({ kind: "wake", status: "queued", prompt: "exited 0" });
    expect((await t.query(api.stories.get, { storyId }))!.statusLine).toBeUndefined();
    expect(await t.query(api.director.waitingWakeups, {})).toHaveLength(0);
  });

  test("an error leaves it waiting with the reason", async () => {
    const { t, userId, storyId, story, claimNext, finish } = await setup();
    await t.mutation(api.stories.approve, { storyId, userId });
    const job = await claimNext();
    await finish(job.turnId, { error: "B70 out of memory" });
    const s = await story();
    expect(s.state).toBe("waiting");
    expect(s.statusLine).toContain("B70 out of memory");
  });

  test("talking to the director during the script stage keeps it writing", async () => {
    const { t, userId, storyId, story, claimNext, finish } = await setup();
    await t.mutation(api.turns.send, { storyId, userId, text: "Thoughts on the ending?" });
    const job = await claimNext();
    await finish(job.turnId);
    expect((await story()).state).toBe("writing");
  });

  test("a long session gets compacted", async () => {
    const { t, userId, storyId, claimNext, finish } = await setup();
    await t.mutation(api.stories.approve, { storyId, userId });
    const job = await claimNext();
    await finish(job.turnId, { tokens: COMPACT_TOKENS + 1 });
    const turns = await t.query(api.turns.list, { storyId });
    expect(turns.at(-1)).toMatchObject({ kind: "compact", prompt: "/compact", status: "queued" });
  });

  test("a stopped turn can't keep using its tools", async () => {
    const { t, userId, storyId, claimNext } = await setup();
    await t.mutation(api.stories.approve, { storyId, userId });
    const job = await claimNext();
    await t.mutation(api.turns.cancel, { turnId: job.turnId });
    await expect(t.mutation(api.director.setStatus, { turnId: job.turnId, line: "x" })).rejects.toThrow(/stopped/);
  });
});

describe("review feedback", () => {
  async function withCut() {
    const ctx = await setup();
    const { t, userId, storyId, claimNext, finish } = ctx;
    await t.mutation(api.stories.approve, { storyId, userId });
    const job = await claimNext();
    const file = { fileId: "f", fileName: "vo.mp4", size: 1, duration: 60, width: 1920, height: 1080, fps: 24 };
    await t.mutation(api.director.addVersion, { turnId: job.turnId, summary: "Auditions", ...file });
    await t.mutation(api.director.requestReview, { turnId: job.turnId, message: "Ready" });
    await finish(job.turnId);
    const s = (await t.query(api.stories.get, { storyId }))!;
    const video = (await t.query(api.videos.get, { videoId: s.videoId }))!;
    return { ...ctx, versionId: video.versions[0]!._id };
  }

  test("comments wait for a quiet spell, then go as one turn", async () => {
    const { t, userId, storyId, versionId } = await withCut();
    await t.mutation(api.comments.add, { versionId, authorId: userId, body: "Toaster too squeaky", time: 3.5 });
    await t.mutation(api.comments.add, { versionId, authorId: userId, body: "Gary needs more gravel", time: 12 });
    expect((await t.query(api.feedback.pending, { storyId })).count).toBe(2);
    await t.mutation(api.feedback.sendNow, { storyId });
    expect((await t.query(api.feedback.pending, { storyId })).count).toBe(0);
    const turn = (await t.query(api.turns.list, { storyId })).at(-1)!;
    expect(turn.kind).toBe("feedback");
    expect(turn.prompt).toContain("at 0:03.50");
    expect(turn.prompt).toContain("Toaster too squeaky");
    expect(turn.prompt).toContain("Gary needs more gravel");
    expect(turn.display).toBe("2 pieces of review feedback");
  });

  test("the director's own replies aren't feedback", async () => {
    const { t, userId, storyId, versionId, claimNext } = await withCut();
    const commentId = await t.mutation(api.comments.add, { versionId, authorId: userId, body: "Louder", time: 1 });
    await t.mutation(api.feedback.sendNow, { storyId });
    const job = await claimNext();
    await t.mutation(api.director.replyToComment, { turnId: job.turnId, commentId, body: "Raised 3 dB" });
    await t.mutation(api.director.resolveComment, { turnId: job.turnId, commentId });
    expect((await t.query(api.feedback.pending, { storyId })).count).toBe(0);
  });

  test("comments on plain reviews don't go anywhere", async () => {
    const { t, userId } = await setup();
    const file = { fileId: "g", fileName: "news.mp4", size: 1, duration: 9, width: 1920, height: 1080, fps: 30 };
    const videoId = await t.mutation(api.videos.create, { userId, ...file });
    const video = (await t.query(api.videos.get, { videoId }))!;
    await t.mutation(api.comments.add, { versionId: video.versions[0]!._id, authorId: userId, body: "Fine", time: 0 });
    const rows = await t.run((ctx) => ctx.db.query("feedback").collect());
    expect(rows).toHaveLength(0);
  });

  test("story cuts stay off the plain reviews list", async () => {
    const { t } = await withCut();
    expect(await t.query(api.videos.list, {})).toHaveLength(0);
  });
});

describe("notifications", () => {
  test("asking for review notifies with the director's message and a link", async () => {
    const { t, userId, storyId, claimNext } = await setup();
    await t.mutation(api.stories.approve, { storyId, userId });
    const job = await claimNext();
    await t.mutation(api.director.requestReview, { turnId: job.turnId, message: "Auditions are up" });
    const notice = await t.mutation(api.director.finish, { turnId: job.turnId, response: "Done." });
    expect(notice).toMatchObject({
      title: "Toaster Overlord: Ready for review",
      body: "Auditions are up",
      url: `/s/${storyId}`,
    });
  });

  test("a failure and a reply notify; plain text only", async () => {
    const { t, userId, storyId, claimNext } = await setup();
    await t.mutation(api.turns.send, { storyId, userId, text: "Thoughts on the ending?" });
    const reply = await claimNext();
    const notice = await t.mutation(api.director.finish, { turnId: reply.turnId, response: "**Cut** the\n\nlast line." });
    expect(notice).toMatchObject({ title: "Toaster Overlord: The director replied", body: "Cut the last line." });
    await t.mutation(api.stories.approve, { storyId, userId });
    const failed = await claimNext();
    const err = await t.mutation(api.director.finish, { turnId: failed.turnId, response: "", error: "B70 out of memory" });
    expect(err!.title).toContain("hit a problem");
    expect(err!.body).toContain("B70 out of memory");
  });

  test("no notification while a job runs, more work is queued, or someone stopped it", async () => {
    const { t, userId, storyId, claimNext } = await setup();
    await t.mutation(api.stories.approve, { storyId, userId });
    const first = await claimNext();
    await t.mutation(api.director.addWakeup, { turnId: first.turnId, note: "renders", unit: "dystory-z", log: "/tmp/z.log" });
    expect(await t.mutation(api.director.finish, { turnId: first.turnId, response: "ok" })).toBeNull();

    await t.mutation(api.turns.send, { storyId, userId, text: "How long?" });
    const second = await claimNext();
    await t.mutation(api.turns.send, { storyId, userId, text: "Also, louder toaster" });
    await t.mutation(api.director.cancelWakeups, { turnId: second.turnId });
    expect(await t.mutation(api.director.finish, { turnId: second.turnId, response: "ok" })).toBeNull();

    const third = await claimNext();
    await t.mutation(api.turns.cancel, { turnId: third.turnId });
    expect(await t.mutation(api.director.finish, { turnId: third.turnId, response: "ok" })).toBeNull();
  });
});

describe("restarts", () => {
  const restart = (t: Awaited<ReturnType<typeof setup>>["t"]) => t.mutation(api.director.resetStale, {});

  test("a turn cut off by a restart is picked up in the same session", async () => {
    const { t, userId, storyId, story, claimNext } = await setup();
    await t.mutation(api.stories.approve, { storyId, userId });
    const job = await claimNext();
    await t.mutation(api.director.setSession, { turnId: job.turnId, sessionId: "session-1" });
    await restart(t);
    const turns = await t.query(api.turns.list, { storyId });
    expect(turns.at(-2)).toMatchObject({ status: "error" });
    expect(turns.at(-1)).toMatchObject({ kind: "wake", status: "queued", resumes: 1 });
    expect(turns.at(-1)!.prompt).toContain("Script went into production");
    const s = await story();
    expect(s.state).toBe("working");
    expect(s.sessionId).toBe("session-1");
  });

  test("review it already asked for survives the restart", async () => {
    const { t, userId, storyId, story, claimNext, finish } = await setup();
    await t.mutation(api.stories.approve, { storyId, userId });
    const job = await claimNext();
    await t.mutation(api.director.requestReview, { turnId: job.turnId, message: "Auditions are up" });
    await restart(t);
    expect((await story()).state).toBe("review");
    const resumed = await claimNext();
    await finish(resumed.turnId);
    expect((await story()).state).toBe("review");
  });

  test("after three cut-offs in a row it stops and asks", async () => {
    const { t, userId, storyId, story, claimNext } = await setup();
    await t.mutation(api.stories.approve, { storyId, userId });
    for (let i = 0; i < 3; i++) {
      await claimNext();
      await restart(t);
    }
    expect((await t.query(api.director.queued, {})).length).toBe(0);
    const s = await story();
    expect(s.state).toBe("waiting");
    expect(s.statusLine).toContain("Restarts kept cutting");
  });
});

describe("the thread and its requests", () => {
  const file = { fileId: "f", fileName: "cut.mp4", size: 1, duration: 60, width: 1920, height: 1080, fps: 24 };
  const img = (n: number) => ({ file: `${n}.png`, thumb: `${n}.png`, fileName: `${n}.png`, size: 1, width: 1280, height: 720 });

  /** Production started; the director posts two stills and asks for review. */
  async function withStills() {
    const ctx = await setup();
    const { t, userId, storyId, claimNext, finish } = ctx;
    await t.mutation(api.stories.approve, { storyId, userId });
    const job = await claimNext();
    const a = await t.mutation(api.director.addImage, { turnId: job.turnId, caption: "Shot 1", ...img(1) });
    const b = await t.mutation(api.director.addImage, { turnId: job.turnId, caption: "Shot 2", ...img(2) });
    await t.mutation(api.director.requestReview, { turnId: job.turnId, message: "Pick a still" });
    await finish(job.turnId);
    return { ...ctx, images: [a, b], turnId: job.turnId };
  }

  test("a review request shows what was posted since the last one", async () => {
    const { t, storyId, images, turnId, story, claimNext, finish } = await withStills();
    const thread = (await t.query(api.requests.thread, { storyId }))!;
    expect(thread.requests).toHaveLength(1);
    const [r] = thread.requests;
    expect(r!.status).toBe("open");
    expect(r!.imageIds).toEqual(images);
    expect(thread.images.every((i) => i.turnId === turnId)).toBe(true);
    expect((await story()).openRequest?.kind).toBe("review");

    // The next round only shows the new cut, and replaces the first.
    await t.mutation(api.feedback.sendNow, { storyId });
    await t.mutation(api.turns.send, { storyId, userId: (await story()).createdBy, text: "Make it darker" });
    const job = await claimNext();
    await t.mutation(api.director.addVersion, { turnId: job.turnId, summary: "Darker", ...file });
    await t.mutation(api.director.requestReview, { turnId: job.turnId, message: "Darker now" });
    await finish(job.turnId);
    const after = (await t.query(api.requests.thread, { storyId }))!;
    expect(after.requests.map((x) => x.status)).toEqual(["superseded", "open"]);
    expect(after.requests[1]!.imageIds).toEqual([]);
    expect(after.requests[1]!.versionIds).toHaveLength(1);
  });

  test("approving closes the request and takes waiting notes along as small fixes", async () => {
    const { t, userId, storyId, images, story } = await withStills();
    await t.mutation(api.feedback.addNote, { userId, text: "Shot 2 is a bit dark", imageIds: [images[1]!] });
    expect((await t.query(api.feedback.pending, { storyId })).count).toBe(1);
    await t.mutation(api.stories.approve, { storyId, userId });
    expect((await t.query(api.feedback.pending, { storyId })).count).toBe(0);
    const thread = (await t.query(api.requests.thread, { storyId }))!;
    expect(thread.requests[0]!.status).toBe("approved");
    expect(thread.requests[0]!.decidedBy).toBe(userId);
    const kickoff = thread.turns.at(-1)!;
    expect(kickoff.display).toBe("Casting approved");
    expect(kickoff.prompt).toContain("small fixes");
    expect(kickoff.prompt).toContain("Shot 2 is a bit dark");
    expect((await story()).stage).toBe("voiceover");
    expect((await t.query(api.requests.approvals, { storyId })).casting?.by).toBe(userId);
  });

  test("not good sends it back right away, with notes on what was pointed at", async () => {
    const { t, userId, storyId, images, story } = await withStills();
    await t.mutation(api.feedback.sendBack, {
      storyId,
      userId,
      text: "Gary looks twelve",
      imageIds: [images[0]!],
    });
    const thread = (await t.query(api.requests.thread, { storyId }))!;
    expect(thread.requests[0]!.status).toBe("changes");
    const turn = thread.turns.at(-1)!;
    expect(turn.kind).toBe("feedback");
    expect(turn.status).toBe("queued");
    expect(turn.display).toBe("Not good: Gary looks twelve");
    expect(turn.prompt).toContain("says it's not good yet");
    expect(turn.prompt).toContain("Shot 1");
    expect(turn.prompt).toContain("Gary looks twelve");
    expect((await t.query(api.images.comments, { imageId: images[0]! }))[0]!.body).toBe("Gary looks twelve");
    expect((await story()).stage).toBe("casting");
  });

  test("a question is answered by the next message", async () => {
    const { t, userId, storyId, claimNext, finish, story } = await setup();
    await t.mutation(api.stories.approve, { storyId, userId });
    const job = await claimNext();
    await t.mutation(api.director.askUser, { turnId: job.turnId, question: "Which channel?" });
    await finish(job.turnId);
    expect((await story()).openRequest?.kind).toBe("question");
    await t.mutation(api.turns.send, { storyId, userId, text: "The main one" });
    const thread = (await t.query(api.requests.thread, { storyId }))!;
    expect(thread.requests[0]!.status).toBe("answered");
    expect(thread.turns.every((x) => x.stage === "casting")).toBe(true);
  });
});

describe("messages and waiting notes", () => {
  test("a message takes the notes still waiting along with it", async () => {
    const { t, userId, storyId, claimNext, finish } = await setup();
    await t.mutation(api.stories.approve, { storyId, userId });
    const job = await claimNext();
    const file = { fileId: "f", fileName: "vo.mp4", size: 1, duration: 60, width: 1920, height: 1080, fps: 24 };
    await t.mutation(api.director.addVersion, { turnId: job.turnId, summary: "Auditions", ...file });
    await t.mutation(api.director.requestReview, { turnId: job.turnId, message: "Ready" });
    await finish(job.turnId);
    const s = (await t.query(api.stories.get, { storyId }))!;
    const versionId = (await t.query(api.videos.get, { videoId: s.videoId }))!.versions[0]!._id;
    await t.mutation(api.comments.add, { versionId, authorId: userId, body: "Toaster too squeaky", time: 3.5 });
    await t.mutation(api.turns.send, { storyId, userId, text: "Also make Gary older" });
    expect((await t.query(api.feedback.pending, { storyId })).count).toBe(0);
    const turn = (await t.query(api.turns.list, { storyId })).at(-1)!;
    expect(turn.kind).toBe("message");
    expect(turn.display).toBe("Also make Gary older");
    expect(turn.prompt).toContain("Also make Gary older");
    expect(turn.prompt).toContain("Toaster too squeaky");
    // The timer finds nothing left to send.
    await t.mutation(api.feedback.sendNow, { storyId });
    expect((await t.query(api.turns.list, { storyId })).at(-1)!._id).toBe(turn._id);
  });
});
