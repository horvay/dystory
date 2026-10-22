import type { Editor, Range } from "@tiptap/core";
import { DICTATE_EVENT } from "./dictation";
import {
  Code2,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListChecks,
  ListOrdered,
  Mic,
  Minus,
  Pilcrow,
  Quote,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export type BlockItem = {
  id: string;
  title: string;
  hint: string;
  icon: LucideIcon;
  keywords: string;
  run: (editor: Editor, range?: Range) => void;
};

const chain = (editor: Editor, range?: Range) => {
  const c = editor.chain().focus();
  return range ? c.deleteRange(range) : c;
};

export const ASK_AI_EVENT = "ideaboard:ask-ai";

type ListType = "bulletList" | "orderedList" | "taskList";
const LISTS: ListType[] = ["bulletList", "orderedList", "taskList"];

/**
 * Like Tiptap's toggle*List, but switching between list kinds converts the
 * whole list instead of splitting the current item out of it.
 */
export function toggleList(editor: Editor, type: ListType, range?: Range) {
  if (range) editor.chain().focus().deleteRange(range).run();
  const { state } = editor;
  const $from = state.selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (!LISTS.includes(node.type.name as ListType)) continue;
    if (node.type.name === type) break; // same kind: let Tiptap lift it out
    const schema = state.schema;
    const itemType = type === "taskList" ? schema.nodes.taskItem! : schema.nodes.listItem!;
    const items: import("@tiptap/pm/model").Node[] = [];
    node.forEach((item) =>
      items.push(itemType.create(type === "taskList" ? { checked: false } : null, item.content)),
    );
    const pos = $from.before(d);
    const tr = state.tr.replaceWith(pos, pos + node.nodeSize, schema.nodes[type]!.create(null, items));
    editor.view.dispatch(tr.scrollIntoView());
    editor.commands.focus();
    return;
  }
  const c = editor.chain().focus();
  if (type === "bulletList") c.toggleBulletList().run();
  else if (type === "orderedList") c.toggleOrderedList().run();
  else c.toggleTaskList().run();
}

export const BLOCKS: BlockItem[] = [
  {
    id: "ai",
    title: "Ask Claude",
    hint: "Write, edit or brainstorm",
    icon: Sparkles,
    keywords: "ai claude write help",
    run: (editor, range) => {
      chain(editor, range).run();
      window.dispatchEvent(new CustomEvent(ASK_AI_EVENT));
    },
  },
  {
    id: "dictate",
    title: "Dictate",
    hint: "Speak instead of typing",
    icon: Mic,
    keywords: "dictate dictation voice speak speech talk microphone mic transcribe",
    run: (editor, range) => {
      chain(editor, range).run();
      window.dispatchEvent(new CustomEvent(DICTATE_EVENT));
    },
  },
  {
    id: "p",
    title: "Text",
    hint: "Plain paragraph",
    icon: Pilcrow,
    keywords: "paragraph text body",
    run: (e, r) => chain(e, r).setParagraph().run(),
  },
  {
    id: "h1",
    title: "Heading 1",
    hint: "Big section heading",
    icon: Heading1,
    keywords: "title h1 heading",
    run: (e, r) => chain(e, r).setHeading({ level: 1 }).run(),
  },
  {
    id: "h2",
    title: "Heading 2",
    hint: "Medium heading",
    icon: Heading2,
    keywords: "subtitle h2 heading",
    run: (e, r) => chain(e, r).setHeading({ level: 2 }).run(),
  },
  {
    id: "h3",
    title: "Heading 3",
    hint: "Small heading",
    icon: Heading3,
    keywords: "h3 heading",
    run: (e, r) => chain(e, r).setHeading({ level: 3 }).run(),
  },
  {
    id: "ul",
    title: "Bulleted list",
    hint: "Simple list",
    icon: List,
    keywords: "bullet unordered list ul",
    run: (e, r) => toggleList(e, "bulletList", r),
  },
  {
    id: "ol",
    title: "Numbered list",
    hint: "List with numbers",
    icon: ListOrdered,
    keywords: "numbered ordered list ol",
    run: (e, r) => toggleList(e, "orderedList", r),
  },
  {
    id: "todo",
    title: "To-do list",
    hint: "Checklist",
    icon: ListChecks,
    keywords: "todo task checklist checkbox",
    run: (e, r) => toggleList(e, "taskList", r),
  },
  {
    id: "quote",
    title: "Quote",
    hint: "Pull quote or aside",
    icon: Quote,
    keywords: "quote blockquote",
    run: (e, r) => chain(e, r).toggleBlockquote().run(),
  },
  {
    id: "code",
    title: "Code block",
    hint: "Monospaced block",
    icon: Code2,
    keywords: "code pre snippet",
    run: (e, r) => chain(e, r).toggleCodeBlock().run(),
  },
  {
    id: "hr",
    title: "Divider",
    hint: "Section break",
    icon: Minus,
    keywords: "divider hr rule line separator",
    run: (e, r) => chain(e, r).setHorizontalRule().run(),
  },
];
