import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { formatSeconds } from "../lib/time";
import type { DictationPhase } from "../lib/useDictation";

// Dictating into the document: a marker sits where the words will land,
// carried along through everyone's edits until the transcript replaces it.

export const DICTATE_EVENT = "ideaboard:dictate";

type Marker = { pos: number; el: HTMLElement } | null;
const key = new PluginKey<Marker>("dictation");

export const Dictation = Extension.create({
  name: "dictation",
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-Space": () => {
        window.dispatchEvent(new CustomEvent(DICTATE_EVENT));
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<Marker>({
        key,
        state: {
          init: () => null,
          apply(tr, prev) {
            const meta = tr.getMeta(key) as Marker | undefined;
            if (meta !== undefined) return meta;
            // Text typed right at the marker goes after the dictated words,
            // which were spoken first.
            return prev && tr.docChanged ? { ...prev, pos: tr.mapping.map(prev.pos, -1) } : prev;
          },
        },
        props: {
          decorations(state) {
            const m = key.getState(state);
            if (!m) return null;
            return DecorationSet.create(state.doc, [
              Decoration.widget(m.pos, m.el, { side: -1, key: "dictation", ignoreSelection: true }),
            ]);
          },
        },
      }),
    ];
  },
});

function setMarker(editor: Editor, marker: Marker) {
  if (editor.isDestroyed) return;
  editor.view.dispatch(editor.state.tr.setMeta(key, marker).setMeta("addToHistory", false));
}

/** Put the marker at the cursor. */
export function showDictationMarker(editor: Editor) {
  const el = document.createElement("span");
  el.className = "dictation-marker";
  el.contentEditable = "false";
  setMarker(editor, { pos: editor.state.selection.to, el });
  editor.commands.scrollIntoView();
}

export function hideDictationMarker(editor: Editor) {
  if (!editor.isDestroyed && key.getState(editor.state)) setMarker(editor, null);
}

export function labelDictationMarker(editor: Editor, phase: DictationPhase, seconds: number) {
  const el = editor.isDestroyed ? null : key.getState(editor.state)?.el;
  if (!el) return;
  el.dataset.phase = phase;
  el.textContent = phase === "recording" ? `Listening ${formatSeconds(seconds)}` : "Transcribing…";
}

/** Replace the marker with the dictated words, spaced to fit the text around them. */
export function insertDictation(editor: Editor, text: string) {
  if (editor.isDestroyed) return;
  const { state } = editor;
  const pos = key.getState(state)?.pos ?? state.selection.to;
  const $pos = state.doc.resolve(pos);
  const before = $pos.parent.textBetween(0, $pos.parentOffset, undefined, " ").slice(-1);
  const after = $pos.parent.textBetween($pos.parentOffset, $pos.parent.content.size, undefined, " ").slice(0, 1);
  let words = text;
  if (before && !/[\s([{“‘"'/-]/.test(before)) words = ` ${words}`;
  if (after && /[\p{L}\p{N}]/u.test(after)) words = `${words} `;
  editor.view.dispatch(state.tr.insertText(words, pos).setMeta(key, null));
}
