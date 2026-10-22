import { Extension, type Editor } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { CHAT_MAX_QUOTE } from "../../shared/chat";

// Chat messages can quote a passage of the document. While the chat is open,
// the passages they quote are tinted in the quoter's color; hovering a
// message deepens its tint, and clicking a tinted passage finds the message.
// The passage being quoted in the chat box is marked too, and a passage
// opened from the chat pulses.

/** Dispatched on window to quote the editor's selection in the chat. */
export const CHAT_QUOTE_EVENT = "ideaboard:chat-quote";
/** Dispatched on window, with message ids as detail, when a quoted passage is clicked. */
export const CHAT_REF_CLICK_EVENT = "ideaboard:chat-ref-click";

export type Range = { from: number; to: number };
export type Quote = Range & { text: string };
/** `label` (who said what) is the passage's tooltip. */
export type ChatRef = Range & { id: string; color: string; label?: string };
type Mark = Range & { color: string };

type Marks = { refs: ChatRef[]; active: string | null; draft: Mark | null; flash: Mark | null };
type State = Marks & { decos: DecorationSet };

const key = new PluginKey<State>("chatRefs");

function build(doc: Node, s: Marks) {
  const max = doc.content.size;
  const decos: Decoration[] = [];
  const add = (r: Mark, cls: string, title?: string) => {
    const from = Math.max(0, Math.min(r.from, max));
    const to = Math.max(from, Math.min(r.to, max));
    const attrs = { class: cls, style: `--c: ${r.color}`, ...(title && { title }) };
    if (to > from) decos.push(Decoration.inline(from, to, attrs));
  };
  for (const r of s.refs) add(r, r.id === s.active ? "chat-ref is-active" : "chat-ref", r.label);
  if (s.draft) add(s.draft, "chat-ref-draft");
  if (s.flash) add(s.flash, "chat-ref-flash");
  try {
    return DecorationSet.create(doc, decos);
  } catch {
    return DecorationSet.empty;
  }
}

function mapRange<T extends Range>(tr: Transaction, r: T): T | null {
  const from = tr.mapping.map(r.from, 1);
  const to = tr.mapping.map(r.to, -1);
  return to > from ? { ...r, from, to } : null;
}

export const ChatRefs = Extension.create({
  name: "chatRefs",
  addProseMirrorPlugins() {
    return [
      new Plugin<State>({
        key,
        state: {
          init: () => ({ refs: [], active: null, draft: null, flash: null, decos: DecorationSet.empty }),
          apply(tr, prev) {
            const meta = tr.getMeta(key) as Partial<Marks> | undefined;
            if (!meta && !tr.docChanged) return prev;
            const map = <T extends Range>(r: T | null) => (r && tr.docChanged ? mapRange(tr, r) : r);
            const next: Marks = {
              refs: meta?.refs ?? (tr.docChanged ? prev.refs.flatMap((r) => mapRange(tr, r) ?? []) : prev.refs),
              active: meta && "active" in meta ? (meta.active ?? null) : prev.active,
              draft: meta && "draft" in meta ? (meta.draft ?? null) : map(prev.draft),
              flash: meta && "flash" in meta ? (meta.flash ?? null) : map(prev.flash),
            };
            return { ...next, decos: build(tr.doc, next) };
          },
        },
        props: {
          decorations: (state) => key.getState(state)?.decos,
          // The click still places the cursor; the chat also shows the message.
          handleClick(view, pos) {
            const ids = (key.getState(view.state)?.refs ?? [])
              .filter((r) => r.from <= pos && pos <= r.to)
              .map((r) => r.id);
            if (ids.length) window.dispatchEvent(new CustomEvent(CHAT_REF_CLICK_EVENT, { detail: ids }));
            return false;
          },
        },
      }),
    ];
  },
});

function dispatch(editor: Editor, meta: Partial<Marks>) {
  if (editor.isDestroyed) return;
  editor.view.dispatch(editor.state.tr.setMeta(key, meta).setMeta("addToHistory", false));
}

export function setChatRefs(editor: Editor, refs: ChatRef[]) {
  const prev = key.getState(editor.state)?.refs;
  if (!prev?.length && !refs.length) return;
  dispatch(editor, { refs });
}

/** Deepens the tint of one message's passage (the message under the pointer). */
export function setActiveChatRef(editor: Editor, id: string | null) {
  if ((key.getState(editor.state)?.active ?? null) !== id) dispatch(editor, { active: id });
}

/** Marks the passage quoted in the chat box. */
export function setDraftQuote(editor: Editor, mark: Mark | null) {
  dispatch(editor, { draft: mark });
}

/** Where the passage quoted in the chat box is now, after any edits. */
export function draftRange(editor: Editor): Range | null {
  return key.getState(editor.state)?.draft ?? null;
}

/** Where a message's passage is now, after any edits. */
export function chatRefRange(editor: Editor, id: string): Range | null {
  return key.getState(editor.state)?.refs.find((r) => r.id === id) ?? null;
}

const flashTimers = new WeakMap<Editor, ReturnType<typeof setTimeout>>();

/** Pulses a passage, after the chat has scrolled the document to it. */
export function flashPassage(editor: Editor, mark: Mark, ms = 2600) {
  dispatch(editor, { flash: mark });
  clearTimeout(flashTimers.get(editor));
  flashTimers.set(editor, setTimeout(() => dispatch(editor, { flash: null }), ms));
}

/** Scrolls the document so a range sits a third of the way down the screen. */
export function revealRange(editor: Editor, range: Range) {
  const scroller = document.getElementById("doc-scroll");
  if (!scroller || editor.isDestroyed) return;
  const coords = editor.view.coordsAtPos(Math.min(range.from, editor.state.doc.content.size));
  const box = scroller.getBoundingClientRect();
  const top = scroller.scrollTop + coords.top - box.top - box.height / 3;
  scroller.scrollTo({ top, behavior: "smooth" });
}

// --- Finding passages by their text -----------------------------------------

/** The document's text, blocks separated by "\n", with each character's position. */
export type FlatText = { text: string; pos: number[] };

export function flatten(doc: Node): FlatText {
  let text = "";
  const pos: number[] = [];
  let first = true;
  doc.descendants((node, p) => {
    if (node.isTextblock) {
      if (!first) {
        text += "\n";
        pos.push(p);
      }
      first = false;
      return true;
    }
    if (node.isText) {
      const t = node.text ?? "";
      text += t;
      for (let i = 0; i < t.length; i++) pos.push(p + i);
      return false;
    }
    if (node.type.name === "hardBreak") {
      text += "\n";
      pos.push(p);
    }
    return true;
  });
  return { text, pos };
}

/** First index in a sorted array whose value is at least `x`. */
function lowerBound(arr: number[], x: number) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The selected text, trimmed, as a quote for the chat. */
export function selectionQuote(editor: Editor): Quote | null {
  const { from, to, empty } = editor.state.selection;
  if (empty) return null;
  const flat = flatten(editor.state.doc);
  let start = lowerBound(flat.pos, from);
  let end = Math.min(lowerBound(flat.pos, to), start + CHAT_MAX_QUOTE);
  while (start < end && /\s/.test(flat.text[start]!)) start++;
  while (end > start && /\s/.test(flat.text[end - 1]!)) end--;
  if (start >= end) return null;
  return { text: flat.text.slice(start, end), from: flat.pos[start]!, to: flat.pos[end - 1]! + 1 };
}

/**
 * Where a quoted passage is now. Of several matches, the one nearest where it
 * was quoted; null once nobody's edits leave the passage word for word.
 */
export function findQuote(flat: FlatText, quote: Quote): Range | null {
  if (!quote.text) return null;
  let best = -1;
  let bestDist = Infinity;
  for (let i = flat.text.indexOf(quote.text); i !== -1; i = flat.text.indexOf(quote.text, i + 1)) {
    const d = Math.abs(flat.pos[i]! - quote.from);
    if (d < bestDist) {
      best = i;
      bestDist = d;
    }
  }
  if (best === -1) return null;
  return { from: flat.pos[best]!, to: flat.pos[best + quote.text.length - 1]! + 1 };
}
