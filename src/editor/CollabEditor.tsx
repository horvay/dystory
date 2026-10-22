import { useTiptapSync } from "@convex-dev/prosemirror-sync/tiptap";
import type { AnyExtension, Content, Editor } from "@tiptap/core";
import { sendableSteps } from "prosemirror-collab";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import Typography from "@tiptap/extension-typography";
import { useEffect, useRef, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import { EMPTY_DOC, schemaExtensions } from "../../shared/extensions";
import { RemoteCursors, setRemoteCursors, type RemoteCursor } from "./cursors";
import { Highlights } from "./highlights";
import { ChatRefs } from "./chatRefs";
import { SlashCommand } from "./SlashCommand";
import { Dictation } from "./dictation";
import { SelectionMenu } from "./Menus";

type Props = {
  docId: string;
  cursors: RemoteCursor[];
  /** Called on every local content change (not for remote ones). */
  onLocalEdit: () => void;
  onCursor: (anchor: number, head: number) => void;
  onEditor: (editor: Editor | null) => void;
  header: ReactNode;
};

export function CollabEditor(props: Props) {
  const sync = useTiptapSync(api.sync, props.docId, {
    onSyncError: (err) => console.warn("[sync]", err),
  });

  if (sync.isLoading) {
    return (
      <>
        {props.header}
        <div className="space-y-3 pt-2">
          {[92, 100, 84, 96, 60].map((w, i) => (
            <div key={i} className="h-4 animate-pulse rounded bg-surface-2" style={{ width: `${w}%` }} />
          ))}
        </div>
      </>
    );
  }
  if (sync.initialContent === null) {
    // Documents are created server-side, so this only happens for legacy or
    // damaged documents. Recreate an empty body.
    return (
      <>
        {props.header}
        <button
          onClick={() => sync.create(EMPTY_DOC)}
          className="rounded-xl border border-line px-4 py-2 text-sm hover:bg-surface-2"
        >
          Start this document
        </button>
      </>
    );
  }
  return <EditorInner {...props} initialContent={sync.initialContent} syncExtension={sync.extension} />;
}

function EditorInner({
  initialContent,
  syncExtension,
  cursors,
  onLocalEdit,
  onCursor,
  onEditor,
  header,
}: Props & { initialContent: Content; syncExtension: AnyExtension }) {
  const callbacks = useRef({ onLocalEdit, onCursor });
  callbacks.current = { onLocalEdit, onCursor };

  const editor = useEditor({
    extensions: [
      ...schemaExtensions,
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === "heading" ? "Heading" : "Write something, or press / for blocks and Claude…",
      }),
      CharacterCount,
      Typography,
      SlashCommand,
      RemoteCursors,
      Highlights,
      ChatRefs,
      Dictation,
      syncExtension,
    ],
    content: initialContent,
    editorProps: {
      attributes: { class: "doc", spellcheck: "true" },
      // Links open in a new tab. Done here rather than with the Link
      // extension's openOnClick, whose window.open leaves the opener reachable.
      handleClick: (view, _pos, event) => {
        if (event.button !== 0) return false;
        const link = (event.target as HTMLElement | null)?.closest("a");
        if (!link?.href || !view.dom.contains(link)) return false;
        window.open(link.href, "_blank", "noopener,noreferrer");
        return true;
      },
    },
    onUpdate: ({ transaction }) => {
      // prosemirror-collab marks steps received from the server this way.
      if (transaction.getMeta("addToHistory") !== false) callbacks.current.onLocalEdit();
    },
    onSelectionUpdate: ({ editor: e }) => {
      const { anchor, head } = e.state.selection;
      callbacks.current.onCursor(anchor, head);
    },
  });

  useEffect(() => {
    onEditor(editor);
    return () => onEditor(null);
  }, [editor, onEditor]);

  useEffect(() => {
    if (editor) setRemoteCursors(editor, cursors);
  }, [editor, cursors]);

  return (
    <>
      {header}
      <EditorContent editor={editor} />
      {editor && <SelectionMenu editor={editor} />}
    </>
  );
}

export function useEditorStats(editor: Editor | null) {
  return useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            words: (e.storage as { characterCount?: { words: () => number } }).characterCount?.words() ?? 0,
            unsynced: sendableSteps(e.state) !== null,
          }
        : null,
  });
}
