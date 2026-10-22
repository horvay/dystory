import { useMutation } from "convex/react";
import {
  Check,
  CircleCheck,
  Circle,
  Link2,
  MoreHorizontal,
  Pencil,
  PenLine,
  SendHorizontal,
  SquareDashed,
  Trash2,
  X,
} from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { Avatar } from "../components/Avatar";
import { DictationStatus, MicButton } from "../components/MicButton";
import { useToast } from "../components/Toast";
import { cn } from "../lib/hooks";
import { useMe } from "../lib/identity";
import { parseTimecode, relativeTime, timecode } from "../lib/time";
import { useTextDictation, type Dictation } from "../lib/useDictation";
import { usePlayback, type Playback } from "./playback";

type Comment = Doc<"comments">;
type User = Doc<"users">;
export type Range = { start: number; end: number };
type Filter = "all" | "open" | "resolved";

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function CommentsPanel({
  pb,
  comments,
  users,
  selectedId,
  onSelect,
  composer,
}: {
  pb: Playback;
  comments: Comment[] | undefined;
  users: Map<string, User>;
  selectedId: string | null;
  onSelect: (c: Comment) => void;
  composer: ReactNode;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const notes = (comments ?? [])
    .filter((c) => !c.parentId)
    .sort((a, b) => (a.time ?? 0) - (b.time ?? 0) || a._creationTime - b._creationTime);
  const replies = new Map<string, Comment[]>();
  for (const c of comments ?? []) {
    if (c.parentId) replies.set(c.parentId, [...(replies.get(c.parentId) ?? []), c]);
  }
  const open = notes.filter((c) => !c.resolved).length;
  const shown = notes.filter((c) => (filter === "all" ? true : filter === "open" ? !c.resolved : c.resolved));

  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selectedId) return;
    list.current
      ?.querySelector(`[data-comment="${selectedId}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId, comments === undefined]); // also once comments load, for ?c= links

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <h2 className="text-sm font-semibold">Comments</h2>
        <div className="ml-auto grid grid-cols-3 gap-0.5 rounded-lg bg-surface-2 p-0.5 text-xs">
          {(
            [
              ["all", `All ${notes.length}`],
              ["open", `Open ${open}`],
              ["resolved", `Done ${notes.length - open}`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={cn(
                "rounded-md px-2 py-1 font-medium tabular-nums",
                filter === id ? "bg-surface text-ink shadow-soft" : "text-muted hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div ref={list} className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {comments === undefined ? (
          <p className="p-6 text-center text-sm text-muted">Loading…</p>
        ) : shown.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted">
            {notes.length === 0 ? (
              <>
                <p className="font-medium text-ink-2">No comments yet</p>
                <p className="mt-1">Pause anywhere and type below. The comment is pinned to that moment.</p>
              </>
            ) : filter === "open" ? (
              "Everything's resolved 🎉"
            ) : (
              "Nothing resolved yet"
            )}
          </div>
        ) : (
          shown.map((c) => (
            <Thread
              key={c._id}
              pb={pb}
              note={c}
              replies={replies.get(c._id) ?? []}
              users={users}
              selected={c._id === selectedId}
              onSelect={() => onSelect(c)}
            />
          ))
        )}
      </div>
      {composer}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One comment and its replies
// ---------------------------------------------------------------------------

function Thread({
  pb,
  note,
  replies,
  users,
  selected,
  onSelect,
}: {
  pb: Playback;
  note: Comment;
  replies: Comment[];
  users: Map<string, User>;
  selected: boolean;
  onSelect: () => void;
}) {
  const me = useMe();
  const setResolved = useMutation(api.comments.setResolved);
  const reply = useMutation(api.comments.reply);
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState("");
  const start = note.time ?? 0;
  const end = note.endTime ?? start + 2;
  const playing = usePlayback(pb, (s) => s.time >= start - 0.05 && s.time < end);
  const author = users.get(note.authorId);
  const resolver = note.resolvedBy && users.get(note.resolvedBy);

  const sendReply = async () => {
    if (!draft.trim()) return;
    await reply({ parentId: note._id, authorId: me._id, body: draft });
    setDraft("");
    setReplying(false);
  };

  return (
    <div
      data-comment={note._id}
      onClick={onSelect}
      className={cn(
        "relative cursor-pointer border-b border-line px-4 py-3 transition-colors",
        selected ? "bg-accent/8" : "hover:bg-surface-2/60",
      )}
    >
      {playing && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent" />}
      <div className={cn(note.resolved && !selected && "opacity-55")}>
        <div className="flex items-center gap-2">
          <Avatar name={author?.name ?? "?"} color={author?.color ?? "#888"} size={24} />
          <span className="truncate text-sm font-semibold">{author?.name ?? "Someone"}</span>
          <span className="shrink-0 text-xs text-muted">{relativeTime(note._creationTime)}</span>
          <div className="ml-auto flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setResolved({ commentId: note._id, userId: me._id, resolved: !note.resolved })}
              title={note.resolved ? "Reopen" : "Mark as done"}
              className={cn(
                "grid size-7 place-items-center rounded-md hover:bg-surface-2",
                note.resolved ? "text-emerald-500" : "text-muted hover:text-ink",
              )}
            >
              {note.resolved ? <CircleCheck size={17} /> : <Circle size={17} />}
            </button>
            <CommentMenu comment={note} />
          </div>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="rounded-md bg-accent/12 px-1.5 py-0.5 font-mono text-xs font-medium text-accent tabular-nums">
            {timecode(start)}
            {note.endTime !== undefined && ` – ${timecode(note.endTime)}`}
          </span>
          {note.drawing && (
            <span className="flex items-center gap-1 text-xs text-muted" title="Has a drawing on the frame">
              <PenLine size={12} /> drawing
            </span>
          )}
        </div>

        <Body comment={note} pb={pb} />
        {note.resolved && resolver && (
          <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">Marked done by {resolver.name}</p>
        )}
      </div>

      {replies.length > 0 && (
        <div className="mt-2 space-y-2.5 border-l-2 border-line pl-3">
          {replies.map((r) => {
            const who = users.get(r.authorId);
            return (
              <div key={r._id}>
                <div className="flex items-center gap-1.5">
                  <Avatar name={who?.name ?? "?"} color={who?.color ?? "#888"} size={18} />
                  <span className="text-xs font-semibold">{who?.name ?? "Someone"}</span>
                  <span className="text-xs text-muted">{relativeTime(r._creationTime)}</span>
                  <div className="ml-auto" onClick={(e) => e.stopPropagation()}>
                    <CommentMenu comment={r} small />
                  </div>
                </div>
                <Body comment={r} pb={pb} />
              </div>
            );
          })}
        </div>
      )}

      <div onClick={(e) => e.stopPropagation()}>
        {replying ? (
          <ReplyBox value={draft} onChange={setDraft} onSend={sendReply} onCancel={() => setReplying(false)} />
        ) : (
          <button onClick={() => setReplying(true)} className="mt-1.5 text-xs font-medium text-muted hover:text-ink">
            Reply
          </button>
        )}
      </div>
    </div>
  );
}

/** Comment text, with any "1:23"-style times turned into links that jump there. */
function Body({ comment, pb }: { comment: Comment; pb: Playback }) {
  const me = useMe();
  const edit = useMutation(api.comments.edit);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent).detail === comment._id && comment.authorId === me._id) {
        setDraft(comment.body);
        setEditing(true);
      }
    };
    window.addEventListener("edit-comment", on);
    return () => window.removeEventListener("edit-comment", on);
  }, [comment._id, comment.authorId, comment.body, me._id]);

  if (editing) {
    const save = async () => {
      await edit({ commentId: comment._id, body: draft });
      setEditing(false);
    };
    return <EditBox value={draft} onChange={setDraft} onSave={save} onCancel={() => setEditing(false)} />;
  }
  if (!comment.body) return null;
  const parts = comment.body.split(/(\b\d{1,2}:\d{2}(?::\d{2})?\b)/g);
  return (
    <p className="mt-1 text-sm leading-relaxed break-words whitespace-pre-wrap text-ink">
      {parts.map((part, i) => {
        const t = i % 2 ? parseTimecode(part) : null;
        return t === null ? (
          part
        ) : (
          <button
            key={i}
            onClick={(e) => {
              e.stopPropagation();
              pb.pause();
              pb.seek(t);
            }}
            className="font-medium text-accent hover:underline"
          >
            {part}
          </button>
        );
      })}
      {comment.editedAt && <span className="text-xs text-muted"> (edited)</span>}
    </p>
  );
}

function CommentMenu({ comment, small }: { comment: Comment; small?: boolean }) {
  const me = useMe();
  const toast = useToast();
  const remove = useMutation(api.comments.remove);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  const mine = comment.authorId === me._id;

  const items: { label: string; icon: typeof Link2; run: () => void; danger?: boolean }[] = [];
  if (!comment.parentId) {
    items.push({
      label: "Copy link",
      icon: Link2,
      run: () => {
        const url = new URL(window.location.href);
        url.searchParams.set("c", comment._id);
        url.searchParams.delete("t");
        void navigator.clipboard?.writeText(url.toString());
        toast({ message: "Link copied" });
      },
    });
  }
  if (mine) {
    items.push({
      label: "Edit",
      icon: Pencil,
      run: () => window.dispatchEvent(new CustomEvent("edit-comment", { detail: comment._id })),
    });
    items.push({
      label: "Delete",
      icon: Trash2,
      danger: true,
      run: () => {
        if (confirm(comment.parentId ? "Delete this reply?" : "Delete this comment and its replies?")) {
          void remove({ commentId: comment._id });
        }
      },
    });
  }
  if (!items.length) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="More"
        className={cn(
          "grid place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink",
          small ? "size-5" : "size-7",
        )}
      >
        <MoreHorizontal size={small ? 14 : 16} />
      </button>
      {open && (
        <div className="absolute top-full right-0 z-20 mt-1 w-36 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-float">
          {items.map((it) => (
            <button
              key={it.label}
              onClick={() => {
                setOpen(false);
                it.run();
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-2",
                it.danger && "text-danger",
              )}
            >
              <it.icon size={14} /> {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

export type ComposerHandle = { focus: () => void };

export const Composer = forwardRef<
  ComposerHandle,
  {
    pb: Playback;
    range: Range | null;
    onRange: (r: Range | null) => void;
    drawing: boolean;
    shapeCount: number;
    onToggleDraw: () => void;
    onSubmit: (body: string) => Promise<void>;
  }
>(function Composer({ pb, range, onRange, drawing, shapeCount, onToggleDraw, onSubmit }, ref) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const time = usePlayback(pb, (s) => s.time);
  const duration = usePlayback(pb, (s) => s.duration);
  // Pauses like typing does, so the comment stays on the frame you're talking about.
  const dictation = useTextDictation(input, body, setBody, { onStart: () => pb.pause() });
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), []);
  const canSend = (body.trim() || shapeCount > 0) && !busy;

  const submit = async () => {
    if (!canSend) return;
    setBusy(true);
    try {
      await onSubmit(body);
      setBody("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-line bg-surface p-3">
      <div className="rounded-xl border border-line bg-bg focus-within:border-accent">
        <DictationStatus dictation={dictation} className="mx-1.5 mt-1.5" />
        <AutoTextarea
          ref={input}
          value={body}
          onChange={setBody}
          onSubmit={submit}
          onFocus={() => pb.pause()}
          dictation={dictation}
          placeholder={`Comment at ${timecode(range?.start ?? time)}…`}
          className="max-h-40 min-h-11 w-full px-3 pt-2.5 pb-1 text-sm"
        />
        <div className="flex items-center gap-1 px-1.5 pb-1.5">
          {range ? (
            <div className="flex items-center gap-0.5 rounded-lg bg-amber-400/15 p-0.5 text-xs text-amber-700 dark:text-amber-300">
              <button
                onClick={() => onRange({ start: Math.min(time, range.end - 0.1), end: range.end })}
                title="Set the start to the playhead (I)"
                className="rounded-md px-1.5 py-1 font-mono tabular-nums hover:bg-amber-400/20"
              >
                {timecode(range.start)}
              </button>
              →
              <button
                onClick={() => onRange({ start: range.start, end: Math.max(time, range.start + 0.1) })}
                title="Set the end to the playhead (O)"
                className="rounded-md px-1.5 py-1 font-mono tabular-nums hover:bg-amber-400/20"
              >
                {timecode(range.end)}
              </button>
              <button
                onClick={() => onRange(null)}
                aria-label="Remove range"
                className="grid size-6 place-items-center rounded-md hover:bg-amber-400/20"
              >
                <X size={13} />
              </button>
            </div>
          ) : (
            <>
              <span className="rounded-md px-1.5 py-1 font-mono text-xs text-accent tabular-nums">
                {timecode(time)}
              </span>
              <ToolButton
                onClick={() => onRange({ start: time, end: Math.min(time + 3, duration || time + 3) })}
                title="Comment on a span of time (I / O set the ends)"
              >
                <SquareDashed size={15} /> <span className="hidden sm:inline">Range</span>
              </ToolButton>
            </>
          )}
          <ToolButton onClick={onToggleDraw} active={drawing || shapeCount > 0} title="Draw on the frame (D)">
            <PenLine size={15} />
            <span className="hidden sm:inline">Draw</span>
            {shapeCount > 0 && <span className="tabular-nums">· {shapeCount}</span>}
          </ToolButton>
          <MicButton dictation={dictation} className="ml-auto size-8 rounded-lg" />
          <button
            onClick={submit}
            disabled={!canSend}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3 text-sm font-medium text-bg transition disabled:opacity-30"
          >
            <Check size={15} /> Post
          </button>
        </div>
      </div>
    </div>
  );
});

function ToolButton({
  children,
  onClick,
  active,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium",
        active ? "bg-accent/12 text-accent" : "text-muted hover:bg-surface-2 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

/**
 * The reply box under a comment. Closing it stops any dictation into it.
 * The dictation status goes below, so the mic button stays put to click again.
 */
function ReplyBox({
  value,
  onChange,
  onSend,
  onCancel,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onCancel: () => void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const dictation = useTextDictation(field, value, onChange);
  return (
    <div className="mt-2">
      <div className="flex items-end gap-1.5">
        <AutoTextarea
          ref={field}
          autoFocus
          value={value}
          onChange={onChange}
          onSubmit={onSend}
          onCancel={onCancel}
          dictation={dictation}
          placeholder="Reply…"
          className="min-h-8 flex-1 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm"
        />
        <MicButton dictation={dictation} />
        <button
          onClick={onSend}
          disabled={!value.trim()}
          className="grid size-8 place-items-center rounded-lg bg-ink text-bg disabled:opacity-30"
          aria-label="Send reply"
        >
          <SendHorizontal size={15} />
        </button>
      </div>
      <DictationStatus dictation={dictation} className="mt-1.5" />
    </div>
  );
}

/** Editing a comment, on a video or an image. Closing it stops any dictation into it. */
export function EditBox({
  value,
  onChange,
  onSave,
  onCancel,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const dictation = useTextDictation(field, value, onChange);
  return (
    <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
      <AutoTextarea
        ref={field}
        autoFocus
        value={value}
        onChange={onChange}
        onSubmit={onSave}
        onCancel={onCancel}
        dictation={dictation}
        className="w-full rounded-lg border border-accent bg-bg px-2.5 py-1.5 text-sm"
      />
      <div className="mt-1 flex items-center justify-end gap-1 text-xs">
        <DictationStatus dictation={dictation} className="mr-auto min-w-0" />
        <MicButton dictation={dictation} className="size-7 rounded-md" iconSize={15} />
        <button onClick={onCancel} className="rounded-md px-2 py-1 hover:bg-surface-2">
          Cancel
        </button>
        <button onClick={onSave} className="rounded-md bg-ink px-2 py-1 font-medium text-bg">
          Save
        </button>
      </div>
    </div>
  );
}

// Enter sends, Shift+Enter is a new line, Escape cancels, and Ctrl/⌘+Shift+Space
// starts or stops the box's dictation.
export const AutoTextarea = forwardRef<
  HTMLTextAreaElement,
  {
    value: string;
    onChange: (v: string) => void;
    onSubmit: () => void;
    onCancel?: () => void;
    onFocus?: () => void;
    placeholder?: string;
    className?: string;
    autoFocus?: boolean;
    dictation?: Dictation;
  }
>(function AutoTextarea(
  { value, onChange, onSubmit, onCancel, onFocus, placeholder, className, autoFocus, dictation },
  ref,
) {
  const el = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => el.current!, []);
  useEffect(() => {
    const t = el.current;
    if (!t) return;
    t.style.height = "auto";
    // scrollHeight leaves out the border, which the height includes.
    t.style.height = `${t.scrollHeight + t.offsetHeight - t.clientHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={el}
      rows={1}
      value={value}
      autoFocus={autoFocus}
      placeholder={placeholder}
      onFocus={onFocus}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onSubmit();
        } else if (e.key === " " && e.shiftKey && (e.ctrlKey || e.metaKey) && dictation) {
          e.preventDefault();
          dictation.toggle();
        } else if (e.key === "Escape") {
          onCancel?.();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
      className={cn("resize-none bg-transparent outline-none placeholder:text-muted", className)}
    />
  );
});

export type { Comment, User, Id };
