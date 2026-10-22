import { createContext, useContext, useState, type ReactNode } from "react";
import type { Id } from "../../convex/_generated/dataModel";

const USER_KEY = "dystory.userId";

export const COLORS = [
  "#e5484d",
  "#f76b15",
  "#d6a10b",
  "#30a46c",
  "#12a594",
  "#0090ff",
  "#3e63dd",
  "#8e4ec6",
  "#d6409f",
  "#7c6f64",
];

export type Me = { _id: Id<"users">; name: string; color: string };

// One id per browser tab, so the same person on two devices shows up twice.
export const SESSION_ID = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);

export function storedUserId(): string | null {
  try {
    return localStorage.getItem(USER_KEY);
  } catch {
    return null;
  }
}

export function storeUserId(id: string | null) {
  try {
    if (id) localStorage.setItem(USER_KEY, id);
    else localStorage.removeItem(USER_KEY);
  } catch {}
}

const MeContext = createContext<Me | null>(null);

export function MeProvider({ me, children }: { me: Me; children: ReactNode }) {
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}

export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe outside MeProvider");
  return me;
}

export function useStoredUserId() {
  const [id, setId] = useState<string | null>(storedUserId);
  return [
    id,
    (next: string | null) => {
      storeUserId(next);
      setId(next);
    },
  ] as const;
}
