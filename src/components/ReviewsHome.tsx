import { useMutation, useQuery } from "convex/react";
import { Film, MoreHorizontal, PanelLeft, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { cn, useFileDrag } from "../lib/hooks";
import { useMe } from "../lib/identity";
import { relativeTime, timecode } from "../lib/time";
import { DropOverlay } from "./DropOverlay";
import { Modal } from "./Modal";
import { useShell } from "./Shell";
import { useToast } from "./Toast";
import { useUploads } from "./Uploads";

type Video = Doc<"videos"> & {
  openNotes: number;
  notes: number;
  imageCount: number;
  noteCount: number;
  coverThumb?: string;
};

/** Plain reviews: cuts of news segments, clips and anything else that isn't a story. */
export function ReviewsHome() {
  const videos = useQuery(api.videos.list);
  const { sidebarOpen, toggleSidebar } = useShell();
  const { start } = useUploads();
  const fileInput = useRef<HTMLInputElement>(null);
  const dragging = useFileDrag((files) => start(files, { kind: "new" }));
  const pick = () => fileInput.current?.click();
  const [creating, setCreating] = useState(false);

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
          {!sidebarOpen && (
            <button
              onClick={toggleSidebar}
              className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
              aria-label="Show sidebar"
            >
              <PanelLeft size={18} />
            </button>
          )}
          <h1 className="font-semibold tracking-tight">Reviews</h1>
          <span className="hidden text-sm text-muted md:inline">News segments, clips and other cuts. Stories keep theirs on their own page.</span>
          <div className="flex-1" />
          <button
            onClick={pick}
            title="Upload a cut as a new video"
            className="flex h-9 items-center gap-2 rounded-xl px-3 text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"
          >
            <Upload size={16} /> <span className="hidden sm:inline">Upload</span>
          </button>
          <button
            onClick={() => setCreating(true)}
            title="Start a video with notes and images, before there's a cut"
            className="flex h-9 items-center gap-2 rounded-xl bg-ink px-3.5 text-sm font-medium text-bg hover:opacity-90"
          >
            <Plus size={16} /> New video
          </button>
        </div>
      </header>
      <input
        ref={fileInput}
        type="file"
        accept="video/*,.mp4,.mov,.m4v"
        multiple
        hidden
        onChange={(e) => {
          start([...(e.target.files ?? [])], { kind: "new" });
          e.target.value = "";
        }}
      />

      <main className="mx-auto max-w-7xl px-4 py-6">
        {videos === undefined ? (
          <p className="py-20 text-center text-muted">Loading…</p>
        ) : videos.length === 0 ? (
          <div className="mx-auto mt-10 flex w-full max-w-xl flex-col items-center rounded-3xl border-2 border-dashed border-line-strong px-6 py-14 text-center">
            <Film size={32} className="text-muted" />
            <p className="mt-4 text-lg font-semibold">Start your first video</p>
            <p className="mt-1 max-w-sm text-sm text-muted">
              Begin with notes and reference images, or drop a cut (MP4) anywhere on this page to review it.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => setCreating(true)}
                className="flex h-9 items-center gap-2 rounded-xl bg-ink px-3.5 text-sm font-medium text-bg hover:opacity-90"
              >
                <Plus size={16} /> New video
              </button>
              <button
                onClick={pick}
                className="flex h-9 items-center gap-2 rounded-xl border border-line px-3.5 text-sm font-medium hover:bg-surface-2"
              >
                <Upload size={16} /> Upload a cut
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-x-5 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {videos.map((v) => (
              <VideoCard key={v._id} video={v} />
            ))}
          </div>
        )}
      </main>

      {dragging && <DropOverlay label="Drop to upload" />}
      {creating && <NewVideoDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function VideoCard({ video }: { video: Video }) {
  const setTrashed = useMutation(api.videos.setTrashed);
  const toast = useToast();
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [thumbOk, setThumbOk] = useState(true);
  const cover = video.latestFileId
    ? `/media/thumbs/${video.latestFileId}.jpg`
    : video.coverThumb && `/media/images/${video.coverThumb}`;
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);

  return (
    <div className="group relative">
      <Link href={`/v/${video._id}`} className="block">
        <div className="relative aspect-video overflow-hidden rounded-2xl bg-[#0b0b0c] shadow-soft ring-1 ring-line transition group-hover:shadow-float">
          {cover && thumbOk ? (
            <img
              src={cover}
              alt=""
              loading="lazy"
              onError={() => setThumbOk(false)}
              className={cn(
                "size-full transition duration-300 group-hover:scale-[1.02]",
                video.latestFileId ? "object-contain" : "object-cover opacity-80",
              )}
            />
          ) : (
            <Film size={28} className="absolute inset-0 m-auto text-white/30" />
          )}
          {video.latestDuration !== undefined ? (
            <span className="absolute right-2 bottom-2 rounded-md bg-black/75 px-1.5 py-0.5 font-mono text-[11px] text-white">
              {timecode(video.latestDuration)}
            </span>
          ) : (
            <span className="absolute right-2 bottom-2 rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white">
              No cut yet
            </span>
          )}
          {video.latestVersion > 1 && (
            <span className="absolute top-2 left-2 rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] font-semibold text-white">
              v{video.latestVersion}
            </span>
          )}
          {video.openNotes > 0 && (
            <span className="absolute top-2 right-2 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-white">
              {video.openNotes} open
            </span>
          )}
        </div>
        <p className="mt-2.5 truncate pr-8 font-medium">{video.title}</p>
        <p className="truncate text-sm text-muted">
          {[
            video.latestVersion > 0 && (video.notes === 0 ? "No comments" : plural(video.notes, "comment")),
            video.noteCount > 0 && plural(video.noteCount, "note"),
            video.imageCount > 0 && plural(video.imageCount, "image"),
            `updated ${relativeTime(video.updatedAt)}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </Link>

      <div ref={menuRef} className="absolute right-0 bottom-6">
        <button
          onClick={() => setMenu((m) => !m)}
          aria-label="Video options"
          className={cn(
            "grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink",
            !menu && "sm:opacity-0 sm:group-hover:opacity-100",
          )}
        >
          <MoreHorizontal size={17} />
        </button>
        {menu && (
          <div className="absolute right-0 bottom-full z-20 mb-1 w-40 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-float">
            <button
              onClick={() => {
                setMenu(false);
                setRenaming(true);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-2"
            >
              <Pencil size={14} /> Rename
            </button>
            <button
              onClick={() => {
                setMenu(false);
                void setTrashed({ videoId: video._id, trashed: true });
                toast({
                  message: `Deleted "${video.title}"`,
                  action: { label: "Undo", run: () => void setTrashed({ videoId: video._id, trashed: false }) },
                });
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-danger hover:bg-surface-2"
            >
              <Trash2 size={14} /> Delete
            </button>
          </div>
        )}
      </div>
      {renaming && <RenameDialog video={video} onClose={() => setRenaming(false)} />}
    </div>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function NewVideoDialog({ onClose }: { onClose: () => void }) {
  const me = useMe();
  const create = useMutation(api.videos.createEmpty);
  const [, navigate] = useLocation();
  const [title, setTitle] = useState("");
  return (
    <Modal onClose={onClose} className="max-w-sm">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const id = await create({ userId: me._id, title });
          onClose();
          navigate(`/v/${id}`);
        }}
        className="p-5"
      >
        <h2 className="font-semibold">New video</h2>
        <p className="mt-1 mb-3 text-sm text-muted">Collect notes and images now, upload cuts when you have them.</p>
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
          <button className="h-9 rounded-xl bg-ink px-4 text-sm font-medium text-bg">Create</button>
        </div>
      </form>
    </Modal>
  );
}

function RenameDialog({ video, onClose }: { video: Video; onClose: () => void }) {
  const rename = useMutation(api.videos.rename);
  const [title, setTitle] = useState(video.title);
  return (
    <Modal onClose={onClose} className="max-w-sm">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await rename({ videoId: video._id, title });
          onClose();
        }}
        className="p-5"
      >
        <h2 className="mb-3 font-semibold">Rename video</h2>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={(e) => e.target.select()}
          className="h-10 w-full rounded-xl border border-line bg-bg px-3 outline-none focus:border-accent"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-xl px-4 text-sm hover:bg-surface-2">
            Cancel
          </button>
          <button className="h-9 rounded-xl bg-ink px-4 text-sm font-medium text-bg">Save</button>
        </div>
      </form>
    </Modal>
  );
}
