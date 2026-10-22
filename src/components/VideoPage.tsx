import { useMutation, useQuery } from "convex/react";
import {
  Check,
  ChevronDown,
  Clapperboard,
  Download,
  Images,
  Keyboard,
  MoveUpRight,
  NotebookPen,
  PenLine,
  Square,
  Undo2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { ImagesTab } from "../images/ImagesTab";
import { cn, useFileDrag, useMediaQuery } from "../lib/hooks";
import { useMe } from "../lib/identity";
import { bytes, relativeTime, timecode } from "../lib/time";
import { NotesTab } from "../notes/NotesTab";
import { CommentsPanel, Composer, type ComposerHandle, type Range } from "../player/Comments";
import { DRAW_COLORS, type Shape, type Tool } from "../player/Drawing";
import { Playback } from "../player/playback";
import { Player, type Marker } from "../player/Player";
import { DropOverlay } from "./DropOverlay";
import { DICTATE_SHORTCUT } from "./MicButton";
import { Modal } from "./Modal";
import { StudioBar, StudioProvider, useStudio, type Tab, type VideoData } from "./Studio";
import { useToast } from "./Toast";
import { stageInfo } from "../../shared/stages";
import { useUploads } from "./Uploads";

type Comment = Doc<"comments">;

export function VideoPage({ videoId, tab, item }: { videoId: string; tab?: string; item?: string }) {
  const video = useQuery(api.videos.get, { videoId });
  const [, navigate] = useLocation();
  const search = useSearch();
  // A story's cuts live on the story's page.
  useEffect(() => {
    if (video?.storyId) navigate(`/s/${video.storyId}/${tab ?? "review"}${item ? `/${item}` : ""}${search ? `?${search}` : ""}`, { replace: true });
  }, [video?.storyId, tab, item, search, navigate]);
  if (video === undefined || video?.storyId) return <div className="grid h-full place-items-center text-muted">Loading…</div>;
  if (video === null) {
    return (
      <div className="grid h-full place-items-center text-center">
        <div>
          <p className="font-medium">This video doesn't exist (anymore).</p>
          <Link href="/reviews" className="mt-2 inline-block text-sm text-accent">
            Back to all reviews
          </Link>
        </div>
      </div>
    );
  }
  const base = `/v/${video._id}`;
  return (
    <StudioTabs
      video={video}
      tab={tab === "notes" || tab === "images" ? tab : "review"}
      item={item}
      paths={{ review: base, notes: `${base}/notes`, images: `${base}/images` }}
    />
  );
}

/** A video's Review, Notes and Images tabs, on its own page or inside a story's. */
export function StudioTabs({
  video,
  tab,
  item,
  paths,
  embedded,
}: {
  video: VideoData;
  tab: Tab;
  item?: string;
  paths: Record<Tab, string>;
  embedded?: boolean;
}) {
  const [location] = useLocation();
  const search = useSearch();
  // Each tab link goes back to where you were on that tab (the version and
  // spot on Review, the open note on Notes).
  const [links, setLinks] = useState<Record<Tab, string>>(paths);
  const here = location + (search ? `?${search}` : "");
  if (links[tab] !== here && here.startsWith(paths[tab])) setLinks({ ...links, [tab]: here });
  // Review stays mounted once opened, so a look at the notes doesn't lose your place in the video.
  const [reviewOpened, setReviewOpened] = useState(tab === "review");
  if (tab === "review" && !reviewOpened) setReviewOpened(true);

  return (
    <StudioProvider value={{ video, tab, paths, links, embedded }}>
      {reviewOpened && (
        <div className={cn("h-full", tab !== "review" && "hidden")}>
          {video.versions.length ? (
            <Review video={video} active={tab === "review"} search={links.review.split("?")[1] ?? ""} />
          ) : (
            <FirstCut active={tab === "review"} />
          )}
        </div>
      )}
      {tab === "notes" && <NotesTab noteId={item} />}
      {tab === "images" && <ImagesTab imageId={item} />}
    </StudioProvider>
  );
}

/** What the director said about a cut it posted. */
function CutSummary({ version }: { version: VideoData["versions"][number] }) {
  const [open, setOpen] = useState(false);
  const text = version.summary!;
  const long = text.length > 160 || text.includes("\n");
  return (
    <div className="flex shrink-0 items-start gap-2 border-b border-line bg-accent/6 px-3 py-2 text-sm">
      <Clapperboard size={15} className="mt-0.5 shrink-0 text-accent" />
      <p className={cn("min-w-0 flex-1 whitespace-pre-wrap text-ink-2", !open && "line-clamp-1")}>
        <span className="font-medium text-ink">Cut v{version.number}{version.stage ? ` · ${stageInfo(version.stage).label}` : ""}: </span>
        {text}
      </p>
      {long && (
        <button onClick={() => setOpen((o) => !o)} className="shrink-0 text-xs font-medium text-accent hover:underline">
          {open ? "Less" : "More"}
        </button>
      )}
    </div>
  );
}

/** Review before there's anything to review. */
function FirstCut({ active }: { active: boolean }) {
  const { video, links, embedded } = useStudio();
  const { start, uploads } = useUploads();
  const fileInput = useRef<HTMLInputElement>(null);
  const upload = (files: File[]) => start(files, { kind: "version", videoId: video._id as Id<"videos"> });
  const dragging = useFileDrag(upload, active);
  const busy = uploads.some(
    (u) => u.target.kind === "version" && u.target.videoId === video._id && u.status !== "error",
  );

  if (embedded) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div className="max-w-sm">
          <Clapperboard size={30} className="mx-auto text-muted" />
          <p className="mt-4 font-semibold">No cuts yet</p>
          <p className="mt-1 text-sm text-muted">
            Once the story is in production, the director posts every cut here: voice auditions, the voice-over, the
            animatic, the animated cut. Comment on any moment and it fixes what you point at.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <StudioBar />
      <div className="scroll-thin grid min-h-0 flex-1 place-items-center overflow-y-auto p-4">
        <div className="w-full max-w-xl text-center">
          <input
            ref={fileInput}
            type="file"
            accept="video/*,.mp4,.mov,.m4v"
            hidden
            onChange={(e) => {
              upload([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileInput.current?.click()}
            disabled={busy}
            className="flex w-full flex-col items-center rounded-3xl border-2 border-dashed border-line-strong px-6 py-14 transition hover:border-accent hover:bg-surface disabled:pointer-events-none"
          >
            <Upload size={30} className="text-muted" />
            <p className="mt-4 text-lg font-semibold">{busy ? "Uploading the first cut…" : "Upload the first cut"}</p>
            <p className="mt-1 text-sm text-muted">
              {busy ? "It shows up here as soon as it's ready." : "Drop an MP4 here, or click to choose one."}
            </p>
          </button>
          <p className="mt-8 text-sm text-muted">Not there yet? Plan it out first:</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Link
              href={links.notes}
              className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 text-left shadow-soft hover:border-line-strong"
            >
              <NotebookPen size={20} className="shrink-0 text-accent" />
              <span>
                <span className="block text-sm font-semibold">Notes</span>
                <span className="block text-xs text-muted">Script, shot list, ideas</span>
              </span>
            </Link>
            <Link
              href={links.images}
              className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 text-left shadow-soft hover:border-line-strong"
            >
              <Images size={20} className="shrink-0 text-accent" />
              <span>
                <span className="block text-sm font-semibold">Images</span>
                <span className="block text-xs text-muted">References, frames, mood board</span>
              </span>
            </Link>
          </div>
        </div>
      </div>
      {dragging && <DropOverlay label="Drop to upload the first cut" />}
    </div>
  );
}

function Review({ video, active, search }: { video: VideoData; active: boolean; search: string }) {
  const { paths, embedded } = useStudio();
  const me = useMe();
  const toast = useToast();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);
  // Without ?v= we show whatever was newest when the page opened, so someone
  // else uploading a version doesn't swap the video out mid-review.
  const [opened] = useState(video.latestVersion);
  const wanted = Number(params.get("v")) || opened;
  const version = video.versions.find((v) => v.number === wanted) ?? video.versions[video.versions.length - 1]!;

  const comments = useQuery(api.comments.forVersion, { versionId: version._id });
  const users = useQuery(api.users.list);
  const userMap = useMemo(() => new Map((users ?? []).map((u) => [u._id as string, u])), [users]);
  const addComment = useMutation(api.comments.add);

  const pb = useMemo(() => new Playback(), []);
  pb.fps = version.fps || 30;

  const [selectedId, setSelectedId] = useState<string | null>(params.get("c"));
  const [range, setRange] = useState<Range | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [tool, setTool] = useState<Tool>("arrow");
  const [color, setColor] = useState(DRAW_COLORS[0]!);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [showKeys, setShowKeys] = useState(false);
  const composer = useRef<ComposerHandle>(null);
  const isWide = useMediaQuery("(min-width: 1024px)");

  // Leaving for another tab pauses, so nothing plays behind it.
  useEffect(() => {
    if (!active) pb.pause();
  }, [active, pb]);

  // Switching versions starts fresh.
  useEffect(() => {
    setRange(null);
    setShapes([]);
    setDrawing(false);
  }, [version._id]);

  const select = useCallback(
    (c: Comment) => {
      setSelectedId(c._id);
      setDrawing(false);
      pb.pause();
      pb.seek(c.time ?? 0);
    },
    [pb],
  );

  // Deep links: ?t=12.5 jumps to a time, ?c=<comment> to a comment.
  const linked = useRef(false);
  useEffect(() => {
    if (linked.current || !comments) return;
    const c = params.get("c");
    const t = Number(params.get("t"));
    const target = c ? comments.find((x) => x._id === c) : undefined;
    const go = () => {
      if (target) select(target);
      else if (t) pb.seek(t);
    };
    linked.current = true;
    if (pb.video && pb.video.readyState >= 1) go();
    else pb.video?.addEventListener("loadedmetadata", go, { once: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments]);

  const notes = (comments ?? []).filter((c) => !c.parentId);
  const selected = notes.find((c) => c._id === selectedId);
  const markers: Marker[] = notes.map((c) => {
    const u = userMap.get(c.authorId);
    return {
      id: c._id,
      time: c.time ?? 0,
      endTime: c.endTime,
      color: u?.color ?? "#888",
      name: u?.name ?? "Someone",
      body: c.body,
      resolved: c.resolved,
    };
  });

  const toggleDraw = useCallback(() => {
    setDrawing((d) => {
      if (!d) {
        pb.pause();
        setSelectedId(null);
      }
      return !d;
    });
  }, [pb]);

  const submit = async (body: string) => {
    const time = range?.start ?? pb.state.time;
    const id = await addComment({
      versionId: version._id,
      authorId: me._id,
      body,
      time,
      endTime: range?.end,
      drawing: shapes.length ? shapes : undefined,
    });
    setRange(null);
    setShapes([]);
    setDrawing(false);
    setSelectedId(id);
  };

  // Keyboard shortcuts, when not typing.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      const now = pb.state.time;
      const keys: Record<string, () => void> = {
        " ": () => pb.toggle(),
        k: () => pb.toggle(),
        j: () => pb.seek(now - 5),
        l: () => pb.seek(now + 5),
        ArrowLeft: () => pb.seek(now - 5),
        ArrowRight: () => pb.seek(now + 5),
        ",": () => pb.step(-1),
        ".": () => pb.step(1),
        m: () => pb.video && (pb.video.muted = !pb.video.muted),
        f: () => (document.querySelector("[data-player]") as HTMLElement | null)?.requestFullscreen?.(),
        c: () => composer.current?.focus(),
        d: toggleDraw,
        i: () => setRange((r) => ({ start: now, end: Math.max(r?.end ?? now + 3, now + 0.1) })),
        o: () => setRange((r) => ({ start: Math.min(r?.start ?? Math.max(0, now - 3), now - 0.1), end: now })),
        "?": () => setShowKeys(true),
        Escape: () => {
          if (drawing) setDrawing(false);
          else setSelectedId(null);
        },
      };
      const run = keys[e.key] ?? keys[e.key.toLowerCase()];
      if (!run) return;
      e.preventDefault(); // also keeps the "c" out of the comment box it focuses
      run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pb, toggleDraw, drawing, active]);

  const aspect = version.width && version.height ? version.width / version.height : 16 / 9;
  const annotation =
    drawing || shapes.length
      ? { shapes }
      : selected?.drawing
        ? { shapes: selected.drawing, at: selected.time ?? 0 }
        : { shapes: [] };

  return (
    <div className="flex h-full flex-col">
      <ReviewBar video={video} version={version} onShowKeys={() => setShowKeys(true)} />
      {version.summary && <CutSummary version={version} />}
      {version.number !== video.latestVersion && (
        <div className="flex items-center justify-center gap-2 bg-amber-400/15 px-4 py-1.5 text-sm text-amber-800 dark:text-amber-200">
          You're looking at version {version.number}.
          <button onClick={() => navigate(`${paths.review}?v=${video.latestVersion}`)} className="font-semibold underline">
            Go to the latest (v{video.latestVersion})
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div
          className="min-w-0 shrink-0 lg:h-full lg:flex-1"
          // A story's page has three more rows above the player, so it gets less of a phone screen.
          style={isWide ? undefined : { height: `calc(min(100vw / ${aspect}, ${embedded ? 34 : 48}vh) + 92px)` }}
        >
          <Player
            key={version._id}
            pb={pb}
            src={`/media/files/${version.fileId}.mp4`}
            aspect={aspect}
            markers={markers}
            selectedId={selectedId}
            onMarker={(id) => {
              const c = notes.find((n) => n._id === id);
              if (c) select(c);
            }}
            annotation={annotation}
            draw={drawing ? { tool, color, onAdd: (s) => setShapes((ss) => [...ss, s]) } : undefined}
            range={range}
            overlay={
              drawing && (
                <DrawToolbar
                  tool={tool}
                  color={color}
                  onTool={setTool}
                  onColor={setColor}
                  canUndo={shapes.length > 0}
                  onUndo={() => setShapes((ss) => ss.slice(0, -1))}
                  onClear={() => setShapes([])}
                  onDone={() => {
                    setDrawing(false);
                    composer.current?.focus();
                  }}
                />
              )
            }
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col border-line lg:w-[380px] lg:flex-none lg:border-l xl:w-[420px]">
          <CommentsPanel
            pb={pb}
            comments={comments}
            users={userMap}
            selectedId={selectedId}
            onSelect={select}
            composer={
              <Composer
                ref={composer}
                pb={pb}
                range={range}
                onRange={setRange}
                drawing={drawing}
                shapeCount={shapes.length}
                onToggleDraw={toggleDraw}
                onSubmit={async (body) => {
                  try {
                    await submit(body);
                  } catch {
                    toast({ message: "Couldn't post that comment. Try again." });
                    throw new Error("post failed");
                  }
                }}
              />
            }
          />
        </div>
      </div>
      {showKeys && <ShortcutsDialog onClose={() => setShowKeys(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ReviewBar({
  video,
  version,
  onShowKeys,
}: {
  video: VideoData;
  version: VideoData["versions"][number];
  onShowKeys: () => void;
}) {
  const { start } = useUploads();
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <StudioBar left={<VersionMenu video={video} version={version} />}>
      <input
        ref={fileInput}
        type="file"
        accept="video/*,.mp4,.mov,.m4v"
        hidden
        onChange={(e) => {
          start([...(e.target.files ?? [])], { kind: "version", videoId: video._id as Id<"videos"> });
          e.target.value = "";
        }}
      />
      <button
        onClick={() => fileInput.current?.click()}
        title="Upload a new version"
        className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"
      >
        <Upload size={16} /> <span className="hidden md:inline">New version</span>
      </button>
      <a
        href={`/media/files/${version.fileId}.mp4?download=${encodeURIComponent(version.fileName)}`}
        title={`Download ${version.fileName} (${bytes(version.size)})`}
        className="hidden size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink sm:grid"
      >
        <Download size={17} />
      </a>
      <button
        onClick={onShowKeys}
        title="Keyboard shortcuts (?)"
        className="hidden size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink lg:grid"
      >
        <Keyboard size={17} />
      </button>
    </StudioBar>
  );
}

function VersionMenu({ video, version }: { video: VideoData; version: VideoData["versions"][number] }) {
  const { paths } = useStudio();
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const users = useQuery(api.users.list);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 items-center gap-1 rounded-lg border border-line px-2.5 text-sm font-semibold hover:bg-surface-2"
      >
        v{version.number}
        <ChevronDown size={14} className="text-muted" />
      </button>
      {open && (
        <div className="absolute top-full left-1/2 z-30 mt-1.5 w-72 -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-float sm:left-0 sm:translate-x-0">
          {[...video.versions].reverse().map((v) => {
            const who = users?.find((u) => u._id === v.uploadedBy);
            return (
              <button
                key={v._id}
                onClick={() => {
                  setOpen(false);
                  navigate(`${paths.review}?v=${v.number}`);
                }}
                className={cn(
                  "flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-surface-2",
                  v._id === version._id && "bg-surface-2",
                )}
              >
                <span className="mt-0.5 w-7 shrink-0 text-sm font-semibold">v{v.number}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{v.fileName}</span>
                  <span className="block text-xs text-muted">
                    {who?.name ?? "Someone"} · {relativeTime(v._creationTime)} · {timecode(v.duration)}
                  </span>
                  <span className="block text-xs text-muted">
                    {v.notes === 0
                      ? "No comments"
                      : v.openNotes === 0
                        ? `${v.notes} comment${v.notes === 1 ? "" : "s"}, all done`
                        : `${v.openNotes} open of ${v.notes}`}
                  </span>
                </span>
                {v._id === version._id && <Check size={15} className="mt-0.5 shrink-0 text-accent" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DrawToolbar({
  tool,
  color,
  onTool,
  onColor,
  canUndo,
  onUndo,
  onClear,
  onDone,
}: {
  tool: Tool;
  color: string;
  onTool: (t: Tool) => void;
  onColor: (c: string) => void;
  canUndo: boolean;
  onUndo: () => void;
  onClear: () => void;
  onDone: () => void;
}) {
  const tools: [Tool, typeof PenLine, string][] = [
    ["arrow", MoveUpRight, "Arrow"],
    ["rect", Square, "Box"],
    ["pen", PenLine, "Pen"],
  ];
  return (
    <div
      className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-xl bg-black/75 p-1 text-white shadow-lg backdrop-blur"
      onClick={(e) => e.stopPropagation()}
    >
      {tools.map(([id, Icon, label]) => (
        <button
          key={id}
          onClick={() => onTool(id)}
          title={label}
          className={cn("grid size-8 place-items-center rounded-lg", tool === id ? "bg-white/20" : "hover:bg-white/10")}
        >
          <Icon size={16} />
        </button>
      ))}
      <span className="mx-0.5 h-5 w-px bg-white/20 sm:mx-1" />
      {DRAW_COLORS.map((c) => (
        <button
          key={c}
          onClick={() => onColor(c)}
          aria-label={`Color ${c}`}
          className={cn("size-5 rounded-full", c === color ? "ring-2 ring-white ring-offset-2 ring-offset-black" : "")}
          style={{ background: c }}
        />
      ))}
      <span className="mx-0.5 h-5 w-px bg-white/20 sm:mx-1" />
      <button
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo"
        className="grid size-8 place-items-center rounded-lg hover:bg-white/10 disabled:opacity-30"
      >
        <Undo2 size={16} />
      </button>
      <button
        onClick={onClear}
        disabled={!canUndo}
        className="hidden h-8 rounded-lg px-2 text-xs hover:bg-white/10 disabled:opacity-30 sm:block"
      >
        Clear
      </button>
      <button onClick={onDone} className="ml-1 h-8 rounded-lg bg-white px-3 text-xs font-semibold text-black">
        Done
      </button>
    </div>
  );
}

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ["Space / K", "Play or pause"],
    ["← / →", "Back or forward 5 seconds"],
    ["J / L", "Back or forward 5 seconds"],
    [", / .", "Previous or next frame"],
    ["C", "Write a comment"],
    ["I / O", "Start or end a time range"],
    ["D", "Draw on the frame"],
    ["M", "Mute"],
    ["F", "Fullscreen"],
    ["Esc", "Stop drawing, deselect"],
    ["Enter", "Post (Shift+Enter for a new line)"],
    [DICTATE_SHORTCUT, "Dictate into a comment"],
  ];
  return (
    <Modal onClose={onClose} className="max-w-sm">
      <div className="p-5">
        <h2 className="mb-3 font-semibold">Keyboard shortcuts</h2>
        <dl className="space-y-1.5 text-sm">
          {rows.map(([k, label]) => (
            <div key={k} className="flex items-center justify-between gap-4">
              <dt className="text-ink-2">{label}</dt>
              <dd className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-xs">{k}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="h-9 rounded-xl bg-ink px-4 text-sm font-medium text-bg">
            Got it
          </button>
        </div>
      </div>
    </Modal>
  );
}
