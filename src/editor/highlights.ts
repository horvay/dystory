import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// Two transient highlights:
// - "flash": where Claude just edited, fading out on every screen.
// - "pending": the selection quoted in the Claude composer, which stays
//   visible after focus moves from the editor to the chat box.
type Range = { from: number; to: number };
type Meta = { flash?: Range | null; pending?: Range | null };
type State = { flash: Range | null; pending: Range | null; decos: DecorationSet };

const key = new PluginKey<State>("highlights");

function build(doc: Parameters<typeof DecorationSet.create>[0], flash: Range | null, pending: Range | null) {
  const max = doc.content.size;
  const decos: Decoration[] = [];
  const add = (r: Range | null, cls: string) => {
    if (!r) return;
    const from = Math.max(0, Math.min(r.from, max));
    const to = Math.max(from, Math.min(r.to, max));
    if (to > from) decos.push(Decoration.inline(from, to, { class: cls }));
  };
  add(flash, "ai-flash");
  add(pending, "pending-selection");
  try {
    return DecorationSet.create(doc, decos);
  } catch {
    return DecorationSet.empty;
  }
}

export const Highlights = Extension.create({
  name: "highlights",
  addProseMirrorPlugins() {
    return [
      new Plugin<State>({
        key,
        state: {
          init: () => ({ flash: null, pending: null, decos: DecorationSet.empty }),
          apply(tr, prev) {
            const meta = tr.getMeta(key) as Meta | undefined;
            const mapRange = (r: Range | null) =>
              r && { from: tr.mapping.map(r.from, 1), to: tr.mapping.map(r.to, -1) };
            const flash = meta && "flash" in meta ? (meta.flash ?? null) : mapRange(prev.flash);
            const pending = meta && "pending" in meta ? (meta.pending ?? null) : mapRange(prev.pending);
            if (!meta && !tr.docChanged) return prev;
            return { flash, pending, decos: build(tr.doc, flash, pending) };
          },
        },
        props: { decorations: (state) => key.getState(state)?.decos },
      }),
    ];
  },
});

function dispatch(editor: Editor, meta: Meta) {
  if (editor.isDestroyed) return;
  editor.view.dispatch(editor.state.tr.setMeta(key, meta).setMeta("addToHistory", false));
}

const flashTimers = new WeakMap<Editor, ReturnType<typeof setTimeout>>();

/** Briefly highlight a range Claude just changed. */
export function flashRange(editor: Editor, range: Range, ms = 8000) {
  dispatch(editor, { flash: range });
  clearTimeout(flashTimers.get(editor));
  flashTimers.set(editor, setTimeout(() => dispatch(editor, { flash: null }), ms));
}

export function setPendingSelection(editor: Editor, range: Range | null) {
  dispatch(editor, { pending: range });
}
