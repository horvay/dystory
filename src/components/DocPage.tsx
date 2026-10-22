import type { Editor } from "@tiptap/core";
import { useMutation, useQuery } from "convex/react";
import {
  ArchiveRestore,
  Check,
  Clapperboard,
  Copy,
  Download,
  History,
  MessagesSquare,
  Moon,
  MoreHorizontal,
  PanelLeft,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { Link, useLocation } from "wouter";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { CollabEditor, useEditorStats } from "../editor/CollabEditor";
import { Toolbar } from "../editor/Menus";
import { ASK_AI_EVENT } from "../editor/blocks";
import { CHAT_QUOTE_EVENT, selectionQuote, type Quote } from "../editor/chatRefs";
import type { RemoteCursor } from "../editor/cursors";
import { flashRange } from "../editor/highlights";
import { copyText } from "../lib/clipboard";
import { SESSION_ID, useMe } from "../lib/identity";
import { cn, useMediaQuery, useNow } from "../lib/hooks";
import { editorMarkdown } from "../lib/markdown";
import { useCategories } from "../lib/categories";
import { chatPreview } from "../../shared/chat";
import { AiPanel } from "../panels/AiPanel";
import { ChatPanel, useChatUnread, type ChatMessage } from "../panels/ChatPanel";
import { HistoryPanel } from "../panels/HistoryPanel";
import { Avatar, ClaudeAvatar } from "./Avatar";
import { CategoryPicker } from "./CategoryPicker";
import { useShell } from "./Shell";
import { useToast } from "./Toast";
import { takeJustCreated } from "./useCreateDoc";
import { NewStoryDialog } from "../story/stageUi";

const ONLINE_MS = 30_000;
const PANEL_KEY = "dystory.panel";
type Panel = "ai" | "history" | "chat" | null;

function storedPanel(): Panel {
  try {
    const v = localStorage.getItem(PANEL_KEY);
    return v === "ai" || v === "history" || v === "chat" ? v : null;
  } catch {
    return null;
  }
}

/** `embedded`: the Script tab of a story, whose page has its own header around it. */
export function DocPage({ docId: rawId, embedded }: { docId: string; embedded?: boolean }) {
  const doc = useQuery(api.docs.get, { docId: rawId });
  if (doc === undefined) return <div className="h-full" />;
  if (doc === null) {
    return (
      <div className="grid h-full place-items-center p-6 text-center text-muted">
        <div>
          <p className="font-medium text-ink">This document doesn't exist.</p>
          <p className="mt-1 text-sm">It may have been deleted.</p>
        </div>
      </div>
    );
  }
  return <DocView doc={doc} embedded={embedded} />;
}

type DocInfo = NonNullable<ReturnType<typeof useQuery<typeof api.docs.get>>>;

function DocView({ doc, embedded }: { doc: DocInfo; embedded?: boolean }) {
  const docId = doc._id;
  const story = useQuery(api.stories.byDoc, { docId: doc._id });
  const [makingStory, setMakingStory] = useState(false);
  const me = useMe();
  const now = useNow(5_000);
  const toast = useToast();
  const [, navigate] = useLocation();
  const { sidebarOpen, toggleSidebar } = useShell();
  const wide = useMediaQuery("(min-width: 1280px)");
  const [panel, setPanelState] = useState<Panel>(storedPanel);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [aiFocus, setAiFocus] = useState(0);
  const [chatFocus, setChatFocus] = useState(0);
  // What's being written in the chat box about, kept while the panel is closed.
  const [chatQuote, setChatQuote] = useState<Quote | null>(null);
  const [chatReplyTo, setChatReplyTo] = useState<Id<"chatMessages"> | null>(null);
  const [titleVisible, setTitleVisible] = useState(true);

  const online = useQuery(api.presence.online);
  const requests = useQuery(api.ai.listForDoc, { docId });
  const messages = useQuery(api.chat.list, { docId });
  const users = useQuery(api.users.list);
  const heartbeat = useMutation(api.presence.heartbeat);
  const leave = useMutation(api.presence.leave);
  const touch = useMutation(api.docs.touch);
  const setTrashed = useMutation(api.docs.setTrashed);
  const markOpened = useMutation(api.docs.markOpened);
  const markInactive = useMutation(api.docs.markInactive);
  const setCategory = useMutation(api.docs.setCategory);
  const { byId: categoryById, pathLabel } = useCategories();
  const category = doc.categoryId ? categoryById.get(doc.categoryId) : undefined;

  const setPanel = useCallback((p: Panel) => {
    setPanelState(p);
    try {
      localStorage.setItem(PANEL_KEY, p ?? "");
    } catch {}
  }, []);
  const openAi = useCallback(() => {
    setPanel("ai");
    setAiFocus((n) => n + 1);
  }, [setPanel]);
  const openChat = useCallback(() => {
    setPanel("chat");
    setChatFocus((n) => n + 1);
  }, [setPanel]);
  const replyInChat = useCallback(
    (id: Id<"chatMessages">) => {
      setChatReplyTo(id);
      openChat();
    },
    [openChat],
  );
  const { unread, lastRead } = useChatUnread(docId, messages, me._id, panel === "chat");

  // Opening a document keeps it active for another two days.
  useEffect(() => {
    markOpened({ docId }).catch(() => {});
  }, [docId, markOpened]);

  // --- Presence ------------------------------------------------------------
  const cursorRef = useRef<{ anchor: number; head: number } | undefined>(undefined);
  const beatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBeat = useRef(0);
  const sendBeat = useCallback(() => {
    const go = () => {
      beatTimer.current = null;
      lastBeat.current = Date.now();
      heartbeat({ docId, sessionId: SESSION_ID, userId: me._id, cursor: cursorRef.current }).catch(() => {});
    };
    if (beatTimer.current) return;
    beatTimer.current = setTimeout(go, Math.max(0, 250 - (Date.now() - lastBeat.current)));
  }, [docId, me._id, heartbeat]);

  useEffect(() => {
    sendBeat();
    const t = setInterval(sendBeat, 10_000);
    const bye = () => leave({ sessionId: SESSION_ID }).catch(() => {});
    window.addEventListener("pagehide", bye);
    return () => {
      clearInterval(t);
      window.removeEventListener("pagehide", bye);
      if (beatTimer.current) clearTimeout(beatTimer.current);
      beatTimer.current = null;
      bye();
    };
  }, [sendBeat, leave]);

  const onCursor = useCallback(
    (anchor: number, head: number) => {
      cursorRef.current = { anchor, head };
      sendBeat();
    },
    [sendBeat],
  );

  const lastTouch = useRef(0);
  const onLocalEdit = useCallback(() => {
    if (Date.now() - lastTouch.current < 5_000) return;
    lastTouch.current = Date.now();
    touch({ docId, userId: me._id }).catch(() => {});
  }, [docId, me._id, touch]);

  const here = useMemo(
    () => (online ?? []).filter((p) => p.docId === docId && now - p.lastSeen < ONLINE_MS),
    [online, docId, now],
  );
  // Other people only; your own other tabs/devices would just be noise.
  const others = here.filter((p) => p.sessionId !== SESSION_ID && p.userId !== me._id);
  const cursors: RemoteCursor[] = useMemo(
    () =>
      others
        .filter((p) => p.cursor)
        .map((p) => ({ id: p.sessionId, name: p.name, color: p.color, ...p.cursor! })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(others.map((p) => [p.sessionId, p.name, p.color, p.cursor]))],
  );
  const people = [...new Map(others.map((p) => [p.userId, p])).values()];
  const running = requests?.find((r) => r.status === "running");
  const aiBusy = !!running;

  // --- Claude activity: highlight its edits, announce others' requests -----
  useClaudeActivity({ requests, editor, users, meId: me._id, panelOpen: panel === "ai", onOpen: openAi });

  useEffect(() => {
    window.addEventListener(ASK_AI_EVENT, openAi);
    return () => window.removeEventListener(ASK_AI_EVENT, openAi);
  }, [openAi]);

  // --- Chat: notify about messages, discuss the selection -----------------
  useChatActivity({ messages, users, meId: me._id, panelOpen: panel === "chat", onReply: replyInChat });

  useEffect(() => {
    const discuss = () => {
      const quote = editor && selectionQuote(editor);
      if (quote) setChatQuote(quote);
      openChat();
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && e.code === "KeyM") {
        e.preventDefault();
        discuss();
      }
    };
    window.addEventListener(CHAT_QUOTE_EVENT, discuss);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(CHAT_QUOTE_EVENT, discuss);
      window.removeEventListener("keydown", onKey);
    };
  }, [editor, openChat]);

  const togglePanel = (p: Exclude<Panel, null>) => {
    if (panel === p) setPanel(null);
    else if (p === "ai") openAi();
    else if (p === "chat") openChat();
    else setPanel(p);
  };

  const chat: ChatProps = {
    docId,
    editor,
    messages,
    users,
    people,
    typers: others,
    quote: chatQuote,
    onQuote: setChatQuote,
    replyTo: chatReplyTo,
    onReplyTo: setChatReplyTo,
    lastRead,
    focusSignal: chatFocus,
  };

  const moveToTrash = async () => {
    await setTrashed({ docId, trashed: true });
    navigate("/");
    toast({
      message: `Moved “${doc.title || "Untitled"}” to trash`,
      action: {
        label: "Undo",
        run: async () => {
          await setTrashed({ docId, trashed: false });
          navigate(`/d/${docId}`);
        },
      },
    });
  };

  // Leaves the document, since opening it is what makes it active again.
  const goInactive = async () => {
    await markInactive({ docId });
    navigate("/");
    toast({
      message: `Marked “${doc.title || "Untitled"}” inactive`,
      action: { label: "Undo", run: () => navigate(`/d/${docId}`) },
    });
  };

  return (
    <div className="flex h-full">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-1 px-3">
          {!sidebarOpen && !embedded && (
            <button
              onClick={toggleSidebar}
              className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
              aria-label="Show sidebar"
            >
              <PanelLeft size={18} />
            </button>
          )}
          <div
            className={cn(
              "min-w-0 flex-1 truncate px-1 text-sm font-medium text-ink-2 transition-opacity duration-200",
              titleVisible && "opacity-0",
            )}
            aria-hidden={titleVisible}
          >
            {category && <span className="text-muted">{pathLabel(category._id)} / </span>}
            {doc.title || "Untitled"}
          </div>

          <SaveState editor={editor} />

          <div className="mr-1 flex items-center -space-x-1.5">
            {running && <ClaudeAvatar size={28} ring />}
            {people.map((p) => (
              <Avatar key={p.userId} name={p.name} color={p.color} size={28} ring title={`${p.name} is here`} />
            ))}
          </div>

          <button
            onClick={() => togglePanel("chat")}
            aria-label={unread ? `Chat, ${unread} unread` : "Chat"}
            aria-pressed={panel === "chat"}
            className={cn(
              "relative flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium transition",
              panel === "chat" ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2",
            )}
          >
            <MessagesSquare size={16} />
            <span className="hidden sm:inline">Chat</span>
            {unread > 0 && panel !== "chat" && (
              <span
                key={unread}
                className="badge-pop absolute -top-1 -right-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[10px] leading-none font-bold text-bg ring-2 ring-bg"
              >
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </button>
          <button
            onClick={() => togglePanel("ai")}
            aria-label="Claude"
            aria-pressed={panel === "ai"}
            className={cn(
              "relative flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium transition",
              panel === "ai" ? "bg-ai-soft text-ai" : "text-ink-2 hover:bg-surface-2",
            )}
          >
            <Sparkles size={16} className={cn("text-ai", aiBusy && "sparkle-spin")} />
            <span className="hidden sm:inline">Claude</span>
            {aiBusy && panel !== "ai" && (
              <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-ai ring-2 ring-bg" />
            )}
          </button>
          <button
            onClick={() => togglePanel("history")}
            aria-label="History"
            aria-pressed={panel === "history"}
            className={cn(
              "flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium transition",
              panel === "history" ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2",
            )}
          >
            <History size={16} />
            <span className="hidden sm:inline">History</span>
          </button>
          <MoreMenu
            editor={editor}
            title={doc.title}
            onInactive={embedded ? undefined : goInactive}
            onTrash={embedded ? undefined : moveToTrash}
            onMakeStory={story === null ? () => setMakingStory(true) : undefined}
          />
        </header>
        {story && !embedded && (
          <Link
            href={`/s/${story._id}/script`}
            className="flex items-center justify-center gap-2 bg-accent/10 px-4 py-2 text-sm text-accent hover:bg-accent/15"
          >
            <Clapperboard size={15} /> This is the script of “{story.title}”. Open the story to see it in production.
          </Link>
        )}
        {makingStory && <NewStoryDialog docId={docId} title={doc.title} onClose={() => setMakingStory(false)} />}

        {doc.trashed && (
          <div className="flex items-center justify-center gap-3 bg-danger/10 px-4 py-2 text-sm text-danger">
            This document is in the trash.
            <button
              onClick={() => setTrashed({ docId, trashed: false })}
              className="flex items-center gap-1 rounded-lg px-2 py-1 font-medium hover:bg-danger/10"
            >
              <ArchiveRestore size={14} /> Restore
            </button>
          </div>
        )}

        {editor && (
          <div className="shrink-0 border-y border-line bg-bg/80 backdrop-blur">
            <div className="mx-auto max-w-[860px]">
              <Toolbar editor={editor} />
            </div>
          </div>
        )}

        <div className="scroll-thin relative flex-1 overflow-y-auto [scrollbar-gutter:stable]" id="doc-scroll">
          {aiBusy && (
            <div className="pointer-events-none sticky top-3 z-10 -mb-9 flex h-9 justify-center">
              <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm shadow-float">
                <Sparkles size={14} className="sparkle-spin text-ai" />
                <span className="font-medium text-ai">Claude is working on the document…</span>
              </div>
            </div>
          )}
          <div className="mx-auto max-w-[720px] px-5 pt-10 sm:px-8 sm:pt-14">
            <CollabEditor
              docId={docId}
              cursors={cursors}
              onLocalEdit={onLocalEdit}
              onCursor={onCursor}
              onEditor={setEditor}
              header={
                <>
                  <div className="mb-2">
                    <CategoryPicker
                      value={category ? category._id : null}
                      onChange={(categoryId) => setCategory({ docId, categoryId })}
                    />
                  </div>
                  <TitleField
                    docId={docId}
                    title={doc.title}
                    editor={editor}
                    onVisibleChange={setTitleVisible}
                  />
                </>
              }
            />
          </div>
        </div>
        <WordCount editor={editor} />
      </div>

      {panel &&
        (wide ? (
          <aside className="w-[360px] shrink-0 border-l border-line bg-surface">
            <PanelBody
              panel={panel}
              docId={docId}
              doc={doc}
              editor={editor}
              requests={requests}
              aiFocus={aiFocus}
              chat={chat}
              overlay={false}
              onClose={() => setPanel(null)}
            />
          </aside>
        ) : (
          <>
            <div className="fade-in fixed inset-0 z-40 bg-black/25" onClick={() => setPanel(null)} />
            <aside className="panel-slide-in fixed inset-y-0 right-0 z-50 w-[min(400px,100vw)] border-l border-line bg-surface shadow-float">
              <PanelBody
                panel={panel}
                docId={docId}
                doc={doc}
                editor={editor}
                requests={requests}
                aiFocus={aiFocus}
                chat={chat}
                overlay
                onClose={() => setPanel(null)}
              />
            </aside>
          </>
        ))}
    </div>
  );
}

function useClaudeActivity({
  requests,
  editor,
  users,
  meId,
  panelOpen,
  onOpen,
}: {
  requests: Doc<"aiRequests">[] | undefined;
  editor: Editor | null;
  users: Doc<"users">[] | undefined;
  meId: Id<"users">;
  panelOpen: boolean;
  onOpen: () => void;
}) {
  const toast = useToast();
  const mountedAt = useRef(Date.now());
  const flashed = useRef(new Set<string>());
  const announced = useRef(new Set<string>());

  // Highlight each new Claude edit on this screen. The query update can
  // arrive slightly before the edit's steps, so wait a moment.
  useEffect(() => {
    if (!editor) return;
    for (const r of requests ?? []) {
      const e = r.lastEdit;
      if (!e || e.at < mountedAt.current) continue;
      const key = `${r._id}:${e.at}`;
      if (flashed.current.has(key)) continue;
      flashed.current.add(key);
      setTimeout(() => flashRange(editor, e), 400);
    }
  }, [requests, editor]);

  // Tell people when someone else asks Claude something here.
  useEffect(() => {
    for (const r of requests ?? []) {
      if (r._creationTime < mountedAt.current || r.requestedBy === meId) continue;
      if (announced.current.has(r._id)) continue;
      announced.current.add(r._id);
      if (panelOpen) continue;
      const who = users?.find((u) => u._id === r.requestedBy)?.name ?? "Someone";
      const prompt = r.prompt.length > 60 ? `${r.prompt.slice(0, 60)}…` : r.prompt;
      toast(
        { message: `${who} asked Claude: “${prompt}”`, action: { label: "Open", run: onOpen } },
        8000,
      );
    }
  }, [requests, users, meId, panelOpen, onOpen, toast]);
}

/** Pops up a toast when someone else writes in the chat while it's closed. */
function useChatActivity({
  messages,
  users,
  meId,
  panelOpen,
  onReply,
}: {
  messages: ChatMessage[] | undefined;
  users: Doc<"users">[] | undefined;
  meId: Id<"users">;
  panelOpen: boolean;
  onReply: (id: Id<"chatMessages">) => void;
}) {
  const toast = useToast();
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!messages) return;
    // What was already there when the document opened isn't news.
    if (!seen.current) {
      seen.current = new Set(messages.map((m) => m._id));
      return;
    }
    for (const m of messages) {
      if (seen.current.has(m._id)) continue;
      seen.current.add(m._id);
      if (panelOpen || m.authorId === meId || m.deleted) continue;
      const who = users?.find((u) => u._id === m.authorId)?.name ?? "Someone";
      toast(
        {
          message: (
            <>
              <span className="font-semibold">{who}:</span> {chatPreview(m)}
            </>
          ),
          action: { label: "Reply", run: () => onReply(m._id) },
        },
        8000,
      );
    }
  }, [messages, users, meId, panelOpen, onReply, toast]);
}

type ChatProps = Omit<ComponentProps<typeof ChatPanel>, "overlay" | "onClose">;

function PanelBody({
  panel,
  docId,
  doc,
  editor,
  requests,
  aiFocus,
  chat,
  overlay,
  onClose,
}: {
  panel: Exclude<Panel, null>;
  docId: Id<"docs">;
  doc: DocInfo;
  editor: Editor | null;
  requests: Doc<"aiRequests">[] | undefined;
  aiFocus: number;
  chat: ChatProps;
  overlay: boolean;
  onClose: () => void;
}) {
  return (
    <div key={panel} className="panel-in h-full">
      {panel === "ai" ? (
        <AiPanel
          docId={docId}
          conversationStartedAt={doc.conversationStartedAt}
          editor={editor}
          requests={requests}
          focusSignal={aiFocus}
          onClose={onClose}
        />
      ) : panel === "chat" ? (
        <ChatPanel {...chat} overlay={overlay} onClose={onClose} />
      ) : (
        <HistoryPanel docId={docId} onClose={onClose} />
      )}
    </div>
  );
}

function TitleField({
  docId,
  title,
  editor,
  onVisibleChange,
}: {
  docId: Id<"docs">;
  title: string;
  editor: Editor | null;
  onVisibleChange: (visible: boolean) => void;
}) {
  const me = useMe();
  const rename = useMutation(api.docs.rename);
  const [value, setValue] = useState(title);
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Take the server's title unless this person is typing in it.
  useEffect(() => {
    if (!focused) setValue(title);
  }, [title, focused]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  // A document you just created starts with the cursor in its title.
  useEffect(() => {
    if (!title && takeJustCreated(docId)) ref.current?.focus();
  }, [docId, title]);

  // The header repeats the title only once this one has scrolled away.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => onVisibleChange(!!e?.isIntersecting), {
      root: document.getElementById("doc-scroll"),
    });
    io.observe(el);
    return () => io.disconnect();
  }, [onVisibleChange]);

  const save = (v: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => rename({ docId, userId: me._id, title: v.trim() }), 350);
  };

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      placeholder="Untitled"
      aria-label="Title"
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        if (timer.current) clearTimeout(timer.current);
        if (value.trim() !== title) rename({ docId, userId: me._id, title: value.trim() });
      }}
      onChange={(e) => {
        const v = e.target.value.replace(/\n/g, " ");
        setValue(v);
        save(v);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || (e.key === "ArrowDown" && !e.shiftKey)) {
          e.preventDefault();
          editor?.commands.focus("start");
        }
      }}
      className="mb-6 block w-full resize-none overflow-hidden bg-transparent font-serif text-[2.25rem] leading-tight font-semibold tracking-tight outline-none placeholder:text-line-strong sm:text-[2.6rem]"
    />
  );
}

function SaveState({ editor }: { editor: Editor | null }) {
  const stats = useEditorStats(editor);
  if (!stats) return null;
  return (
    <span className="mr-2 hidden shrink-0 items-center gap-1 text-xs text-muted sm:flex" aria-live="polite">
      {stats.unsynced ? (
        <>
          <span className="size-1.5 animate-pulse rounded-full bg-amber-500" /> Saving…
        </>
      ) : (
        <>
          <Check size={12} /> Saved
        </>
      )}
    </span>
  );
}

function WordCount({ editor }: { editor: Editor | null }) {
  const stats = useEditorStats(editor);
  if (!stats || stats.words === 0) return null;
  return (
    <div className="pointer-events-none absolute right-4 bottom-3 hidden rounded-full bg-bg/85 px-3 py-1 text-xs text-muted backdrop-blur md:block">
      {stats.words.toLocaleString()} {stats.words === 1 ? "word" : "words"}
    </div>
  );
}

function MoreMenu({
  editor,
  title,
  onInactive,
  onTrash,
  onMakeStory,
}: {
  editor: Editor | null;
  title: string;
  onInactive?: () => void;
  onTrash?: () => void;
  onMakeStory?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector("button")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const markdown = () => {
    if (!editor) return "";
    const body = editorMarkdown(editor);
    return title ? `# ${title}\n\n${body}\n` : `${body}\n`;
  };

  const item =
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none hover:bg-surface-2 focus-visible:bg-surface-2";
  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen((o) => !o)}
        className="grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-surface-2"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            ref={menuRef}
            role="menu"
            className="absolute top-full right-0 z-50 mt-1 w-56 rounded-xl border border-line bg-surface p-1 shadow-float"
          >
            <button
              role="menuitem"
              className={item}
              onClick={async () => {
                if (await copyText(markdown())) {
                  setCopied(true);
                  setTimeout(() => {
                    setCopied(false);
                    close();
                  }, 900);
                }
              }}
            >
              {copied ? <Check size={16} /> : <Copy size={16} className="text-muted" />}
              {copied ? "Copied" : "Copy as Markdown"}
            </button>
            <button
              role="menuitem"
              className={item}
              onClick={() => {
                const blob = new Blob([markdown()], { type: "text/markdown" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `${(title || "Untitled").replace(/[^\w\- ]+/g, "").trim() || "document"}.md`;
                a.click();
                URL.revokeObjectURL(a.href);
                close();
              }}
            >
              <Download size={16} className="text-muted" /> Download .md
            </button>
            {onMakeStory && (
              <button
                role="menuitem"
                className={item}
                onClick={() => {
                  setOpen(false);
                  onMakeStory();
                }}
              >
                <Clapperboard size={16} className="text-muted" /> Turn into a story
              </button>
            )}
            {(onInactive || onTrash) && <div className="my-1 h-px bg-line" />}
            {onInactive && (
              <button
                role="menuitem"
                className={item}
                onClick={() => {
                  setOpen(false);
                  onInactive();
                }}
              >
                <Moon size={16} className="text-muted" /> Mark inactive
              </button>
            )}
            {onTrash && (
              <button
                role="menuitem"
                className={cn(item, "text-danger")}
                onClick={() => {
                  setOpen(false);
                  onTrash();
                }}
              >
                <Trash2 size={16} /> Move to trash
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
