import { useQuery } from "convex/react";
import { useCallback, useMemo, useState, type CSSProperties } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export type Category = { _id: Id<"categories">; name: string; color: string; parentId: Id<"categories"> | null };
type CategoryId = Id<"categories">;

export const CATEGORY_COLORS = [
  "#3e63dd",
  "#30a46c",
  "#f76b15",
  "#8e4ec6",
  "#d6409f",
  "#12a594",
  "#e5484d",
  "#d6a10b",
  "#7c6f64",
];

/** The least-used color, so new categories are easy to tell apart. */
export function nextCategoryColor(categories: Category[]) {
  const uses = (c: string) => categories.filter((x) => x.color === c).length;
  return CATEGORY_COLORS.reduce((best, c) => (uses(c) < uses(best) ? c : best));
}

/** Tinted pill colors that read well in both themes: the text is mixed toward the ink color. */
export function categoryTint(color: string): CSSProperties {
  return {
    background: `color-mix(in srgb, ${color} 14%, transparent)`,
    color: `color-mix(in srgb, ${color} 70%, var(--ink))`,
  };
}

/** All categories plus ways to walk the tree. The list is in sidebar order. */
export function useCategories() {
  const list = useQuery(api.categories.list);
  return useMemo(() => {
    const byId = new Map(list?.map((c) => [c._id, c]) ?? []);
    // A parent deleted a moment ago leaves its children at the top level.
    const parentOf = (c: Category) => (c.parentId && byId.has(c.parentId) ? c.parentId : null);
    const kids = new Map<CategoryId | null, Category[]>();
    for (const c of list ?? []) kids.set(parentOf(c), [...(kids.get(parentOf(c)) ?? []), c]);

    const children = (id: CategoryId | null) => kids.get(id) ?? [];
    /** The category and its ancestors, outermost first. */
    const path = (id: CategoryId | null) => {
      const out: Category[] = [];
      for (let c = id ? byId.get(id) : undefined; c && out.length < 50; c = c.parentId ? byId.get(c.parentId) : undefined) {
        out.unshift(c);
      }
      return out;
    };
    /** The category and everything nested in it. */
    const subtree = (id: CategoryId) => {
      const out = new Set<CategoryId>([id]);
      for (const cid of out) for (const k of children(cid)) out.add(k._id);
      return out;
    };
    /** Every category in sidebar order, with how deeply it's nested. */
    const flat = () => {
      const out: { category: Category; depth: number }[] = [];
      const walk = (id: CategoryId | null, depth: number) => {
        for (const c of children(id)) {
          out.push({ category: c, depth });
          walk(c._id, depth + 1);
        }
      };
      walk(null, 0);
      return out;
    };
    const pathLabel = (id: CategoryId) => path(id).map((c) => c.name).join(" / ");
    return { list, byId, parentOf, children, path, subtree, flat, pathLabel };
  }, [list]);
}

const COLLAPSED_KEY = "dystory.collapsedCategories";

/** Which sidebar sections are folded, remembered per browser. */
export function useCollapsedCategories() {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]"));
    } catch {
      return new Set();
    }
  });
  const set = useCallback((id: string, folded: boolean) => {
    setCollapsed((prev) => {
      if (prev.has(id) === folded) return prev;
      const next = new Set(prev);
      if (folded) next.add(id);
      else next.delete(id);
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  }, []);
  return [collapsed, set] as const;
}

// Drag-and-drop payload types; a custom type keeps drops from other apps out.
export const DRAG_DOC = "application/x-ideaboard-doc";
export const DRAG_CATEGORY = "application/x-ideaboard-category";
