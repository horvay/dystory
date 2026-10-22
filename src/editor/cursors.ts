import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/core";

export type RemoteCursor = {
  id: string;
  name: string;
  color: string;
  anchor: number;
  head: number;
};

const key = new PluginKey<DecorationSet>("remoteCursors");

function build(doc: Node, cursors: RemoteCursor[]): DecorationSet {
  const max = doc.content.size;
  const clamp = (n: number) => Math.max(0, Math.min(n, max));
  const decos: Decoration[] = [];
  for (const c of cursors) {
    const head = clamp(c.head);
    const anchor = clamp(c.anchor);
    const from = Math.min(head, anchor);
    const to = Math.max(head, anchor);
    if (from !== to) {
      decos.push(
        Decoration.inline(from, to, { class: "remote-selection", style: `--c: ${c.color}` }, { id: c.id }),
      );
    }
    decos.push(
      Decoration.widget(
        head,
        () => {
          const caret = document.createElement("span");
          caret.className = "remote-caret";
          caret.style.setProperty("--c", c.color);
          const label = document.createElement("span");
          label.textContent = c.name;
          caret.append("⁠", label, "⁠");
          return caret;
        },
        { key: `${c.id}:${c.name}:${c.color}:${head}`, side: 10 },
      ),
    );
  }
  try {
    return DecorationSet.create(doc, decos);
  } catch {
    return DecorationSet.empty;
  }
}

/** Shows where other people's cursors and selections are. */
export const RemoteCursors = Extension.create({
  name: "remoteCursors",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const next = tr.getMeta(key) as RemoteCursor[] | undefined;
            if (next) return build(tr.doc, next);
            return set.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations: (state) => key.getState(state),
        },
      }),
    ];
  },
});

export function setRemoteCursors(editor: Editor, cursors: RemoteCursor[]) {
  if (editor.isDestroyed) return;
  editor.view.dispatch(editor.state.tr.setMeta(key, cursors).setMeta("addToHistory", false));
}
