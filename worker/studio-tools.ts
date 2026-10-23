// The app tools the production AI gets as an in-process MCP server ("studio").
// Each one calls Convex or the media server, so what it posts shows up live in
// the story's page.
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { ConvexClient } from "convex/browser";
import { z } from "zod";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { errorText, type ToolResult } from "./doc-tools";
import { b70Kind, startJob, usesB70 } from "./jobs";
import { uploadAudio, uploadImage, uploadVideo } from "./media";

export type StudioCtx = {
  convex: ConvexClient;
  turnId: Id<"turns">;
  storyId: Id<"stories">;
  slug: string;
  folder: string;
  /** The story's page in the app, for links in replies. */
  storyUrl: string;
};

async function run(fn: () => Promise<string>): Promise<ToolResult> {
  try {
    return { content: [{ type: "text", text: await fn() }] };
  } catch (err) {
    return { content: [{ type: "text", text: errorText(err) }], isError: true };
  }
}

function studioTool<Shape extends z.ZodRawShape>(
  name: string,
  description: string,
  schema: Shape,
  handler: (ctx: StudioCtx, args: z.infer<z.ZodObject<Shape>>) => Promise<string>,
) {
  return { name, description, schema, call: (ctx: StudioCtx, args: z.infer<z.ZodObject<Shape>>) => run(() => handler(ctx, args)) };
}

/** A path the AI gave, made absolute against the story folder, and checked. */
function existing(ctx: StudioCtx, path: string) {
  const full = isAbsolute(path) ? path : resolve(ctx.folder, path);
  if (!existsSync(full)) throw new Error(`No file at ${full}`);
  return full;
}

const json = (v: unknown) => JSON.stringify(v, null, 2);

export const STUDIO_TOOLS = [
  studioTool(
    "story_info",
    "Where the story stands: stage, state, every posted cut (number, stage, summary, open comments), notes, and the background jobs you are waiting on.",
    {},
    async (ctx) => {
      const info = await ctx.convex.mutation(api.director.storyInfo, { turnId: ctx.turnId });
      return json({ ...info, folder: ctx.folder, page: ctx.storyUrl });
    },
  ),
  studioTool(
    "read_script",
    "Read the story's script (the shared document people edit in the app) as Markdown. It can change while you work; read it again before relying on a line.",
    {},
    async (ctx) => {
      const { title, markdown } = await ctx.convex.mutation(api.director.readScript, { turnId: ctx.turnId });
      return `Title: ${title}\n\n${markdown || "(the script is empty)"}`;
    },
  ),
  studioTool(
    "edit_script",
    "Change the script with find/replace edits on its Markdown (each `find` must match exactly once). Only when people asked for a script change or agreed to one; say what you changed. A version is saved before and after.",
    {
      edits: z.array(z.object({ find: z.string(), replace: z.string() })).min(1),
      reason: z.string().describe("Short reason, shown in the script's history"),
    },
    async (ctx, { edits, reason }) => {
      await ctx.convex.mutation(api.director.editScript, { turnId: ctx.turnId, edits, reason });
      return `Applied ${edits.length} edit${edits.length === 1 ? "" : "s"} to the script.`;
    },
  ),
  studioTool(
    "open_feedback",
    "Every open (unresolved) review comment with its replies, every image comment and every note on the story. Use it to check nothing is left over before requesting review.",
    {},
    async (ctx) => json(await ctx.convex.mutation(api.director.openFeedback, { turnId: ctx.turnId })),
  ),
  studioTool(
    "post_cut",
    "Post a video file (MP4, H.264) as the story's next cut. It plays in the story's thread (and the next review card) and on the Review tab. Write a summary of what this cut is and what changed since the last one; people read it under the player.",
    {
      path: z.string().describe("Path to the MP4, absolute or relative to the story folder"),
      summary: z.string().describe("What this cut is and what changed"),
    },
    async (ctx, { path, summary }) => {
      const file = await uploadVideo(existing(ctx, path));
      const { number } = await ctx.convex.mutation(api.director.addVersion, { turnId: ctx.turnId, summary, ...file });
      return `Posted as cut v${number} (${file.duration.toFixed(1)} s, ${file.width}x${file.height}). Review page: ${ctx.storyUrl}/review?v=${number}`;
    },
  ),
  studioTool(
    "post_image",
    "Post an image (still, character sheet, thumbnail). It shows in the story's thread under this turn (and in the next review card) and on the Images tab, where people can pin comments on it. The caption says what it is in plain words (\"Shot 3, option B: Gary laughing\"); it's what people see under the image. Returns the image id.",
    {
      path: z.string().describe("Path to a JPEG, PNG or WebP, absolute or relative to the story folder"),
      caption: z.string().optional(),
    },
    async (ctx, { path, caption }) => {
      const img = await uploadImage(existing(ctx, path));
      const id = await ctx.convex.mutation(api.director.addImage, { turnId: ctx.turnId, caption, ...img });
      return `Posted ${img.fileName} (${img.width}x${img.height}) as image ${id}.`;
    },
  ),
  studioTool(
    "write_note",
    "Create or overwrite the note with this title on the story's Notes tab (packaging, shot list, open questions). People can edit notes, and their edits come back to you as feedback.",
    { title: z.string(), body: z.string().describe("Plain text or Markdown") },
    async (ctx, { title, body }) => {
      const how = await ctx.convex.mutation(api.director.writeNote, { turnId: ctx.turnId, title, body });
      return `Note "${title}" ${how}.`;
    },
  ),
  studioTool(
    "reply_to_comment",
    "Reply under a review comment, as the Director. Use it to explain a choice, ask about the comment, or say why something can't be done.",
    { commentId: z.string(), body: z.string() },
    async (ctx, { commentId, body }) => {
      await ctx.convex.mutation(api.director.replyToComment, { turnId: ctx.turnId, commentId, body });
      return "Replied.";
    },
  ),
  studioTool(
    "resolve_comment",
    "Mark a review comment done once a posted cut fixes it.",
    { commentId: z.string() },
    async (ctx, { commentId }) => {
      await ctx.convex.mutation(api.director.resolveComment, { turnId: ctx.turnId, commentId });
      return "Resolved.";
    },
  ),
  studioTool(
    "set_status",
    "Set the one-line status shown on the story (what you're doing right now, e.g. \"Rendering shot 7 of 22\").",
    { line: z.string() },
    async (ctx, { line }) => {
      await ctx.convex.mutation(api.director.setStatus, { turnId: ctx.turnId, line });
      return "Status set.";
    },
  ),
  studioTool(
    "request_review",
    "Hand the stage's work to people for review. It becomes a card in the story's thread with your message as its heading, showing what you posted since your last request (the newest cut and every image), with Approve and Not good buttons. Call it after posting, as the last thing in the turn.",
    {
      message: z.string().describe("One line: what's ready and what to decide"),
      cuts: z.array(z.number()).optional().describe("Show these cut numbers instead of what was posted since the last request"),
      images: z.array(z.string()).optional().describe("Show these image ids (from post_image) instead"),
    },
    async (ctx, { message, cuts, images }) => {
      await ctx.convex.mutation(api.director.requestReview, { turnId: ctx.turnId, message, cuts, images });
      return "The story is waiting for review. End your turn now.";
    },
  ),
  studioTool(
    "ask_user",
    "You need a decision or information before you can go on: the story shows your question as waiting for an answer. Ask the full question in your reply too, then end the turn. The answer arrives as a message.",
    { question: z.string().describe("The question, in one line") },
    async (ctx, { question }) => {
      await ctx.convex.mutation(api.director.askUser, { turnId: ctx.turnId, question });
      return "The story is waiting for an answer. End your turn now.";
    },
  ),
  studioTool(
    "start_job",
    "Run a long command (renders, TTS batches, upscales: anything over a couple of minutes) in the background, then end your turn. You are woken with a new turn when it exits, with its exit code and the end of its log. It survives app restarts. Set gpu to \"b70\" for B70 work (only Drama 3, Qwen stills, H3 and sharpening): it goes into the b70q queue and runs when its turn comes. ComfyUI/SFX jobs run on the 3080 and never get gpu \"b70\". Don't wrap it in b70-lease yourself (scripts that take the lease inside are fine), and don't space jobs out or run them one by one: start them all and the queue lines them up.",
    {
      command: z.string().describe("Bash command line"),
      gpu: z.enum(["b70", "none"]).optional().describe("\"b70\" if it uses the B70 (default: none)"),
      note: z.string().describe("What it does, shown on the story (e.g. \"8 takes per line for the AI voice\")"),
      cwd: z.string().optional().describe("Working directory, absolute or relative to the story folder (default: the story folder)"),
    },
    async (ctx, { command, note, cwd, gpu }) => {
      const dir = cwd ? (isAbsolute(cwd) ? cwd : resolve(ctx.folder, cwd)) : ctx.folder;
      if (!existsSync(dir)) throw new Error(`No directory ${dir}`);
      const b70 = usesB70(command, gpu);
      const job = await startJob(ctx.folder, ctx.slug, command, dir, note, { b70, kind: b70 ? b70Kind(command) : undefined });
      await ctx.convex.mutation(api.director.addWakeup, { turnId: ctx.turnId, note, unit: job.unit, log: job.log });
      if (b70) {
        return `Queued on the B70 as ${job.unit.replace(":", " #")} (${job.queue ?? "starting now"}); log ${job.log}. End your turn now; you'll be woken when it exits. Start any other jobs first: they line up on their own.`;
      }
      return `Started unit ${job.unit}; log ${job.log}. End your turn now; you'll be woken when it exits.`;
    },
  ),
  studioTool(
    "wake_me_in",
    "Be woken with a new turn after this many minutes (to check on something you can't wait on with start_job). End your turn after calling it.",
    { minutes: z.number().min(1).max(24 * 60), note: z.string() },
    async (ctx, { minutes, note }) => {
      await ctx.convex.mutation(api.director.addWakeup, { turnId: ctx.turnId, note, at: Date.now() + minutes * 60_000 });
      return `You'll be woken in ${minutes} minute${minutes === 1 ? "" : "s"}. End your turn now.`;
    },
  ),
  studioTool(
    "cancel_waits",
    "Stop waiting on every background job and timer of this story (stops the jobs' units too).",
    {},
    async (ctx) => {
      const n = await ctx.convex.mutation(api.director.cancelWakeups, { turnId: ctx.turnId });
      return `Cancelled ${n}.`;
    },
  ),
  studioTool(
    "list_voices",
    "The voice catalog: voices approved in earlier stories, with their reference wav, its transcript and how each was made. Check it before designing a new voice.",
    {},
    async (ctx) => {
      const voices = await ctx.convex.query(api.voices.list, {});
      if (!voices.length) return "The catalog is empty.";
      return json(
        voices.map((v) => ({
          name: v.name,
          character: v.character,
          description: v.description,
          refPath: v.refPath,
          refText: v.refText,
          notes: v.notes,
          fromStory: v.storyTitle,
        })),
      );
    },
  ),
  studioTool(
    "add_voice",
    "Add an approved voice to the voice catalog so later stories can cast it. Only after people approved the casting.",
    {
      name: z.string().describe("A name to cast it by, e.g. \"Gary (gruff Southern)\""),
      character: z.string().optional().describe("The character it was made for"),
      description: z.string().describe("What it sounds like: age, accent, pitch, pace, mood"),
      refPath: z.string().describe("The cloning reference wav (kept where it is; use a stable path)"),
      refText: z.string().describe("The reference's exact transcript"),
      notes: z.string().optional().describe("How it was made and how to use it: model, cues, --capacity, quirks"),
    },
    async (ctx, voice) => {
      const ref = existing(ctx, voice.refPath);
      const audio = await uploadAudio(ref);
      await ctx.convex.mutation(api.director.addVoice, {
        turnId: ctx.turnId,
        ...voice,
        refPath: ref,
        audioFile: audio.file,
        duration: audio.duration,
      });
      return `Added "${voice.name}" to the voice catalog.`;
    },
  ),
];

export const STUDIO_TOOL_NAMES = STUDIO_TOOLS.map((t) => `mcp__studio__${t.name}`);

/** The activity line shown in the story's thread for a tool call. */
export function studioLabel(name: string, input: Record<string, unknown>): string | null {
  const s = (k: string) => String(input[k] ?? "");
  switch (name) {
    case "mcp__studio__story_info":
      return "Checked the story";
    case "mcp__studio__read_script":
      return "Read the script";
    case "mcp__studio__edit_script":
      return `Edited the script: ${s("reason")}`;
    case "mcp__studio__open_feedback":
      return "Read the open feedback";
    case "mcp__studio__post_cut":
      return `Posted a cut: ${s("summary").split("\n")[0]}`;
    case "mcp__studio__post_image":
      return `Posted an image${input.caption ? `: ${s("caption")}` : ""}`;
    case "mcp__studio__write_note":
      return `Wrote the note “${s("title")}”`;
    case "mcp__studio__reply_to_comment":
      return "Replied to a comment";
    case "mcp__studio__resolve_comment":
      return "Resolved a comment";
    case "mcp__studio__set_status":
      return s("line");
    case "mcp__studio__request_review":
      return `Asked for review: ${s("message")}`;
    case "mcp__studio__ask_user":
      return `Asked: ${s("question")}`;
    case "mcp__studio__start_job":
      return `Started a job: ${s("note")}`;
    case "mcp__studio__wake_me_in":
      return `Set a timer (${s("minutes")} min): ${s("note")}`;
    case "mcp__studio__cancel_waits":
      return "Cancelled its background jobs";
    case "mcp__studio__list_voices":
      return "Checked the voice catalog";
    case "mcp__studio__add_voice":
      return `Added “${s("name")}” to the voice catalog`;
    default:
      return null;
  }
}
