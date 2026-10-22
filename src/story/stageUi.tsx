import { useMutation } from "convex/react";
import { useState } from "react";
import { useLocation } from "wouter";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { Modal } from "../components/Modal";
import { cn } from "../lib/hooks";
import { useMe } from "../lib/identity";
import { nextStage, stageInfo, type StageId, type StageState } from "../../shared/stages";

export type Story = Doc<"stories">;

export const STATE_LABEL: Record<StageState, string> = {
  writing: "Writing",
  working: "Director working",
  review: "Ready for review",
  waiting: "Needs you",
  done: "Published",
};

/** A dot and chip color per state: who has the ball. */
export const STATE_TONE: Record<StageState, { dot: string; chip: string }> = {
  writing: { dot: "bg-line-strong", chip: "bg-surface-2 text-ink-2" },
  working: { dot: "bg-accent animate-pulse", chip: "bg-accent/12 text-accent" },
  review: { dot: "bg-emerald-500", chip: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
  waiting: { dot: "bg-amber-500", chip: "bg-amber-500/14 text-amber-700 dark:text-amber-300" },
  done: { dot: "bg-ink-2", chip: "bg-surface-2 text-ink-2" },
};

export function StageChip({ stage, state, className }: { stage: StageId; state: StageState; className?: string }) {
  const tone = STATE_TONE[state];
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold", tone.chip, className)}
      title={STATE_LABEL[state]}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", tone.dot)} />
      {stage === "done" ? "Published" : stageInfo(stage).label}
    </span>
  );
}

/** Asks for a story title, then makes the story and opens its script. */
export function NewStoryDialog({ onClose, docId, title: initial }: { onClose: () => void; docId?: Id<"docs">; title?: string }) {
  const me = useMe();
  const create = useMutation(api.stories.create);
  const [, navigate] = useLocation();
  const [title, setTitle] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <Modal onClose={onClose} className="max-w-md">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const id = await create({ userId: me._id, title, docId });
            onClose();
            navigate(`/s/${id}`);
          } finally {
            setBusy(false);
          }
        }}
        className="p-5"
      >
        <h2 className="font-semibold">{docId ? "Turn this document into a story" : "New story"}</h2>
        <p className="mt-1 mb-3 text-sm text-muted">
          {docId
            ? "The document becomes the story's script. When it's ready, put it into production and the director takes it from there."
            : "Start with the script. When it's ready, put it into production and the director takes it from there: voices, stills, animation, sound, upload."}
        </p>
        <input
          autoFocus
          value={title}
          placeholder="What's it called?"
          onChange={(e) => setTitle(e.target.value)}
          className="h-10 w-full rounded-xl border border-line bg-bg px-3 outline-none placeholder:text-muted focus:border-accent"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-xl px-4 text-sm hover:bg-surface-2">
            Cancel
          </button>
          <button disabled={busy} className="h-9 rounded-xl bg-ink px-4 text-sm font-medium text-bg disabled:opacity-50">
            Create story
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Confirms a stage move: approving the current stage, putting the script into
 * production, or moving to another stage. People can add a note for the director.
 */
export function StageMoveDialog({
  story,
  to,
  onClose,
}: {
  story: Story;
  /** Missing: approve and go to the next stage. */
  to?: StageId;
  onClose: () => void;
}) {
  const me = useMe();
  const approve = useMutation(api.stories.approve);
  const setStage = useMutation(api.stories.setStage);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const current = stageInfo(story.stage);
  const back = to !== undefined;
  const target = to ? stageInfo(to) : null;

  const title = !back
    ? story.stage === "script"
      ? "Put the script into production?"
      : `Approve ${current.label}?`
    : to === "script"
      ? "Back to the script?"
      : `Move to ${target!.label}?`;
  const body = !back
    ? story.stage === "script"
      ? "The director starts on casting: it reads the script and picks or designs a voice for every character. You'll review auditions before any line is voiced."
      : story.stage === "short"
        ? "That marks the story as published."
        : `The director moves on to ${stageInfo(nextStage(story.stage)).label}.`
    : to === "script"
      ? "Production stops: the director's queued work and background jobs are cancelled. Put the script back into production when it's ready."
      : "The director is told to redo the work from that stage on, and says what has to change before starting.";

  return (
    <Modal onClose={onClose} className="max-w-md">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            if (back) await setStage({ storyId: story._id, userId: me._id, stage: to!, note: note || undefined });
            else await approve({ storyId: story._id, userId: me._id, note: note || undefined });
            onClose();
          } finally {
            setBusy(false);
          }
        }}
        className="p-5"
      >
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-1 mb-3 text-sm text-muted">{body}</p>
        {to !== "script" && (
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Anything the director should know (optional)"
            className="w-full resize-none rounded-xl border border-line bg-bg px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent"
          />
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-xl px-4 text-sm hover:bg-surface-2">
            Cancel
          </button>
          <button disabled={busy} className="h-9 rounded-xl bg-ink px-4 text-sm font-medium text-bg disabled:opacity-50">
            {!back ? (story.stage === "script" ? "Start production" : "Approve") : "Move"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

