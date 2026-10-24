// Script assistant: watches Convex for queued requests from a document's AI
// panel and runs each one through Claude (Agent SDK, Claude Fable by default),
// using the Claude Code login on this machine. The agent edits the document
// through tools that call Convex mutations, so every change streams live to
// everyone who has the document open.
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createSdkMcpServer,
  query,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { COMEDY_STYLES, type ComedyStyle } from "../shared/comedy";
import { DOC_TOOLS, errorText, toolLabel } from "./doc-tools";

const CONVEX_URL = process.env.VITE_CONVEX_URL;
if (!CONVEX_URL) throw new Error("VITE_CONVEX_URL is not set (run `bun run dev` once to create .env.local)");

const MODEL = process.env.AI_MODEL || "claude-fable-5-1";
const MAX_CONCURRENT = 3;
const INLINE_DOC_LIMIT = 60_000; // characters of markdown to include in the prompt
const WORKSPACE = resolve(import.meta.dir, "../.ai-workspace");
mkdirSync(WORKSPACE, { recursive: true });

const convex = new ConvexClient(CONVEX_URL);
const active = new Map<string, Id<"docs"> | null>(); // requestId -> docId

const basePrompt = `You are Claude, a writing partner built into Dynastory, a shared studio where a small team (often a couple) writes scripts for short AI-made comedy videos and turns them into finished videos. You help in the document editor: ideas, scripts, articles and plans. A separate production AI makes the videos once a script goes into production; you only work on the writing.

Scripts here become videos with AI voices and AI animation. When writing a screenplay, keep one line per spoken beat with the speaker's name, so lines map one to one to voice-over takes later.

Several people may be looking at and typing in the document while you work. Your edits appear on their screens live, and a version is saved before and after you make changes, so they can always roll back. Work with that in mind:
- Make the change that was asked for. Don't rewrite or "improve" parts nobody asked about.
- Prefer edit_document with small, precise find/replace edits; use rewrite_document only for sweeping changes (restructuring, drafting from scratch, translating everything).
- The document is shown to you as Markdown. Supported formatting: headings (#, ##, ###), **bold**, *italic*, ~~strike~~, ==highlight==, \`code\`, links, bullet/numbered lists, task lists (- [ ] / - [x]), > quotes, fenced code blocks, and --- dividers. Don't use tables, images or HTML.
- If an edit fails because the text wasn't found, someone probably just changed it: call read_document and try again.
- If the request is a question or asks for feedback rather than changes, answer in chat and leave the document alone.
- Use web search/fetch when facts or research would help.

Your chat reply appears in a narrow side panel. Keep it short: say what you changed (or answer the question) in a few sentences. Never paste the whole document into the chat.

If you can't do something, say so in one sentence, citing that it's against policy (for example, "I can't help with that, it's against policy."), and move on. Don't moralize, lecture, guess at why someone asked, or argue about what you can and can't do. If part of the request is fine, do that part and briefly note what you left out.`;

const STYLE_FILE = resolve(import.meta.dir, "writing-style.md");
const COMEDY_DIR = resolve(import.meta.dir, "comedy");

// Re-read the style rules for every request so edits apply without a restart.
function systemPrompt(comedyStyle: ComedyStyle | undefined): string {
  const parts = [basePrompt, readFileSync(STYLE_FILE, "utf8")];
  if (comedyStyle) parts.push(comedyGuide(comedyStyle));
  return parts.join("\n\n");
}

/** The comedy skill picked in the panel, with its reference files inlined (the AI can't open files). */
function comedyGuide(id: ComedyStyle): string {
  const style = COMEDY_STYLES.find((s) => s.id === id)!;
  const dir = resolve(COMEDY_DIR, id);
  const skill = readFileSync(resolve(dir, "SKILL.md"), "utf8").replace(/^---\n[\s\S]*?\n---\n/, "");
  const refs = readdirSync(resolve(dir, "references"))
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => `### references/${f}\n\n${readFileSync(resolve(dir, "references", f), "utf8").trim()}`);
  return `## Comedy style: ${style.label} (in the tradition of ${style.after})

The person asking picked this comedy style for their message. Write what they asked for in this style, following the guide below. If the request plainly has nothing to do with comedy (fixing a typo, answering a factual question), just do the task.

Where the guide and "How you write" disagree about the comedy itself, follow the guide: comic repetition, a rule of three or a recurring refrain are fine there. Everything else in "How you write" still applies, including no em dashes. The reference files the guide links to are included after it.

${skill.trim()}

${refs.join("\n\n")}`;
}

function docTools(requestId: Id<"aiRequests">) {
  return createSdkMcpServer({
    name: "doc",
    version: "1.0.0",
    tools: DOC_TOOLS.map((t) => tool(t.name, t.description, t.schema, (args: any) => t.call({ convex, requestId }, args))),
  });
}

const ALLOWED_TOOLS = [
  "mcp__doc__read_document",
  "mcp__doc__edit_document",
  "mcp__doc__rewrite_document",
  "mcp__doc__set_title",
  "WebSearch",
  "WebFetch",
];

type Job = NonNullable<Awaited<ReturnType<typeof claimRequest>>>;
const claimRequest = (requestId: Id<"aiRequests">) => convex.mutation(api.ai.claim, { requestId });

function buildPrompt(job: Job): string {
  const parts: string[] = [];
  parts.push(`${job.requesterName} asks:\n${job.prompt}`);
  if (job.selection) {
    parts.push(
      `They have this passage selected (the request most likely refers to it):\n<selection>\n${job.selection}\n</selection>`,
    );
  }
  if (job.markdown.length <= INLINE_DOC_LIMIT) {
    parts.push(
      `Current document (as of this request):\n<document title="${job.title.replace(/"/g, "'") || "untitled"}">\n${job.markdown || "(empty)"}\n</document>`,
    );
  } else {
    parts.push("The document is long; call read_document to see it.");
  }
  return parts.join("\n\n");
}

async function runRequest(requestId: Id<"aiRequests">) {
  const job = await claimRequest(requestId);
  if (!job) {
    active.delete(requestId);
    return;
  }
  const style = job.comedyStyle ? `, ${job.comedyStyle}` : "";
  console.log(`[ai] ${job.requesterName} → script assistant (${job.effort} effort${style}): ${job.prompt.slice(0, 80)}`);

  const abort = new AbortController();
  const unsubscribe = convex.onUpdate(api.ai.status, { requestId }, (status) => {
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
      convex.mutation(api.ai.progress, { requestId, response: current() }).catch(() => {});
    };
    if (force) {
      if (pushTimer) clearTimeout(pushTimer);
      send();
    } else if (!pushTimer) {
      pushTimer = setTimeout(send, Math.max(0, 250 - (Date.now() - lastPush)));
    }
  };
  const logActivity = (activity: string) =>
    convex.mutation(api.ai.progress, { requestId, activity }).catch(() => {});

  const attempt = async (resume: string | undefined) => {
    let sessionId: string | undefined;
    let error: string | undefined;
    const q = query({
      prompt: buildPrompt(job),
      options: {
        systemPrompt: systemPrompt(job.comedyStyle),
        model: MODEL,
        effort: job.effort,
        cwd: WORKSPACE,
        settingSources: [],
        tools: ["WebSearch", "WebFetch"],
        // Only web tools plus our document tools exist; anything else is refused
        // rather than prompting, since nobody is at a terminal to approve it.
        allowedTools: ALLOWED_TOOLS,
        permissionMode: "dontAsk",
        mcpServers: { doc: docTools(requestId) },
        includePartialMessages: true,
        abortController: abort,
        resume,
        maxTurns: 40,
      },
    });
    for await (const msg of q) {
      if (msg.type === "stream_event") {
        const ev = msg.event;
        if (ev.type === "content_block_start" && ev.content_block.type === "text") {
          if (partial) committed = current();
          partial = "";
        } else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          partial += ev.delta.text;
          pushResponse();
        }
      } else if (msg.type === "assistant") {
        partial = "";
        for (const block of msg.message.content) {
          if (block.type === "text" && block.text.trim()) {
            committed = [committed, block.text.trim()].filter(Boolean).join("\n\n");
          } else if (block.type === "tool_use") {
            logActivity(toolLabel(block.name, (block.input ?? {}) as Record<string, unknown>));
          }
        }
        pushResponse(true);
      } else if (msg.type === "result") {
        sessionId = msg.session_id;
        if (msg.subtype !== "success") {
          error = "errors" in msg && Array.isArray(msg.errors) && msg.errors.length
            ? msg.errors.join("; ")
            : `Claude stopped early (${msg.subtype}).`;
        } else if (msg.is_error) {
          error = msg.result || "Claude reported an error.";
        }
      }
    }
    return { sessionId, error };
  };

  let outcome: { sessionId?: string; error?: string };
  try {
    try {
      outcome = await attempt(job.sessionId);
    } catch (err) {
      // A stale session (e.g. its transcript was deleted) shouldn't block the
      // request; retry once as a fresh conversation if nothing happened yet.
      if (!job.sessionId || abort.signal.aborted || committed) throw err;
      console.warn(`[ai] resume failed, starting fresh: ${errorText(err)}`);
      outcome = await attempt(undefined);
    }
  } catch (err) {
    outcome = { error: abort.signal.aborted ? undefined : errorText(err) };
  }
  if (pushTimer) clearTimeout(pushTimer);
  unsubscribe();
  active.delete(requestId);

  await convex.mutation(api.ai.finish, {
    requestId,
    response: current(),
    sessionId: outcome.sessionId,
    error: outcome.error,
  });
  if (outcome.error) console.error(`[ai] request failed: ${outcome.error}`);
  pump();
}

let queue: { _id: Id<"aiRequests">; docId: Id<"docs"> }[] = [];

function pump() {
  for (const req of queue) {
    if (active.size >= MAX_CONCURRENT) break;
    if (active.has(req._id)) continue;
    // One request per document at a time, so follow-ups see earlier edits
    // and continue the same agent conversation.
    if ([...active.values()].includes(req.docId)) continue;
    active.set(req._id, req.docId);
    runRequest(req._id).catch((err) => {
      console.error("[ai] unexpected error", err);
      active.delete(req._id);
    });
  }
}

async function main() {
  await convex.mutation(api.ai.resetStale, {});
  await convex.mutation(api.ai.heartbeat, {});
  setInterval(() => convex.mutation(api.ai.heartbeat, {}).catch(() => {}), 10_000);
  convex.onUpdate(api.ai.queued, {}, (rows) => {
    queue = rows.map((r) => ({ _id: r._id, docId: r.docId }));
    pump();
  });
  console.log(`[ai] script assistant ready (model: ${MODEL})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
