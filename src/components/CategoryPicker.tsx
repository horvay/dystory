import { useMutation } from "convex/react";
import { Check, ChevronDown, FolderMinus, Plus, Tag } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { categoryTint, nextCategoryColor, useCategories, type Category } from "../lib/categories";
import { useMe } from "../lib/identity";
import { cn } from "../lib/hooks";
import { Popover } from "./Popover";

type CategoryId = Id<"categories">;

/** The pill above a document's title: shows its category and opens a picker to change it. */
export function CategoryPicker({
  value,
  onChange,
}: {
  value: CategoryId | null;
  onChange: (id: CategoryId | null) => void;
}) {
  const { byId, path } = useCategories();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const current = value ? byId.get(value) : undefined;
  const ancestors = current ? path(current._id).slice(0, -1) : [];

  return (
    <>
      <button
        ref={ref}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "group/cat inline-flex h-7 max-w-full items-center gap-1.5 rounded-full text-[13px] font-medium transition",
          current
            ? "pr-2 pl-2.5"
            : "-ml-2 px-2 text-muted hover:bg-surface-2 hover:text-ink-2",
        )}
        style={current ? categoryTint(current.color) : undefined}
      >
        {current ? (
          <>
            <span className="size-2 shrink-0 rounded-full" style={{ background: current.color }} />
            <span className="truncate">
              {ancestors.map((a) => (
                <span key={a._id} className="opacity-65">
                  {a.name} /{" "}
                </span>
              ))}
              {current.name}
            </span>
            <ChevronDown size={13} className="shrink-0 opacity-60 transition group-hover/cat:opacity-100" />
          </>
        ) : (
          <>
            <Tag size={13} /> Add category
          </>
        )}
      </button>
      {open && (
        <Popover anchor={ref} onClose={() => setOpen(false)} className="w-64">
          <CategoryMenu
            value={value}
            onPick={(id) => {
              setOpen(false);
              if (id !== value) onChange(id);
            }}
          />
        </Popover>
      )}
    </>
  );
}

type Option =
  | { kind: "category"; category: Category; depth: number }
  | { kind: "create"; name: string; parent: Category | null }
  | { kind: "none" };

/** Search-or-create list of categories, driven by the keyboard or the mouse. */
export function CategoryMenu({
  value,
  onPick,
}: {
  value: CategoryId | null;
  onPick: (id: CategoryId | null) => void;
}) {
  const me = useMe();
  const { list, byId, flat, path } = useCategories();
  const create = useMutation(api.categories.create);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const q = query.trim().replace(/\s+/g, " ");
  const lower = q.toLowerCase();
  // The whole tree when browsing; a flat list of matches (shown with their path) when searching.
  const matches = flat().filter(({ category }) => category.name.toLowerCase().includes(lower));
  const current = value ? byId.get(value) : undefined;
  const exists = (parent: Category | null) =>
    (list ?? []).some((c) => c.parentId === (parent?._id ?? null) && c.name.toLowerCase() === lower);
  const options: Option[] = [
    ...matches.map(({ category, depth }) => ({ kind: "category" as const, category, depth: q ? 0 : depth })),
    ...(q && !exists(null) ? [{ kind: "create" as const, name: q, parent: null }] : []),
    // With a category already set, offer to create the new one inside it as well.
    ...(q && current && !exists(current) ? [{ kind: "create" as const, name: q, parent: current }] : []),
    ...(value && !q ? [{ kind: "none" as const }] : []),
  ];

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = async (o: Option | undefined) => {
    if (!o) return;
    if (o.kind === "category") onPick(o.category._id);
    else if (o.kind === "none") onPick(null);
    else {
      const color = nextCategoryColor(list ?? []);
      onPick(await create({ userId: me._id, name: o.name, color, parentId: o.parent?._id }));
    }
  };

  return (
    <div>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const n = options.length;
            if (n) setActive((a) => (a + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
          } else if (e.key === "Enter") {
            e.preventDefault();
            choose(options[active]);
          }
        }}
        placeholder={list?.length ? "Find or create a category…" : "Name a new category…"}
        aria-label="Category"
        role="combobox"
        aria-expanded
        aria-controls="category-options"
        aria-activedescendant={options.length ? `category-option-${active}` : undefined}
        className="h-9 w-full rounded-lg bg-transparent px-2.5 text-sm outline-none placeholder:text-muted"
      />
      <div className="-mx-1 my-1 h-px bg-line" />
      <div ref={listRef} id="category-options" role="listbox" className="scroll-thin max-h-64 overflow-y-auto">
        {options.length === 0 && (
          <p className="px-2.5 py-2 text-sm text-muted">
            {list === undefined ? "Loading…" : "Type a name to create your first category."}
          </p>
        )}
        {options.map((o, i) => (
          <button
            key={o.kind === "category" ? o.category._id : o.kind === "create" ? `create-${o.parent?._id}` : o.kind}
            id={`category-option-${i}`}
            data-index={i}
            role="option"
            aria-selected={i === active}
            tabIndex={-1}
            onMouseMove={() => setActive(i)}
            onClick={() => choose(o)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm",
              i === active && "bg-surface-2",
              o.kind === "none" && "text-muted",
            )}
          >
            {o.kind === "category" && (
              <>
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: o.category.color, marginLeft: o.depth * 14 }}
                />
                <span className="min-w-0 flex-1 truncate">
                  {q &&
                    path(o.category._id)
                      .slice(0, -1)
                      .map((a) => (
                        <span key={a._id} className="text-muted">
                          {a.name} /{" "}
                        </span>
                      ))}
                  {o.category.name}
                </span>
                {o.category._id === value && <Check size={15} className="shrink-0 text-ink-2" />}
              </>
            )}
            {o.kind === "create" && (
              <>
                <Plus size={15} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate">
                  Create <span className="font-medium">“{o.name}”</span>
                  {o.parent && <span className="text-muted"> in {o.parent.name}</span>}
                </span>
              </>
            )}
            {o.kind === "none" && (
              <>
                <FolderMinus size={15} className="shrink-0" /> Remove from category
              </>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
