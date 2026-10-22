import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  Bold,
  Highlighter,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  MessageSquareQuote,
  Quote,
  Redo2,
  Sparkles,
  Strikethrough,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { MicButton } from "../components/MicButton";
import { cn } from "../lib/hooks";
import { useDictation } from "../lib/useDictation";
import { ASK_AI_EVENT, toggleList } from "./blocks";
import { CHAT_QUOTE_EVENT } from "./chatRefs";
import {
  DICTATE_EVENT,
  hideDictationMarker,
  insertDictation,
  labelDictationMarker,
  showDictationMarker,
} from "./dictation";

function useMarks(editor: Editor) {
  return useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      highlight: e.isActive("highlight"),
      link: e.isActive("link"),
      bulletList: e.isActive("bulletList"),
      orderedList: e.isActive("orderedList"),
      taskList: e.isActive("taskList"),
      blockquote: e.isActive("blockquote"),
      block: e.isActive("heading", { level: 1 })
        ? "h1"
        : e.isActive("heading", { level: 2 })
          ? "h2"
          : e.isActive("heading", { level: 3 })
            ? "h3"
            : "p",
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
}

function Btn({
  icon: Icon,
  label,
  active,
  disabled,
  onClick,
  className,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-lg text-ink-2 transition hover:bg-surface-2 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent",
        active && "bg-surface-2 text-ink",
        className,
      )}
    >
      <Icon size={17} strokeWidth={2} />
    </button>
  );
}

const Sep = () => <span className="mx-1 h-5 w-px shrink-0 bg-line" />;

function LinkInput({ editor, onDone }: { editor: Editor; onDone: () => void }) {
  const [href, setHref] = useState(() => editor.getAttributes("link").href ?? "");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const apply = () => {
    const url = href.trim();
    const c = editor.chain().focus().extendMarkRange("link");
    if (url) c.setLink({ href: /^[a-z]+:/i.test(url) ? url : `https://${url}` }).run();
    else c.unsetLink().run();
    onDone();
  };
  return (
    <div className="flex items-center gap-1 p-1">
      <input
        ref={ref}
        value={href}
        onChange={(e) => setHref(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            apply();
          } else if (e.key === "Escape") onDone();
        }}
        placeholder="Paste a link…"
        className="h-8 w-56 rounded-lg bg-bg px-2.5 text-sm outline-none"
      />
      <button onClick={apply} className="h-8 rounded-lg bg-ink px-3 text-xs font-medium text-bg">
        Apply
      </button>
      <button
        onClick={onDone}
        className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2"
        aria-label="Cancel"
      >
        <X size={15} />
      </button>
    </div>
  );
}

export function Toolbar({ editor, end }: { editor: Editor; end?: ReactNode }) {
  const s = useMarks(editor);
  const [linkOpen, setLinkOpen] = useState(false);
  const c = () => editor.chain().focus();

  return (
    <div className="relative">
      <div className="no-scrollbar flex items-center justify-center gap-0.5 overflow-x-auto px-2 py-1.5">
        <Btn icon={Undo2} label="Undo" disabled={!s.canUndo} onClick={() => c().undo().run()} />
        <Btn icon={Redo2} label="Redo" disabled={!s.canRedo} onClick={() => c().redo().run()} />
        <Sep />
        <select
          value={s.block}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "p") c().setParagraph().run();
            else c().setHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run();
          }}
          className="h-9 shrink-0 cursor-pointer rounded-lg bg-transparent px-2 text-sm font-medium text-ink-2 outline-none hover:bg-surface-2"
          aria-label="Text style"
        >
          <option value="p">Text</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
        </select>
        <Sep />
        <Btn icon={Bold} label="Bold (⌘B)" active={s.bold} onClick={() => c().toggleBold().run()} />
        <Btn icon={Italic} label="Italic (⌘I)" active={s.italic} onClick={() => c().toggleItalic().run()} />
        <Btn icon={Strikethrough} label="Strikethrough" active={s.strike} onClick={() => c().toggleStrike().run()} />
        <Btn icon={Highlighter} label="Highlight" active={s.highlight} onClick={() => c().toggleHighlight().run()} />
        <Btn icon={Link2} label="Link" active={s.link} onClick={() => setLinkOpen((o) => !o)} />
        <Sep />
        <Btn icon={List} label="Bulleted list" active={s.bulletList} onClick={() => toggleList(editor, "bulletList")} />
        <Btn icon={ListOrdered} label="Numbered list" active={s.orderedList} onClick={() => toggleList(editor, "orderedList")} />
        <Btn icon={ListChecks} label="To-do list" active={s.taskList} onClick={() => toggleList(editor, "taskList")} />
        <Btn icon={Quote} label="Quote" active={s.blockquote} onClick={() => c().toggleBlockquote().run()} />
        <Sep />
        <DictateButton editor={editor} />
        {end && <div className="ml-auto flex shrink-0 items-center pl-2">{end}</div>}
      </div>
      {linkOpen && (
        <div className="absolute top-full left-1/2 z-30 mt-1 -translate-x-1/2 rounded-xl border border-line bg-surface shadow-float">
          <LinkInput editor={editor} onDone={() => setLinkOpen(false)} />
        </div>
      )}
    </div>
  );
}

/** Speak into the document at the cursor (also the /dictate command and ⌘⇧Space). */
function DictateButton({ editor }: { editor: Editor }) {
  const dictation = useDictation({
    onStart: () => showDictationMarker(editor),
    onText: (text) => insertDictation(editor, text),
    onEnd: () => hideDictationMarker(editor),
  });
  const { phase, seconds, toggle } = dictation;

  useEffect(() => labelDictationMarker(editor, phase, seconds), [editor, phase, seconds]);

  useEffect(() => {
    window.addEventListener(DICTATE_EVENT, toggle);
    return () => window.removeEventListener(DICTATE_EVENT, toggle);
  }, [toggle]);

  return <MicButton dictation={dictation} className="size-9 rounded-lg" iconSize={17} />;
}

const DISCUSS_SHORTCUT = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘⌥M" : "Ctrl+Alt+M";

export function SelectionMenu({ editor }: { editor: Editor }) {
  const s = useMarks(editor);
  const [linkMode, setLinkMode] = useState(false);
  const c = () => editor.chain().focus();
  const boundary = typeof document !== "undefined" ? document.getElementById("doc-scroll") ?? undefined : undefined;

  return (
    <BubbleMenu
      editor={editor}
      options={{
        placement: "top",
        offset: 8,
        // Keep the menu inside the writing area instead of over the sidebar.
        shift: { padding: 8, boundary },
        flip: { boundary },
        onHide: () => setLinkMode(false),
      }}
      // Hidden once focus moves elsewhere, such as the Claude or chat box.
      shouldShow={({ editor: e, element, view, state, from, to }) =>
        (view.hasFocus() || element.contains(document.activeElement)) &&
        from !== to &&
        !e.isActive("codeBlock") &&
        !state.selection.toJSON().type?.includes("node")
      }
      className="rounded-xl border border-line bg-surface font-sans shadow-float"
    >
      {linkMode ? (
        <LinkInput editor={editor} onDone={() => setLinkMode(false)} />
      ) : (
        <div className="flex items-center gap-0.5 p-1">
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => window.dispatchEvent(new CustomEvent(ASK_AI_EVENT))}
            className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-ai hover:bg-ai-soft"
          >
            <Sparkles size={15} /> Ask Claude
          </button>
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => window.dispatchEvent(new CustomEvent(CHAT_QUOTE_EVENT))}
            title={`Discuss in the chat (${DISCUSS_SHORTCUT})`}
            aria-label="Discuss in the chat"
            className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"
          >
            <MessageSquareQuote size={15} /> <span className="hidden sm:inline">Discuss</span>
          </button>
          <Sep />
          <Btn icon={Bold} label="Bold" active={s.bold} onClick={() => c().toggleBold().run()} />
          <Btn icon={Italic} label="Italic" active={s.italic} onClick={() => c().toggleItalic().run()} />
          <Btn icon={Strikethrough} label="Strikethrough" active={s.strike} onClick={() => c().toggleStrike().run()} />
          <Btn icon={Highlighter} label="Highlight" active={s.highlight} onClick={() => c().toggleHighlight().run()} />
          <Btn icon={Link2} label="Link" active={s.link} onClick={() => setLinkMode(true)} />
        </div>
      )}
    </BubbleMenu>
  );
}
