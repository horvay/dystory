import { useMutation, useQuery } from "convex/react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  CircleStop,
  Clapperboard,
  Clock,
  Hourglass,
  MessageSquarePlus,
  MessagesSquare,
  Minimize2,
  Play,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { Avatar, DirectorAvatar } from "../components/Avatar";
import { MicButton } from "../components/MicButton";
import { DictationStatus } from "../panels/AiPanel";
import { renderChatMarkdown } from "../lib/chatMarkdown";
import { cn, useNow } from "../lib/hooks";
import { useMe } from "../lib/identity";
import { clockTime, relativeTime } from "../lib/time";
import { useDictation } from "../lib/useDictation";
import type { StoryData } from "./StoryPage";

type Turn = Doc<"turns">;

const EVENT_ICON: Record<Turn["kind"], typeof Play> = {
  message: MessagesSquare,
  stage: Play,
  feedback: MessagesSquare,
  wake: Hourglass,
  compact: Minimize2,
};

/** How many of a turn's steps show before "N more". */
const STEPS_SHOWN = 6;

export function DirectorPanel({
  story,
  focusSignal,
  onClose,
}: {
  story: StoryData;
  focusSignal: number;
  onClose: () => void;
}) {
  const me = useMe();
  const now = useNow(5_000);
  const turns = useQuery(api.turns.list, { storyId: story._id });
  const users = useQuery(api.users.list);
  const worker = useQuery(api.ai.workerStatus, { name: "director" });
  const send = useMutation(api.turns.send);
  const cancel = useMutation(api.turns.cancel);
  const newSession = useMutation(api.turns.newSession);
  const stopJob = useMutation(api.director.cancelWakeup);
  const [text, setText] = useState("");
  const [confirmNew, setConfirmNew] = useState(false);
  const [showEarlier, setShowEarlier] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const userById = useMemo(() => new Map(users?.map((u) => [u._id, u]) ?? []), [users]);
  const online = !!worker && now - worker.lastSeen < 35_000;
  const dictation = useDictation({
    onText: (t) => {
      setText((p) => (p.trim() ? `${p.trimEnd()} ${t}` : t));
      inputRef.current?.focus();
    },
  });

  const started = story.conversationStartedAt ?? 0;
  const visible = (turns ?? []).filter((t) => showEarlier || t._creationTime >= started);
  const hidden = (turns?.length ?? 0) - visible.length;
  const last = visible.at(-1);

  useEffect(() => {
    if (focusSignal) inputRef.current?.focus();
  }, [focusSignal]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [visible.length, last?.response, last?.activity.length]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    el.style.overflowY = el.scrollHeight > 200 ? "auto" : "hidden";
  }, [text]);

  const submit = async () => {
    const body = text.trim();
    if (!body) return;
    setText("");
    await send({ storyId: story._id, userId: me._id, text: body });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
        <Clapperboard size={17} className="text-accent" />
        <span className="font-semibold">Director</span>
        <span
          className={cn("ml-1 size-1.5 rounded-full", online ? "bg-emerald-500" : "bg-line-strong")}
          title={online ? "Ready" : "Offline"}
        />
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setConfirmNew(true)}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-ink-2 hover:bg-surface-2"
            title="Start the director on a fresh session (it forgets this conversation)"
          >
            <MessageSquarePlus size={15} /> New session
          </button>
          <button
            onClick={onClose}
            className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
            aria-label="Close"
          >
            <X size={17} />
          </button>
        </div>
      </div>

      {confirmNew && (
        <div className="border-b border-line bg-surface-2 px-4 py-3 text-sm">
          <p className="text-ink-2">
            Start a fresh session? The director forgets this conversation and catches up from the story's folder and
            README.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={async () => {
                setConfirmNew(false);
                setShowEarlier(false);
                await newSession({ storyId: story._id });
              }}
              className="h-8 rounded-lg bg-ink px-3 text-xs font-medium text-bg"
            >
              New session
            </button>
            <button onClick={() => setConfirmNew(false)} className="h-8 rounded-lg px-3 text-xs hover:bg-surface">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div ref={scrollRef} className="scroll-thin flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {hidden > 0 && (
          <button
            onClick={() => setShowEarlier(true)}
            className="mx-auto block rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-ink"
          >
            Show {hidden} earlier turn{hidden === 1 ? "" : "s"}
          </button>
        )}
        {turns !== undefined && visible.length === 0 && (
          <div className="pt-6 text-center">
            <div className="mx-auto mb-3 grid size-11 place-items-center rounded-2xl bg-accent/12 text-accent">
              <Clapperboard size={20} />
            </div>
            <p className="font-medium">The director makes the video</p>
            <p className="mx-auto mt-1 max-w-72 text-sm text-muted">
              {story.stage === "script"
                ? "Once the script is ready, start production. The director voices it, makes the stills, animates them and posts every cut for review. You can also talk to it here."
                : "It works through the stages and posts each cut for review. Write to it here any time."}
            </p>
            {!online && worker !== undefined && <Offline />}
          </div>
        )}
        {visible.map((t) => (
          <TurnView
            key={t._id}
            turn={t}
            author={t.requestedBy ? userById.get(t.requestedBy) : undefined}
            online={online}
            onStop={() => cancel({ turnId: t._id })}
          />
        ))}
      </div>

      {story.jobs.length > 0 && (
        <div className="shrink-0 space-y-1 border-t border-line px-3 py-2">
          {story.jobs.map((j) => (
            <div key={j._id} className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-xs">
              {j.unit ? (
                <Hourglass size={13} className="shrink-0 animate-pulse text-accent" />
              ) : (
                <Clock size={13} className="shrink-0 text-muted" />
              )}
              <span className="min-w-0 flex-1 truncate text-ink-2" title={[j.unit, j.queue].filter(Boolean).join(" · ") || undefined}>
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
            </div>
          ))}
        </div>
      )}

      <div className="shrink-0 border-t border-line p-3">
        <div className="rounded-2xl border border-line bg-bg focus-within:border-line-strong">
          <DictationStatus dictation={dictation} />
          <div className="flex items-end gap-2 p-2">
            <textarea
              ref={inputRef}
              rows={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                } else if (e.key === " " && e.shiftKey && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  dictation.toggle();
                }
              }}
              placeholder={story.state === "waiting" ? "Answer the director…" : "Write to the director…"}
              aria-label="Message the director"
              className="max-h-[200px] min-h-9 flex-1 resize-none overflow-hidden bg-transparent px-1.5 py-1.5 text-sm outline-none placeholder:text-muted"
            />
            <MicButton dictation={dictation} className="size-9 rounded-xl" iconSize={17} />
            <button
              onClick={submit}
              disabled={!text.trim()}
              className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-white transition disabled:opacity-30"
              aria-label="Send"
            >
              <ArrowUp size={18} />
            </button>
          </div>
        </div>
        {story.busy && (
          <p className="mt-1.5 px-1 text-xs text-muted">The director reads your message when its current turn ends.</p>
        )}
      </div>
    </div>
  );
}

function TurnView({
  turn,
  author,
  online,
  onStop,
}: {
  turn: Turn;
  author?: Doc<"users">;
  online: boolean;
  onStop: () => void;
}) {
  const [openPrompt, setOpenPrompt] = useState(false);
  const [allSteps, setAllSteps] = useState(false);
  const Icon = EVENT_ICON[turn.kind];
  const steps = allSteps ? turn.activity : turn.activity.slice(-STEPS_SHOWN);
  const more = turn.activity.length - steps.length;
  const live = turn.status === "running" || turn.status === "queued";

  return (
    <div className="space-y-2.5">
      {turn.kind === "message" ? (
        <div className="flex gap-2.5">
          {author && <Avatar name={author.name} color={author.color} size={26} />}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 text-xs text-muted">
              <span className="font-medium text-ink-2">{author?.name ?? "Someone"}</span>
              {clockTime(turn._creationTime)}
            </div>
            <p className="mt-0.5 text-sm whitespace-pre-wrap">{turn.display}</p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-line bg-bg px-3 py-2">
          <button
            onClick={() => setOpenPrompt((o) => !o)}
            className="flex w-full items-center gap-2 text-left text-xs"
            aria-expanded={openPrompt}
          >
            <Icon size={13} className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1 font-medium text-ink-2">{turn.display}</span>
            <span className="shrink-0 text-muted">{clockTime(turn._creationTime)}</span>
            {openPrompt ? <ChevronDown size={13} className="text-muted" /> : <ChevronRight size={13} className="text-muted" />}
          </button>
          {openPrompt && <p className="mt-2 text-xs whitespace-pre-wrap text-ink-2">{turn.prompt}</p>}
        </div>
      )}

      <div className="flex gap-2.5">
        <DirectorAvatar size={26} />
        <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md bg-bg px-3.5 py-2.5">
          {more > 0 && (
            <button onClick={() => setAllSteps(true)} className="mb-1 text-xs text-muted hover:text-ink">
              {more} earlier step{more === 1 ? "" : "s"}
            </button>
          )}
          {steps.length > 0 && (
            <ul className="mb-2 space-y-1">
              {steps.map((a, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-muted">
                  <Check size={13} className="mt-px shrink-0 text-emerald-600" />
                  <span className="min-w-0 break-words">{a}</span>
                </li>
              ))}
            </ul>
          )}
          {turn.response ? (
            <div className="chat-md break-words" dangerouslySetInnerHTML={{ __html: renderChatMarkdown(turn.response) }} />
          ) : turn.status === "queued" ? (
            <div className="text-sm text-muted">{online ? "Waiting its turn…" : <Offline inline />}</div>
          ) : null}
          {turn.status === "running" && (
            <div className="mt-1 flex items-center gap-1 py-1">
              {[0, 1, 2].map((i) => (
                <span key={i} className="typing-dot size-1.5 rounded-full bg-accent" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          )}
          {turn.status === "error" && <p className="mt-1 text-sm text-danger">{turn.error ?? "Something went wrong."}</p>}
          {turn.status === "cancelled" && <p className="mt-1 text-xs text-muted">Stopped.</p>}
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
    </div>
  );
}

function Offline({ inline }: { inline?: boolean }) {
  const text = "The director isn't running. Start Dystory with `bun run start` (or its systemd service).";
  return inline ? (
    <span>{text}</span>
  ) : (
    <p className="mx-auto mt-4 max-w-72 rounded-xl bg-surface-2 px-3 py-2 text-xs text-ink-2">{text}</p>
  );
}

