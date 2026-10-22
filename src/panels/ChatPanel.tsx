import type { Editor } from "@tiptap/core";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  Copy,
  MessagesSquare,
  Reply,
  TextQuote,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { CHAT_MAX_TEXT, chatPreview } from "../../shared/chat";
import { Avatar } from "../components/Avatar";
import { Collapse } from "../components/Collapse";
import { MicButton } from "../components/MicButton";
import { useToast } from "../components/Toast";
import {
  CHAT_REF_CLICK_EVENT,
  chatRefRange,
  draftRange,
  findQuote,
  flashPassage,
  flatten,
  revealRange,
  selectionQuote,
  setActiveChatRef,
  setChatRefs,
  setDraftQuote,
  type ChatRef,
  type Quote,
} from "../editor/chatRefs";
import { copyText } from "../lib/clipboard";
import { SESSION_ID, useMe } from "../lib/identity";
import { cn, useNow } from "../lib/hooks";
import { clockTime, dayLabel } from "../lib/time";
import { useDictation } from "../lib/useDictation";
import { DictationStatus } from "./AiPanel";

export type ChatMessage = FunctionReturnType<typeof api.chat.list>[number];
type MessageId = Id<"chatMessages">;
type User = { name: string; color: string };
export type ChatPerson = { userId: Id<"users">; name: string; color: string };
export type ChatTyper = ChatPerson & { sessionId: string; typingAt?: number };

// Messages from one person this close together share a group under one
// header (avatar, name, time).
const GROUP_MS = 5 * 60_000;
// Ids of messages shown before the server has saved them.
const PENDING = "pending:";
const UNKNOWN: User = { name: "Someone", color: "#8a847b" };

const readKey = (docId: Id<"docs">) => `dystory.chatRead.${docId}`;

/**
 * How many messages other people sent since this browser last had the chat
 * open, and when that was. Having the chat open marks everything read.
 */
export function useChatUnread(
  docId: Id<"docs">,
  messages: ChatMessage[] | undefined,
  meId: Id<"users">,
  open: boolean,
) {
  const [lastRead, setLastRead] = useState(() => {
    try {
      return Number(localStorage.getItem(readKey(docId))) || 0;
    } catch {
      return 0;
    }
  });
  // Pending messages carry this browser's clock rather than the server's.
  const latest = messages?.findLast((m) => !m._id.startsWith(PENDING))?._creationTime ?? 0;
  useEffect(() => {
    if (!open || latest <= lastRead) return;
    setLastRead(latest);
    try {
      localStorage.setItem(readKey(docId), String(latest));
    } catch {}
  }, [open, latest, lastRead, docId]);
  const unread = open
    ? 0
    : (messages ?? []).filter((m) => m._creationTime > lastRead && m.authorId !== meId && !m.deleted).length;
  return { unread, lastRead };
}

type Item =
  | { kind: "time"; key: string; at: number }
  | { kind: "new"; key: string }
  | { kind: "msg"; key: string; m: ChatMessage; first: boolean; last: boolean };

export function ChatPanel({
  docId,
  editor,
  messages,
  users,
  people,
  typers,
  quote,
  onQuote,
  replyTo,
  onReplyTo,
  lastRead,
  focusSignal,
  overlay,
  onClose,
}: {
  docId: Id<"docs">;
  editor: Editor | null;
  messages: ChatMessage[] | undefined;
  users: Doc<"users">[] | undefined;
  /** Other people with the document open. */
  people: ChatPerson[];
  typers: ChatTyper[];
  /** The passage quoted in the chat box. */
  quote: Quote | null;
  onQuote: (quote: Quote | null) => void;
  replyTo: MessageId | null;
  onReplyTo: (id: MessageId | null) => void;
  lastRead: number;
  focusSignal: number;
  /** The panel covers the document (narrow screens). */
  overlay: boolean;
  onClose: () => void;
}) {
  const me = useMe();
  const toast = useToast();
  const sendMessage = useMutation(api.chat.send).withOptimisticUpdate((store, args) => {
    const list = store.getQuery(api.chat.list, { docId: args.docId });
    if (!list) return;
    const target = args.replyTo ? list.find((m) => m._id === args.replyTo) : undefined;
    store.setQuery(api.chat.list, { docId: args.docId }, [
      ...list,
      {
        _id: `${PENDING}${args.clientId}` as MessageId,
        _creationTime: Date.now(),
        clientId: args.clientId,
        authorId: args.userId,
        text: args.text.trim(),
        quote: args.quote,
        replyTo: args.replyTo,
        reply: args.replyTo
          ? {
              authorId: target?.authorId ?? null,
              preview: target ? chatPreview(target) : "",
              deleted: !target || target.deleted,
            }
          : null,
        deleted: false,
      },
    ]);
  });
  const remove = useMutation(api.chat.remove);
  const restore = useMutation(api.chat.restore);
  const setTyping = useMutation(api.chat.typing);

  const [draft, setDraft] = useState("");
  // The "New" line goes above the first message that was unread when the
  // chat opened (not above ones that arrive while you watch), and stays put.
  const [newLineAt, setNewLineAt] = useState<string | null | undefined>(undefined);
  if (messages && newLineAt === undefined) {
    const i = messages.findIndex((m) => m._creationTime > lastRead && m.authorId !== me._id && !m.deleted);
    setNewLineAt(lastRead > 0 && i > 0 ? messages[i]!._id : null);
  }
  const [below, setBelow] = useState(0);
  // On touch screens, the message tapped to show its actions.
  const [selected, setSelected] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const atBottom = useRef(true);
  const typedAt = useRef(0);
  const dictation = useDictation({
    onText: (text) => {
      setDraft((d) => (d.trim() ? `${d.trimEnd()} ${text}` : text));
      inputRef.current?.focus();
    },
  });

  const userById = useMemo(() => new Map<string, User>(users?.map((u) => [u._id, u]) ?? []), [users]);
  const userOf = useCallback(
    (id: Id<"users"> | null | undefined): User => (id && userById.get(id)) || UNKNOWN,
    [userById],
  );

  // Deleted messages leave a placeholder only where someone answered them.
  const visible = useMemo(() => {
    const list = messages ?? [];
    const answered = new Set(list.filter((m) => !m.deleted && m.replyTo).map((m) => m.replyTo));
    return list.filter((m) => !m.deleted || answered.has(m._id));
  }, [messages]);

  const items = useMemo(() => {
    const out: Item[] = [];
    let prev: ChatMessage | undefined;
    let prevItem: Extract<Item, { kind: "msg" }> | undefined;
    for (const m of visible) {
      const pause = !prev || dayLabel(m._creationTime) !== dayLabel(prev._creationTime);
      if (pause) out.push({ kind: "time", key: `day:${m._id}`, at: m._creationTime });
      const isNew = m._id === newLineAt;
      if (isNew) out.push({ kind: "new", key: "new" });
      const first =
        pause || isNew || prev!.authorId !== m.authorId || m._creationTime - prev!._creationTime > GROUP_MS;
      if (!first && prevItem) prevItem.last = false;
      prevItem = { kind: "msg", key: m.clientId ?? m._id, m, first, last: true };
      out.push(prevItem);
      prev = m;
    }
    return out;
  }, [visible, newLineAt]);

  // Messages that arrive after the first render slide in.
  const ready = useRef(false);
  useEffect(() => {
    if (messages) ready.current = true;
  }, [messages]);

  useEffect(() => {
    if (focusSignal) inputRef.current?.focus();
  }, [focusSignal]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    el.style.overflowY = el.scrollHeight > 160 ? "auto" : "hidden";
  }, [draft]);

  // --- Passages in the document ---------------------------------------------
  const quoted = useMemo(() => visible.filter((m) => m.quote && !m.deleted), [visible]);
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const resolve = () => {
      if (editor.isDestroyed) return;
      const flat = flatten(editor.state.doc);
      const refs: ChatRef[] = [];
      const gone: string[] = [];
      for (const m of quoted) {
        const r = findQuote(flat, m.quote!);
        const { name, color } = userOf(m.authorId);
        const said = m.text ? `${name}: ${m.text.replace(/\s+/g, " ")}` : `${name} quoted this`;
        if (r) refs.push({ id: m._id, color, label: said.length > 140 ? `${said.slice(0, 140)}…` : said, ...r });
        else gone.push(m._id);
      }
      setChatRefs(editor, refs);
      setMissing((prev) =>
        prev.size === gone.length && gone.every((id) => prev.has(id)) ? prev : new Set(gone),
      );
    };
    resolve();
    const onUpdate = () => {
      clearTimeout(timer);
      timer = setTimeout(resolve, 400);
    };
    editor.on("update", onUpdate);
    return () => {
      clearTimeout(timer);
      editor.off("update", onUpdate);
    };
  }, [editor, quoted, userOf]);
  useEffect(
    () => () => {
      if (editor && !editor.isDestroyed) setChatRefs(editor, []);
    },
    [editor],
  );

  // Keep the passage being quoted marked while you write about it.
  useEffect(() => {
    if (!editor || !quote) return;
    const r = findQuote(flatten(editor.state.doc), quote);
    setDraftQuote(editor, r && { ...r, color: me.color });
    return () => {
      if (!editor.isDestroyed) setDraftQuote(editor, null);
    };
  }, [editor, quote, me.color]);

  // Offer to quote whatever is selected in the document.
  const [selection, setSelection] = useState<Quote | null>(null);
  const [usedSelection, setUsedSelection] = useState("");
  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(timer);
      timer = setTimeout(() => !editor.isDestroyed && setSelection(selectionQuote(editor)), 150);
    };
    update();
    editor.on("selectionUpdate", update);
    return () => {
      clearTimeout(timer);
      editor.off("selectionUpdate", update);
    };
  }, [editor]);
  useEffect(() => {
    if (quote) setUsedSelection(`${quote.from}:${quote.to}`);
  }, [quote]);
  const offer = selection && !quote && `${selection.from}:${selection.to}` !== usedSelection ? selection : null;

  const replyMsg = replyTo ? messages?.find((m) => m._id === replyTo) : undefined;
  useEffect(() => {
    if (replyTo && messages && (!replyMsg || replyMsg.deleted)) onReplyTo(null);
  }, [replyTo, replyMsg, messages, onReplyTo]);
  useEffect(() => {
    if (replyTo || quote) inputRef.current?.focus();
  }, [replyTo, quote]);

  // --- Scrolling -------------------------------------------------------------
  const onScroll = () => {
    const el = scrollRef.current!;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom.current) setBelow(0);
  };

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottom.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setBelow(0);
  };

  // Open at the "New" line if there is one, otherwise at the latest message.
  const placed = useRef(false);
  useLayoutEffect(() => {
    if (placed.current || !messages) return;
    placed.current = true;
    const el = scrollRef.current;
    if (!el) return;
    const line = el.querySelector<HTMLElement>("[data-new-line]");
    el.scrollTop = line ? line.offsetTop - 56 : el.scrollHeight;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, [messages]);

  // While at the bottom, stay there as messages arrive and the typing
  // indicator opens.
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const ro = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  // Scrolled up when someone writes: count it on the "new messages" button.
  const newest = visible.at(-1);
  const newestAt = useRef(newest?._creationTime ?? 0);
  useLayoutEffect(() => {
    if (!newest || newest._creationTime <= newestAt.current) return;
    newestAt.current = newest._creationTime;
    if (!placed.current) return;
    if (newest.authorId === me._id) {
      atBottom.current = true;
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    } else if (!atBottom.current) setBelow((n) => n + 1);
  }, [newest, me._id]);

  const jumpTo = useCallback(
    (id: string) => {
      const row = scrollRef.current?.querySelector<HTMLElement>(`[data-msg="${CSS.escape(id)}"]`);
      if (!row) {
        toast({ message: "That message is too far back to show" });
        return;
      }
      row.scrollIntoView({ block: "center", behavior: "smooth" });
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
      const ring = /^#[0-9a-f]{6}$/i.test(accent) ? accent : "#2f5bd3";
      row.querySelector<HTMLElement>("[data-bubble]")?.animate(
        [
          { transform: "scale(1)", boxShadow: `0 0 0 0 ${ring}00` },
          { transform: "scale(1.04)", boxShadow: `0 0 0 4px ${ring}70`, offset: 0.25 },
          { transform: "scale(1)", boxShadow: `0 0 0 10px ${ring}00` },
        ],
        { duration: 1100, delay: 280, easing: "cubic-bezier(.2,.8,.2,1)" },
      );
    },
    [toast],
  );

  // Clicking a tinted passage in the document finds the latest message about it.
  useEffect(() => {
    const onRefClick = (e: Event) => {
      const ids = (e as CustomEvent<string[]>).detail;
      const m = visible.findLast((x) => ids.includes(x._id));
      if (m) jumpTo(m._id);
    };
    window.addEventListener(CHAT_REF_CLICK_EVENT, onRefClick);
    return () => window.removeEventListener(CHAT_REF_CLICK_EVENT, onRefClick);
  }, [visible, jumpTo]);

  // --- Actions ---------------------------------------------------------------
  const showPassage = (m: ChatMessage) => {
    if (!editor) return;
    const r = chatRefRange(editor, m._id);
    if (!r) return;
    const color = userOf(m.authorId).color;
    const go = () => {
      revealRange(editor, r);
      flashPassage(editor, { ...r, color });
    };
    if (overlay) {
      onClose();
      requestAnimationFrame(go);
    } else go();
  };

  const hoverPassage = (id: string | null) => {
    if (editor && !editor.isDestroyed) setActiveChatRef(editor, id);
  };

  const reply = (m: ChatMessage) => {
    setSelected(null);
    onReplyTo(m._id);
    inputRef.current?.focus();
  };

  const deleteMessage = async (m: ChatMessage, row: HTMLElement | null) => {
    setSelected(null);
    // Messages without replies vanish, so fold them away first.
    const answered = visible.some((x) => x.replyTo === m._id && !x.deleted);
    let fold: Animation | undefined;
    if (row && !answered && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      row.style.overflow = "hidden";
      fold = row.animate(
        [
          { height: `${row.offsetHeight}px`, opacity: 1, transform: "scale(1)" },
          { height: "0px", marginTop: "0px", opacity: 0, transform: "scale(0.9)" },
        ],
        { duration: 260, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" },
      );
      await fold.finished.catch(() => {});
    }
    try {
      await remove({ messageId: m._id, userId: me._id });
      toast({
        message: "Message deleted",
        action: { label: "Undo", run: () => void restore({ messageId: m._id, userId: me._id }) },
      });
    } catch {
      fold?.cancel();
      if (row) row.style.overflow = "";
      toast({ message: "Couldn't delete that message" });
    }
  };

  const onDraft = (value: string) => {
    setDraft(value);
    const now = Date.now();
    if (value.trim()) {
      if (now - typedAt.current > 2500) {
        typedAt.current = now;
        setTyping({ sessionId: SESSION_ID, typing: true }).catch(() => {});
      }
    } else if (typedAt.current) {
      typedAt.current = 0;
      setTyping({ sessionId: SESSION_ID, typing: false }).catch(() => {});
    }
  };
  useEffect(
    () => () => {
      if (typedAt.current) setTyping({ sessionId: SESSION_ID, typing: false }).catch(() => {});
    },
    [setTyping],
  );

  const tooLong = draft.trim().length > CHAT_MAX_TEXT;
  const canSend = (!!draft.trim() || !!quote) && !tooLong;

  const send = () => {
    if (!canSend) return;
    const text = draft.trim();
    const sentQuote = quote;
    const sentReply = replyTo;
    // The passage may have moved while you wrote; send where it is now.
    const live = editor && sentQuote ? draftRange(editor) : null;
    const clientId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setDraft("");
    onQuote(null);
    onReplyTo(null);
    typedAt.current = 0;
    sendMessage({
      docId,
      userId: me._id,
      sessionId: SESSION_ID,
      clientId,
      text,
      quote: sentQuote
        ? { text: sentQuote.text, from: live?.from ?? sentQuote.from, to: live?.to ?? sentQuote.to }
        : undefined,
      replyTo: sentReply ?? undefined,
    }).catch((err) => {
      setDraft((d) => d || text);
      if (sentQuote) onQuote(sentQuote);
      if (sentReply) onReplyTo(sentReply);
      toast({
        message: err instanceof ConvexError ? String(err.data) : "Couldn't send your message. Try again.",
      });
    });
  };

  const names = people.map((p) => p.name);
  const placeholder = replyMsg
    ? `Reply to ${replyMsg.authorId === me._id ? "yourself" : userOf(replyMsg.authorId).name}…`
    : quote
      ? "Say something about this passage…"
      : names.length === 0
        ? "Write a message…"
        : names.length <= 2
          ? `Message ${names.join(" and ")}…`
          : "Message everyone here…";

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
        <MessagesSquare size={17} className="text-ink-2" />
        <span className="font-semibold">Chat</span>
        {people.length > 0 && (
          <div
            className="ml-1 flex items-center -space-x-1.5"
            title={`${listNames(names)} ${names.length === 1 ? "is" : "are"} here`}
          >
            {people.slice(0, 4).map((p) => (
              <Avatar key={p.userId} name={p.name} color={p.color} size={22} ring />
            ))}
          </div>
        )}
        <button
          onClick={onClose}
          className="ml-auto grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
          aria-label="Close"
        >
          <X size={17} />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          onPointerDown={(e) => {
            if (!(e.target as Element).closest("[data-msg]")) setSelected(null);
          }}
          className="scroll-thin relative h-full overflow-x-hidden overflow-y-auto px-4 pt-3 pb-4"
        >
          <div ref={contentRef} className="flex min-h-full flex-col">
            {messages === undefined ? (
              <LoadingBubbles />
            ) : visible.length === 0 ? (
              <EmptyState people={people} />
            ) : (
              <div className="mt-auto" role="log" aria-label="Messages">
                {items.map((item) =>
                  item.kind === "time" ? (
                    <div
                      key={item.key}
                      className="flex items-center gap-3 pt-5 pb-1 text-[11px] font-medium text-muted first:pt-1"
                    >
                      <span className="h-px flex-1 bg-line" />
                      {dayLabel(item.at)}
                      <span className="h-px flex-1 bg-line" />
                    </div>
                  ) : item.kind === "new" ? (
                    <div
                      key={item.key}
                      data-new-line
                      className="chat-new-line flex items-center gap-2 pt-4 pb-1 text-[11px] font-semibold tracking-wide text-accent uppercase"
                    >
                      <span className="h-px flex-1 bg-accent/40" />
                      New
                      <span className="h-px flex-1 bg-accent/40" />
                    </div>
                  ) : (
                    <MessageRow
                      key={item.key}
                      m={item.m}
                      first={item.first}
                      last={item.last}
                      mine={item.m.authorId === me._id}
                      meId={me._id}
                      userOf={userOf}
                      missing={missing.has(item.m._id)}
                      animate={ready.current}
                      selected={selected === item.m._id}
                      onSelect={setSelected}
                      onReply={reply}
                      onJump={jumpTo}
                      onPassage={showPassage}
                      onHoverPassage={hoverPassage}
                      onDelete={deleteMessage}
                    />
                  ),
                )}
              </div>
            )}
            <TypingIndicator typers={typers} />
          </div>
        </div>

        {below > 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <button
              onClick={scrollToBottom}
              className="chat-pop pointer-events-auto flex items-center gap-1.5 rounded-full bg-ink py-1.5 pr-3.5 pl-2.5 text-xs font-medium text-bg shadow-float"
            >
              <ArrowDown size={14} />
              {below} new message{below === 1 ? "" : "s"}
            </button>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line p-3">
        <Collapse open={!!offer}>
          {offer && (
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onQuote(offer)}
              className="mb-2 flex w-full items-center gap-2 rounded-xl border border-dashed border-line-strong px-3 py-2 text-left text-xs text-ink-2 transition hover:border-solid hover:bg-surface-2"
            >
              <TextQuote size={14} className="shrink-0 text-muted" />
              <span className="shrink-0 font-medium">Quote the selection</span>
              <span className="min-w-0 truncate font-serif text-muted">“{offer.text.replace(/\s+/g, " ")}”</span>
            </button>
          )}
        </Collapse>
        <div className="rounded-2xl border border-line bg-bg transition-[border-color,box-shadow] focus-within:border-line-strong focus-within:shadow-soft">
          <Collapse open={!!replyMsg && !replyMsg.deleted}>
            {replyMsg && (
              <ComposerChip
                icon={Reply}
                color={userOf(replyMsg.authorId).color}
                title={`Replying to ${replyMsg.authorId === me._id ? "yourself" : userOf(replyMsg.authorId).name}`}
                onCancel={() => onReplyTo(null)}
                cancelLabel="Cancel reply"
              >
                <span className="block truncate text-xs text-ink-2">{chatPreview(replyMsg)}</span>
              </ComposerChip>
            )}
          </Collapse>
          <Collapse open={!!quote}>
            {quote && (
              <ComposerChip
                icon={TextQuote}
                color={me.color}
                title="Quoting the document"
                onCancel={() => onQuote(null)}
                cancelLabel="Remove the quote"
              >
                <span className="line-clamp-2 font-serif text-[0.8rem] leading-snug whitespace-pre-line text-ink-2">
                  {quote.text}
                </span>
              </ComposerChip>
            )}
          </Collapse>
          <DictationStatus dictation={dictation} />
          <div className="flex items-end gap-1.5 p-2">
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              onChange={(e) => onDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                } else if (e.key === " " && e.shiftKey && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  dictation.toggle();
                } else if (e.key === "Escape" && dictation.phase === "idle") {
                  e.preventDefault();
                  if (replyTo) onReplyTo(null);
                  else if (quote) onQuote(null);
                  else editor?.commands.focus();
                }
              }}
              placeholder={placeholder}
              aria-label="Message"
              className="max-h-[160px] min-h-9 flex-1 resize-none overflow-hidden bg-transparent px-1.5 py-1.5 text-sm outline-none placeholder:text-muted"
            />
            <MicButton dictation={dictation} className="size-9 rounded-xl" iconSize={17} />
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={send}
              disabled={!canSend}
              aria-label="Send"
              className={cn(
                "send-button grid size-9 shrink-0 place-items-center rounded-xl bg-ink text-bg",
                canSend ? "is-ready" : "opacity-25",
              )}
            >
              <ArrowUp size={18} />
            </button>
          </div>
          {draft.length > CHAT_MAX_TEXT - 300 && (
            <div className={cn("px-3.5 pb-2 text-right text-[11px]", tooLong ? "text-danger" : "text-muted")}>
              {(CHAT_MAX_TEXT - draft.trim().length).toLocaleString()} characters left
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageRow({
  m,
  first,
  last,
  mine,
  meId,
  userOf,
  missing,
  animate,
  selected,
  onSelect,
  onReply,
  onJump,
  onPassage,
  onHoverPassage,
  onDelete,
}: {
  m: ChatMessage;
  first: boolean;
  last: boolean;
  mine: boolean;
  meId: Id<"users">;
  userOf: (id: Id<"users"> | null | undefined) => User;
  /** Its passage has been edited out of the document. */
  missing: boolean;
  animate: boolean;
  selected: boolean;
  onSelect: (id: string | null) => void;
  onReply: (m: ChatMessage) => void;
  onJump: (id: string) => void;
  onPassage: (m: ChatMessage) => void;
  onHoverPassage: (id: string | null) => void;
  onDelete: (m: ChatMessage, row: HTMLElement | null) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [enter] = useState(animate);
  const [copied, setCopied] = useState(false);
  const pending = m._id.startsWith(PENDING);
  const live = !pending && !m.deleted;
  const author = userOf(m.authorId);
  const jumbo = live && !m.quote && isJumboEmoji(m.text);
  const swipe = useSwipeToReply(() => onReply(m), live);

  const copy = async () => {
    if (await copyText(m.text || m.quote?.text || "")) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }
  };

  return (
    <div
      ref={rowRef}
      data-msg={m._id}
      className={cn(
        "msg relative flex touch-pan-y items-start gap-2",
        mine && "flex-row-reverse",
        first ? "mt-4" : "mt-[3px]",
        enter && (jumbo ? "jumbo-in" : "msg-in"),
        selected && "is-selected",
      )}
      style={{ transformOrigin: mine ? "100% 100%" : "0% 100%" }}
      onMouseEnter={() => m.quote && onHoverPassage(m._id)}
      onMouseLeave={() => m.quote && onHoverPassage(null)}
      {...swipe.handlers}
    >
      <SwipeHint progress={swipe.progress} />
      <div className="w-7 shrink-0">
        {first && <Avatar name={author.name} color={author.color} size={28} title={mine ? "You" : author.name} />}
      </div>
      <div
        className={cn(
          "flex min-w-0 flex-col",
          mine ? "max-w-[calc(100%-6.25rem)] items-end" : "max-w-[calc(100%-4.5rem)] items-start",
        )}
        style={swipe.style}
      >
        {first && (
          <div className={cn("mb-1 flex min-h-7 items-center gap-1.5 px-1", mine && "flex-row-reverse")}>
            <span className="text-[13px] font-semibold" style={{ color: author.color }}>
              {mine ? "You" : author.name}
            </span>
            <span className="text-[11px] text-muted tabular-nums">{clockTime(m._creationTime)}</span>
          </div>
        )}
        {m.reply && (
          <ReplyRef
            reply={m.reply}
            mine={mine}
            who={m.reply.authorId ? userOf(m.reply.authorId) : null}
            isMe={m.reply.authorId === meId}
            onClick={() => m.replyTo && onJump(m.replyTo)}
          />
        )}
        <div
          data-bubble
          title={new Date(m._creationTime).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
          onPointerUp={(e) => {
            if (e.pointerType === "touch" && live && !swipe.moved()) onSelect(selected ? null : m._id);
          }}
          className={cn(
            "relative max-w-full",
            bubbleShape(mine, first, last),
            m.deleted
              ? "border border-dashed border-line-strong px-3.5 py-2 text-sm text-muted italic"
              : jumbo
                ? "px-0.5 text-[2.6rem] leading-[1.15]"
                : mine
                  ? "bg-ink p-1 text-bg"
                  : "bg-surface-2 p-1 text-ink",
            pending && "opacity-60",
          )}
        >
          {m.deleted ? (
            "Message deleted"
          ) : jumbo ? (
            m.text.trim()
          ) : (
            <>
              {m.quote && (
                <PassageCard quote={m.quote} color={author.color} missing={missing} onOpen={() => onPassage(m)} />
              )}
              {m.text && (
                <p className="px-2.5 py-1.5 text-[0.9rem] leading-[1.45] break-words whitespace-pre-wrap">
                  <Linkified text={m.text} />
                </p>
              )}
            </>
          )}
          {live && (
            <div
              className={cn(
                "msg-actions absolute -top-4 z-10 flex items-center rounded-full border border-line bg-surface p-0.5 text-ink-2 shadow-soft",
                mine ? "right-[calc(100%-1.75rem)]" : "left-[calc(100%-1.75rem)]",
              )}
            >
              <ActionButton icon={Reply} label="Reply" onClick={() => onReply(m)} />
              <ActionButton icon={copied ? Check : Copy} label={copied ? "Copied" : "Copy"} onClick={copy} />
              {mine && (
                <ActionButton icon={Trash2} label="Delete" danger onClick={() => onDelete(m, rowRef.current)} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Rounded bubbles whose corners tuck in on the sender's side where a group's messages meet. */
function bubbleShape(mine: boolean, first: boolean, last: boolean) {
  return mine
    ? cn("rounded-[20px]", !first && "rounded-tr-[6px]", !last && "rounded-br-[6px]")
    : cn("rounded-[20px]", !first && "rounded-tl-[6px]", !last && "rounded-bl-[6px]");
}

function ActionButton({
  icon: Icon,
  label,
  danger,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "grid size-7 place-items-center rounded-full transition hover:scale-110 active:scale-95",
        danger ? "hover:bg-danger/10 hover:text-danger" : "hover:bg-surface-2 hover:text-ink",
      )}
    >
      <Icon size={15} />
    </button>
  );
}

/** The quoted document passage at the top of a message; opens it in the document. */
function PassageCard({
  quote,
  color,
  missing,
  onOpen,
}: {
  quote: Quote;
  color: string;
  missing: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={missing ? undefined : onOpen}
      aria-disabled={missing}
      title={missing ? "This passage has been edited since" : "Show in the document"}
      style={{ "--c": color } as CSSProperties}
      className={cn(
        "passage group/p block w-full min-w-0 rounded-[16px] py-2 pr-3 pl-3.5 text-left",
        missing ? "is-missing cursor-default" : "cursor-pointer",
      )}
    >
      <span className="flex items-center gap-1 text-[10px] font-semibold tracking-[0.08em] uppercase opacity-65">
        <TextQuote size={11} strokeWidth={2.5} />
        {missing ? "Passage, since edited" : "Passage"}
        {!missing && (
          <ArrowUpRight
            size={13}
            className="-mr-1 ml-auto opacity-0 transition group-hover/p:translate-x-0.5 group-hover/p:opacity-100"
          />
        )}
      </span>
      <span
        className={cn(
          "mt-0.5 line-clamp-4 font-serif text-[0.84rem] leading-[1.5] whitespace-pre-line",
          missing && "opacity-60",
        )}
      >
        {quote.text}
      </span>
    </button>
  );
}

/** Above a reply: who and what it answers, joined to the bubble by a curved line. */
function ReplyRef({
  reply,
  mine,
  who,
  isMe,
  onClick,
}: {
  reply: NonNullable<ChatMessage["reply"]>;
  mine: boolean;
  who: User | null;
  isMe: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Show the message"
      className={cn(
        "relative mb-1 flex max-w-full min-w-0 items-center gap-1.5 pb-0.5 text-xs text-muted transition-colors hover:text-ink-2",
        mine ? "pr-7" : "pl-7",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-1/2 -bottom-1 w-3.5 border-t-2 border-line-strong",
          mine ? "right-3 rounded-tr-[10px] border-r-2" : "left-3 rounded-tl-[10px] border-l-2",
        )}
      />
      {who && <Avatar name={who.name} color={who.color} size={16} />}
      <span className="shrink-0 font-semibold" style={{ color: who?.color }}>
        {isMe ? "You" : (who?.name ?? "Someone")}
      </span>
      <span className={cn("min-w-0 truncate", reply.deleted && "italic")}>
        {reply.deleted ? "Message deleted" : reply.preview}
      </span>
    </button>
  );
}

function ComposerChip({
  icon: Icon,
  color,
  title,
  cancelLabel,
  onCancel,
  children,
}: {
  icon: LucideIcon;
  color: string;
  title: string;
  cancelLabel: string;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 px-3 pt-2.5 pb-0.5">
      <Icon size={15} className="mt-2 shrink-0 text-muted" />
      <div className="min-w-0 flex-1 border-l-2 py-0.5 pl-2.5" style={{ borderColor: color }}>
        <span className="block text-[11px] font-semibold" style={{ color }}>
          {title}
        </span>
        {children}
      </div>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onCancel}
        aria-label={cancelLabel}
        className="grid size-6 shrink-0 place-items-center rounded-md text-muted transition hover:bg-surface-2 hover:text-ink"
      >
        <X size={14} />
      </button>
    </div>
  );
}

/** On touch screens, dragging a message to the right replies to it. */
function useSwipeToReply(onReply: () => void, enabled: boolean) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; id: number; horizontal: boolean | null } | null>(null);
  const moved = useRef(false);
  const THRESHOLD = 64;

  const end = (commit: boolean) => {
    if (commit && dx >= THRESHOLD) {
      navigator.vibrate?.(8);
      onReply();
    }
    start.current = null;
    setDragging(false);
    setDx(0);
  };

  return {
    progress: Math.min(1, dx / THRESHOLD),
    moved: () => moved.current,
    style: {
      transform: dx ? `translateX(${dx}px)` : undefined,
      transition: dragging ? "none" : "transform 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.25)",
    } satisfies CSSProperties,
    handlers: {
      onPointerDown(e: ReactPointerEvent) {
        moved.current = false;
        if (!enabled || e.pointerType !== "touch") return;
        start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, horizontal: null };
      },
      onPointerMove(e: ReactPointerEvent) {
        const s = start.current;
        if (!s || e.pointerId !== s.id) return;
        const x = e.clientX - s.x;
        const y = e.clientY - s.y;
        if (s.horizontal === null && Math.hypot(x, y) > 8) s.horizontal = x > 0 && Math.abs(x) > Math.abs(y) * 1.3;
        if (!s.horizontal) return;
        moved.current = true;
        setDragging(true);
        // Resists past the point where letting go replies.
        setDx(x < THRESHOLD ? Math.max(0, x) : THRESHOLD + (x - THRESHOLD) * 0.3);
      },
      onPointerUp: () => start.current && end(true),
      onPointerCancel: () => start.current && end(false),
    },
  };
}

function SwipeHint({ progress }: { progress: number }) {
  if (!progress) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "absolute top-1/2 left-0 -mt-4 grid size-8 place-items-center rounded-full transition-colors",
        progress >= 1 ? "bg-ink text-bg" : "bg-surface-2 text-muted",
      )}
      style={{ opacity: progress, transform: `scale(${0.4 + progress * 0.6})` }}
    >
      <Reply size={15} />
    </span>
  );
}

/**
 * Who is typing right now. Each ping counts for a few seconds after it
 * arrives here, so it doesn't matter if this device's clock is off.
 */
function useActiveTypers(typers: ChatTyper[]) {
  useNow(1000);
  const seen = useRef(new Map<string, { at: number; seenAt: number }>());
  const now = Date.now();
  const byUser = new Map<string, ChatTyper>();
  for (const t of typers) {
    if (!t.typingAt) {
      seen.current.delete(t.sessionId);
      continue;
    }
    let s = seen.current.get(t.sessionId);
    if (!s || s.at !== t.typingAt) {
      s = { at: t.typingAt, seenAt: now };
      seen.current.set(t.sessionId, s);
    }
    if (now - s.seenAt < 4500 && Math.abs(now - t.typingAt) < 20_000) byUser.set(t.userId, t);
  }
  return [...byUser.values()];
}

function TypingIndicator({ typers }: { typers: ChatTyper[] }) {
  const active = useActiveTypers(typers);
  const names = active.map((t) => t.name);
  const label =
    names.length === 1
      ? `${names[0]} is typing`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing`
        : `${names.length} people are typing`;
  return (
    <Collapse open={active.length > 0}>
      {active.length > 0 && (
        <div className="flex items-end gap-2 pt-3" aria-live="polite">
          <div className="relative w-7 shrink-0">
            <Avatar name={active[0]!.name} color={active[0]!.color} size={28} />
          </div>
          <div className="typing-bubble flex items-center gap-[5px] rounded-[20px] rounded-bl-[6px] bg-surface-2 px-4 py-[15px]">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="typing-bounce size-[7px] rounded-full bg-muted"
                style={{ animationDelay: `${i * 0.16}s` }}
              />
            ))}
          </div>
          <span className="min-w-0 truncate pb-1.5 text-[11px] text-muted">{label}</span>
        </div>
      )}
    </Collapse>
  );
}

function EmptyState({ people }: { people: ChatPerson[] }) {
  const names = people.map((p) => p.name);
  return (
    <div className="m-auto flex max-w-72 flex-col items-center px-2 py-8 text-center">
      <div className="relative mb-6 h-[70px] w-[96px]" aria-hidden>
        <span className="float-a absolute top-0 left-0 flex h-10 w-16 flex-col justify-center gap-1.5 rounded-[18px] rounded-bl-[6px] bg-surface-2 px-3">
          <span className="h-1.5 w-full rounded-full bg-line-strong" />
          <span className="h-1.5 w-2/3 rounded-full bg-line-strong" />
        </span>
        <span className="float-b absolute right-0 bottom-0 flex h-10 w-16 items-center justify-center gap-1 rounded-[18px] rounded-br-[6px] bg-ink shadow-soft">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="typing-bounce size-[6px] rounded-full bg-bg"
              style={{ animationDelay: `${i * 0.16}s` }}
            />
          ))}
        </span>
      </div>
      <p className="font-medium">Talk about this document</p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">
        Everyone with it open sees the chat. To talk about a passage, select it and choose{" "}
        <span className="font-medium text-ink-2">Discuss</span>.
      </p>
      {people.length > 0 && (
        <div className="mt-5 flex max-w-full items-center gap-2 rounded-full bg-surface-2 py-1 pr-3 pl-1 text-xs text-ink-2">
          <div className="flex shrink-0 -space-x-1.5">
            {people.slice(0, 3).map((p) => (
              <Avatar key={p.userId} name={p.name} color={p.color} size={22} ring />
            ))}
          </div>
          <span className="min-w-0 truncate">
            {listNames(names)} {names.length === 1 ? "is" : "are"} here now
          </span>
        </div>
      )}
    </div>
  );
}

function LoadingBubbles() {
  return (
    <div className="mt-auto space-y-2 pb-1" aria-hidden>
      {[56, 72, 40].map((w, i) => (
        <div key={i} className={cn("flex", i === 1 && "justify-end")}>
          <div className="h-9 animate-pulse rounded-[20px] bg-surface-2" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  );
}

function listNames(names: string[]) {
  if (names.length <= 2) return names.join(" and ");
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}

const URL_RE = /\bhttps?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]'"]/g;

function Linkified({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const i = match.index;
    if (i > last) parts.push(text.slice(last, i));
    parts.push(
      <a
        key={i}
        href={match[0]}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all underline decoration-current/40 underline-offset-2 hover:decoration-current"
      >
        {match[0]}
      </a>,
    );
    last = i + match[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

const graphemes = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter() : null;

/** One to three emoji and nothing else, shown large without a bubble. */
function isJumboEmoji(text: string) {
  const t = text.replace(/\s+/g, "");
  if (!t || t.length > 24 || !/\p{Extended_Pictographic}/u.test(t)) return false;
  if (!/^[\p{Extended_Pictographic}\p{Emoji_Component}‍️]+$/u.test(t)) return false;
  return (graphemes ? [...graphemes.segment(t)].length : 1) <= 3;
}
