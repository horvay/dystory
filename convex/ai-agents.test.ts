/// <reference types="vite/client" />
// The script assistant can be Claude or Muse. Each keeps its own session, and
// switching mid-chat shows the new model what the other one already said.
import { convexTest } from "convex-test";
import prosemirrorSync from "@convex-dev/prosemirror-sync/test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  prosemirrorSync.register(t);
  const userId = await t.mutation(api.users.create, { name: "Greg", color: "#e5484d" });
  const docId = await t.mutation(api.docs.create, { userId, title: "A script" });
  const claim = async (agent: "claude" | "muse" | undefined, prompt: string) => {
    const requestId = await t.mutation(api.ai.ask, { docId, userId, prompt, agent });
    const job = await t.mutation(api.ai.claim, { requestId });
    return { requestId, job: job! };
  };
  const finish = (requestId: Awaited<ReturnType<typeof claim>>["requestId"], sessionId: string, response: string) =>
    t.mutation(api.ai.finish, { requestId, response, sessionId });
  const doc = () => t.run(async (ctx) => ctx.db.get(docId));
  return { t, claim, finish, doc };
}

describe("Claude and Muse on one document", () => {
  test("each model keeps its own session", async () => {
    const { claim, finish, doc } = await setup();
    const muse = await claim("muse", "Write a cold open");
    expect(muse.job.agent).toBe("muse");
    expect(muse.job.sessionId).toBeUndefined();
    await finish(muse.requestId, "muse-1", "Gary opens the fridge.");

    const claude = await claim("claude", "Make it shorter");
    expect(claude.job.agent).toBe("claude");
    expect(claude.job.sessionId).toBeUndefined();
    expect(claude.job.catchUp).toEqual([
      {
        requesterName: "Greg",
        agentName: "Muse",
        prompt: "Write a cold open",
        response: "Gary opens the fridge.",
      },
    ]);
    await finish(claude.requestId, "claude-1", "Shorter.");

    const again = await claim("muse", "Now the button");
    expect(again.job.sessionId).toBe("muse-1");
    expect(again.job.catchUp.map((t) => t.agentName)).toEqual(["Claude"]);
    const stored = await doc();
    expect(stored?.museSessionId).toBe("muse-1");
    expect(stored?.aiSessionId).toBe("claude-1");
  });

  test("a new conversation forgets both sessions and the earlier replies", async () => {
    const { t, claim, finish, doc } = await setup();
    const first = await claim("muse", "Hello");
    await finish(first.requestId, "muse-1", "Hi");
    const docId = (await doc())!._id;
    await t.mutation(api.ai.newConversation, { docId });
    const next = await claim("muse", "Again");
    expect(next.job.sessionId).toBeUndefined();
    expect(next.job.catchUp).toEqual([]);
    expect((await doc())?.museSessionId).toBeUndefined();
  });

  test("a request from before the picker still goes to Claude", async () => {
    const { claim } = await setup();
    const job = await claim(undefined, "Fix the typo");
    expect(job.job.agent).toBe("claude");
  });
});
