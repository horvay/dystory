import type { Editor } from "@tiptap/core";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  CircleStop,
  LoaderCircle,
  MessageSquarePlus,
  Quote,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { COMEDY_STYLES, type ComedyStyle } from "../../shared/comedy";
import { Avatar, ClaudeAvatar } from "../components/Avatar";
import { MicButton } from "../components/MicButton";
import { Popover } from "../components/Popover";
import { renderChatMarkdown } from "../lib/chatMarkdown";
import { useMe } from "../lib/identity";
import { cn, useNow } from "../lib/hooks";
import { selectionMarkdown } from "../lib/markdown";
import { selectionPreview } from "../lib/plain";
import { setPendingSelection } from "../editor/highlights";
import { clockTime, formatSeconds } from "../lib/time";
import { useDictation, type Dictation } from "../lib/useDictation";

const SUGGESTIONS = [
  "Continue writing",
  "Fix spelling and grammar",
  "Suggest better titles",
  "What's working and what isn't?",
];

const SELECTION_SUGGESTIONS = ["Rewrite this", "Make it shorter", "Make it punchier", "Expand on this"];

type Effort = NonNullable<Doc<"aiRequests">["effort"]>;
const EFFORTS: Effort[] = ["low", "medium", "high"];
const EFFORT_HINTS: Record<Effort, string> = {
  low: "Quick answers for small edits",
  medium: "A balance of speed and care",
  high: "Slower, but thinks harder about bigger changes",
};
const EFFORT_KEY = "dystory.effort";

/** The effort slider's position, remembered in this browser. */
function useEffort() {
  const [effort, setEffort] = useState<Effort>(() => {
    try {
      const saved = localStorage.getItem(EFFORT_KEY) as Effort | null;
      return saved && EFFORTS.includes(saved) ? saved : "medium";
    } catch {
      return "medium";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(EFFORT_KEY, effort);
    } catch {}
  }, [effort]);
  return [effort, setEffort] as const;
}

const comedyKey = (docId: Id<"docs">) => `dystory.comedy.${docId}`;

function readComedyStyle(docId: Id<"docs">): ComedyStyle | null {
  try {
    const saved = localStorage.getItem(comedyKey(docId));
    return COMEDY_STYLES.find((s) => s.id === saved)?.id ?? null;
  } catch {
    return null;
  }
}

/** The comedy style picked for this document, remembered in this browser. */
function useComedyStyle(docId: Id<"docs">) {
  const [state, setState] = useState(() => ({ docId, style: readComedyStyle(docId) }));
  const style = state.docId === docId ? state.style : readComedyStyle(docId);
  const setStyle = (next: ComedyStyle | null) => {
    setState({ docId, style: next });
    try {
      if (next) localStorage.setItem(comedyKey(docId), next);
      else localStorage.removeItem(comedyKey(docId));
    } catch {}
  };
  return [style, setStyle] as const;
}

export function AiPanel({
  docId,
  conversationStartedAt,
  editor,
  requests,
  focusSignal,
  onClose,
}: {
  docId: Id<"docs">;
  conversationStartedAt: number;
  editor: Editor | null;
  requests: Doc<"aiRequests">[] | undefined;
  focusSignal: number;
  onClose: () => void;
}) {
  const me = useMe();
  const now = useNow(5_000);
  const users = useQuery(api.users.list);
  const worker = useQuery(api.ai.workerStatus, {});
  const ask = useMutation(api.ai.ask);
  const cancel = useMutation(api.ai.cancel);
  const newConversation = useMutation(api.ai.newConversation);
  const restore = useMutation(api.docVersions.restore);

  const [prompt, setPrompt] = useState("");
  const [selection, setSelection] = useState("");
  const [selRange, setSelRange] = useState<{ from: number; to: number } | null>(null);
  const [confirmUndo, setConfirmUndo] = useState<Id<"aiRequests"> | null>(null);
  const [ignoreSelection, setIgnoreSelection] = useState(false);
  const [showEarlier, setShowEarlier] = useState(false);
  const agentName = "Claude";
  const [effort, setEffort] = useEffort();
  const [comedyStyle, setComedyStyle] = useComedyStyle(docId);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dictation = useDictation({
    onText: (text) => {
      setPrompt((p) => (p.trim() ? `${p.trimEnd()} ${text}` : text));
      inputRef.current?.focus();
    },
  });

  const userById = useMemo(() => new Map(users?.map((u) => [u._id, u]) ?? []), [users]);
  const workerOnline = !!worker && now - worker.lastSeen < 35_000;

  // Track the editor's selection so requests can be about the selected text.
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const text = selectionMarkdown(editor);
      setSelection(text);
      const { from, to } = editor.state.selection;
      setSelRange(text ? { from, to } : null);
      if (text) setIgnoreSelection(false);
    };
    update();
    editor.on("selectionUpdate", update);
    return () => {
      editor.off("selectionUpdate", update);
    };
  }, [editor]);

  useEffect(() => {
    if (focusSignal) inputRef.current?.focus();
  }, [focusSignal]);

  const visible = (requests ?? []).filter((r) => showEarlier || r._creationTime >= conversationStartedAt);
  const hiddenCount = (requests?.length ?? 0) - visible.length;
  const lastResponse = visible.at(-1)?.response;

  useEffect(() => {
    // After layout, so freshly rendered replies are measured.
    const id = requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [visible.length, lastResponse, visible.at(-1)?.activity.length]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    el.style.overflowY = el.scrollHeight > 200 ? "auto" : "hidden";
  }, [prompt]);

  const activeSelection = !ignoreSelection && selection ? selection : "";

  // Keep the quoted passage visibly marked in the document while you type
  // in the chat box (the editor hides its own selection when unfocused).
  useEffect(() => {
    if (!editor) return;
    const sync = () =>
      setPendingSelection(editor, activeSelection && !editor.isFocused ? selRange : null);
    sync();
    editor.on("focus", sync);
    editor.on("blur", sync);
    return () => {
      editor.off("focus", sync);
      editor.off("blur", sync);
      setPendingSelection(editor, null);
    };
  }, [editor, activeSelection, selRange]);
  const lastWithEdits = [...visible].reverse().find((r) => r.status === "done" && r.editCount > 0);

  const send = async (text: string) => {
    const p = text.trim();
    if (!p) return;
    setPrompt("");
    const sel = activeSelection || undefined;
    // The selection belongs to this message; don't silently reuse it.
    setIgnoreSelection(true);
    await ask({
      docId,
      userId: me._id,
      prompt: p,
      selection: sel,
      effort,
      comedyStyle: comedyStyle ?? undefined,
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
        <Sparkles size={17} className="text-ai" />
        <span className="font-semibold">{agentName}</span>
        <span
          className={cn("ml-1 size-1.5 rounded-full", workerOnline ? "bg-emerald-500" : "bg-line-strong")}
          title={workerOnline ? "Ready" : "Offline"}
        />
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => {
              newConversation({ docId });
              setShowEarlier(false);
            }}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-ink-2 hover:bg-surface-2"
            title="Start a new conversation (the AI forgets this chat)"
          >
            <MessageSquarePlus size={15} /> New chat
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

      <div ref={scrollRef} className="scroll-thin flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {hiddenCount > 0 && (
          <button
            onClick={() => setShowEarlier(true)}
            className="mx-auto block rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-ink"
          >
            Show {hiddenCount} earlier message{hiddenCount === 1 ? "" : "s"}
          </button>
        )}

        {visible.length === 0 && (
          <div className="pt-6 text-center">
            <div className="mx-auto mb-3 grid size-11 place-items-center rounded-2xl bg-ai-soft text-ai">
              <Sparkles size={20} />
            </div>
            <p className="font-medium">Ask {agentName} to help with this document</p>
            <p className="mx-auto mt-1 max-w-64 text-sm text-muted">
              {agentName} can draft, edit and restructure it live. Every change is saved in History.
            </p>
            {!workerOnline && worker !== undefined && <OfflineNote />}
          </div>
        )}

        {visible.map((r) => {
          const author = userById.get(r.requestedBy);
          return (
            <div key={r._id} className="space-y-2.5">
              <div className="flex gap-2.5">
                {author && <Avatar name={author.name} color={author.color} size={26} />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 text-xs text-muted">
                    <span className="font-medium text-ink-2">{author?.name ?? "Someone"}</span>
                    {clockTime(r._creationTime)}
                    {r.effort && <span className="capitalize">· {r.effort} effort</span>}
                    {r.comedyStyle && (
                      <span className="truncate">
                        · {COMEDY_STYLES.find((s) => s.id === r.comedyStyle)?.label}
                      </span>
                    )}
                  </div>
                  {r.selection && (
                    <div className="mt-1 line-clamp-2 border-l-2 border-line-strong pl-2 text-xs text-muted">
                      {selectionPreview(r.selection)}
                    </div>
                  )}
                  <p className="mt-0.5 text-sm whitespace-pre-wrap">{r.prompt}</p>
                </div>
              </div>

              <div className="flex gap-2.5">
                <ClaudeAvatar size={26} />
                <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md bg-bg px-3.5 py-2.5">
                  {r.activity.length > 0 && (
                    <ul className="mb-2 space-y-1">
                      {r.activity.map((a, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs text-muted">
                          <Check size={13} className="mt-px shrink-0 text-emerald-600" />
                          <span className="min-w-0 break-words">{a}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {r.response ? (
                    <div
                      className="chat-md break-words"
                      dangerouslySetInnerHTML={{ __html: renderChatMarkdown(r.response) }}
                    />
                  ) : r.status === "queued" ? (
                    <div className="text-sm text-muted">
                      {workerOnline ? "Waiting…" : <OfflineNote inline />}
                    </div>
                  ) : null}
                  {r.status === "running" && (
                    <div className="mt-1 flex items-center gap-1 py-1">
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="typing-dot size-1.5 rounded-full bg-ai"
                          style={{ animationDelay: `${i * 0.15}s` }}
                        />
                      ))}
                    </div>
                  )}
                  {r.status === "error" && (
                    <p className="mt-1 text-sm text-danger">{r.error ?? "Something went wrong."}</p>
                  )}
                  {r.status === "cancelled" && <p className="mt-1 text-xs text-muted">Stopped.</p>}

                  <div className="mt-1 flex items-center gap-1 empty:hidden">
                    {(r.status === "running" || r.status === "queued") && (
                      <button
                        onClick={() => cancel({ requestId: r._id })}
                        className="-ml-1.5 flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs text-muted hover:bg-surface-2 hover:text-ink"
                      >
                        <CircleStop size={13} /> Stop
                      </button>
                    )}
                    {r._id === lastWithEdits?._id && r.beforeVersionId && confirmUndo !== r._id && (
                      <button
                        onClick={() => setConfirmUndo(r._id)}
                        className="-ml-1.5 flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs text-muted hover:bg-surface-2 hover:text-ink"
                      >
                        <RotateCcw size={13} /> Undo Claude's changes
                      </button>
                    )}
                  </div>
                  {confirmUndo === r._id && r.beforeVersionId && (
                    <UndoConfirm
                      docId={docId}
                      since={r.finishedAt ?? r._creationTime}
                      onCancel={() => setConfirmUndo(null)}
                      onConfirm={async () => {
                        setConfirmUndo(null);
                        await restore({ versionId: r.beforeVersionId!, userId: me._id });
                      }}
                    />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="shrink-0 border-t border-line p-3">
        {visible.length === 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {(activeSelection ? SELECTION_SUGGESTIONS : SUGGESTIONS).map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="rounded-full border border-line px-3 py-1.5 text-xs text-ink-2 hover:border-line-strong hover:bg-surface-2"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <div className="rounded-2xl border border-line bg-bg focus-within:border-line-strong">
          {activeSelection && (
            <div className="mx-2 mt-2 flex items-start gap-2 rounded-xl bg-ai-soft/60 px-2.5 py-2">
              <Quote size={13} className="mt-0.5 shrink-0 text-ai" />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold text-ai">Selected text</div>
                <div className="line-clamp-2 text-xs text-ink-2">{selectionPreview(activeSelection)}</div>
              </div>
              <button
                onClick={() => setIgnoreSelection(true)}
                className="grid size-6 shrink-0 place-items-center rounded-md text-muted hover:bg-surface hover:text-ink"
                aria-label="Don't use the selection"
              >
                <X size={14} />
              </button>
            </div>
          )}
          <DictationStatus dictation={dictation} />
          <div className="flex items-end gap-2 p-2">
            <textarea
              ref={inputRef}
              rows={1}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(prompt);
                } else if (e.key === " " && e.shiftKey && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  dictation.toggle();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  editor?.commands.focus();
                }
              }}
              placeholder={activeSelection ? `What should ${agentName} do with it?` : `Ask ${agentName} anything…`}
              aria-label={`Message ${agentName}`}
              className="max-h-[200px] min-h-9 flex-1 resize-none overflow-hidden bg-transparent px-1.5 py-1.5 text-sm outline-none placeholder:text-muted"
            />
            <MicButton dictation={dictation} className="size-9 rounded-xl" iconSize={17} />
            <button
              onClick={() => send(prompt)}
              disabled={!prompt.trim()}
              className="grid size-9 shrink-0 place-items-center rounded-xl bg-ai text-white transition disabled:opacity-30"
              aria-label="Send"
            >
              <ArrowUp size={18} />
            </button>
          </div>
        </div>
        <label className="mt-1.5 flex items-center gap-3 px-1 text-xs text-muted" title={EFFORT_HINTS[effort]}>
          <span className="w-12 shrink-0">Effort</span>
          <input
            type="range"
            min={0}
            max={EFFORTS.length - 1}
            step={1}
            value={EFFORTS.indexOf(effort)}
            onChange={(e) => setEffort(EFFORTS[Number(e.target.value)])}
            aria-valuetext={effort}
            className="h-1 min-w-0 flex-1 cursor-pointer accent-ai"
          />
          <span className="w-14 shrink-0 text-right font-medium text-ink-2 capitalize">{effort}</span>
        </label>
        <ComedyPicker value={comedyStyle} onChange={setComedyStyle} />
      </div>
    </div>
  );
}

/** What the microphone is doing, shown in the composer while dictating. */
export function DictationStatus({ dictation }: { dictation: Dictation }) {
  const { phase, seconds } = dictation;
  if (phase === "idle") return null;
  return (
    <div
      aria-live="polite"
      className={cn(
        "mx-2 mt-2 flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs",
        phase === "recording" ? "bg-danger/10 text-danger" : "bg-surface-2 text-ink-2",
      )}
    >
      {phase === "transcribing" ? (
        <LoaderCircle size={13} className="shrink-0 animate-spin" />
      ) : (
        <span className={cn("size-2 shrink-0 rounded-full bg-current", phase === "recording" && "animate-pulse")} />
      )}
      <span className="font-medium tabular-nums">
        {phase === "recording"
          ? `Listening ${formatSeconds(seconds)}`
          : phase === "transcribing"
            ? "Transcribing…"
            : "Starting the microphone…"}
      </span>
      {phase !== "starting" && <span className="ml-auto text-muted">Esc to cancel</span>}
    </div>
  );
}

const COMEDY_HELP =
  "Gives the AI a comedy-writing guide for one tradition (stand-up, sketch, satire), added to its instructions for your messages in this document. Pick None to turn it off.";

/** Dropdown under the chat box for choosing a comedy style (or none). */
function ComedyPicker({
  value,
  onChange,
}: {
  value: ComedyStyle | null;
  onChange: (style: ComedyStyle | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const current = COMEDY_STYLES.find((s) => s.id === value);
  const pick = (style: ComedyStyle | null) => {
    setOpen(false);
    onChange(style);
    ref.current?.focus();
  };
  const options = [
    { id: null, label: "None", after: null, hint: "The AI writes normally." },
    ...COMEDY_STYLES,
  ];

  return (
    <div className="mt-1.5 flex items-center gap-3 px-1 text-xs text-muted">
      <span className="w-12 shrink-0">Comedy</span>
      <button
        ref={ref}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Comedy style: ${current?.label ?? "None"}`}
        title={current ? `${current.label}, after ${current.after}. ${current.hint}\n\n${COMEDY_HELP}` : COMEDY_HELP}
        className={cn(
          "-mx-1.5 flex h-7 min-w-0 items-center gap-1 rounded-lg px-1.5 hover:bg-surface-2",
          current ? "font-medium text-ink-2" : "hover:text-ink-2",
        )}
      >
        <span className="truncate">{current ? `${current.label} (${current.after})` : "None"}</span>
        <ChevronDown size={13} className="shrink-0 opacity-60" />
      </button>
      {open && (
        <Popover anchor={ref} onClose={() => setOpen(false)} placement="top-start" className="w-72">
          <div role="listbox" aria-label="Comedy style" className="scroll-thin max-h-[min(24rem,calc(100vh-6rem))] overflow-y-auto">
            {options.map((o) => (
              <button
                key={o.id ?? "none"}
                role="option"
                aria-selected={o.id === value}
                autoFocus={o.id === value}
                onClick={() => pick(o.id)}
                className="flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">
                    {o.label}
                    {o.after && <span className="text-muted"> · {o.after}</span>}
                  </span>
                  <span className="block text-xs text-muted">{o.hint}</span>
                </span>
                {o.id === value && <Check size={15} className="mt-0.5 shrink-0 text-ink-2" />}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}

function OfflineNote({ inline }: { inline?: boolean }) {
  const text = (
    <>
      The AI worker isn't running. Start the app with <code className="rounded bg-surface-2 px-1">bun run dev</code>.
    </>
  );
  return inline ? (
    <span>{text}</span>
  ) : (
    <p className="mx-auto mt-4 max-w-72 rounded-xl bg-surface-2 px-3 py-2 text-xs text-ink-2">{text}</p>
  );
}

function UndoConfirm({
  docId,
  since,
  onConfirm,
  onCancel,
}: {
  docId: Id<"docs">;
  since: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const me = useMe();
  const editors = useQuery(api.docVersions.editorsSince, { docId, since });
  const users = useQuery(api.users.list);
  const names = (editors ?? [])
    .filter((id) => id !== me._id)
    .map((id) => users?.find((u) => u._id === id)?.name)
    .filter(Boolean) as string[];
  const mine = editors?.includes(me._id);
  const whose = [...names.map((n) => `${n}'s`), ...(mine ? ["your"] : [])];
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [editors]);
  const list =
    whose.length <= 1 ? whose[0] : `${whose.slice(0, -1).join(", ")} and ${whose.at(-1)}`;

  return (
    <div ref={ref} className="mt-2 rounded-xl border border-line bg-surface p-3 text-sm">
      <p className="text-ink-2">
        {list
          ? `This also removes ${list} edits made since ${clockTime(since)}. They stay in History.`
          : "Put the document back the way it was before this request?"}
      </p>
      <div className="mt-2.5 flex gap-2">
        <button
          onClick={onConfirm}
          disabled={editors === undefined}
          className="h-8 rounded-lg bg-ink px-3 text-xs font-medium text-bg disabled:opacity-40"
        >
          {list ? "Undo anyway" : "Undo changes"}
        </button>
        <button onClick={onCancel} className="h-8 rounded-lg px-3 text-xs hover:bg-surface-2">
          Cancel
        </button>
      </div>
    </div>
  );
}
