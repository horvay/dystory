import { useMutation, useQuery } from "convex/react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  MapPin,
  Minus,
  Pencil,
  Plus,
  SendHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { Avatar } from "../components/Avatar";
import { DictationStatus, MicButton } from "../components/MicButton";
import { useToast } from "../components/Toast";
import { cn, useMediaQuery } from "../lib/hooks";
import { useMe } from "../lib/identity";
import { bytes, relativeTime } from "../lib/time";
import { useTextDictation } from "../lib/useDictation";
import { AutoTextarea, EditBox } from "../player/Comments";
import type { Image } from "./ImagesTab";

type Comment = Doc<"imageComments">;
type User = Doc<"users">;
type Point = { x: number; y: number };

/**
 * One image, big, with its comments. Wheel or pinch to zoom, drag to pan,
 * click a spot to pin a comment there.
 */
export function ImageViewer({
  image,
  position,
  onGo,
  onClose,
}: {
  image: Image;
  position: { index: number; total: number };
  onGo: (step: number) => void;
  onClose: () => void;
}) {
  const me = useMe();
  const toast = useToast();
  const comments = useQuery(api.images.comments, { imageId: image._id });
  const users = useQuery(api.users.list);
  const userMap = useMemo(() => new Map((users ?? []).map((u) => [u._id as string, u])), [users]);
  const addComment = useMutation(api.images.addComment);
  const removeImage = useMutation(api.images.remove);
  const [pin, setPin] = useState<Point | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const click = useMediaQuery("(pointer: coarse)") ? "tap" : "click";
  const dictation = useTextDictation(input, draft, setDraft);

  const ordered = useMemo(() => [...(comments ?? [])].sort((a, b) => a._creationTime - b._creationTime), [comments]);
  // Pins are numbered in the order they were left.
  const pinNumber = new Map<string, number>();
  for (const c of ordered) if (c.x !== undefined) pinNumber.set(c._id, pinNumber.size + 1);

  const post = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      const id = await addComment({ imageId: image._id, authorId: me._id, body: draft, ...(pin ?? {}) });
      setDraft("");
      setPin(null);
      setSelectedId(id);
    } catch {
      toast({ message: "Couldn't post that comment. Try again." });
    } finally {
      setBusy(false);
    }
  };

  // Keys, when not typing: arrows step through images, Esc drops the pin or closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, [contenteditable]") || e.metaKey || e.ctrlKey) return;
      if (e.key === "Escape") {
        if (pin) setPin(null);
        else if (selectedId) setSelectedId(null);
        else onClose();
      } else if (e.key === "ArrowLeft" && position.total > 1) onGo(-1);
      else if (e.key === "ArrowRight" && position.total > 1) onGo(1);
      else if (e.key === "c") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onGo, pin, position.total, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    list.current?.querySelector(`[data-comment="${selectedId}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId, comments === undefined]);

  const uploader = userMap.get(image.uploadedBy);
  const pins = ordered
    .filter((c) => c.x !== undefined && c.y !== undefined)
    .map((c) => ({
      id: c._id,
      x: c.x!,
      y: c.y!,
      n: pinNumber.get(c._id)!,
      color: userMap.get(c.authorId)?.color ?? "#888",
    }));

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-[#0b0b0c] lg:flex-row" role="dialog" aria-label={image.fileName}>
      <Stage
        image={image}
        pins={pins}
        pending={pin ? { ...pin, color: me.color } : null}
        selectedId={selectedId}
        onPin={(p) => {
          setPin(p);
          setSelectedId(null);
          input.current?.focus({ preventScroll: true });
        }}
        onSelectPin={setSelectedId}
        position={position}
        onGo={onGo}
        onClose={onClose}
      />

      <aside className="flex min-h-0 flex-1 flex-col border-line bg-surface lg:w-[380px] lg:flex-none lg:border-l xl:w-[420px]">
        <div className="flex items-start gap-3 border-b border-line px-4 py-3">
          <Avatar name={uploader?.name ?? "?"} color={uploader?.color ?? "#888"} size={28} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold" title={image.fileName}>
              {image.caption || image.fileName}
            </p>
            {image.caption && <p className="truncate text-xs text-muted">{image.fileName}</p>}
            <p className="truncate text-xs text-muted">
              {uploader?.name ?? "Someone"} · {relativeTime(image._creationTime)} · {image.width}×{image.height} ·{" "}
              {bytes(image.size)}
            </p>
          </div>
          <a
            href={`/media/images/${image.file}?download=${encodeURIComponent(image.fileName)}`}
            title="Download"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
          >
            <Download size={16} />
          </a>
          <button
            onClick={async () => {
              if (!confirm("Delete this image and its comments for everyone?")) return;
              await removeImage({ imageId: image._id });
              onClose();
            }}
            title="Delete image"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-danger"
          >
            <Trash2 size={16} />
          </button>
        </div>

        <div ref={list} className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          {comments === undefined ? (
            <p className="p-6 text-center text-sm text-muted">Loading…</p>
          ) : ordered.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted">
              <p className="font-medium text-ink-2">No comments yet</p>
              <p className="mt-1">Write below, or {click} a spot on the image to pin your comment there.</p>
            </div>
          ) : (
            ordered.map((c) => (
              <CommentRow
                key={c._id}
                comment={c}
                author={userMap.get(c.authorId)}
                pinNumber={pinNumber.get(c._id)}
                selected={c._id === selectedId}
                onSelect={() => setSelectedId(c._id === selectedId ? null : c._id)}
              />
            ))
          )}
        </div>

        <div className="border-t border-line bg-surface p-3">
          <div className="rounded-xl border border-line bg-bg focus-within:border-accent">
            <DictationStatus dictation={dictation} className="mx-1.5 mt-1.5" />
            <AutoTextarea
              ref={input}
              value={draft}
              onChange={setDraft}
              onSubmit={post}
              onCancel={() => setPin(null)}
              dictation={dictation}
              placeholder={pin ? "Comment on this spot…" : `Comment, or ${click} the image to pin a spot…`}
              className="max-h-40 min-h-11 w-full px-3 pt-2.5 pb-1 text-sm"
            />
            <div className="flex items-center gap-1 px-1.5 pb-1.5">
              {pin ? (
                <span className="flex items-center gap-1 rounded-lg bg-accent/12 py-1 pr-0.5 pl-2 text-xs font-medium text-accent">
                  <MapPin size={13} /> Pinned to a spot
                  <button
                    onClick={() => setPin(null)}
                    aria-label="Remove pin"
                    className="grid size-5 place-items-center rounded-md hover:bg-accent/15"
                  >
                    <X size={12} />
                  </button>
                </span>
              ) : (
                <span className="flex items-center gap-1 px-1.5 text-xs text-muted">
                  <MapPin size={13} /> {click === "tap" ? "Tap" : "Click"} the image to pin
                </span>
              )}
              <MicButton dictation={dictation} className="ml-auto size-8 rounded-lg" />
              <button
                onClick={post}
                disabled={!draft.trim() || busy}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3 text-sm font-medium text-bg transition disabled:opacity-30"
              >
                <SendHorizontal size={14} /> Post
              </button>
            </div>
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  );
}

function CommentRow({
  comment,
  author,
  pinNumber,
  selected,
  onSelect,
}: {
  comment: Comment;
  author?: User;
  pinNumber?: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const me = useMe();
  const edit = useMutation(api.images.editComment);
  const remove = useMutation(api.images.removeComment);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const mine = comment.authorId === me._id;
  const save = async () => {
    if (!draft.trim()) return;
    await edit({ commentId: comment._id, body: draft });
    setEditing(false);
  };

  return (
    <div
      data-comment={comment._id}
      onClick={onSelect}
      className={cn(
        "group cursor-pointer border-b border-line px-4 py-3 transition-colors",
        selected ? "bg-accent/8" : "hover:bg-surface-2/60",
      )}
    >
      <div className="flex items-center gap-2">
        <Avatar name={author?.name ?? "?"} color={author?.color ?? "#888"} size={24} />
        <span className="truncate text-sm font-semibold">{author?.name ?? "Someone"}</span>
        <span className="shrink-0 text-xs text-muted">{relativeTime(comment._creationTime)}</span>
        {pinNumber && <PinBadge n={pinNumber} color={author?.color ?? "#888"} className="ml-1" />}
        {mine && !editing && (
          <div
            className="ml-auto flex shrink-0 items-center sm:opacity-0 sm:group-hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                setDraft(comment.body);
                setEditing(true);
              }}
              title="Edit"
              className="grid size-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={() => confirm("Delete this comment?") && void remove({ commentId: comment._id })}
              title="Delete"
              className="grid size-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-danger"
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>
      {editing ? (
        <EditBox value={draft} onChange={setDraft} onSave={save} onCancel={() => setEditing(false)} />
      ) : (
        <p className="mt-1 text-sm leading-relaxed break-words whitespace-pre-wrap text-ink">
          {comment.body}
          {comment.editedAt && <span className="text-xs text-muted"> (edited)</span>}
        </p>
      )}
    </div>
  );
}

function PinBadge({ n, color, className }: { n: number; color: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-grid size-5 shrink-0 place-items-center rounded-full rounded-bl-none text-[10px] font-bold text-white",
        className,
      )}
      style={{ background: color }}
      title={`Pin ${n}`}
    >
      {n}
    </span>
  );
}

// ---------------------------------------------------------------------------
// The zoomable image
// ---------------------------------------------------------------------------

type View = { s: number; left: number; top: number }; // zoom, and the image's top-left in the stage
type Size = { w: number; h: number };
type Pin = { id: string; x: number; y: number; n: number; color: string };

function Stage({
  image,
  pins,
  pending,
  selectedId,
  onPin,
  onSelectPin,
  position,
  onGo,
  onClose,
}: {
  image: Image;
  pins: Pin[];
  pending: (Point & { color: string }) | null;
  selectedId: string | null;
  onPin: (p: Point) => void;
  onSelectPin: (id: string) => void;
  position: { index: number; total: number };
  onGo: (step: number) => void;
  onClose: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Size>({ w: 0, h: 0 });
  const [raw, setRaw] = useState<View>({ s: 1, left: 0, top: 0 });
  const [loaded, setLoaded] = useState(false);
  const [grabbing, setGrabbing] = useState(false);

  useEffect(() => {
    const el = stage.current!;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // At zoom 1 the image fits the stage (never blown up past its real size).
  const pad = box.w < 640 ? 12 : 56;
  const fitScale = Math.min(1, (box.w - pad * 2) / image.width, (box.h - pad * 2) / image.height) || 0;
  const fit: Size = { w: image.width * fitScale, h: image.height * fitScale };
  const maxS = Math.max(2, 4 / (fitScale || 1));

  const clamp = useCallback(
    (v: View): View => {
      const s = Math.min(maxS, Math.max(1, v.s));
      const w = fit.w * s;
      const h = fit.h * s;
      return {
        s,
        left: w <= box.w ? (box.w - w) / 2 : Math.min(0, Math.max(box.w - w, v.left)),
        top: h <= box.h ? (box.h - h) / 2 : Math.min(0, Math.max(box.h - h, v.top)),
      };
    },
    [box.h, box.w, fit.h, fit.w, maxS],
  );
  const view = clamp(raw);
  const update = useCallback((f: (v: View) => View) => setRaw((r) => clamp(f(clamp(r)))), [clamp]);
  const zoomAt = useCallback(
    (factor: number, cx: number, cy: number) =>
      update((v) => {
        const s = Math.min(maxS, Math.max(1, v.s * factor));
        const k = s / v.s;
        return { s, left: cx - (cx - v.left) * k, top: cy - (cy - v.top) * k };
      }),
    [maxS, update],
  );

  // Wheel and trackpad pinch zoom around the pointer. (React's onWheel can't preventDefault.)
  useEffect(() => {
    const el = stage.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
      zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.002)), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, [contenteditable]") || e.metaKey || e.ctrlKey) return;
      if (e.key === "+" || e.key === "=") zoomAt(1.4, box.w / 2, box.h / 2);
      else if (e.key === "-") zoomAt(1 / 1.4, box.w / 2, box.h / 2);
      else if (e.key === "0") setRaw({ s: 1, left: 0, top: 0 });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [box.h, box.w, zoomAt]);

  // Picking a pinned comment while zoomed in brings its pin into view.
  useEffect(() => {
    const p = pins.find((x) => x.id === selectedId);
    if (!p) return;
    update((v) => {
      const x = v.left + p.x * fit.w * v.s;
      const y = v.top + p.y * fit.h * v.s;
      if (x > 40 && x < box.w - 40 && y > 40 && y < box.h - 40) return v;
      return { ...v, left: box.w / 2 - p.x * fit.w * v.s, top: box.h / 2 - p.y * fit.h * v.s };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // One pointer drags (or, without moving, pins); two pinch.
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ start: Point; last: Point; moved: boolean; pinch?: { dist: number; mid: Point } } | null>(
    null,
  );
  const local = (e: React.PointerEvent): Point => {
    const r = stage.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const pair = () => {
    const [a, b] = [...pointers.current.values()] as [Point, Point];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 1) gesture.current = { start: p, last: p, moved: false };
    else if (gesture.current && pointers.current.size === 2) {
      gesture.current.moved = true;
      gesture.current.pinch = pair();
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || !pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (g.pinch && pointers.current.size >= 2) {
      const now = pair();
      const before = g.pinch;
      zoomAt(now.dist / before.dist, now.mid.x, now.mid.y);
      update((v) => ({ ...v, left: v.left + now.mid.x - before.mid.x, top: v.top + now.mid.y - before.mid.y }));
      g.pinch = now;
      return;
    }
    if (!g.moved && Math.hypot(p.x - g.start.x, p.y - g.start.y) > 5) {
      g.moved = true;
      setGrabbing(true);
    }
    if (g.moved) update((v) => ({ ...v, left: v.left + p.x - g.last.x, top: v.top + p.y - g.last.y }));
    g.last = p;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!pointers.current.delete(e.pointerId)) return;
    const g = gesture.current;
    if (pointers.current.size === 1 && g) {
      // Pinch over; the finger left behind carries on panning.
      g.pinch = undefined;
      g.last = [...pointers.current.values()][0]!;
      return;
    }
    if (pointers.current.size > 0) return;
    gesture.current = null;
    setGrabbing(false);
    if (!g || g.moved || e.type === "pointercancel") return;
    const p = local(e);
    const x = (p.x - view.left) / (fit.w * view.s);
    const y = (p.y - view.top) / (fit.h * view.s);
    if (x >= 0 && x <= 1 && y >= 0 && y <= 1) onPin({ x: round(x), y: round(y) });
  };

  const at = (p: Point) => ({ left: view.left + p.x * fit.w * view.s, top: view.top + p.y * fit.h * view.s });
  const pct = Math.round(fitScale * view.s * 100);
  const frame = { left: view.left, top: view.top, width: fit.w * view.s, height: fit.h * view.s };

  return (
    <div className="relative h-[52vh] shrink-0 text-white select-none lg:h-full lg:min-w-0 lg:flex-1">
      <div
        ref={stage}
        className={cn("absolute inset-0 touch-none overflow-hidden", grabbing ? "cursor-grabbing" : "cursor-crosshair")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {box.w > 0 && (
          <>
            {/* The grid's thumbnail stands in until the full image arrives. */}
            {!loaded && (
              <img src={`/media/images/${image.thumb}`} alt="" draggable={false} className="absolute max-w-none" style={frame} />
            )}
            <img
              src={`/media/images/${image.file}`}
              alt={image.fileName}
              draggable={false}
              onLoad={() => setLoaded(true)}
              className={cn("absolute max-w-none", !loaded && "opacity-0")}
              style={frame}
            />
            {pins.map((p) => (
              <PinMarker
                key={p.id}
                pos={at(p)}
                color={p.color}
                label={String(p.n)}
                active={p.id === selectedId}
                onClick={() => onSelectPin(p.id)}
              />
            ))}
            {pending && <PinMarker pos={at(pending)} color={pending.color} label="+" active pulse />}
          </>
        )}
      </div>

      {/* Controls */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 p-2 sm:p-3">
        <button
          onClick={onClose}
          title="Back to images (Esc)"
          className="pointer-events-auto grid size-9 place-items-center rounded-xl bg-black/60 backdrop-blur hover:bg-black/80"
        >
          <X size={18} />
        </button>
        {position.total > 1 && (
          <span className="rounded-lg bg-black/60 px-2 py-1 text-xs font-medium tabular-nums backdrop-blur">
            {position.index + 1} of {position.total}
          </span>
        )}
        <div className="pointer-events-auto ml-auto flex items-center rounded-xl bg-black/60 p-0.5 backdrop-blur">
          <button
            onClick={() => zoomAt(1 / 1.4, box.w / 2, box.h / 2)}
            disabled={view.s <= 1}
            title="Zoom out (−)"
            className="grid size-8 place-items-center rounded-lg hover:bg-white/10 disabled:opacity-30"
          >
            <Minus size={16} />
          </button>
          <button
            onClick={() => setRaw({ s: 1, left: 0, top: 0 })}
            title="Fit (0)"
            className="h-8 min-w-12 rounded-lg px-1.5 text-xs font-medium tabular-nums hover:bg-white/10"
          >
            {pct}%
          </button>
          <button
            onClick={() => zoomAt(1.4, box.w / 2, box.h / 2)}
            disabled={view.s >= maxS}
            title="Zoom in (+)"
            className="grid size-8 place-items-center rounded-lg hover:bg-white/10 disabled:opacity-30"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>
      {position.total > 1 && (
        <>
          <button
            onClick={() => onGo(-1)}
            title="Newer (←)"
            className="absolute top-1/2 left-2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-black/50 backdrop-blur hover:bg-black/80 sm:left-3"
          >
            <ChevronLeft size={22} />
          </button>
          <button
            onClick={() => onGo(1)}
            title="Older (→)"
            className="absolute top-1/2 right-2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-black/50 backdrop-blur hover:bg-black/80 sm:right-3"
          >
            <ChevronRight size={22} />
          </button>
        </>
      )}
    </div>
  );
}

const round = (n: number) => Math.round(n * 10000) / 10000;

/** A map-pin style marker whose point sits on the spot. */
function PinMarker({
  pos,
  color,
  label,
  active,
  pulse,
  onClick,
}: {
  pos: { left: number; top: number };
  color: string;
  label: string;
  active?: boolean;
  pulse?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      tabIndex={onClick ? 0 : -1}
      className={cn(
        "absolute grid size-7 -translate-y-full place-items-center rounded-full rounded-bl-none border-2 border-white text-xs font-bold text-white shadow-[0_2px_8px_rgb(0_0_0/0.5)] transition-transform",
        active && "z-10 scale-125",
        pulse && "animate-pulse",
        !onClick && "pointer-events-none",
      )}
      style={{ left: pos.left, top: pos.top, background: color, transformOrigin: "0 100%" }}
    >
      {label}
    </button>
  );
}
