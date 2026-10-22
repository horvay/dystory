import type { Editor } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { schemaExtensions } from "../../shared/extensions";

let manager: MarkdownManager | null = null;
const md = () => (manager ??= new MarkdownManager({ extensions: schemaExtensions }));

export function editorMarkdown(editor: Editor): string {
  return md().serialize(editor.getJSON()).trim();
}

/** The current selection as Markdown, so Claude can match it exactly. */
export function selectionMarkdown(editor: Editor): string {
  const { selection, doc } = editor.state;
  if (selection.empty) return "";
  try {
    const content = selection.content().content.toJSON() ?? [];
    const text = md().serialize({ type: "doc", content }).trim();
    if (text) return text;
  } catch {}
  return doc.textBetween(selection.from, selection.to, "\n\n", " ").trim();
}
