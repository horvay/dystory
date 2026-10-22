import type { Doc } from "../../convex/_generated/dataModel";
import { useRef, useState } from "react";

export type Shape = NonNullable<Doc<"comments">["drawing"]>[number];
export type Tool = Shape["tool"];

export const DRAW_COLORS = ["#ff3b30", "#ffcc00", "#34c759", "#0a84ff", "#ffffff"];

function ShapeView({ s, w, h }: { s: Shape; w: number; h: number }) {
  const px = s.points.map((p, i) => p * (i % 2 ? h : w));
  const stroke = Math.max(2.5, Math.min(w, h) / 160);
  const common = {
    stroke: s.color,
    strokeWidth: stroke,
    fill: "none",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    style: { filter: "drop-shadow(0 1px 2px rgb(0 0 0 / 0.6))" },
  };
  if (s.tool === "pen") {
    const d = px.reduce((acc, p, i) => (i % 2 ? `${acc},${p}` : `${acc}${i ? " L" : "M"}${p}`), "");
    return <path d={d} {...common} />;
  }
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = px;
  if (s.tool === "rect") {
    return (
      <rect
        x={Math.min(x0, x1)}
        y={Math.min(y0, y1)}
        width={Math.abs(x1 - x0)}
        height={Math.abs(y1 - y0)}
        rx={stroke}
        {...common}
      />
    );
  }
  const angle = Math.atan2(y1 - y0, x1 - x0);
  const head = stroke * 5;
  const wing = (a: number) => `${x1 - head * Math.cos(angle + a)},${y1 - head * Math.sin(angle + a)}`;
  return <path d={`M${x0},${y0} L${x1},${y1} M${wing(0.5)} L${x1},${y1} L${wing(-0.5)}`} {...common} />;
}

/**
 * Shapes over the video frame. `w`/`h` are the frame's on-screen size; shapes
 * are stored in 0..1 so they line up at any size. With `onAdd` it is an
 * editor: drag to draw with the given tool.
 */
export function DrawingLayer({
  shapes,
  w,
  h,
  tool,
  color,
  onAdd,
}: {
  shapes: Shape[];
  w: number;
  h: number;
  tool?: Tool;
  color?: string;
  onAdd?: (s: Shape) => void;
}) {
  const [draft, setDraft] = useState<Shape | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const editing = !!onAdd && !!tool && !!color;

  const at = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    ] as const;
  };

  return (
    <svg
      ref={svg}
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="absolute inset-0"
      style={{ pointerEvents: editing ? "auto" : "none", cursor: editing ? "crosshair" : undefined, touchAction: "none" }}
      onPointerDown={(e) => {
        if (!editing) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const [x, y] = at(e);
        setDraft({ tool: tool!, color: color!, points: [x, y, x, y] });
      }}
      onPointerMove={(e) => {
        if (!draft) return;
        const [x, y] = at(e);
        setDraft({
          ...draft,
          points: draft.tool === "pen" ? [...draft.points, x, y] : [draft.points[0]!, draft.points[1]!, x, y],
        });
      }}
      onPointerUp={() => {
        if (!draft) return;
        const [x0, y0, x1, y1] = draft.points.slice(-4) as number[];
        const moved = draft.tool === "pen" ? draft.points.length > 6 : Math.hypot(x1! - x0!, y1! - y0!) > 0.01;
        if (moved) {
          onAdd?.({ ...draft, points: draft.points.map((p) => Math.round(p * 10000) / 10000) });
        }
        setDraft(null);
      }}
    >
      {shapes.map((s, i) => (
        <ShapeView key={i} s={s} w={w} h={h} />
      ))}
      {draft && <ShapeView s={draft} w={w} h={h} />}
    </svg>
  );
}
