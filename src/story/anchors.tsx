// What a note in the story's thread points at: images picked in a card, or a
// moment of a cut. Cards add them; the composer shows them as chips and sends
// them with the note.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Id } from "../../convex/_generated/dataModel";

export type Anchor =
  | { kind: "image"; id: Id<"images">; label: string; thumb: string }
  | { kind: "cut"; versionId: Id<"versions">; number: number; time: number };

type Anchors = {
  anchors: Anchor[];
  toggleImage: (a: Extract<Anchor, { kind: "image" }>) => void;
  setCut: (a: Extract<Anchor, { kind: "cut" }>) => void;
  remove: (a: Anchor) => void;
  clear: () => void;
  has: (imageId: Id<"images">) => boolean;
  /** Bumped whenever something is added, so the composer takes focus. */
  focusSignal: number;
};

const Ctx = createContext<Anchors | null>(null);

export function AnchorsProvider({ children }: { children: ReactNode }) {
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [focusSignal, setFocus] = useState(0);
  const toggleImage = useCallback((a: Extract<Anchor, { kind: "image" }>) => {
    setAnchors((list) => {
      const on = list.some((x) => x.kind === "image" && x.id === a.id);
      return on ? list.filter((x) => !(x.kind === "image" && x.id === a.id)) : [...list, a];
    });
    setFocus((n) => n + 1);
  }, []);
  // One moment of one cut at a time.
  const setCut = useCallback((a: Extract<Anchor, { kind: "cut" }>) => {
    setAnchors((list) => [...list.filter((x) => x.kind !== "cut"), a]);
    setFocus((n) => n + 1);
  }, []);
  const remove = useCallback((a: Anchor) => setAnchors((list) => list.filter((x) => x !== a)), []);
  const clear = useCallback(() => setAnchors([]), []);
  const value = useMemo(
    () => ({
      anchors,
      toggleImage,
      setCut,
      remove,
      clear,
      has: (id: Id<"images">) => anchors.some((x) => x.kind === "image" && x.id === id),
      focusSignal,
    }),
    [anchors, toggleImage, setCut, remove, clear, focusSignal],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAnchors() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAnchors outside AnchorsProvider");
  return ctx;
}
