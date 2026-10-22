import { Clapperboard, Sparkles } from "lucide-react";
import { cn } from "../lib/hooks";

export function Avatar({
  name,
  color,
  size = 28,
  ring,
  title,
}: {
  name: string;
  color: string;
  size?: number;
  ring?: boolean;
  title?: string;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span
      title={title ?? name}
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full font-semibold text-white select-none",
        ring && "ring-2 ring-bg",
      )}
      style={{ background: color, width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials || "?"}
    </span>
  );
}

export function ClaudeAvatar({ size = 28, ring }: { size?: number; ring?: boolean }) {
  return (
    <span
      title="Claude"
      className={cn("inline-grid shrink-0 place-items-center rounded-full bg-ai text-white", ring && "ring-2 ring-bg")}
      style={{ width: size, height: size }}
    >
      <Sparkles size={size * 0.55} strokeWidth={2.2} />
    </span>
  );
}

/** The production AI's avatar: the director of a story. */
export function DirectorAvatar({ size = 28, ring }: { size?: number; ring?: boolean }) {
  return (
    <span
      title="Director"
      className={cn("inline-grid shrink-0 place-items-center rounded-full bg-accent text-white", ring && "ring-2 ring-bg")}
      style={{ width: size, height: size }}
    >
      <Clapperboard size={size * 0.52} strokeWidth={2.2} />
    </span>
  );
}
