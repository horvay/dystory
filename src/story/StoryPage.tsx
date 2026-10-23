import { useMutation, useQuery } from "convex/react";
import { ArchiveRestore, ChevronDown, MessageSquarePlus, MoreHorizontal, PanelLeft, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { api } from "../../convex/_generated/api";
import { DocPage } from "../components/DocPage";
import { Modal } from "../components/Modal";
import { Popover } from "../components/Popover";
import { useShell } from "../components/Shell";
import type { Tab, VideoData } from "../components/Studio";
import { useToast } from "../components/Toast";
import { StudioTabs } from "../components/VideoPage";
import { cn, useMediaQuery } from "../lib/hooks";
import { timecode } from "../lib/time";
import { STAGES, stageIndex, stageInfo, type StageId } from "../../shared/stages";
import { AnchorsProvider } from "./anchors";
import { DecisionBar } from "./DecisionBar";
import { StageRail } from "./StageRail";
import { STATE_TONE } from "./stageUi";
import { scrollToStage, Thread } from "./Thread";

export type StoryData = NonNullable<ReturnType<typeof useQuery<typeof api.stories.get>>>;
export type StoryView = "thread" | "script" | Tab;
const VIEWS: StoryView[] = ["thread", "script", "review", "images", "notes"];

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
  const view = VIEWS.includes(tab as StoryView) ? (tab as StoryView) : story.stage === "script" ? "script" : "thread";
  return (
    <AnchorsProvider>
      <StoryLayout story={story} view={view} item={item} />
    </AnchorsProvider>
  );
}

/**
 * The stages down the left, the thread (or a breakout: script, cuts, images,
 * notes) in the middle, and the decision bar with the message box at the bottom.
 */
function StoryLayout({ story, view, item }: { story: StoryData; view: StoryView; item?: string }) {
  const video = useQuery(api.videos.get, { videoId: story.videoId });
  const { sidebarOpen, toggleSidebar } = useShell();
  const wide = useMediaQuery("(min-width: 900px)");
  const [, navigate] = useLocation();
  const base = `/s/${story._id}`;
  const paths = { review: `${base}/review`, images: `${base}/images`, notes: `${base}/notes` };
  const counts = { images: video?.imageCount, notes: video?.noteCount };

  const onStage = (stage: StageId) => {
    if (stage === "script") return navigate(`${base}/script`);
    if (view !== "thread") navigate(`${base}/thread`);
    setTimeout(() => scrollToStage(stage), view === "thread" ? 0 : 120);
  };

  return (
    <div className="flex h-full flex-col">
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
        {!wide && <StagePill story={story} view={view} counts={counts} onStage={onStage} />}
        <StoryMenu story={story} />
      </header>
      {story.trashed && <TrashedBanner story={story} />}
      <div className="flex min-h-0 flex-1">
        {wide && (
          <aside className="w-56 shrink-0 border-r border-line bg-surface">
            <StageRail story={story} view={view} counts={counts} onStage={onStage} />
          </aside>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 flex-col">
            {view === "thread" ? (
              <Thread story={story} />
            ) : view === "script" ? (
              <DocPage docId={story.docId} embedded />
            ) : video ? (
              <StudioTabs video={video as VideoData} tab={view} item={item} paths={paths} embedded />
            ) : (
              <div className="h-full" />
            )}
          </div>
          <DecisionBar story={story} composer={view === "thread"} />
        </div>
      </div>
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

/** On a narrow screen the stage rail folds into this: where the story is, and the rail on tap. */
function StagePill({
  story,
  view,
  counts,
  onStage,
}: {
  story: StoryData;
  view: StoryView;
  counts: { images?: number; notes?: number };
  onStage: (stage: StageId) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const steps = STAGES.length - 1;
  const n = Math.min(stageIndex(story.stage) + 1, steps);
  const tone = STATE_TONE[story.state];
  return (
    <>
      <button
        ref={ref}
        onClick={() => setOpen((o) => !o)}
        className={cn("flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold", tone.chip)}
      >
        <span className={cn("size-1.5 rounded-full", tone.dot)} />
        {story.stage === "done" ? "Published" : `${stageInfo(story.stage).label} · ${n}/${steps}`}
        <ChevronDown size={13} />
      </button>
      {open && (
        <Popover anchor={ref} onClose={() => setOpen(false)} placement="bottom-end" className="h-[min(560px,75vh)] w-64 overflow-hidden">
          <StageRail
            story={story}
            view={view}
            counts={counts}
            onStage={(s) => {
              setOpen(false);
              onStage(s);
            }}
          />
        </Popover>
      )}
    </>
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
  const newSession = useMutation(api.turns.newSession);
  const [open, setOpen] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
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
            className={item}
            onClick={() => {
              setOpen(false);
              setConfirmNew(true);
            }}
          >
            <MessageSquarePlus size={16} /> New director session…
          </button>
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
      {confirmNew && (
        <Modal onClose={() => setConfirmNew(false)} className="max-w-md">
          <div className="p-5">
            <h2 className="font-semibold">Start the director on a fresh session?</h2>
            <p className="mt-1 text-sm text-muted">
              It forgets this conversation and catches up from the story's folder and README. The thread stays.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setConfirmNew(false)} className="h-9 rounded-xl px-4 text-sm hover:bg-surface-2">
                Cancel
              </button>
              <button
                onClick={async () => {
                  setConfirmNew(false);
                  await newSession({ storyId: story._id });
                  toast({ message: "The director starts fresh on its next turn." });
                }}
                className="h-9 rounded-xl bg-ink px-4 text-sm font-medium text-bg"
              >
                New session
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
