import { Clapperboard, Infinity as InfinityIcon, Sparkles } from "lucide-react";
import type { AiAgent } from "../../shared/agents";
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

export function MuseAvatar({ size = 28, ring }: { size?: number; ring?: boolean }) {
  return (
    <span
      title="Muse"
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full bg-[#0866ff] text-white",
        ring && "ring-2 ring-bg",
      )}
      style={{ width: size, height: size }}
    >
      <InfinityIcon size={size * 0.6} strokeWidth={2.4} />
    </span>
  );
}

/** Whichever model answered a script-assistant request. Older requests are Claude. */
export function AgentAvatar({ agent, ...props }: { agent?: AiAgent; size?: number; ring?: boolean }) {
  return agent === "muse" ? <MuseAvatar {...props} /> : <ClaudeAvatar {...props} />;
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
