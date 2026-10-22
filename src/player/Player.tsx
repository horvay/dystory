import {
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minimize,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/hooks";
import { frameTimecode, timecode } from "../lib/time";
import { DrawingLayer, type Shape, type Tool } from "./Drawing";
import { usePlayback, type Playback } from "./playback";

export type Marker = {
  id: string;
  time: number;
  endTime?: number;
  color: string;
  name: string;
  body: string;
  resolved: boolean;
};

const RATES = [0.5, 1, 1.5, 2];

export function Player({
  pb,
  src,
  aspect,
  markers,
  selectedId,
  onMarker,
  annotation,
  draw,
  range,
  overlay,
}: {
  pb: Playback;
  src: string;
  aspect: number;
  markers: Marker[];
  selectedId: string | null;
  onMarker: (id: string) => void;
  /** Shown over the frame; with `at`, only while paused on that moment. */
  annotation: { shapes: Shape[]; at?: number };
  draw?: { tool: Tool; color: string; onAdd: (s: Shape) => void };
  range?: { start: number; end: number } | null;
  overlay?: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  const attach = useCallback((v: HTMLVideoElement | null) => pb.attach(v), [pb]);

  // Fit the frame inside the stage, so the drawing layer can sit exactly on it.
  useEffect(() => {
    const el = stage.current!;
    const fit = () => {
      const { width, height } = el.getBoundingClientRect();
      const w = Math.min(width, height * aspect);
      setBox({ w: Math.floor(w), h: Math.floor(w / aspect) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);

  useEffect(() => {
    const on = () => setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (root.current?.requestFullscreen) void root.current.requestFullscreen();
    else (pb.video as any)?.webkitEnterFullscreen?.(); // iPhone Safari
  };

  return (
    <div ref={root} data-player className="flex h-full min-h-0 flex-col bg-[#0b0b0c] text-white select-none">
      <div
        ref={stage}
        className="relative grid min-h-0 flex-1 place-items-center overflow-hidden"
        onClick={() => !draw && pb.toggle()}
        onDoubleClick={() => !draw && toggleFullscreen()}
      >
        <div className="relative" style={{ width: box.w, height: box.h }}>
          <video
            ref={attach}
            src={src}
            preload="auto"
            playsInline
            className="absolute inset-0 size-full bg-black"
          />
          <Annotation pb={pb} annotation={annotation} w={box.w} h={box.h} draw={draw} />
        </div>
        {overlay}
        <BigPlay pb={pb} hidden={!!draw} />
      </div>
      <Scrubber pb={pb} markers={markers} selectedId={selectedId} onMarker={onMarker} range={range} />
      <div className="flex items-center gap-1 px-2 pb-2 sm:px-3">
        <PlayButton pb={pb} />
        <button onClick={() => pb.step(-1)} title="Previous frame ( , )" className={ctrl}>
          <ChevronLeft size={18} />
        </button>
        <button onClick={() => pb.step(1)} title="Next frame ( . )" className={ctrl}>
          <ChevronRight size={18} />
        </button>
        <Clock pb={pb} />
        <div className="flex-1" />
        <RateButton pb={pb} />
        <Volume pb={pb} />
        <button onClick={toggleFullscreen} title="Fullscreen (F)" className={ctrl}>
          {fullscreen ? <Minimize size={17} /> : <Maximize size={17} />}
        </button>
      </div>
    </div>
  );
}

function Annotation({
  pb,
  annotation,
  w,
  h,
  draw,
}: {
  pb: Playback;
  annotation: { shapes: Shape[]; at?: number };
  w: number;
  h: number;
  draw?: { tool: Tool; color: string; onAdd: (s: Shape) => void };
}) {
  const { at } = annotation;
  const tolerance = 0.6 / pb.fps + 0.02;
  const visible = usePlayback(pb, (s) => at === undefined || (s.paused && Math.abs(s.time - at) < tolerance));
  return <DrawingLayer shapes={visible ? annotation.shapes : []} w={w} h={h} {...draw} />;
}

const ctrl = "grid size-9 place-items-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white";

function BigPlay({ pb, hidden }: { pb: Playback; hidden: boolean }) {
  const paused = usePlayback(pb, (s) => s.paused);
  const started = usePlayback(pb, (s) => s.time > 0);
  if (hidden || !paused || started) return null;
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <div className="grid size-16 place-items-center rounded-full bg-black/55 backdrop-blur-sm">
        <Play size={28} fill="currentColor" className="ml-1" />
      </div>
    </div>
  );
}

function PlayButton({ pb }: { pb: Playback }) {
  const paused = usePlayback(pb, (s) => s.paused);
  return (
    <button onClick={() => pb.toggle()} title={paused ? "Play (Space)" : "Pause (Space)"} className={ctrl}>
      {paused ? <Play size={18} fill="currentColor" /> : <Pause size={18} fill="currentColor" />}
    </button>
  );
}

function Clock({ pb }: { pb: Playback }) {
  const time = usePlayback(pb, (s) => s.time);
  const duration = usePlayback(pb, (s) => s.duration);
  return (
    <span className="ml-1 font-mono text-xs text-white/80 tabular-nums sm:text-[13px]">
      {frameTimecode(time, pb.fps)}
      <span className="text-white/40"> / {timecode(duration)}</span>
    </span>
  );
}

function RateButton({ pb }: { pb: Playback }) {
  const rate = usePlayback(pb, (s) => s.rate);
  return (
    <button
      onClick={() => {
        if (pb.video) pb.video.playbackRate = RATES[(RATES.indexOf(rate) + 1) % RATES.length]!;
      }}
      title="Playback speed"
      className="h-9 rounded-lg px-2 font-mono text-xs text-white/80 hover:bg-white/10 hover:text-white"
    >
      {rate}×
    </button>
  );
}

function Volume({ pb }: { pb: Playback }) {
  const muted = usePlayback(pb, (s) => s.muted || s.volume === 0);
  const volume = usePlayback(pb, (s) => s.volume);
  return (
    <div className="group flex items-center">
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={muted ? 0 : volume}
        aria-label="Volume"
        onChange={(e) => {
          if (!pb.video) return;
          pb.video.volume = Number(e.target.value);
          pb.video.muted = Number(e.target.value) === 0;
        }}
        className="hidden w-0 accent-white opacity-0 transition-all group-hover:w-20 group-hover:opacity-100 sm:block"
      />
      <button
        onClick={() => {
          if (!pb.video) return;
          pb.video.muted = !muted;
          if (muted && pb.video.volume === 0) pb.video.volume = 1;
        }}
        title="Mute (M)"
        className={ctrl}
      >
        {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
      </button>
    </div>
  );
}

function Scrubber({
  pb,
  markers,
  selectedId,
  onMarker,
  range,
}: {
  pb: Playback;
  markers: Marker[];
  selectedId: string | null;
  onMarker: (id: string) => void;
  range?: { start: number; end: number } | null;
}) {
  const time = usePlayback(pb, (s) => s.time);
  const duration = usePlayback(pb, (s) => s.duration);
  const buffered = usePlayback(pb, (s) => s.buffered);
  const track = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const drag = useRef<{ wasPlaying: boolean } | null>(null);
  const pct = (t: number) => (duration ? `${Math.min(100, (t / duration) * 100)}%` : "0%");

  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * duration;
  };

  return (
    <div className="px-3 pt-1 sm:px-4">
      {/* Comment markers */}
      <div className="relative h-6">
        {markers.map((m) => {
          const selected = m.id === selectedId;
          return (
            <div key={m.id}>
              {m.endTime !== undefined && (
                <div
                  className="absolute bottom-0 h-1 rounded-full"
                  style={{
                    left: pct(m.time),
                    width: `calc(${pct(m.endTime)} - ${pct(m.time)})`,
                    background: m.color,
                    opacity: m.resolved ? 0.3 : selected ? 0.9 : 0.55,
                  }}
                />
              )}
              <button
                onClick={() => onMarker(m.id)}
                className={cn(
                  "group absolute bottom-1.5 -translate-x-1/2 rounded-full transition hover:z-10 hover:scale-125",
                  selected ? "z-10 size-3.5 ring-2 ring-white" : "size-2.5",
                  m.resolved && !selected && "opacity-40",
                )}
                style={{ left: pct(m.time), background: m.color }}
                aria-label={`${m.name} at ${timecode(m.time)}`}
              >
                <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 hidden w-max max-w-56 -translate-x-1/2 rounded-lg bg-black/90 px-2.5 py-1.5 text-left text-xs text-white shadow-lg group-hover:block">
                  <span className="font-semibold">{m.name}</span>
                  <span className="text-white/50"> · {timecode(m.time)}</span>
                  {m.body && <span className="mt-0.5 line-clamp-2 block text-white/80">{m.body}</span>}
                </span>
              </button>
            </div>
          );
        })}
      </div>

      {/* Track */}
      <div
        ref={track}
        className="group relative flex h-5 cursor-pointer items-center touch-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { wasPlaying: !pb.state.paused };
          pb.pause();
          pb.seek(timeAt(e.clientX));
        }}
        onPointerMove={(e) => {
          setHover(timeAt(e.clientX));
          if (drag.current) pb.seek(timeAt(e.clientX));
        }}
        onPointerUp={() => {
          if (drag.current?.wasPlaying) pb.play();
          drag.current = null;
        }}
        onPointerLeave={() => setHover(null)}
      >
        <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/15 transition-[height] group-hover:h-1.5">
          <div className="absolute inset-y-0 left-0 bg-white/25" style={{ width: pct(buffered) }} />
          <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: pct(time) }} />
          {range && (
            <div
              className="absolute inset-y-0 bg-amber-400/80"
              style={{ left: pct(range.start), width: `calc(${pct(range.end)} - ${pct(range.start)})` }}
            />
          )}
        </div>
        <div
          className="pointer-events-none absolute size-3 -translate-x-1/2 rounded-full bg-white shadow"
          style={{ left: pct(time) }}
        />
        {hover !== null && (
          <div
            className="pointer-events-none absolute bottom-full mb-1 -translate-x-1/2 rounded bg-black/90 px-1.5 py-0.5 font-mono text-[11px] text-white"
            style={{ left: pct(hover) }}
          >
            {timecode(hover)}
          </div>
        )}
      </div>
    </div>
  );
}
