import { useMutation, useQuery } from "convex/react";
import { ChevronLeft, NotebookPen, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { Avatar } from "../components/Avatar";
import { DictationStatus, MicButton } from "../components/MicButton";
import { StudioBar, useStudio } from "../components/Studio";
import { useToast } from "../components/Toast";
import { cn, useMediaQuery } from "../lib/hooks";
import { useMe } from "../lib/identity";
import { relativeTime } from "../lib/time";
import { useTextDictation } from "../lib/useDictation";

type Note = Doc<"notes">;
type User = Doc<"users">;

const firstLine = (s: string) => s.trim().split("\n", 1)[0]!.trim();

export function NotesTab({ noteId }: { noteId?: string }) {
  const { video, paths } = useStudio();
  const me = useMe();
  const toast = useToast();
  const notes = useQuery(api.notes.list, { videoId: video._id });
  const users = useQuery(api.users.list);
  const userMap = useMemo(() => new Map((users ?? []).map((u) => [u._id as string, u])), [users]);
  const create = useMutation(api.notes.create);
  const [, navigate] = useLocation();
  // Side by side on wide screens; on a phone, the list or one note.
  const wide = useMediaQuery("(min-width: 768px)");
  const base = paths.notes;
  const current = notes?.find((n) => n._id === noteId) ?? (wide ? notes?.[0] : undefined);

  const newNote = async () => {
    try {
      const id = await create({ videoId: video._id, userId: me._id });
      navigate(`${base}/${id}`);
    } catch {
      toast({ message: "Couldn't create a note. Try again." });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <StudioBar>
        <button
          onClick={newNote}
          title="New note"
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"
        >
          <Plus size={16} /> <span className="hidden md:inline">New note</span>
        </button>
      </StudioBar>

      {notes === undefined ? (
        <p className="py-20 text-center text-muted">Loading…</p>
      ) : notes.length === 0 ? (
        <div className="grid flex-1 place-items-center p-4">
          <div className="max-w-sm text-center">
            <NotebookPen size={30} className="mx-auto text-muted" />
            <p className="mt-4 text-lg font-semibold">No notes yet</p>
            <p className="mt-1 text-sm text-muted">
              Script, shot list, voice-over, music ideas: anything this video needs. Everyone sees edits live.
            </p>
            <button
              onClick={newNote}
              className="mt-5 inline-flex h-9 items-center gap-2 rounded-xl bg-ink px-3.5 text-sm font-medium text-bg hover:opacity-90"
            >
              <Plus size={16} /> Write the first note
            </button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <nav
            className={cn(
              "scroll-thin min-h-0 shrink-0 overflow-y-auto border-line bg-surface md:w-72 md:border-r lg:w-80",
              current && !wide ? "hidden" : "w-full",
            )}
          >
            {notes.map((n) => (
              <NoteRow key={n._id} note={n} href={`${base}/${n._id}`} who={userMap.get(n.updatedBy)} selected={n._id === current?._id} />
            ))}
          </nav>
          {current ? (
            <NoteEditor
              key={current._id}
              note={current}
              editor={userMap.get(current.updatedBy)}
              onBack={wide ? undefined : () => navigate(base)}
              onDeleted={() => navigate(base, { replace: true })}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function NoteRow({ note, href, who, selected }: { note: Note; href: string; who?: User; selected: boolean }) {
  const title = note.title.trim() || firstLine(note.body) || "Untitled";
  const rest = note.title.trim() ? note.body : note.body.trim().split("\n").slice(1).join(" ");
  return (
    <Link
      href={href}
      className={cn(
        "block border-b border-line px-4 py-3 transition-colors",
        selected ? "bg-accent/8" : "hover:bg-surface-2/60",
      )}
    >
      <p className={cn("truncate text-sm font-semibold", title === "Untitled" && "text-muted")}>{title}</p>
      {rest.trim() && <p className="mt-0.5 line-clamp-2 text-sm break-words text-muted">{rest.trim()}</p>}
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
        <Avatar name={who?.name ?? "?"} color={who?.color ?? "#888"} size={16} />
        <span className="truncate">{who?.name ?? "Someone"}</span>· {relativeTime(note.updatedAt)}
      </p>
    </Link>
  );
}

/**
 * One note, saved as you type. Other people's saves show up live while you
 * aren't mid-edit. If two people type at once, the second save is held back
 * and whoever hit it chooses whose text to keep.
 */
function NoteEditor({
  note,
  editor,
  onBack,
  onDeleted,
}: {
  note: Note;
  editor?: User;
  onBack?: () => void;
  onDeleted: () => void;
}) {
  const me = useMe();
  const toast = useToast();
  const save = useMutation(api.notes.save);
  const remove = useMutation(api.notes.remove);
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [status, setStatus] = useState<"saved" | "saving" | "unsaved">("saved");
  const [conflict, setConflict] = useState(false);

  // What's typed, and the server version (updatedAt) it was based on.
  const latest = useRef({ title: note.title, body: note.body });
  const base = useRef(note.updatedAt);
  const dirty = useRef(false);
  const saving = useRef(false);
  const held = useRef(false); // a conflict is waiting on a choice
  const gone = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const scroller = useRef<HTMLDivElement>(null);
  const bodyEl = useRef<HTMLTextAreaElement>(null);
  const titleEl = useRef<HTMLInputElement>(null);

  const adopt = useCallback((n: Note) => {
    const el = bodyEl.current;
    const sel = el && document.activeElement === el ? ([el.selectionStart, el.selectionEnd] as const) : null;
    latest.current = { title: n.title, body: n.body };
    base.current = n.updatedAt;
    dirty.current = false;
    held.current = false;
    setTitle(n.title);
    setBody(n.body);
    setConflict(false);
    setStatus("saved");
    if (sel) requestAnimationFrame(() => el!.setSelectionRange(...sel));
  }, []);

  const flush = useCallback(
    async (force = false) => {
      clearTimeout(timer.current);
      if (!dirty.current || saving.current || gone.current || (held.current && !force)) return;
      saving.current = true;
      dirty.current = false;
      setStatus("saving");
      const { title, body } = latest.current;
      try {
        const r = await save({ noteId: note._id, userId: me._id, title, body, base: base.current, force });
        if (r.conflict) {
          dirty.current = true;
          held.current = true;
          setConflict(true);
        } else {
          base.current = r.updatedAt;
          held.current = false;
          setConflict(false);
        }
      } catch {
        dirty.current = true;
        if (!gone.current) toast({ message: "Couldn't save the note. It'll retry as you type." });
      } finally {
        saving.current = false;
      }
      setStatus(dirty.current ? "unsaved" : "saved");
      if (dirty.current && !held.current) timer.current = setTimeout(() => void flush(), 1500);
    },
    [me._id, note._id, save, toast],
  );

  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => void flushRef.current(), []); // switching notes saves what's pending

  // Someone else saved: take it, unless we're mid-edit (then saving finds the conflict).
  useEffect(() => {
    if (note.updatedAt === base.current || dirty.current || saving.current) return;
    adopt(note);
  }, [note, adopt]);

  useEffect(() => {
    if (status === "saved") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [status]);

  // A fresh note starts with the cursor in its title.
  useEffect(() => {
    if (!note.title && !note.body) titleEl.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Grow the text area with its text, without the page jumping.
  useLayoutEffect(() => {
    const el = bodyEl.current;
    const box = scroller.current;
    if (!el || !box) return;
    const top = box.scrollTop;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    box.scrollTop = top;
  }, [body]);

  const edit = (next: { title?: string; body?: string }) => {
    latest.current = { ...latest.current, ...next };
    if (next.title !== undefined) setTitle(next.title);
    if (next.body !== undefined) setBody(next.body);
    dirty.current = true;
    setStatus("unsaved");
    clearTimeout(timer.current);
    if (!held.current) timer.current = setTimeout(() => void flush(), 600);
  };

  const dictation = useTextDictation(bodyEl, body, (b) => edit({ body: b }));

  const del = async () => {
    if (!confirm("Delete this note for everyone?")) return;
    gone.current = true;
    clearTimeout(timer.current);
    await remove({ noteId: note._id });
    onDeleted();
  };

  const mine = note.updatedBy === me._id;
  return (
    <div ref={scroller} className="scroll-thin min-h-0 min-w-0 flex-1 overflow-y-auto bg-bg">
      <div className="sticky top-0 z-10 flex h-11 items-center gap-2 border-b border-line bg-bg/85 px-2 backdrop-blur md:px-4">
        {onBack && (
          <button
            onClick={onBack}
            className="flex h-8 items-center gap-0.5 rounded-lg pr-2 pl-1 text-sm font-medium text-ink-2 hover:bg-surface-2"
          >
            <ChevronLeft size={17} /> Notes
          </button>
        )}
        <span className="min-w-0 truncate px-1 text-xs text-muted">
          {status === "saving"
            ? "Saving…"
            : status === "unsaved"
              ? "Edited"
              : `Saved · ${mine ? "you" : (editor?.name ?? "someone")}, ${relativeTime(note.updatedAt)}`}
        </span>
        <DictationStatus dictation={dictation} className="ml-auto shrink-0" />
        <MicButton dictation={dictation} className={cn("size-8 rounded-lg", dictation.phase === "idle" && "ml-auto")} />
        <button
          onClick={del}
          title="Delete note"
          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-danger"
        >
          <Trash2 size={16} />
        </button>
      </div>

      {conflict && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-amber-400/30 bg-amber-400/15 px-4 py-2 text-sm text-ink">
          <span className="min-w-0 flex-1">
            {editor && !mine ? editor.name : "Someone"} changed this note while you were typing.
          </span>
          <button onClick={() => adopt(note)} className="rounded-lg px-2 py-1 font-semibold hover:bg-amber-400/20">
            Use theirs
          </button>
          <button
            onClick={() => void flush(true)}
            className="rounded-lg bg-amber-400/30 px-2 py-1 font-semibold hover:bg-amber-400/45"
          >
            Keep mine
          </button>
        </div>
      )}

      <div className="mx-auto max-w-2xl px-5 pt-6 pb-24 md:px-8 md:pt-10">
        <input
          ref={titleEl}
          value={title}
          aria-label="Note title"
          placeholder="Untitled"
          onChange={(e) => edit({ title: e.target.value })}
          onBlur={() => void flush()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              bodyEl.current?.focus();
            }
          }}
          className="w-full bg-transparent text-2xl font-semibold tracking-tight outline-none placeholder:text-muted/60"
        />
        <textarea
          ref={bodyEl}
          value={body}
          aria-label="Note"
          placeholder="Script, shot list, ideas…"
          onChange={(e) => edit({ body: e.target.value })}
          onBlur={() => void flush()}
          onKeyDown={(e) => {
            if (e.key === " " && e.shiftKey && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              dictation.toggle();
            }
          }}
          rows={8}
          className="mt-3 block w-full resize-none overflow-hidden bg-transparent text-[15px] leading-7 outline-none placeholder:text-muted"
        />
      </div>
    </div>
  );
}
