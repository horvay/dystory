import { useMutation, useQuery } from "convex/react";
import {
  ArchiveRestore,
  Check,
  Clapperboard,
  FileText,
  Images,
  LoaderCircle,
  MoreHorizontal,
  NotebookPen,
  PanelLeft,
  Send,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { api } from "../../convex/_generated/api";
import { DocPage } from "../components/DocPage";
import { Popover } from "../components/Popover";
import { useShell } from "../components/Shell";
import type { Tab, VideoData } from "../components/Studio";
import { useToast } from "../components/Toast";
import { StudioTabs } from "../components/VideoPage";
import { cn, useMediaQuery, useNow } from "../lib/hooks";
import { timecode } from "../lib/time";
import { STAGES, stageIndex, stageInfo, type StageId } from "../../shared/stages";
import { DirectorPanel } from "./DirectorPanel";
import { STATE_LABEL, STATE_TONE, StageMoveDialog } from "./stageUi";

export type StoryData = NonNullable<ReturnType<typeof useQuery<typeof api.stories.get>>>;
type StoryTab = "script" | Tab;
const TABS: StoryTab[] = ["script", "review", "images", "notes"];
const PANEL_KEY = "dystory.directorPanel";

export function StoryPage({ storyId, tab, item }: { storyId: string; tab?: string; item?: string }) {
  const story = useQuery(api.stories.get, { storyId });
  if (story === undefined) return <div className="h-full" />;
  if (story === null) {
    return (
      <div className="grid h-full place-items-center p-6 text-center text-muted">
        <div>
          <p className="font-medium text-ink">This story doesn't exist.</p>
          <Link href="/" className="mt-2 inline-block text-sm text-accent">
            Back home
          </Link>
        </div>
      </div>
    );
  }
  const current = TABS.includes(tab as StoryTab) ? (tab as StoryTab) : story.stage === "script" ? "script" : "review";
  return <StoryView story={story} tab={current} item={item} />;
}

function StoryView({ story, tab, item }: { story: StoryData; tab: StoryTab; item?: string }) {
  const video = useQuery(api.videos.get, { videoId: story.videoId });
  const { sidebarOpen, toggleSidebar } = useShell();
  const wide = useMediaQuery("(min-width: 1280px)");
  const [panelOpen, setPanelOpen] = useState(() => {
    try {
      return localStorage.getItem(PANEL_KEY) !== "closed";
    } catch {
      return true;
    }
  });
  const [focus, setFocus] = useState(0);
  const setPanel = useCallback((open: boolean) => {
    setPanelOpen(open);
    try {
      localStorage.setItem(PANEL_KEY, open ? "open" : "closed");
    } catch {}
  }, []);
  const openPanel = useCallback(() => {
    setPanel(true);
    setFocus((n) => n + 1);
  }, [setPanel]);
  // On a narrow screen the panel is a drawer, closed until asked for.
  const [drawer, setDrawer] = useState(false);
  const showPanel = wide ? panelOpen : drawer;
  const togglePanel = () => (wide ? setPanel(!panelOpen) : setDrawer((d) => !d));

  const base = `/s/${story._id}`;
  const paths = { review: `${base}/review`, images: `${base}/images`, notes: `${base}/notes` };

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-1.5 border-b border-line bg-surface px-2 sm:px-3">
          {!sidebarOpen && (
            <button
              onClick={toggleSidebar}
              className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
              aria-label="Show sidebar"
            >
              <PanelLeft size={18} />
            </button>
          )}
          <TitleInput story={story} />
          <button
            onClick={togglePanel}
            aria-pressed={showPanel}
            className={cn(
              "relative flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium transition",
              showPanel ? "bg-accent/12 text-accent" : "text-ink-2 hover:bg-surface-2",
            )}
          >
            <Clapperboard size={16} className="text-accent" />
            <span className="hidden sm:inline">Director</span>
            {(story.busy || story.state === "waiting") && !showPanel && (
              <span
                className={cn(
                  "absolute top-1.5 right-1.5 size-2 rounded-full ring-2 ring-surface",
                  story.state === "waiting" ? "bg-amber-500" : "bg-accent",
                )}
              />
            )}
          </button>
          <StoryMenu story={story} />
        </header>
        <StageTrack story={story} className="flex border-b border-line bg-surface px-3 py-1.5" />
        {story.trashed && <TrashedBanner story={story} />}
        <StatusBar story={story} onOpenDirector={openPanel} />
        <nav className="flex h-11 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line bg-surface px-2 no-scrollbar">
          <TabLink href={base + "/script"} active={tab === "script"} icon={FileText} label="Script" />
          <TabLink
            href={paths.review}
            active={tab === "review"}
            icon={Clapperboard}
            label="Review"
            count={story.openComments}
            hint="open comments on the latest cut"
          />
          <TabLink href={paths.images} active={tab === "images"} icon={Images} label="Images" count={video?.imageCount} />
          <TabLink href={paths.notes} active={tab === "notes"} icon={NotebookPen} label="Notes" count={video?.noteCount} />
        </nav>
        <div className="relative min-h-0 flex-1">
          {tab === "script" ? (
            <DocPage docId={story.docId} embedded />
          ) : video ? (
            <StudioTabs video={video as VideoData} tab={tab} item={item} paths={paths} embedded />
          ) : (
            <div className="h-full" />
          )}
        </div>
      </div>
      {showPanel &&
        (wide ? (
          <aside className="w-[380px] shrink-0 border-l border-line bg-surface">
            <DirectorPanel story={story} focusSignal={focus} onClose={() => setPanel(false)} />
          </aside>
        ) : (
          <>
            <div className="fade-in fixed inset-0 z-40 bg-black/25" onClick={() => setDrawer(false)} />
            <aside className="panel-slide-in fixed inset-y-0 right-0 z-50 w-[min(420px,100vw)] border-l border-line bg-surface shadow-float">
              <DirectorPanel story={story} focusSignal={focus} onClose={() => setDrawer(false)} />
            </aside>
          </>
        ))}
    </div>
  );
}

function TitleInput({ story }: { story: StoryData }) {
  const rename = useMutation(api.stories.rename);
  const [title, setTitle] = useState(story.title);
  useEffect(() => setTitle(story.title), [story.title]);
  return (
    <input
      value={title}
      aria-label="Story title"
      onChange={(e) => setTitle(e.target.value)}
      onBlur={() => title.trim() !== story.title && rename({ storyId: story._id, title })}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className="h-9 min-w-0 flex-1 truncate rounded-lg bg-transparent px-2 font-semibold outline-none hover:bg-surface-2 focus:bg-surface-2 sm:max-w-md"
    />
  );
}

function TabLink({
  href,
  active,
  icon: Icon,
  label,
  count,
  hint,
}: {
  href: string;
  active: boolean;
  icon: typeof FileText;
  label: string;
  count?: number;
  hint?: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors",
        active ? "bg-surface-2 text-ink" : "text-muted hover:text-ink",
      )}
    >
      <Icon size={15} />
      {label}
      {!!count && (
        <span className="text-xs text-muted tabular-nums" title={hint ? `${count} ${hint}` : undefined}>
          {count}
        </span>
      )}
    </Link>
  );
}

/** The stages as a row of steps; clicking one offers to move the story there. */
function StageTrack({ story, className }: { story: StoryData; className?: string }) {
  const at = stageIndex(story.stage);
  const [pick, setPick] = useState<StageId | null>(null);
  const [menu, setMenu] = useState<StageId | null>(null);
  const refs = useRef(new Map<StageId, HTMLButtonElement>());
  const anchor = useRef<HTMLButtonElement | null>(null);
  const steps = STAGES.filter((s) => s.id !== "done");
  return (
    <div className={cn("min-w-0 items-center", className)}>
      <ol className="no-scrollbar flex min-w-0 items-center gap-0.5 overflow-x-auto">
        {steps.map((s, i) => {
          const done = i < at || story.stage === "done";
          const current = s.id === story.stage;
          return (
            <li key={s.id} className="flex shrink-0 items-center">
              {i > 0 && <span className={cn("mx-0.5 h-px w-2.5", done || current ? "bg-ink-2" : "bg-line-strong")} />}
              <button
                ref={(el) => {
                  if (el) refs.current.set(s.id, el);
                }}
                onClick={() => {
                  anchor.current = refs.current.get(s.id) ?? null;
                  setMenu(s.id);
                }}
                title={`${s.label}: ${s.hint}`}
                className={cn(
                  "flex h-7 items-center gap-1 rounded-full px-2 text-xs font-medium transition",
                  current
                    ? cn(STATE_TONE[story.state].chip, "ring-1 ring-current/20")
                    : done
                      ? "text-ink-2 hover:bg-surface-2"
                      : "text-muted hover:bg-surface-2 hover:text-ink-2",
                )}
              >
                {done ? (
                  <Check size={12} className="shrink-0" />
                ) : current ? (
                  <span className={cn("size-1.5 shrink-0 rounded-full", STATE_TONE[story.state].dot)} />
                ) : null}
                {s.label}
              </button>
            </li>
          );
        })}
      </ol>
      {menu && (
        <Popover anchor={anchor} onClose={() => setMenu(null)} className="w-64 p-1">
          <div className="px-2.5 pt-1.5 pb-1 text-xs text-muted">{stageInfo(menu).hint}</div>
          {menu !== story.stage ? (
            <button
              onClick={() => {
                setPick(menu);
                setMenu(null);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surface-2"
            >
              {stageIndex(menu) < at ? "Move the story back here…" : "Skip ahead to here…"}
            </button>
          ) : (
            <p className="px-2.5 py-2 text-sm text-ink-2">The story is here now.</p>
          )}
        </Popover>
      )}
      {pick && <StageMoveDialog story={story} to={pick} onClose={() => setPick(null)} />}
    </div>
  );
}

/** Where the story stands and what you can do about it: approve, answer, send feedback now. */
function StatusBar({ story, onOpenDirector }: { story: StoryData; onOpenDirector: () => void }) {
  const pending = useQuery(api.feedback.pending, { storyId: story._id });
  const sendNow = useMutation(api.feedback.sendNow);
  const [approving, setApproving] = useState(false);
  const now = useNow(1_000);
  const tone = STATE_TONE[story.state];
  const stage = stageInfo(story.stage);

  let text: ReactNode;
  let action: ReactNode = null;
  if (story.stage === "script") {
    text = "Write the script with Claude. When it's ready, put it into production.";
    action = (
      <ActionButton onClick={() => setApproving(true)} primary>
        Start production
      </ActionButton>
    );
  } else if (story.state === "done") {
    text = "Published.";
  } else if (story.state === "review") {
    text = story.statusLine || `${stage.label} is ready for review.`;
    action = (
      <ActionButton onClick={() => setApproving(true)} primary>
        Approve {stage.label}
      </ActionButton>
    );
  } else if (story.state === "waiting") {
    text = story.statusLine || "The director is waiting for you.";
    action = (
      <>
        <ActionButton onClick={onOpenDirector}>Answer</ActionButton>
        <ActionButton onClick={() => setApproving(true)}>Approve {stage.label}</ActionButton>
      </>
    );
  } else {
    text = story.statusLine || (story.busy ? "The director is working." : story.jobs.length ? (story.jobs.find((j) => j.queue)?.queue ?? "Waiting on a background job.") : "Queued.");
  }

  const due = pending?.dueAt ? Math.max(0, pending.dueAt - now) : null;
  return (
    <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-bg px-3 py-1.5 text-sm">
      <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold", tone.chip)}>
        {story.state === "working" && story.busy ? (
          <LoaderCircle size={12} className="animate-spin" />
        ) : (
          <span className={cn("size-1.5 rounded-full", tone.dot)} />
        )}
        {story.stage === "script" ? "Script" : `${stage.label} · ${STATE_LABEL[story.state]}`}
      </span>
      <span className="min-w-0 flex-1 truncate text-ink-2" title={typeof text === "string" ? text : undefined}>
        {text}
      </span>
      {!!pending?.count && (
        <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
          {pending.count === 1 ? "1 new comment goes" : `${pending.count} new comments go`} to the director
          {due !== null && ` in ${timecode(due / 1000)}`}
          <button
            onClick={() => sendNow({ storyId: story._id })}
            className="flex h-7 items-center gap-1 rounded-lg border border-line px-2 font-medium text-ink hover:bg-surface-2"
          >
            <Send size={12} /> Send now
          </button>
        </span>
      )}
      {action && <span className="flex shrink-0 items-center gap-2">{action}</span>}
      {approving && <StageMoveDialog story={story} onClose={() => setApproving(false)} />}
    </div>
  );
}

function ActionButton({ onClick, primary, children }: { onClick: () => void; primary?: boolean; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-8 rounded-lg px-3 text-xs font-semibold transition",
        primary ? "bg-ink text-bg hover:opacity-90" : "border border-line text-ink hover:bg-surface-2",
      )}
    >
      {children}
    </button>
  );
}

function TrashedBanner({ story }: { story: StoryData }) {
  const setTrashed = useMutation(api.stories.setTrashed);
  return (
    <div className="flex items-center justify-center gap-3 bg-danger/10 px-4 py-2 text-sm text-danger">
      This story is in the trash.
      <button
        onClick={() => setTrashed({ storyId: story._id, trashed: false })}
        className="flex items-center gap-1 rounded-lg px-2 py-1 font-medium hover:bg-danger/10"
      >
        <ArchiveRestore size={14} /> Restore
      </button>
    </div>
  );
}

function StoryMenu({ story }: { story: StoryData }) {
  const setTrashed = useMutation(api.stories.setTrashed);
  const toast = useToast();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const item = "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surface-2";
  return (
    <>
      <button
        ref={ref}
        onClick={() => setOpen((o) => !o)}
        className="grid size-9 shrink-0 place-items-center rounded-lg text-ink-2 hover:bg-surface-2"
        aria-label="More"
      >
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <Popover anchor={ref} onClose={() => setOpen(false)} placement="bottom-end" className="w-60 p-1">
          <div className="px-2.5 py-1.5 text-xs text-muted">
            Folder: <span className="font-mono">short-stories/{story.slug}</span>
            {story.latestDuration ? ` · latest cut ${timecode(story.latestDuration)}` : ""}
          </div>
          <div className="my-1 h-px bg-line" />
          <button
            className={cn(item, "text-danger")}
            onClick={async () => {
              setOpen(false);
              await setTrashed({ storyId: story._id, trashed: true });
              navigate("/");
              toast({
                message: `Moved “${story.title}” to trash. Its background jobs were stopped.`,
                action: { label: "Undo", run: () => void setTrashed({ storyId: story._id, trashed: false }) },
              });
            }}
          >
            <Trash2 size={16} /> Move to trash
          </button>
        </Popover>
      )}
    </>
  );
}
