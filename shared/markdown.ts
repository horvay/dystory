// Markdown <-> ProseMirror conversion and minimal block-level replacement.
// Runs inside Convex functions, so it must stay DOM-free.
import type { JSONContent } from "@tiptap/core";
import { getSchema } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { Node, type Schema } from "@tiptap/pm/model";
import { Transform } from "@tiptap/pm/transform";
import { schemaExtensions } from "./extensions";

let manager: MarkdownManager | null = null;
let schema: Schema | null = null;

export function getDocSchema(): Schema {
  schema ??= getSchema(schemaExtensions);
  return schema;
}

function md(): MarkdownManager {
  manager ??= new MarkdownManager({ extensions: schemaExtensions });
  return manager;
}

export function toMarkdown(doc: JSONContent): string {
  return md().serialize(doc).trim();
}

export function fromMarkdown(markdown: string): JSONContent {
  const parsed = md().parse(markdown);
  if (!parsed.content || parsed.content.length === 0) {
    return { type: "doc", content: [{ type: "paragraph" }] };
  }
  return parsed;
}

export function plainText(doc: Node): string {
  return doc.textBetween(0, doc.content.size, "\n\n", " ");
}

export function wordCount(text: string): number {
  const m = text.match(/\S+/g);
  return m ? m.length : 0;
}

/**
 * Build a transform that turns `doc` into `target`, replacing only the
 * top-level blocks that actually differ. Untouched blocks (and the cursors of
 * people typing in them) are left alone. `same` decides block equality, which
 * lets callers compare by markdown so that attributes markdown can't express
 * (like text alignment) survive on blocks the AI didn't touch.
 */
export function replaceBlocks(
  doc: Node,
  target: Node,
  same: (a: Node, b: Node) => boolean = (a, b) => a.eq(b),
): Transform | null {
  // Leave trailing empty paragraphs alone (Markdown can't represent them, so
  // they'd otherwise never match and drag the whole tail into the edit).
  const trimmed = (n: Node) => {
    let count = n.childCount;
    while (count > 1 && n.child(count - 1).isTextblock && n.child(count - 1).content.size === 0) count--;
    return count;
  };
  const oldCount = trimmed(doc);
  const newCount = trimmed(target);
  let start = 0;
  while (start < oldCount && start < newCount && same(doc.child(start), target.child(start))) {
    start++;
  }
  let endOld = oldCount;
  let endNew = newCount;
  while (endOld > start && endNew > start && same(doc.child(endOld - 1), target.child(endNew - 1))) {
    endOld--;
    endNew--;
  }
  if (start === endOld && start === endNew) return null;

  let from = 0;
  for (let i = 0; i < start; i++) from += doc.child(i).nodeSize;
  let to = from;
  for (let i = start; i < endOld; i++) to += doc.child(i).nodeSize;
  const nodes: Node[] = [];
  for (let i = start; i < endNew; i++) nodes.push(target.child(i));

  const tr = new Transform(doc);
  tr.replaceWith(from, to, nodes);
  return tr;
}

/** Block equality by rendered markdown (ignores attrs markdown can't hold). */
export function sameMarkdown(a: Node, b: Node): boolean {
  if (a.eq(b)) return true;
  const wrap = (n: Node) => toMarkdown({ type: "doc", content: [n.toJSON()] });
  return wrap(a) === wrap(b);
}

/** Replace the whole document with markdown, touching only changed blocks. */
export function markdownTransform(doc: Node, markdown: string): Transform | null {
  const target = Node.fromJSON(getDocSchema(), fromMarkdown(markdown));
  return replaceBlocks(doc, target, sameMarkdown);
}
