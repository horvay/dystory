import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { Modal } from "../components/Modal";
import { cn } from "../lib/hooks";
import { useMe } from "../lib/identity";
import { slugify } from "../../shared/director";
import { isSetupStage, nextStage, stageIndex, stageInfo, type StageId, type StageState } from "../../shared/stages";

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

type Song = { slug: string; title: string; units: number };

/**
 * Asks what to call a remake, or which song already in make_real to bring in,
 * then makes it and opens its Source page.
 */
export function NewRemakeDialog({ onClose }: { onClose: () => void }) {
  const me = useMe();
  const create = useMutation(api.stories.createRemake);
  const [, navigate] = useLocation();
  const [title, setTitle] = useState("");
  const [existing, setExisting] = useState(false);
  const [adopt, setAdopt] = useState("");
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only the media server sees the disk, so it lists the songs make_real has.
  useEffect(() => {
    fetch("/media/remakes")
      .then((r) => r.json())
      .then((d: { songs?: Song[] }) => setSongs(d.songs ?? []))
      .catch(() => setSongs([]));
  }, []);

  // A new remake gets a new folder: a title that lands on an existing song's folder would collide with it.
  const clash = !existing && title.trim() ? songs?.find((s) => s.slug === slugify(title)) : undefined;
  const picked = songs?.find((s) => s.slug === adopt);
  const ready = existing ? !!picked : !!title.trim() && !clash;
  const tab = (on: boolean) =>
    cn("h-8 flex-1 rounded-[10px] text-sm font-medium transition-colors", on ? "bg-surface text-ink shadow-soft" : "text-muted hover:text-ink");

  return (
    <Modal onClose={onClose} className="max-w-md">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ready) return;
          setBusy(true);
          setError(null);
          try {
            const id = await create(
              existing ? { userId: me._id, title: title.trim() || picked!.title, adopt } : { userId: me._id, title },
            );
            onClose();
            navigate(`/s/${id}`);
          } catch (err) {
            setError(err instanceof ConvexError ? String(err.data) : "Couldn't make the remake. Try again.");
          } finally {
            setBusy(false);
          }
        }}
        className="p-5"
      >
        <h2 className="font-semibold">New remake</h2>
        <p className="mt-1 mb-3 text-sm text-muted">
          A cartoon video remade as live action, shot for shot. No script: you give the director the video, and it shows
          you the cast, then the stills, then the footage.
        </p>
        <div className="mb-3 flex gap-0.5 rounded-xl bg-surface-2 p-0.5">
          <button type="button" onClick={() => setExisting(false)} className={tab(!existing)}>
            A new video
          </button>
          <button type="button" onClick={() => setExisting(true)} className={tab(existing)}>
            A song in progress
          </button>
        </div>
        {existing &&
          (songs === null ? (
            <p className="mb-3 text-sm text-muted">Looking for songs…</p>
          ) : songs.length === 0 ? (
            <p className="mb-3 text-sm text-muted">No song folders found in make_real.</p>
          ) : (
            <select
              value={adopt}
              onChange={(e) => setAdopt(e.target.value)}
              className="mb-3 h-10 w-full rounded-xl border border-line bg-bg px-3 outline-none focus:border-accent"
            >
              <option value="">Which song?</option>
              {songs.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.title} ({s.units} shots)
                </option>
              ))}
            </select>
          ))}
        <input
          autoFocus
          value={title}
          placeholder={existing ? picked?.title ?? "What's it called?" : "What's it called?"}
          onChange={(e) => setTitle(e.target.value)}
          className="h-10 w-full rounded-xl border border-line bg-bg px-3 outline-none placeholder:text-muted focus:border-accent"
        />
        {clash && (
          <p className="mt-2 text-sm text-ink-2">
            make_real already has a song folder called <span className="font-mono">{clash.slug}</span>.{" "}
            <button
              type="button"
              className="font-medium text-accent hover:underline"
              onClick={() => {
                setExisting(true);
                setAdopt(clash.slug);
              }}
            >
              Bring that one in
            </button>{" "}
            or pick another title.
          </p>
        )}
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-xl px-4 text-sm hover:bg-surface-2">
            Cancel
          </button>
          <button
            disabled={busy || !ready}
            className="h-9 rounded-xl bg-ink px-4 text-sm font-medium text-bg disabled:opacity-50"
          >
            {existing ? "Bring it in" : "Create remake"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Confirms a stage move: approving the current stage, putting the script into
 * production (or starting a remake), or moving to another stage. People can
 * add a note for the director.
 */
export function StageMoveDialog({
  story,
  to,
  step,
  pending = 0,
  onClose,
}: {
  story: Story;
  /** The open review is for this step inside the stage: approving it doesn't move the story on. */
  step?: string;
  /** Notes not yet sent to the director; they go with an approval. */
  pending?: number;
  /** Missing: approve and go to the next stage. */
  to?: StageId;
  onClose: () => void;
}) {
  const me = useMe();
  const approve = useMutation(api.stories.approve);
  const setStage = useMutation(api.stories.setStage);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const kind = story.kind;
  const remake = kind === "remake";
  const current = stageInfo(story.stage, kind);
  const back = to !== undefined;
  const target = to ? stageInfo(to, kind) : null;
  const toSetup = to !== undefined && isSetupStage(to);
  const earlier = to !== undefined && stageIndex(to, kind) < stageIndex(story.stage, kind);
  // An adopted song starts at the stage it had reached.
  const adopt = story.source?.adopt;
  const startAt = stageInfo(story.source?.startAt ?? "breakdown", "remake").label;

  const title = !back
    ? story.stage === "script"
      ? "Put the script into production?"
      : story.stage === "source"
        ? adopt
          ? "Bring this song into Dynastory?"
          : "Start the remake?"
        : step
          ? `Approve ${step}?`
          : `Approve ${current.label}?`
    : toSetup
      ? `Back to the ${target!.label.toLowerCase()}?`
      : earlier
        ? `Redo from ${target!.label}?`
        : `Skip ahead to ${target!.label}?`;
  const body = !back
    ? story.stage === "script"
      ? "The director starts on casting: it reads the script and picks or designs a voice for every character. You'll review auditions before any line is voiced."
      : story.stage === "source"
        ? adopt
          ? `The director reads the song's folder and log, posts its newest cut here, and carries on at ${startAt}.`
          : "The director gets the video, maps every shot and works out who is in it. You approve the cast before any still is made, and the stills before anything renders."
        : step
          ? `The director carries on with ${current.label}. You'll still approve the ${current.label.toLowerCase()} itself when it's done.`
          : story.stage === "short"
            ? `That marks the ${remake ? "remake" : "story"} as published.`
            : `The director moves on to ${stageInfo(nextStage(story.stage, kind), kind).label}.`
    : toSetup
      ? remake
        ? "Production stops: the director's queued work and background jobs are cancelled. Start the remake again when the source is right."
        : "Production stops: the director's queued work and background jobs are cancelled. Put the script back into production when it's ready."
      : earlier
        ? `The director redoes ${target!.label} and then every stage after it, up to ${current.label}. The work so far stays in the thread.`
        : `The director skips ahead to ${target!.label}.`;
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal onClose={onClose} className="max-w-md">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            if (back) await setStage({ storyId: story._id, userId: me._id, stage: to!, note: note || undefined });
            else await approve({ storyId: story._id, userId: me._id, note: note || undefined });
            onClose();
          } catch (err) {
            setError(err instanceof ConvexError ? String(err.data) : "That didn't go through. Try again.");
          } finally {
            setBusy(false);
          }
        }}
        className="p-5"
      >
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-1 mb-3 text-sm text-muted">{body}</p>
        {!back && pending > 0 && !isSetupStage(story.stage) && (
          <p className="mb-3 rounded-xl bg-accent/8 px-3 py-2 text-sm text-ink-2">
            {pending === 1 ? "1 note hasn't" : `${pending} notes haven't`} gone to the director yet. They go with the
            approval, as small fixes to make along the way.
          </p>
        )}
        {!toSetup && (
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Anything the director should know (optional)"
            className="w-full resize-none rounded-xl border border-line bg-bg px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent"
          />
        )}
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-xl px-4 text-sm hover:bg-surface-2">
            Cancel
          </button>
          <button disabled={busy} className="h-9 rounded-xl bg-ink px-4 text-sm font-medium text-bg disabled:opacity-50">
            {!back
              ? story.stage === "script"
                ? "Start production"
                : story.stage === "source"
                  ? adopt
                    ? "Bring it in"
                    : "Start the remake"
                  : "Approve"
              : toSetup || earlier
                ? "Redo from here"
                : "Skip ahead"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

