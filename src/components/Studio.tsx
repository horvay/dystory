import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Clapperboard, Images, NotebookPen, PanelLeft } from "lucide-react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { api } from "../../convex/_generated/api";
import { cn } from "../lib/hooks";
import { useShell } from "./Shell";

export type VideoData = NonNullable<ReturnType<typeof useQuery<typeof api.videos.get>>>;
export type Tab = "review" | "notes" | "images";

/**
 * The video being worked on, which tab is showing, where each tab lives
 * (`paths`) and where each tab link goes back to (`links`, with the version
 * and spot you left). `embedded`: inside a story's page, which has its own
 * title and tabs, so the bar only shows the tab's own controls.
 */
type Studio = {
  video: VideoData;
  tab: Tab;
  paths: Record<Tab, string>;
  links: Record<Tab, string>;
  embedded?: boolean;
};

const StudioCtx = createContext<Studio | null>(null);
export const StudioProvider = StudioCtx.Provider;

export function useStudio(): Studio {
  const studio = useContext(StudioCtx);
  if (!studio) throw new Error("useStudio outside StudioProvider");
  return studio;
}

/**
 * The header every tab shows: back, title, the tabs, and the tab's own
 * actions. `left` sits next to the title (the version menu on Review).
 */
export function StudioBar({ left, children }: { left?: ReactNode; children?: ReactNode }) {
  const { video, embedded } = useStudio();
  const { sidebarOpen, toggleSidebar } = useShell();
  const rename = useMutation(api.videos.rename);
  const [title, setTitle] = useState(video.title);
  useEffect(() => setTitle(video.title), [video.title]);

  if (embedded) {
    if (!left && !children) return null;
    return (
      <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-line bg-surface px-2 sm:gap-2 sm:px-3">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">{left}</div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">{children}</div>
      </div>
    );
  }

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-1.5 border-b border-line bg-surface px-2 sm:gap-2 sm:px-3">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
          {!sidebarOpen && (
            <button
              onClick={toggleSidebar}
              className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
              aria-label="Show sidebar"
            >
              <PanelLeft size={18} />
            </button>
          )}
          <Link
            href="/reviews"
            aria-label="All reviews"
            className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
          >
            <ArrowLeft size={18} />
          </Link>
          <input
            value={title}
            aria-label="Title"
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() !== video.title && rename({ videoId: video._id, title })}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="h-9 min-w-0 flex-1 truncate rounded-lg bg-transparent px-2 font-semibold outline-none hover:bg-surface-2 focus:bg-surface-2 sm:max-w-md"
          />
          {left}
        </div>
        <TabSwitch className="hidden w-[22rem] lg:grid" />
        <div className="flex shrink-0 items-center justify-end gap-1.5 sm:gap-2 lg:flex-1">
          {children}
        </div>
      </header>
      <div className="shrink-0 border-b border-line bg-surface px-2 py-1.5 lg:hidden">
        <TabSwitch />
      </div>
    </>
  );
}

function TabSwitch({ className }: { className?: string }) {
  const { video, tab, links } = useStudio();
  const open = video.versions[video.versions.length - 1]?.openNotes ?? 0;
  const tabs: [Tab, string, typeof Clapperboard, number, string][] = [
    ["review", "Review", Clapperboard, open, `${open} open comment${open === 1 ? "" : "s"}`],
    ["notes", "Notes", NotebookPen, video.noteCount, `${video.noteCount} note${video.noteCount === 1 ? "" : "s"}`],
    ["images", "Images", Images, video.imageCount, `${video.imageCount} image${video.imageCount === 1 ? "" : "s"}`],
  ];
  return (
    <nav className={cn("grid grid-cols-3 gap-0.5 rounded-xl bg-surface-2 p-0.5", className)}>
      {tabs.map(([id, label, Icon, count, hint]) => (
        <Link
          key={id}
          href={links[id]}
          aria-current={tab === id ? "page" : undefined}
          className={cn(
            "flex h-8 items-center justify-center gap-1.5 rounded-[10px] px-2 text-sm font-medium transition-colors",
            tab === id ? "bg-surface text-ink shadow-soft" : "text-muted hover:text-ink",
          )}
        >
          <Icon size={15} className="shrink-0" />
          {label}
          {count > 0 && (
            <span title={hint} className="text-xs text-muted tabular-nums">
              {count}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
