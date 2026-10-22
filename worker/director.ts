// Director: runs each story's production AI. It watches Convex for queued
// turns (a stage starting, review feedback, a message, a job finishing) and
// runs each through the story's own Claude session (Agent SDK, Claude Opus at
// medium effort by default) in the story's folder, with every Claude Code
// tool plus the app tools in studio-tools.ts. One turn per story at a time.
//
// Between turns it watches the background jobs the AI started (transient
// systemd units, see jobs.ts) and its timers, and wakes it with a turn when
// one is done.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { stageInfo } from "../shared/stages";
import { errorText, toolLabel } from "./doc-tools";
import { jobReport, queueLine, stopUnit, unitActive } from "./jobs";
import { notifyAll } from "./notify";
import { STUDIO_TOOLS, studioLabel, type StudioCtx } from "./studio-tools";

const CONVEX_URL = process.env.VITE_CONVEX_URL;
if (!CONVEX_URL) throw new Error("VITE_CONVEX_URL is not set (run `bun run dev` once to create .env.local)");

const MODEL = process.env.DIRECTOR_MODEL || "claude-opus-5-5";
const EFFORT = (process.env.DIRECTOR_EFFORT || "medium") as "low" | "medium" | "high";
const STORIES_DIR = resolve(process.env.STORIES_DIR || join(process.env.HOME ?? "", "ai/clips/short-stories"));
const APP_URL = (process.env.APP_URL || `http://127.0.0.1:${process.env.PORT || 5190}`).replace(/\/$/, "");
const MAX_CONCURRENT = Number(process.env.DIRECTOR_CONCURRENCY || 4);
const POLL_MS = 15_000;
const PROMPT_FILE = resolve(import.meta.dir, "director-prompt.md");
const STYLE_FILE = resolve(import.meta.dir, "writing-style.md");

const convex = new ConvexClient(CONVEX_URL);
const active = new Map<Id<"turns">, Id<"stories">>();

// Re-read for every turn so edits apply without a restart.
function systemPrompt() {
  return [readFileSync(PROMPT_FILE, "utf8"), "## How you write\n", readFileSync(STYLE_FILE, "utf8")].join("\n\n");
}

function studioServer(ctx: StudioCtx) {
  return createSdkMcpServer({
    name: "studio",
    version: "1.0.0",
    tools: STUDIO_TOOLS.map((t) => tool(t.name, t.description, t.schema, (args: any) => t.call(ctx, args))),
  });
}

/** The activity line for a tool call: the app tools, the document tools, or Claude Code's own. */
function activityLabel(name: string, input: Record<string, unknown>): string | null {
  const studio = studioLabel(name, input);
  if (studio) return studio;
  const s = (k: string) => String(input[k] ?? "");
  const file = (k: string) => s(k).replace(`${process.env.HOME}/`, "~/");
  switch (name) {
    case "Bash":
      return input.description ? s("description") : `Ran ${s("command").split("\n")[0]!.slice(0, 120)}`;
    case "Read":
      return `Read ${file("file_path")}`;
    case "Write":
      return `Wrote ${file("file_path")}`;
    case "Edit":
    case "MultiEdit":
      return `Edited ${file("file_path")}`;
    case "Glob":
    case "Grep":
      return `Searched for ${s("pattern").slice(0, 80)}`;
    case "Agent":
    case "Task":
      return `Asked a helper: ${s("description")}`;
    case "TodoWrite":
    case "ToolSearch":
      return null;
    default:
      return toolLabel(name, input);
  }
}

type Job = NonNullable<Awaited<ReturnType<typeof claim>>>;
const claim = (turnId: Id<"turns">) => convex.mutation(api.director.claim, { turnId });

function storyFolder(slug: string) {
  return join(STORIES_DIR, slug);
}

/** Makes the story folder on its first turn and drops the current script in it. */
async function prepareFolder(job: Job, folder: string) {
  mkdirSync(join(folder, "00-script"), { recursive: true });
  try {
    const { title, markdown } = await convex.mutation(api.director.readScript, { turnId: job.turnId });
    writeFileSync(join(folder, "00-script", "script-current.md"), `# ${title}\n\n${markdown}\n`);
  } catch (err) {
    console.warn(`[director] couldn't write the script for ${job.story.slug}: ${errorText(err)}`);
  }
}

function buildPrompt(job: Job, folder: string, fresh: boolean) {
  if (job.kind === "compact") return "/compact";
  const head = `[Dystory] Story "${job.story.title}" · stage: ${stageInfo(job.story.stage).label} · folder: ${folder} · page: ${APP_URL}/s/${job.story._id}`;
  const intro = fresh
    ? "\n\nThis is the start of your session for this story. Read the clips guides named in your instructions before doing production work, then check story_info and the story README (if there is one) for where things stand."
    : "";
  return `${head}${intro}\n\n${job.prompt}`;
}

async function runTurn(turnId: Id<"turns">) {
  const job = await claim(turnId);
  if (!job) {
    active.delete(turnId);
    return;
  }
  const folder = storyFolder(job.story.slug);
  await prepareFolder(job, folder);
  console.log(`[director] ${job.story.slug}: ${job.kind} turn${job.requesterName ? ` from ${job.requesterName}` : ""}`);

  const abort = new AbortController();
  const unsubscribe = convex.onUpdate(api.director.status, { turnId }, (status) => {
    if (status === "cancelled") abort.abort();
  });

  let committed = "";
  let partial = "";
  let lastPush = 0;
  let pushTimer: ReturnType<typeof setTimeout> | null = null;
  const current = () => [committed, partial].filter(Boolean).join("\n\n");
  const pushResponse = (force = false) => {
    const send = () => {
      lastPush = Date.now();
      pushTimer = null;
      convex.mutation(api.director.progress, { turnId, response: current() }).catch(() => {});
    };
    if (force) {
      if (pushTimer) clearTimeout(pushTimer);
      send();
    } else if (!pushTimer) {
      pushTimer = setTimeout(send, Math.max(0, 400 - (Date.now() - lastPush)));
    }
  };
  const logActivity = (activity: string) => convex.mutation(api.director.progress, { turnId, activity }).catch(() => {});

  const ctx: StudioCtx = {
    convex,
    turnId,
    storyId: job.story._id,
    slug: job.story.slug,
    folder,
    storyUrl: `${APP_URL}/s/${job.story._id}`,
  };

  const attempt = async (resume: string | undefined) => {
    let sessionId: string | undefined;
    let tokens: number | undefined;
    let error: string | undefined;
    const q = query({
      prompt: buildPrompt(job, folder, !resume),
      options: {
        systemPrompt: { type: "preset", preset: "claude_code", append: systemPrompt() },
        model: MODEL,
        effort: EFFORT,
        cwd: folder,
        additionalDirectories: [resolve(STORIES_DIR, "..")],
        // Greg's global instructions (GPU rules, browser leases) and the clips skills.
        settingSources: ["user", "project"],
        // Nobody is at a terminal to approve anything; it works like Greg's own sessions.
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        disallowedTools: ["AskUserQuestion", "EnterPlanMode", "ExitPlanMode"],
        mcpServers: { studio: studioServer(ctx) },
        includePartialMessages: true,
        abortController: abort,
        resume,
        maxTurns: 500,
        stderr: (data) => {
          const line = data.trim();
          if (line) console.error(`[director] ${job.story.slug} stderr: ${line.slice(0, 300)}`);
        },
      },
    });
    for await (const msg of q) {
      if (msg.type === "system" && msg.subtype === "init" && msg.session_id !== resume) {
        convex.mutation(api.director.setSession, { turnId, sessionId: msg.session_id }).catch(() => {});
      }
      if (msg.type === "stream_event") {
        if (msg.parent_tool_use_id) continue;
        const ev = msg.event;
        if (ev.type === "content_block_start" && ev.content_block.type === "text") {
          if (partial) committed = current();
          partial = "";
        } else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          partial += ev.delta.text;
          pushResponse();
        }
      } else if (msg.type === "assistant") {
        if (msg.parent_tool_use_id) continue; // a subagent's
        partial = "";
        const u = msg.message.usage;
        if (u) {
          tokens =
            (u.input_tokens ?? 0) +
            (u.cache_creation_input_tokens ?? 0) +
            (u.cache_read_input_tokens ?? 0) +
            (u.output_tokens ?? 0);
        }
        for (const block of msg.message.content) {
          if (block.type === "text" && block.text.trim()) {
            committed = [committed, block.text.trim()].filter(Boolean).join("\n\n");
          } else if (block.type === "tool_use") {
            const label = activityLabel(block.name, (block.input ?? {}) as Record<string, unknown>);
            if (label) logActivity(label);
          }
        }
        pushResponse(true);
      } else if (msg.type === "result") {
        sessionId = msg.session_id;
        if (msg.subtype !== "success") {
          error =
            "errors" in msg && Array.isArray(msg.errors) && msg.errors.length
              ? msg.errors.join("; ")
              : `Claude stopped early (${msg.subtype}).`;
        } else if (msg.is_error) {
          error = msg.result || "Claude reported an error.";
        }
      }
    }
    return { sessionId, tokens, error };
  };

  let outcome: { sessionId?: string; tokens?: number; error?: string };
  try {
    try {
      outcome = await attempt(job.story.sessionId);
    } catch (err) {
      // A session that can't be resumed (its transcript is gone) shouldn't
      // block the story; start a fresh one if nothing happened yet.
      if (!job.story.sessionId || abort.signal.aborted || committed || job.kind === "compact") throw err;
      console.warn(`[director] ${job.story.slug}: resume failed, starting a fresh session: ${errorText(err)}`);
      outcome = await attempt(undefined);
    }
  } catch (err) {
    outcome = { error: abort.signal.aborted ? undefined : errorText(err) };
  }
  if (pushTimer) clearTimeout(pushTimer);
  unsubscribe();
  active.delete(turnId);

  const notice = await convex.mutation(api.director.finish, {
    turnId,
    response: current(),
    sessionId: outcome.sessionId,
    tokens: outcome.tokens,
    error: outcome.error,
  });
  if (outcome.error) console.error(`[director] ${job.story.slug}: turn failed: ${outcome.error}`);
  if (notice) notifyAll(convex, notice).catch((err) => console.warn("[notify]", errorText(err)));
  pump();
}

let queue: { _id: Id<"turns">; storyId: Id<"stories"> }[] = [];

function pump() {
  for (const turn of queue) {
    if (active.size >= MAX_CONCURRENT) break;
    if (active.has(turn._id)) continue;
    // One turn per story at a time, in order, so each sees what the last one did.
    if ([...active.values()].includes(turn.storyId)) continue;
    active.set(turn._id, turn.storyId);
    runTurn(turn._id).catch((err) => {
      console.error("[director] unexpected error", err);
      active.delete(turn._id);
    });
  }
}

/** Wakes the AI for finished jobs and due timers, and stops units people stopped. */
async function checkWakeups() {
  const waiting = await convex.query(api.director.waitingWakeups, {});
  for (const w of waiting) {
    if (w.unit) {
      let active: boolean;
      try {
        active = await unitActive(w.unit);
        if (active) {
          const queue = await queueLine(w.unit);
          if (queue !== w.queue) await convex.mutation(api.director.setWakeupQueue, { wakeupId: w._id, queue });
        }
      } catch (err) {
        // The b70q daemon is down or restarting: ask again next round.
        console.warn(`[director] can't check ${w.unit}: ${errorText(err)}`);
        continue;
      }
      if (active) continue;
      const { code, tail } = await jobReport(w.log ?? "");
      const how =
        code === null
          ? "ended without recording an exit code (killed or crashed)"
          : /^\d+$/.test(code)
            ? `exited with code ${code}`
            : `ended without running to completion (${code})`;
      await convex.mutation(api.director.fireWakeup, {
        wakeupId: w._id,
        report: `Background job finished: ${w.note}\n${w.unit!.startsWith("b70q:") ? `B70 queue job #${w.unit!.slice(5)}` : `Unit ${w.unit}`} ${how}. Log: ${w.log}\n\nLast lines of the log:\n${tail}\n\nCheck the results and carry on.`,
      });
    } else if (w.at !== undefined && w.at <= Date.now()) {
      await convex.mutation(api.director.fireWakeup, {
        wakeupId: w._id,
        report: `Timer you set is due: ${w.note}`,
      });
    }
  }
  for (const w of await convex.query(api.director.unitsToStop, {})) {
    console.log(`[director] stopping ${w.unit}`);
    try {
      await stopUnit(w.unit!);
    } catch (err) {
      // Already over is fine; otherwise try again next round.
      if (await unitActive(w.unit!).catch(() => true)) {
        console.warn(`[director] couldn't stop ${w.unit}: ${errorText(err)}`);
        continue;
      }
    }
    await convex.mutation(api.director.unitStopped, { wakeupId: w._id });
  }
}

async function main() {
  mkdirSync(STORIES_DIR, { recursive: true });
  await convex.mutation(api.director.resetStale, {});
  await convex.mutation(api.ai.heartbeat, { name: "director" });
  setInterval(() => convex.mutation(api.ai.heartbeat, { name: "director" }).catch(() => {}), 10_000);
  convex.onUpdate(api.director.queued, {}, (rows) => {
    queue = rows;
    pump();
  });
  const poll = () =>
    checkWakeups()
      .catch((err) => console.error(`[director] checking jobs failed: ${errorText(err)}`))
      .finally(() => setTimeout(poll, POLL_MS));
  poll();
  console.log(`[director] ready (model ${MODEL}, ${EFFORT} effort; stories in ${STORIES_DIR})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
