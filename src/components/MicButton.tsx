import { LoaderCircle, Mic, Square, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "../lib/hooks";
import { timecode } from "../lib/time";
import type { Dictation } from "../lib/useDictation";

export const DICTATE_SHORTCUT = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘⇧Space" : "Ctrl+Shift+Space";

/** Starts and stops a dictation; while recording, its ring follows your voice. */
export function MicButton({
  dictation,
  className = "size-8 rounded-lg",
  iconSize = 16,
}: {
  dictation: Dictation;
  className?: string;
  iconSize?: number;
}) {
  const { phase, level, toggle } = dictation;
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (phase !== "recording") return;
    let frame = 0;
    const tick = () => {
      ref.current?.style.setProperty("--level", level().toFixed(3));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [phase, level]);

  const label =
    phase === "recording"
      ? "Stop and insert (Esc cancels)"
      : phase === "transcribing"
        ? "Transcribing… (Esc cancels)"
        : phase === "starting"
          ? "Starting the microphone…"
          : `Dictate (${DICTATE_SHORTCUT})`;

  return (
    <button
      ref={ref}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={phase === "recording"}
      aria-busy={phase === "transcribing" || phase === "starting"}
      // Keeps the cursor in the text box, which is where the words go.
      onMouseDown={(e) => e.preventDefault()}
      onClick={toggle}
      className={cn(
        "grid shrink-0 place-items-center transition",
        phase === "recording"
          ? "mic-live bg-danger text-white"
          : phase === "idle"
            ? "text-muted hover:bg-surface-2 hover:text-ink"
            : "cursor-default text-ink-2",
        className,
      )}
    >
      {phase === "recording" ? (
        <Square size={iconSize - 4} fill="currentColor" />
      ) : phase === "transcribing" ? (
        <LoaderCircle size={iconSize} className="animate-spin" />
      ) : (
        <Mic size={iconSize} className={cn(phase === "starting" && "animate-pulse")} />
      )}
    </button>
  );
}

/** What the microphone is doing, shown by the text box while dictating. */
export function DictationStatus({ dictation, className }: { dictation: Dictation; className?: string }) {
  const { phase, seconds, cancel } = dictation;
  if (phase === "idle") return null;
  return (
    <div
      aria-live="polite"
      className={cn(
        "flex h-7 items-center gap-2 rounded-lg pr-0.5 pl-2.5 text-xs",
        phase === "recording" ? "bg-danger/10 text-danger" : "bg-surface-2 text-ink-2",
        className,
      )}
    >
      {phase === "transcribing" ? (
        <LoaderCircle size={13} className="shrink-0 animate-spin" />
      ) : (
        <span className={cn("size-2 shrink-0 rounded-full bg-current", phase === "recording" && "animate-pulse")} />
      )}
      <span className="font-medium whitespace-nowrap tabular-nums">
        {phase === "recording"
          ? `Listening ${timecode(seconds)}`
          : phase === "transcribing"
            ? "Transcribing…"
            : "Starting the microphone…"}
      </span>
      {phase !== "starting" && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={cancel}
          title="Cancel dictation (Esc)"
          aria-label="Cancel dictation (Esc)"
          className="ml-auto grid size-6 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
