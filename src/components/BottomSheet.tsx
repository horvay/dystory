import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A side panel on a phone: it rises from the bottom and is dragged down to
 * close, by the handle, the header, or the content once it's scrolled to the
 * top. Sideways swipes stay free for the browser's back gesture and for
 * swipe-to-reply in the chat, and back closes the sheet instead of leaving
 * the page. `children` gets the animated close for its own close buttons.
 */
export function BottomSheet({ onClose, children }: { onClose: () => void; children: (close: () => void) => ReactNode }) {
  const sheet = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const closed = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const finish = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    onCloseRef.current();
  }, []);
  const close = useCallback(() => {
    const el = sheet.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return finish();
    setClosing(true);
    el.style.transition = "";
    el.style.transform = "translateY(100%)";
    // transitionend doesn't come when nothing moves (already off screen).
    setTimeout(finish, 320);
  }, [finish]);

  useBackCloses(finish);

  useEffect(() => {
    const el = sheet.current!;
    let mode: "idle" | "maybe" | "drag" = "idle";
    let startX = 0;
    let startY = 0;
    let dy = 0;
    let lastY = 0;
    let lastT = 0;
    let speed = 0;

    const start = (e: TouchEvent) => {
      mode = "idle";
      if (e.touches.length !== 1) return;
      const target = e.target as HTMLElement;
      if (target.closest("textarea, input, [contenteditable='true']")) return;
      if (scrolledAwayFromTop(target, el)) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = lastY = t.clientY;
      lastT = e.timeStamp;
      dy = speed = 0;
      mode = "maybe";
    };
    const move = (e: TouchEvent) => {
      if (mode === "idle") return;
      const t = e.touches[0];
      const y = t.clientY - startY;
      if (mode === "maybe") {
        // Up or sideways: leave it to scrolling, swipe-to-reply or back.
        if (y < 0 || Math.abs(t.clientX - startX) > Math.abs(y)) {
          mode = "idle";
          return;
        }
        if (y === 0) return;
        mode = "drag";
        el.style.transition = "none";
      }
      // Also stops the content's overscroll and pull-to-refresh.
      e.preventDefault();
      dy = Math.max(0, y);
      const dt = e.timeStamp - lastT;
      if (dt > 0) speed = (t.clientY - lastY) / dt;
      lastY = t.clientY;
      lastT = e.timeStamp;
      el.style.transform = `translateY(${dy}px)`;
    };
    const end = () => {
      if (mode !== "drag") {
        mode = "idle";
        return;
      }
      mode = "idle";
      el.style.transition = "";
      if (dy > el.offsetHeight * 0.25 || speed > 0.5) close();
      else el.style.transform = "";
    };

    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, [close]);

  return (
    <>
      <div
        className="fade-in fixed inset-0 z-40 bg-black/30 transition-opacity duration-300"
        style={closing ? { opacity: 0 } : undefined}
        onClick={close}
      />
      <div
        ref={sheet}
        className="sheet-up fixed inset-x-0 bottom-0 z-50 flex h-[calc(100dvh-2.5rem)] flex-col overflow-hidden overscroll-contain rounded-t-2xl border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-float transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex h-5 shrink-0 cursor-grab justify-center pt-2" aria-hidden>
          <div className="h-1 w-10 rounded-full bg-line-strong" />
        </div>
        <div className="min-h-0 flex-1">{children(close)}</div>
      </div>
    </>
  );
}

/** Whether anything scrollable between `from` and the sheet isn't at its top. */
function scrolledAwayFromTop(from: HTMLElement, sheet: HTMLElement) {
  for (let el: HTMLElement | null = from; el && el !== sheet; el = el.parentElement) {
    if (el.scrollTop > 0) return true;
  }
  return false;
}

/**
 * While mounted, the browser's back (button or edge swipe) calls `onBack`
 * instead of leaving the page. Closing some other way takes the extra
 * history entry back out.
 */
function useBackCloses(onBack: () => void) {
  const cb = useRef(onBack);
  cb.current = onBack;
  useEffect(() => {
    openSheets++;
    if (!history.state?.sheet) history.pushState({ ...history.state, sheet: true }, "");
    const onPop = () => cb.current();
    window.addEventListener("popstate", onPop);
    return () => {
      openSheets--;
      window.removeEventListener("popstate", onPop);
      // Later, so a remount (StrictMode) keeps the entry instead of going back.
      setTimeout(() => {
        if (openSheets === 0 && history.state?.sheet) history.back();
      });
    };
  }, []);
}
let openSheets = 0;
