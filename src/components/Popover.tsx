import { autoUpdate, computePosition, flip, offset, shift, type Placement } from "@floating-ui/dom";
import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/hooks";

/**
 * A floating panel anchored to `anchor`, rendered in a portal so scrolling
 * containers (like the sidebar) can't clip it. Closes on Escape or an outside click.
 */
export function Popover({
  anchor,
  onClose,
  children,
  placement = "bottom-start",
  className,
}: {
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  placement?: Placement;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const a = anchor.current;
    const el = ref.current;
    if (!a || !el) return;
    return autoUpdate(a, el, () =>
      computePosition(a, el, {
        placement,
        strategy: "fixed",
        middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
      }).then(({ x, y }) => Object.assign(el.style, { left: `${x}px`, top: `${y}px` })),
    );
  }, [anchor, placement]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onCloseRef.current();
      anchor.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.current?.contains(t)) onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [anchor]);

  return createPortal(
    <div
      ref={ref}
      style={{ position: "fixed", left: 0, top: 0 }}
      className={cn(
        "pop-in z-[95] rounded-xl border border-line bg-surface p-1 shadow-float",
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}
