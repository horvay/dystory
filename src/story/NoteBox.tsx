// A note on a moment of a cut or on images, written right where it was
// clicked. It isn't a message to the director: notes wait and go to it
// together a few minutes after the last one (or with Approve / Not good).
import { useMutation } from "convex/react";
import { MessageSquarePlus, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MicButton } from "../components/MicButton";
import { useToast } from "../components/Toast";
import { DictationStatus } from "../panels/AiPanel";
import { cn } from "../lib/hooks";
import { useMe } from "../lib/identity";
import { useDictation } from "../lib/useDictation";

export function NoteBox({
  title,
  imageIds,
  cut,
  onDone,
  dark,
}: {
  title: ReactNode;
  imageIds?: Id<"images">[];
  cut?: { versionId: Id<"versions">; time: number };
  onDone: () => void;
  /** On the image viewer's black background. */
  dark?: boolean;
}) {
  const me = useMe();
  const toast = useToast();
  const addNote = useMutation(api.feedback.addNote);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const dictation = useDictation({
    onText: (t) => {
      setText((p) => (p.trim() ? `${p.trimEnd()} ${t}` : t));
      input.current?.focus();
    },
  });

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
    input.current?.closest("[data-note-box]")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  const save = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await addNote({ userId: me._id, text: body, imageIds, cut });
      toast({ message: "Note saved. It goes to the director with the others in a few minutes." });
      onDone();
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't save the note." });
      setBusy(false);
    }
  };

  return (
    <div
      data-note-box
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "w-full rounded-xl border-2 text-left",
        dark ? "border-amber-300/60 bg-neutral-900 text-white" : "border-amber-400/70 bg-amber-50 dark:bg-amber-950/30",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 px-3 pt-2.5 text-sm font-semibold",
          dark ? "text-amber-200" : "text-amber-800 dark:text-amber-200",
        )}
      >
        <MessageSquarePlus size={15} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <button
          onClick={onDone}
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-lg",
            dark ? "text-white/60 hover:bg-white/10" : "text-muted hover:bg-black/5",
          )}
          aria-label="Cancel note"
        >
          <X size={15} />
        </button>
      </div>
      <DictationStatus dictation={dictation} />
      <textarea
        ref={input}
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation(); // the image viewer's arrow keys
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void save();
          } else if (e.key === "Escape") {
            onDone();
          } else if (e.key === " " && e.shiftKey && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            dictation.toggle();
          }
        }}
        placeholder="What should change here?"
        aria-label="Note"
        className={cn(
          "block w-full resize-none bg-transparent px-3 py-2 text-sm outline-none",
          dark ? "placeholder:text-white/40" : "placeholder:text-muted",
        )}
      />
      <div className="flex items-center gap-2 px-2 pb-2">
        <p className={cn("min-w-0 flex-1 px-1 text-[11px] leading-snug", dark ? "text-white/55" : "text-muted")}>
          A note, not a message: the director gets it with the other notes a few minutes after the last one.
        </p>
        <MicButton dictation={dictation} className="size-9 rounded-lg" iconSize={16} />
        <button
          onClick={save}
          disabled={!text.trim() || busy}
          className="h-9 shrink-0 rounded-lg bg-amber-500 px-3.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-40"
        >
          Leave note
        </button>
      </div>
    </div>
  );
}
