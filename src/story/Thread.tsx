// The story's thread: everything the director did and asked, in order, with
// the cuts and images it wants looked at right in it. Its internal steps fold
// away; the decision bar under it acts on the open request.
import { useMutation, useQuery } from "convex/react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Clapperboard,
  ExternalLink,
  Hourglass,
  MessageSquarePlus,
  Minimize2,
  Play,
  RotateCcw,
  ThumbsDown,
  X,
} from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "wouter";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { Avatar, DirectorAvatar } from "../components/Avatar";
import { renderChatMarkdown } from "../lib/chatMarkdown";
import { cn } from "../lib/hooks";
import { clockTime, dayLabel, timecode } from "../lib/time";
import { stageInfo, type StageId } from "../../shared/stages";
import { NoteBox } from "./NoteBox";
import type { StoryData } from "./StoryPage";

type ThreadData = NonNullable<ReturnType<typeof useQuery<typeof api.requests.thread>>>;
type Turn = Doc<"turns">;
type Request = Doc<"requests">;
type Version = ThreadData["versions"][number];
type Image = ThreadData["images"][number];

const PAGE = 60;

/** Scrolls the thread to a stage's divider (the stage rail calls it). */
export function scrollToStage(stage: StageId) {
  document.getElementById(`stage-${stage}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Scrolls to the open request's card and flashes it. */
export function scrollToOpenRequest() {
  const el = document.querySelector<HTMLElement>("[data-open-request]");
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.classList.remove("request-flash");
  void el.offsetWidth;
  el.classList.add("request-flash");
  return true;
}

export function Thread({ story }: { story: StoryData }) {
  const [limit, setLimit] = useState(PAGE);
  const data = useQuery(api.requests.thread, { storyId: story._id, limit });
  const users = useQuery(api.users.list);
  const cancel = useMutation(api.turns.cancel);
  const userById = useMemo(() => new Map(users?.map((u) => [u._id, u]) ?? []), [users]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stuck = useRef(true); // following the newest message
  const first = useRef(true);
  // Keep the last page while a bigger one loads, so "Show earlier" doesn't blank the thread.
  const last = useRef(data);
  if (data) last.current = data;
  const shown = data ?? last.current;

  const byTurn = useMemo(() => {
    const versions = new Map<string, Version[]>();
    const images = new Map<string, Image[]>();
    const requests = new Map<string, Request[]>();
    const inRequest = new Set<string>();
    for (const r of shown?.requests ?? []) {
      requests.set(r.turnId, [...(requests.get(r.turnId) ?? []), r]);
      for (const id of [...r.versionIds, ...r.imageIds]) inRequest.add(id);
    }
    // What a request shows isn't repeated under the turn that posted it.
    for (const x of shown?.versions ?? []) {
      if (x.turnId && !inRequest.has(x._id)) versions.set(x.turnId, [...(versions.get(x.turnId) ?? []), x]);
    }
    for (const i of shown?.images ?? []) {
      if (i.turnId && !inRequest.has(i._id)) images.set(i.turnId, [...(images.get(i.turnId) ?? []), i]);
    }
    return { versions, images, requests };
  }, [shown]);

  const versionById = useMemo(() => new Map(shown?.versions.map((x) => [x._id, x]) ?? []), [shown]);
  const imageById = useMemo(() => new Map(shown?.images.map((i) => [i._id, i]) ?? []), [shown]);
  const turns = shown?.turns ?? [];
  const tail = turns.at(-1);

  // The last divider for each stage gets the id the rail scrolls to.
  const dividers = useMemo(() => {
    const at = new Map<number, StageId>();
    const lastFor = new Map<StageId, number>();
    let prev: StageId | undefined;
    turns.forEach((t, i) => {
      const s = t.stage;
      if (s && s !== prev) {
        at.set(i, s);
        lastFor.set(s, i);
      }
      if (s) prev = s;
    });
    return { at, lastFor };
  }, [turns]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  // Open on the request waiting for people, else the newest message; then follow new ones.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !shown) return;
    if (first.current) {
      first.current = false;
      const open = el.querySelector<HTMLElement>("[data-open-request]");
      if (open) {
        el.scrollTop = open.offsetTop - 16;
        stuck.current = false;
        return;
      }
      el.scrollTop = el.scrollHeight;
      return;
    }
    if (stuck.current) el.scrollTop = el.scrollHeight;
  }, [shown, tail?.response, tail?.activity.length, tail?.status]);

  if (!shown) return <div className="flex-1" />;

  return (
    <div ref={scrollRef} onScroll={onScroll} className="scroll-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-5 px-4 pt-5 pb-8 sm:px-6">
        {shown.more && (
          <button
            onClick={() => setLimit((n) => n + PAGE)}
            className="mx-auto block rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-ink"
          >
            Show earlier
          </button>
        )}
        {turns.length === 0 && <Empty story={story} />}
        {turns.map((t, i) => {
          const stage = dividers.at.get(i);
          return (
            <Fragment key={t._id}>
              {stage && (
                <StageDivider stage={stage} id={dividers.lastFor.get(stage) === i ? `stage-${stage}` : undefined} />
              )}
              {i > 0 && dayLabel(t._creationTime) !== dayLabel(turns[i - 1]!._creationTime) && !stage && (
                <DayDivider ts={t._creationTime} />
              )}
              <TurnView
                turn={t}
                author={t.requestedBy ? userById.get(t.requestedBy) : undefined}
                versions={byTurn.versions.get(t._id) ?? []}
                images={byTurn.images.get(t._id) ?? []}
                storyId={story._id}
                onStop={() => cancel({ turnId: t._id })}
              />
              {(byTurn.requests.get(t._id) ?? []).map((r) => (
                <RequestCard
                  key={r._id}
                  request={r}
                  storyId={story._id}
                  versions={r.versionIds.map((id) => versionById.get(id)).filter((x): x is Version => !!x)}
                  images={r.imageIds.map((id) => imageById.get(id)).filter((x): x is Image => !!x)}
                  decidedBy={r.decidedBy ? userById.get(r.decidedBy) : undefined}
                />
              ))}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function Empty({ story }: { story: StoryData }) {
  return (
    <div className="pt-10 text-center">
      <div className="mx-auto mb-3 grid size-11 place-items-center rounded-2xl bg-accent/12 text-accent">
        <Clapperboard size={20} />
      </div>
      <p className="font-medium">The director makes the video</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
        {story.stage === "script"
          ? "Once the script is ready, start production. The director voices it, makes the stills, animates them, and shows you everything here to approve."
          : "Everything it makes and asks shows up here. Write to it any time."}
      </p>
    </div>
  );
}

function StageDivider({ stage, id }: { stage: StageId; id?: string }) {
  return (
    <div id={id} className="flex scroll-mt-4 items-center gap-3 pt-3">
      <span className="h-px flex-1 bg-line" />
      <span className="text-[11px] font-semibold tracking-wider text-muted uppercase">{stageInfo(stage).label}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

function DayDivider({ ts }: { ts: number }) {
  return <div className="text-center text-[11px] text-muted">{dayLabel(ts)}</div>;
}

// ---------------------------------------------------------------------------
// A turn: what started it, then the director's reply
// ---------------------------------------------------------------------------

function TurnView({
  turn,
  author,
  versions,
  images,
  storyId,
  onStop,
}: {
  turn: Turn;
  author?: Doc<"users">;
  versions: Version[];
  images: Image[];
  storyId: Id<"stories">;
  onStop: () => void;
}) {
  const live = turn.status === "running" || turn.status === "queued";
  const quiet = !turn.response && !live && turn.status === "done" && !versions.length && !images.length;
  return (
    <div className="space-y-3">
      <Trigger turn={turn} author={author} />
      {!quiet && (
        <div className="flex gap-3">
          <DirectorAvatar size={28} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 text-xs text-muted">
              <span className="font-medium text-ink-2">Director</span>
              {clockTime(turn.finishedAt ?? turn.startedAt ?? turn._creationTime)}
            </div>
            <Steps turn={turn} />
            {turn.response ? (
              <div className="chat-md mt-1 break-words" dangerouslySetInnerHTML={{ __html: renderChatMarkdown(turn.response) }} />
            ) : turn.status === "queued" ? (
              <p className="mt-1 text-sm text-muted">Waiting its turn…</p>
            ) : null}
            {turn.status === "running" && (
              <div className="mt-1.5 flex items-center gap-1">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="typing-dot size-1.5 rounded-full bg-accent" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            )}
            {turn.status === "error" && <p className="mt-1 text-sm text-danger">{turn.error ?? "Something went wrong."}</p>}
            {turn.status === "cancelled" && <p className="mt-1 text-xs text-muted">Stopped.</p>}
            {(versions.length > 0 || images.length > 0) && (
              <div className="mt-2.5 space-y-2.5">
                {versions.map((x) => (
                  <InlineCut key={x._id} version={x} storyId={storyId} compact />
                ))}
                {images.length > 0 && <ImageGrid images={images} storyId={storyId} small />}
              </div>
            )}
            {live && (
              <button
                onClick={onStop}
                className="mt-1 -ml-1.5 flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs text-muted hover:bg-surface-2 hover:text-ink"
              >
                <CircleStop size={13} /> Stop
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** The director's steps, folded into one line. While it works, the latest step shows. */
function Steps({ turn }: { turn: Turn }) {
  const [open, setOpen] = useState(false);
  const n = turn.activity.length;
  if (!n) return null;
  const running = turn.status === "running";
  return (
    <div className="mt-0.5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex max-w-full items-center gap-1 text-xs text-muted hover:text-ink"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="truncate">
          {running && !open ? turn.activity[n - 1] : `Worked through ${n} step${n === 1 ? "" : "s"}`}
        </span>
      </button>
      {open && (
        <ul className="mt-1 mb-1 space-y-1 border-l border-line pl-3">
          {turn.activity.map((a, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-muted">
              <Check size={12} className="mt-0.5 shrink-0 text-emerald-600" />
              <span className="min-w-0 break-words">{a}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What started the turn: someone's message, an approval, notes, a finished job. */
function Trigger({ turn, author }: { turn: Turn; author?: Doc<"users"> }) {
  const [open, setOpen] = useState(false);
  if (turn.kind === "message" || (turn.kind === "feedback" && turn.display.startsWith("Not good"))) {
    const notGood = turn.kind === "feedback";
    return (
      <div className="flex gap-3">
        {author ? <Avatar name={author.name} color={author.color} size={28} /> : <span className="size-7" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 text-xs text-muted">
            <span className="font-medium text-ink-2">{author?.name ?? "Someone"}</span>
            {clockTime(turn._creationTime)}
          </div>
          {notGood ? (
            <p className="mt-1 inline-flex max-w-full items-start gap-1.5 rounded-xl bg-danger/8 px-3 py-2 text-sm whitespace-pre-wrap text-ink">
              <ThumbsDown size={14} className="mt-0.5 shrink-0 text-danger" />
              <span className="min-w-0">{turn.display.replace(/^Not good:?\s*/, "") || "Not good"}</span>
            </p>
          ) : (
            <p className="mt-0.5 text-sm whitespace-pre-wrap">{turn.display}</p>
          )}
        </div>
      </div>
    );
  }
  if (turn.kind === "stage") {
    const approved = /approved|into production/.test(turn.display);
    return (
      <div className="flex justify-center">
        <span
          className={cn(
            "inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
            approved ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/14 text-amber-700 dark:text-amber-300",
          )}
        >
          {approved ? <Check size={13} /> : <RotateCcw size={13} />}
          <span className="truncate">
            {author ? `${author.name}: ` : ""}
            {turn.display}
          </span>
          <span className="shrink-0 opacity-70">· {clockTime(turn._creationTime)}</span>
        </span>
      </div>
    );
  }
  const Icon = turn.kind === "wake" ? Hourglass : turn.kind === "compact" ? Minimize2 : MessageSquarePlus;
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex max-w-full items-center gap-1.5 text-xs text-muted hover:text-ink"
        aria-expanded={open}
      >
        <Icon size={13} className="shrink-0" />
        <span className="truncate">
          {turn.kind === "feedback" && author ? `${author.name} sent ` : ""}
          {turn.display}
        </span>
        <span className="shrink-0">· {clockTime(turn._creationTime)}</span>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {open && (
        <p className="mt-1.5 rounded-xl bg-surface-2 px-3 py-2 text-xs whitespace-pre-wrap text-ink-2">{turn.prompt}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A request: what the director wants looked at, with it right there
// ---------------------------------------------------------------------------

function RequestCard({
  request,
  storyId,
  versions,
  images,
  decidedBy,
}: {
  request: Request;
  storyId: Id<"stories">;
  versions: Version[];
  images: Image[];
  decidedBy?: Doc<"users">;
}) {
  const open = request.status === "open";
  const [expanded, setExpanded] = useState(request.status !== "superseded");
  const question = request.kind === "question";
  const label = stageInfo(request.stage).label;
  const hasWork = versions.length > 0 || images.length > 0;

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex max-w-full sm:ml-10 sm:max-w-[calc(100%-2.5rem)] items-center gap-1.5 rounded-lg border border-dashed border-line px-3 py-1.5 text-left text-xs text-muted hover:text-ink"
      >
        <ChevronRight size={13} className="shrink-0" />
        <span className="truncate">
          Earlier round{hasWork ? ` (${[versions.length && "a cut", images.length && `${images.length} image${images.length === 1 ? "" : "s"}`].filter(Boolean).join(", ")})` : ""}: {request.message}
        </span>
      </button>
    );
  }

  return (
    <section
      id={`request-${request._id}`}
      data-open-request={open ? "" : undefined}
      className={cn(
        "scroll-mt-4 rounded-2xl border bg-surface p-3 sm:ml-10 sm:p-4",
        open
          ? question
            ? "border-amber-500/50 shadow-[0_0_0_4px_rgb(245_158_11/0.10)]"
            : "border-accent/50 shadow-[0_0_0_4px_color-mix(in_oklab,var(--accent)_12%,transparent)]"
          : "border-line",
      )}
    >
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
            question ? "bg-amber-500/14 text-amber-700 dark:text-amber-300" : "bg-accent/12 text-accent",
          )}
        >
          {question ? "Question" : `${label} · for review`}
        </span>
        <p className="min-w-0 flex-1 text-sm font-medium">{request.message}</p>
        {request.status === "superseded" && (
          <button onClick={() => setExpanded(false)} className="shrink-0 text-muted hover:text-ink" aria-label="Fold">
            <ChevronDown size={16} />
          </button>
        )}
      </div>
      {hasWork && (
        <div className="mt-3 space-y-3">
          {versions.map((x) => (
            <InlineCut key={x._id} version={x} storyId={storyId} />
          ))}
          {images.length > 0 && <ImageGrid images={images} storyId={storyId} />}
        </div>
      )}
      <div className="mt-3 text-xs">
        {open ? (
          <span className={cn("font-semibold", question ? "text-amber-700 dark:text-amber-300" : "text-accent")}>
            {question ? "Waiting for your answer: write it below." : "Waiting on you: approve it below, or say what's not good."}
            {!question && images.length > 0 && " Click an image to look closer or point at it."}
          </span>
        ) : request.status === "approved" ? (
          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
            <Check size={13} /> Approved{decidedBy ? ` by ${decidedBy.name}` : ""}
            {request.decidedAt ? ` · ${clockTime(request.decidedAt)}` : ""}
          </span>
        ) : request.status === "changes" ? (
          <span className="inline-flex items-center gap-1 text-danger">
            <ThumbsDown size={13} /> Sent back{decidedBy ? ` by ${decidedBy.name}` : ""}
          </span>
        ) : request.status === "answered" ? (
          <span className="text-muted">Answered{decidedBy ? ` by ${decidedBy.name}` : ""}</span>
        ) : (
          <span className="text-muted">A newer round replaced this one.</span>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Cuts and images in the thread
// ---------------------------------------------------------------------------

function InlineCut({ version, storyId, compact }: { version: Version; storyId: Id<"stories">; compact?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  // The moment a note is being written about, while its box is open.
  const [noteAt, setNoteAt] = useState<number | null>(null);
  // Paused partway: the moment to write a note, so the button lights up.
  const [paused, setPaused] = useState(true);
  const [more, setMore] = useState(false);
  const [playing, setPlaying] = useState(!compact);
  const tall = version.height > version.width;
  const summary = version.summary ?? "";

  if (!playing) {
    return (
      <button
        onClick={() => setPlaying(true)}
        className="group flex w-full max-w-md items-center gap-3 rounded-xl border border-line bg-bg p-2 text-left hover:border-line-strong"
      >
        <span className="relative h-14 w-24 shrink-0 overflow-hidden rounded-lg bg-black">
          <img src={`/media/thumbs/${version.fileId}.jpg`} alt="" className="size-full object-cover" />
          <span className="absolute inset-0 grid place-items-center bg-black/25 text-white">
            <Play size={18} />
          </span>
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium">
            Cut v{version.number} · {timecode(version.duration)}
          </span>
          <span className="line-clamp-2 text-xs text-muted">{summary}</span>
        </span>
      </button>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-bg">
      <div className="bg-black">
        <video
          ref={video}
          src={`/media/files/${version.fileId}.mp4`}
          poster={`/media/thumbs/${version.fileId}.jpg`}
          controls
          playsInline
          preload="metadata"
          autoPlay={compact}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          className={cn("mx-auto block max-h-[62vh] w-full", tall && "w-auto")}
        />
      </div>
      <div className="p-2.5">
        {noteAt !== null ? (
          <NoteBox
            title={`Note at ${timecode(noteAt)} · cut v${version.number}`}
            cut={{ versionId: version._id, time: noteAt }}
            onDone={() => setNoteAt(null)}
          />
        ) : (
          <button
            onClick={() => {
              video.current?.pause();
              setNoteAt(time);
            }}
            className={cn(
              "flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-semibold transition active:scale-[0.99]",
              paused && time > 0
                ? "note-ready bg-accent text-white"
                : "border-2 border-accent/50 bg-accent/10 text-accent hover:bg-accent/15",
            )}
            title="Pause and write a note about this moment"
          >
            <MessageSquarePlus size={19} /> Add a note at {timecode(time)}
          </button>
        )}
        <div className="mt-2 flex items-center gap-3 px-1">
          <span className="text-sm font-medium">
            Cut v{version.number}
            <span className="font-normal text-muted"> · {timecode(version.duration)}</span>
          </span>
          <Link
            href={`/s/${storyId}/review?v=${version.number}`}
            className="ml-auto flex shrink-0 items-center gap-1 text-xs text-muted hover:text-ink"
            title="Frame by frame, drawing on the frame, every comment"
          >
            Open in Review <ExternalLink size={12} />
          </Link>
        </div>
      </div>
      {summary && (
        <div className="border-t border-line px-3 py-2 text-xs text-ink-2">
          <p className={cn("whitespace-pre-wrap", !more && "line-clamp-2")}>{summary}</p>
          {(summary.length > 180 || summary.includes("\n")) && (
            <button onClick={() => setMore((m) => !m)} className="mt-0.5 font-medium text-accent hover:underline">
              {more ? "Less" : "More"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const IMAGES_SHOWN = 24;

function ImageGrid({ images, storyId, small }: { images: Image[]; storyId: Id<"stories">; small?: boolean }) {
  // Images picked for one note about all of them.
  const [picked, setPicked] = useState<Id<"images">[]>([]);
  const toggle = (id: Id<"images">) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const [all, setAll] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const shown = all ? images : images.slice(0, small ? 12 : IMAGES_SHOWN);
  return (
    <div>
      <div
        className={cn(
          "grid gap-2",
          small ? "grid-cols-[repeat(auto-fill,minmax(88px,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(140px,1fr))]",
        )}
      >
        {shown.map((img, i) => {
          const on = picked.includes(img._id);
          return (
            <div key={img._id} className="group relative">
              <button
                onClick={() => setViewing(i)}
                title={img.caption}
                className={cn(
                  "block w-full overflow-hidden rounded-lg bg-surface-2 ring-offset-2 ring-offset-surface transition",
                  on ? "ring-2 ring-amber-500" : "hover:opacity-90",
                )}
              >
                <img
                  src={`/media/images/${img.thumb}`}
                  alt={img.caption ?? ""}
                  loading="lazy"
                  className="aspect-video w-full object-cover"
                />
              </button>
              <button
                onClick={() => toggle(img._id)}
                className={cn(
                  "absolute top-1.5 left-1.5 grid size-6 place-items-center rounded-full border text-white shadow transition",
                  on
                    ? "border-amber-500 bg-amber-500"
                    : "border-white/80 bg-black/30 opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                )}
                title={on ? "Leave this out of the note" : "Pick for a note about several images"}
                aria-pressed={on}
              >
                {on && <Check size={13} />}
              </button>
              {img.comments > 0 && (
                <span className="absolute right-1.5 bottom-1.5 rounded-full bg-black/60 px-1.5 text-[10px] font-medium text-white">
                  {img.comments}
                </span>
              )}
              {!small && img.caption && <p className="mt-1 line-clamp-1 text-[11px] text-muted">{img.caption}</p>}
            </div>
          );
        })}
      </div>
      {!all && images.length > shown.length && (
        <button onClick={() => setAll(true)} className="mt-2 text-xs font-medium text-accent hover:underline">
          Show all {images.length} images
        </button>
      )}
      {picked.length > 0 && (
        <div className="mt-2.5">
          <NoteBox
            title={`Note about ${picked.length === 1 ? "this image" : `these ${picked.length} images`}`}
            imageIds={picked}
            onDone={() => setPicked([])}
          />
        </div>
      )}
      {viewing !== null && (
        <Lightbox
          images={images}
          index={viewing}
          storyId={storyId}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

function Lightbox({
  images,
  index,
  storyId,
  onIndex,
  onClose,
}: {
  images: Image[];
  index: number;
  storyId: Id<"stories">;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const img = images[index]!;
  const [noting, setNoting] = useState<Id<"images"> | null>(null);
  const go = (d: number) => onIndex((index + d + images.length) % images.length);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (noting) return; // the note box has the keys
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return createPortal(
    <div className="fade-in fixed inset-0 z-[100] flex flex-col bg-black/92 text-white">
      <div className="flex h-14 shrink-0 items-center gap-3 px-4">
        <span className="text-sm text-white/70 tabular-nums">
          {index + 1} / {images.length}
        </span>
        <p className="min-w-0 flex-1 truncate text-sm">{img.caption}</p>
        <button onClick={onClose} className="grid size-9 place-items-center rounded-lg hover:bg-white/10" aria-label="Close">
          <X size={20} />
        </button>
      </div>
      <div className="relative min-h-0 flex-1" onClick={onClose}>
        <img
          src={`/media/images/${img.file}`}
          alt={img.caption ?? ""}
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-0 m-auto max-h-full max-w-full object-contain"
        />
        {images.length > 1 && (
          <>
            <button
              onClick={(e) => (e.stopPropagation(), go(-1))}
              className="absolute top-1/2 left-3 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 hover:bg-white/20"
              aria-label="Previous"
            >
              <ChevronLeft size={22} />
            </button>
            <button
              onClick={(e) => (e.stopPropagation(), go(1))}
              className="absolute top-1/2 right-3 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 hover:bg-white/20"
              aria-label="Next"
            >
              <ChevronRight size={22} />
            </button>
          </>
        )}
      </div>
      {noting === img._id ? (
        <div className="mx-auto w-full max-w-xl shrink-0 p-4">
          <NoteBox title="Note about this image" imageIds={[img._id]} onDone={() => setNoting(null)} dark />
        </div>
      ) : (
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 p-4">
          <button
            onClick={() => setNoting(img._id)}
            className="flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-black hover:bg-white/90"
          >
            <MessageSquarePlus size={16} /> Leave a note on this
          </button>
          <Link
            href={`/s/${storyId}/images/${img._id}`}
            className="flex h-10 items-center gap-2 rounded-xl px-4 text-sm text-white/80 hover:bg-white/10"
          >
            Pin a comment on a spot <ExternalLink size={14} />
          </Link>
        </div>
      )}
    </div>,
    document.body,
  );
}
