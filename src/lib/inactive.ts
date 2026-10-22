import { useSyncExternalStore } from "react";

/** A document nobody has opened or typed in for this long is inactive. */
export const INACTIVE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

export const isInactive = (d: { activeAt: number }, now: number) => now - d.activeAt > INACTIVE_AFTER_MS;

const KEY = "dystory.showInactive";
const listeners = new Set<() => void>();
let show = (() => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
})();

export function setShowInactive(value: boolean) {
  show = value;
  try {
    localStorage.setItem(KEY, value ? "1" : "0");
  } catch {}
  for (const l of listeners) l();
}

/** Whether the sidebar and home screen list inactive documents; shared by both, remembered per browser. */
export function useShowInactive() {
  const value = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => show,
  );
  return [value, setShowInactive] as const;
}
