// The document tools the AI uses to read and change a shared document. Each
// calls a Convex mutation, so changes stream live to everyone viewing it.
// Claude gets them as an in-process MCP server (Agent SDK); Muse gets the
// same tools over HTTP MCP (see muse.ts).
import type { ConvexClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { z } from "zod";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

export type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

export function errorText(err: unknown): string {
  if (err instanceof ConvexError) return String(err.data);
  if (err instanceof Error) return err.message;
  return String(err);
}

async function run(fn: () => Promise<string>): Promise<ToolResult> {
  try {
    return { content: [{ type: "text", text: await fn() }] };
  } catch (err) {
    return { content: [{ type: "text", text: errorText(err) }], isError: true };
  }
}

type Ctx = { convex: ConvexClient; requestId: Id<"aiRequests"> };

function docTool<Shape extends z.ZodRawShape>(
  name: string,
  description: string,
  schema: Shape,
  handler: (ctx: Ctx, args: z.infer<z.ZodObject<Shape>>) => Promise<string>,
) {
  return {
    name,
    description,
    schema,
    call: (ctx: Ctx, args: z.infer<z.ZodObject<Shape>>) => run(() => handler(ctx, args)),
  };
}

export const DOC_TOOLS = [
  docTool(
    "read_document",
    "Read the current title and full content (Markdown) of the shared document. Others may have edited it since you last looked.",
    {},
    async ({ convex, requestId }) => {
      const { title, markdown } = await convex.mutation(api.ai.readDoc, { requestId });
      return `Title: ${title || "(untitled)"}\n\n${markdown || "(the document is empty)"}`;
    },
  ),
  docTool(
    "edit_document",
    "Apply one or more find/replace edits to the document's Markdown. Each `find` must match exactly once (include enough surrounding text to be unique). Edits are applied in order, atomically.",
    {
      edits: z
        .array(
          z.object({
            find: z.string().describe("Exact Markdown text currently in the document"),
            replace: z.string().describe("Markdown to put in its place (may be empty to delete)"),
          }),
        )
        .min(1),
    },
    async ({ convex, requestId }, { edits }) => {
      await convex.mutation(api.ai.editDoc, { requestId, edits });
      return `Applied ${edits.length} edit${edits.length === 1 ? "" : "s"}.`;
    },
  ),
  docTool(
    "rewrite_document",
    "Replace the entire document body with new Markdown. Unchanged paragraphs are preserved as-is. Use for large restructures or first drafts.",
    { markdown: z.string() },
    async ({ convex, requestId }, { markdown }) => {
      await convex.mutation(api.ai.rewriteDoc, { requestId, markdown });
      return "Document rewritten.";
    },
  ),
  docTool(
    "set_title",
    "Set the document's title (shown above the body; don't repeat it as a heading in the body).",
    { title: z.string() },
    async ({ convex, requestId }, { title }) => {
      await convex.mutation(api.ai.setTitle, { requestId, title });
      return "Title updated.";
    },
  ),
];

/** The activity line shown in the panel for a tool call (Claude's and Muse's tool names). */
export function toolLabel(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "mcp__doc__read_document":
      return "Read the document";
    case "mcp__doc__edit_document": {
      const n = Array.isArray(input.edits) ? input.edits.length : 1;
      return `Edited the document (${n} change${n === 1 ? "" : "s"})`;
    }
    case "mcp__doc__rewrite_document":
      return "Rewrote the document";
    case "mcp__doc__set_title":
      return `Set the title to “${String(input.title ?? "")}”`;
    case "WebSearch":
    case "web_search":
      return `Searched the web: ${String(input.query ?? "")}`;
    case "WebFetch":
    case "web_fetch":
      return `Read ${String(input.url ?? "a web page")}`;
    default:
      return `Used ${name}`;
  }
}
