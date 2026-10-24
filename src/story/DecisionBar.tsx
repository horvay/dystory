// The bottom of a story's page: what's waiting on people and the big buttons
// for it (Approve, Not good, Start production), notes still waiting to go to
// the director, and the one box for writing to it.
import { useMutation, useQuery } from "convex/react";
import { ArrowUp, Check, CircleStop, Clapperboard, Hourglass, LoaderCircle, Play, Send, ThumbsDown, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { api } from "../../convex/_generated/api";
import { MicButton } from "../components/MicButton";
import { useToast } from "../components/Toast";
import { DictationStatus } from "../panels/AiPanel";
import { cn, useNow } from "../lib/hooks";
import { useMe } from "../lib/identity";
import { relativeTime, timecode } from "../lib/time";
import { useDictation } from "../lib/useDictation";
import { stageInfo, type StageId } from "../../shared/stages";
import { StageMoveDialog } from "./stageUi";
import { scrollToOpenRequest } from "./Thread";
import type { StoryData } from "./StoryPage";

/** What the big button says for each stage. */
const APPROVE: Partial<Record<StageId, string>> = {
  casting: "Approve the cast",
  voiceover: "Approve the voices",
  stills: "Approve the stills",
  animatic: "Approve the animatic",
  animation: "Approve the animation",
  sfx: "Approve the sound",
  final: "Approve the final cut",
  packaging: "Approve the packaging",
  upload: "Approve the upload",
  short: "Approve the Short",
};
export const approveLabel = (stage: StageId) => APPROVE[stage] ?? `Approve ${stageInfo(stage).label}`;

export function DecisionBar({ story, composer }: { story: StoryData; composer: boolean }) {
  const [approving, setApproving] = useState(false);
  const [notGood, setNotGood] = useState(false);
  const pending = useQuery(api.feedback.pending, { storyId: story._id });
  const [, navigate] = useLocation();
  const stage = stageInfo(story.stage);
  // From a breakout (script, images…) it goes to the thread first.
  const showRequest = () => {
    if (scrollToOpenRequest()) return true;
    navigate(`/s/${story._id}/thread`);
    setTimeout(scrollToOpenRequest, 400);
    return true;
  };
  const review = story.state === "review";
  const question = story.state === "waiting" && story.openRequest?.kind === "question";

  let bar: ReactNode;
  if (story.stage === "script") {
    bar = (
      <Bar
        glow="accent"
        icon={<Clapperboard size={18} />}
        title="Script"
        text="When the script is ready, put it into production. The director takes it from there and shows you each stage here."
      >
        <BigButton onClick={() => setApproving(true)}>
          <Play size={16} /> Start production
        </BigButton>
      </Bar>
    );
  } else if (story.state === "done") {
    bar = <Bar icon={<Check size={18} />} title="Published" text="The story is done." />;
  } else if (review) {
    bar = (
      <Bar
        glow="accent"
        icon={<Check size={18} />}
        title={`${stage.label} is ready for your OK`}
        text={story.statusLine}
        onShow={story.openRequest ? showRequest : undefined}
      >
        <button
          onClick={() => setNotGood(true)}
          className={cn(
            "flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition",
            notGood ? "border-danger/40 bg-danger/10 text-danger" : "border-line-strong text-ink hover:bg-surface-2",
          )}
        >
          <ThumbsDown size={16} /> Not good…
        </button>
        <BigButton onClick={() => setApproving(true)}>
          <Check size={17} /> {approveLabel(story.stage)}
        </BigButton>
      </Bar>
    );
  } else if (story.state === "waiting") {
    bar = (
      <Bar
        glow="amber"
        icon={<Hourglass size={18} />}
        title={question ? "The director has a question" : "The director stopped and needs you"}
        text={story.statusLine ?? "Write to it below."}
        onShow={question ? showRequest : undefined}
      >
        <button
          onClick={() => setApproving(true)}
          className="h-9 rounded-xl px-3 text-xs font-medium text-ink-2 hover:bg-surface-2"
          title="Skip the question and move on"
        >
          {approveLabel(story.stage)} anyway
        </button>
      </Bar>
    );
  } else {
    bar = <Working story={story} />;
  }

  return (
    <div className="shrink-0 border-t border-line bg-bg/95 backdrop-blur">
      <div className="mx-auto max-w-3xl space-y-2 px-3 pt-2.5 pb-3 sm:px-6">
        <PendingNotes storyId={story._id} pending={pending} />
        {bar}
        {composer && story.stage !== "done" && (
          <Composer story={story} notGood={notGood && review} onNotGoodDone={() => setNotGood(false)} />
        )}
        {!composer && notGood && review && (
          <Composer story={story} notGood onNotGoodDone={() => setNotGood(false)} />
        )}
      </div>
      {approving && <StageMoveDialog story={story} pending={pending?.count ?? 0} onClose={() => setApproving(false)} />}
    </div>
  );
}

function Bar({
  glow,
  icon,
  title,
  text,
  onShow,
  children,
}: {
  glow?: "accent" | "amber";
  icon: ReactNode;
  title: string;
  text?: string;
  onShow?: () => boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-2xl border px-4 py-3",
        glow === "accent" && "decision-glow border-accent/60 bg-accent/6",
        glow === "amber" && "decision-glow-amber border-amber-500/60 bg-amber-500/8",
        !glow && "border-line bg-surface",
      )}
    >
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-xl",
          glow === "accent" ? "bg-accent text-white" : glow === "amber" ? "bg-amber-500 text-white" : "bg-surface-2 text-ink-2",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1 basis-56">
        <p className="font-semibold">{title}</p>
        {text && (
          <p className="line-clamp-2 text-sm text-ink-2" title={text}>
            {text}
            {onShow && (
              <>
                {" "}
                <button onClick={onShow} className="font-medium text-accent hover:underline">
                  Show me
                </button>
              </>
            )}
          </p>
        )}
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

function BigButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex h-11 items-center gap-2 rounded-xl bg-accent px-5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 active:scale-[0.98]"
    >
      {children}
    </button>
  );
}

/** While the director works: what it's on and the jobs it's waiting for. */
function Working({ story }: { story: StoryData }) {
  const me = useMe();
  const now = useNow(5_000);
  const stopJob = useMutation(api.director.cancelWakeup);
  const worker = useQuery(api.ai.workerStatus, { name: "director" });
  const online = !worker || now - worker.lastSeen < 35_000;
  const line =
    story.statusLine ||
    (story.busy ? "The director is working." : story.jobs.length ? "Waiting on a background job." : "Queued.");
  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-2.5">
      <div className="flex items-center gap-2.5 text-sm">
        <LoaderCircle size={16} className={cn("shrink-0 text-accent", online && "animate-spin")} />
        <span className="min-w-0 flex-1 truncate text-ink-2" title={line}>
          <span className="font-medium text-ink">Director is working on {stageInfo(story.stage).label}</span> · {line}
        </span>
      </div>
      {!online && (
        <p className="mt-1 text-xs text-danger">
          The director isn't running. Start Dynastory with `bun run start` (or its systemd service).
        </p>
      )}
      {story.jobs.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {story.jobs.map((j) => (
            <li key={j._id} className="flex items-center gap-2 text-xs">
              <Hourglass size={12} className={cn("shrink-0", j.unit ? "animate-pulse text-accent" : "text-muted")} />
              <span className="min-w-0 flex-1 truncate text-ink-2" title={j.note}>
                {j.note}
                {j.queue && <span className="text-muted"> · {j.queue}</span>}
                {j.at && <span className="text-muted"> · {relativeTime(j.at, now).replace(" ago", "")}</span>}
              </span>
              <button
                onClick={() => stopJob({ wakeupId: j._id, userId: me._id })}
                className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-muted hover:bg-surface-2 hover:text-danger"
                title={j.unit ? "Stop this job" : "Cancel this timer"}
              >
                <CircleStop size={12} /> Stop
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-xs text-muted">You'll get a notification when it needs you.</p>
    </div>
  );
}

function PendingNotes({
  storyId,
  pending,
}: {
  storyId: StoryData["_id"];
  pending: { count: number; dueAt: number | null } | undefined;
}) {
  const sendNow = useMutation(api.feedback.sendNow);
  const now = useNow(1_000);
  if (!pending?.count) return null;
  const due = pending.dueAt ? Math.max(0, pending.dueAt - now) : null;
  return (
    <div className="flex items-center gap-2 px-1 text-xs text-muted">
      <span className="size-1.5 shrink-0 rounded-full bg-accent" />
      <span className="min-w-0 flex-1">
        {pending.count === 1 ? "1 note is waiting" : `${pending.count} notes are waiting`} to go to the director
        {due !== null && `, in ${timecode(due / 1000)}`}
      </span>
      <button
        onClick={() => sendNow({ storyId })}
        className="flex h-7 shrink-0 items-center gap-1 rounded-lg border border-line px-2 font-medium text-ink hover:bg-surface-2"
      >
        <Send size={12} /> Send now
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The box for writing to the director, or for why it's not good. Notes on a
// cut moment or images are written where they're clicked (NoteBox), not here.
// ---------------------------------------------------------------------------

function Composer({
  story,
  notGood,
  onNotGoodDone,
}: {
  story: StoryData;
  notGood: boolean;
  onNotGoodDone: () => void;
}) {
  const me = useMe();
  const toast = useToast();
  const send = useMutation(api.turns.send);
  const sendBack = useMutation(api.feedback.sendBack);
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
    if (notGood) input.current?.focus();
  }, [notGood]);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    el.style.overflowY = el.scrollHeight > 200 ? "auto" : "hidden";
  }, [text]);

  const canSend = !!text.trim();

  const submit = async () => {
    if (!canSend || busy) return;
    const body = text.trim();
    setBusy(true);
    try {
      if (notGood) {
        await sendBack({ storyId: story._id, userId: me._id, text: body });
        onNotGoodDone();
        toast({ message: "Sent back to the director with your notes." });
      } else {
        await send({ storyId: story._id, userId: me._id, text: body });
      }
      setText("");
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't send that." });
    } finally {
      setBusy(false);
    }
  };

  const placeholder = notGood
    ? `What's wrong with the ${stageInfo(story.stage).label.toLowerCase()}?`
    : story.state === "waiting"
        ? "Answer the director…"
        : "Write to the director…";

  return (
    <div
      className={cn(
        "rounded-2xl border bg-surface transition",
        notGood ? "border-danger/50 ring-4 ring-danger/10" : "border-line focus-within:border-line-strong",
      )}
    >
      {notGood && (
        <div className="flex items-center gap-2 border-b border-line px-3.5 py-2 text-sm font-semibold text-danger">
          <ThumbsDown size={15} /> Not good: tell the director what to change
          <span className="hidden font-normal text-muted sm:inline">· notes you left on the cut or images go with it</span>
          <button onClick={onNotGoodDone} className="ml-auto grid size-7 place-items-center rounded-lg text-muted hover:bg-surface-2" aria-label="Cancel">
            <X size={16} />
          </button>
        </div>
      )}
      <DictationStatus dictation={dictation} />
      <div className="flex items-end gap-2 p-2">
        <textarea
          ref={input}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            } else if (e.key === " " && e.shiftKey && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              dictation.toggle();
            } else if (e.key === "Escape" && notGood) {
              onNotGoodDone();
            }
          }}
          placeholder={placeholder}
          aria-label={notGood ? "What's not good" : "Message the director"}
          className="max-h-[200px] min-h-10 flex-1 resize-none overflow-hidden bg-transparent px-1.5 py-2 text-sm outline-none placeholder:text-muted"
        />
        <MicButton dictation={dictation} className="size-10 rounded-xl" iconSize={18} />
        {notGood ? (
          <button
            onClick={submit}
            disabled={!canSend || busy}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-danger px-3.5 text-sm font-semibold text-white transition disabled:opacity-35"
          >
            <Send size={15} /> Send back
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={!canSend || busy}
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-ink text-bg transition disabled:opacity-25"
            aria-label="Send"
          >
            <ArrowUp size={18} />
          </button>
        )}
      </div>
      {!notGood && story.busy && (
        <p className="px-3.5 pb-2 text-[11px] text-muted">The director reads your message when it finishes what it's doing.</p>
      )}
    </div>
  );
}
