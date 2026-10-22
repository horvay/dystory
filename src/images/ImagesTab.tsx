import { useMutation, useQuery } from "convex/react";
import { ImagePlus, Loader2, MessageCircle } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { DropOverlay } from "../components/DropOverlay";
import { StudioBar, useStudio } from "../components/Studio";
import { useToast } from "../components/Toast";
import { useFileDrag } from "../lib/hooks";
import { ImageError, isImageFile, uploadImage } from "../lib/images";
import { useMe } from "../lib/identity";
import { ImageViewer } from "./ImageViewer";

export type Image = Doc<"images"> & { comments: number };
type Pending = { id: number; name: string; preview: string };

let nextPendingId = 1;

export function ImagesTab({ imageId }: { imageId?: string }) {
  const { video, paths } = useStudio();
  const me = useMe();
  const toast = useToast();
  const images = useQuery(api.images.list, { videoId: video._id });
  const add = useMutation(api.images.add);
  const [pending, setPending] = useState<Pending[]>([]);
  const [, navigate] = useLocation();
  const fileInput = useRef<HTMLInputElement>(null);
  const base = paths.images;
  // Closing the viewer goes back in history when the grid opened it, so Back doesn't reopen it.
  const openedFromGrid = useRef(false);

  const uploadOne = useCallback(
    async (file: File) => {
      const id = nextPendingId++;
      const preview = URL.createObjectURL(file);
      setPending((p) => [{ id, name: file.name, preview }, ...p]);
      try {
        const info = await uploadImage(file);
        await add({ videoId: video._id, userId: me._id, ...info });
      } catch (e) {
        toast({ message: e instanceof ImageError ? e.message : `Couldn't upload ${file.name}. Try again.` });
      } finally {
        setPending((p) => p.filter((x) => x.id !== id));
        URL.revokeObjectURL(preview);
      }
    },
    [add, me._id, toast, video._id],
  );

  const upload = useCallback(
    (files: File[]) => {
      const imgs = files.filter(isImageFile);
      if (imgs.length < files.length) toast({ message: "Only images go here. Upload cuts on the Review tab." });
      for (const f of imgs) void uploadOne(f);
    },
    [toast, uploadOne],
  );

  const dragging = useFileDrag(upload);

  // Paste a screenshot straight in.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter(isImageFile);
      if (!files.length) return;
      e.preventDefault();
      upload(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [upload]);

  const index = images?.findIndex((i) => i._id === imageId) ?? -1;
  const open = index >= 0 ? images![index] : undefined;
  const close = () => {
    if (openedFromGrid.current) history.back();
    else navigate(base, { replace: true });
    openedFromGrid.current = false;
  };

  const items: ({ kind: "pending"; p: Pending } | { kind: "image"; img: Image })[] = [
    ...pending.map((p) => ({ kind: "pending" as const, p })),
    ...(images ?? []).map((img) => ({ kind: "image" as const, img })),
  ];

  return (
    <div className="flex h-full flex-col">
      <StudioBar>
        <button
          onClick={() => fileInput.current?.click()}
          title="Add images (or drop or paste them anywhere)"
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"
        >
          <ImagePlus size={16} /> <span className="hidden md:inline">Add images</span>
        </button>
      </StudioBar>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          upload([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {images === undefined ? (
          <p className="py-20 text-center text-muted">Loading…</p>
        ) : items.length === 0 ? (
          <button
            onClick={() => fileInput.current?.click()}
            className="mx-auto mt-10 flex w-[calc(100%-2rem)] max-w-xl flex-col items-center rounded-3xl border-2 border-dashed border-line-strong px-6 py-16 text-center transition hover:border-accent hover:bg-surface"
          >
            <ImagePlus size={30} className="text-muted" />
            <p className="mt-4 text-lg font-semibold">Collect images for this video</p>
            <p className="mt-1 max-w-sm text-sm text-muted">
              References, storyboards, frames to match, mood. Drop them here, paste a screenshot, or click to choose.
            </p>
          </button>
        ) : (
          <div className="mx-auto max-w-7xl p-3 sm:p-4">
            <p className="mb-3 hidden text-center text-xs text-muted sm:block">
              Newest on top · drop or paste images anywhere on this page
            </p>
            <Masonry
              items={items}
              keyOf={(it) => (it.kind === "pending" ? `p${it.p.id}` : it.img._id)}
              ratioOf={(it) => (it.kind === "pending" ? 1 : tileRatio(it.img))}
              render={(it) =>
                it.kind === "pending" ? (
                  <PendingTile p={it.p} />
                ) : (
                  <Tile
                    img={it.img}
                    onOpen={() => {
                      openedFromGrid.current = true;
                      navigate(`${base}/${it.img._id}`);
                    }}
                  />
                )
              }
            />
          </div>
        )}
      </div>

      {open && (
        <ImageViewer
          key={open._id}
          image={open}
          position={{ index, total: images!.length }}
          onGo={(step) => {
            const to = images![(index + step + images!.length) % images!.length]!;
            navigate(`${base}/${to._id}`, { replace: true });
          }}
          onClose={close}
        />
      )}
      {dragging && <DropOverlay label="Drop to add images" />}
    </div>
  );
}

/** Height over width for the grid; very tall images are cropped. */
const tileRatio = (img: Image) => Math.min(img.height / img.width, 2);

/**
 * Columns filled shortest-first, so the newest items stay along the top
 * (CSS columns would run the newest down the first column).
 */
function Masonry<T>({
  items,
  keyOf,
  ratioOf,
  render,
}: {
  items: T[];
  keyOf: (t: T) => string;
  ratioOf: (t: T) => number;
  render: (t: T) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const gap = width < 640 ? 8 : 14;
  const count = Math.max(2, Math.min(6, Math.floor((width + gap) / (260 + gap))));
  const colWidth = (width - gap * (count - 1)) / count || 1;
  const cols: T[][] = Array.from({ length: count }, () => []);
  const heights = new Array<number>(count).fill(0);
  for (const it of items) {
    const i = heights.indexOf(Math.min(...heights));
    cols[i]!.push(it);
    heights[i]! += ratioOf(it) * colWidth + gap;
  }
  return (
    <div ref={ref} className="flex items-start" style={{ gap }}>
      {cols.map((col, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col" style={{ gap }}>
          {col.map((it) => (
            <div key={keyOf(it)}>{render(it)}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Tile({ img, onOpen }: { img: Image; onOpen: () => void }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <button
      onClick={onOpen}
      title={img.caption ? `${img.caption}\n${img.fileName}` : img.fileName}
      className="group relative block w-full overflow-hidden rounded-xl bg-surface-2 ring-1 ring-line transition hover:shadow-float focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
      style={{ aspectRatio: `1 / ${tileRatio(img)}` }}
    >
      <img
        src={`/media/images/${img.thumb}`}
        alt={img.fileName}
        loading="lazy"
        draggable={false}
        onLoad={() => setLoaded(true)}
        className={`size-full object-cover object-top transition duration-300 group-hover:scale-[1.02] ${loaded ? "opacity-100" : "opacity-0"}`}
      />
      <span
        className={`absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2.5 pt-6 pb-2 text-left text-xs font-medium text-white transition ${img.caption ? "" : "opacity-0 group-hover:opacity-100"}`}
      >
        {img.caption || img.fileName}
      </span>
      {img.comments > 0 && (
        <span className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-white tabular-nums">
          <MessageCircle size={11} /> {img.comments}
        </span>
      )}
    </button>
  );
}

function PendingTile({ p }: { p: Pending }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="relative aspect-square overflow-hidden rounded-xl bg-surface-2 ring-1 ring-line">
      {!broken && (
        <img src={p.preview} alt="" onError={() => setBroken(true)} className="size-full object-cover opacity-50" />
      )}
      <div className="absolute inset-0 grid place-items-center">
        <span className="flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-xs font-medium text-white">
          <Loader2 size={13} className="animate-spin" /> Uploading
        </span>
      </div>
    </div>
  );
}
