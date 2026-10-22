// Editor extensions that define the document schema. Shared by the browser
// editor, the Convex backend (server-side transforms) and the AI worker, so
// keep this free of DOM / React imports.
import type { AnyExtension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";

export const schemaExtensions: AnyExtension[] = [
  StarterKit.configure({
    // Undo/redo stays on: prosemirror-collab marks remote steps as
    // non-undoable, so undo only reverts your own typing.
    link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
    heading: { levels: [1, 2, 3] },
    // The trailing-paragraph plugin runs in every open editor, so with two
    // people connected each one appends its own empty paragraph.
    trailingNode: false,
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Highlight,
  TextAlign.configure({ types: ["heading", "paragraph"] }),
];

export const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };
