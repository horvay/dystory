import { useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/hooks";

/**
 * Slides its content open and shut (see .slide-reveal in index.css). While
 * closing it keeps showing what it last showed, then unmounts.
 */
export function Collapse({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  const [mounted, setMounted] = useState(open);
  const last = useRef(children);
  if (open) last.current = children;
  if (open && !mounted) setMounted(true);
  if (!mounted && !open) return null;
  return (
    <div
      className={cn("slide-reveal", className)}
      data-open={open}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === "grid-template-rows" && !open) setMounted(false);
      }}
    >
      <div className="min-h-0 overflow-hidden">{open ? children : last.current}</div>
    </div>
  );
}
