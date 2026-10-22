import { useMutation, useQuery } from "convex/react";
import {
  ArrowUpLeft,
  AudioLines,
  Bell,
  BellOff,
  Clapperboard,
  Film,
  ChevronRight,
  FileText,
  FolderPlus,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { stageInfo } from "../../shared/stages";
import { NewStoryDialog, STATE_LABEL, STATE_TONE } from "../story/stageUi";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  CATEGORY_COLORS,
  DRAG_CATEGORY,
  DRAG_DOC,
  nextCategoryColor,
  useCategories,
  useCollapsedCategories,
  type Category,
} from "../lib/categories";
import { useMe } from "../lib/identity";
import { useNotifications } from "../lib/notifications";
import { cn, useNow } from "../lib/hooks";
import { isInactive, useShowInactive } from "../lib/inactive";
import { relativeTime } from "../lib/time";
import { Avatar } from "./Avatar";
import { Popover } from "./Popover";
import { ProfileDialog } from "./ProfileDialog";
import { useShell } from "./Shell";
import { useToast } from "./Toast";
import { useCreateDoc } from "./useCreateDoc";

const ONLINE_MS = 30_000;
const UNCATEGORIZED = "uncategorized";

type CategoryId = Id<"categories">;
type Zone = "before" | "inside" | "after";
type DropProps = {
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
};

type DocItem = NonNullable<ReturnType<typeof useQuery<typeof api.docs.list>>>[number];
type Viewer = { userId: Id<"users">; name: string; color: string };

export function Sidebar({ onSwitchUser }: { onSwitchUser: () => void }) {
  const me = useMe();
  const now = useNow(10_000);
  const { toggleSidebar } = useShell();
  const [showTrash, setShowTrash] = useState(false);
  const [search, setSearch] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [showInactive, setShowInactive] = useShowInactive();
  const [, route] = useRoute("/d/:id");
  const docs = useQuery(api.docs.list, { trashed: showTrash });
  const users = useQuery(api.users.list);
  const online = useQuery(api.presence.online);
  const worker = useQuery(api.ai.workerStatus, {});
  const director = useQuery(api.ai.workerStatus, { name: "director" });
  const stories = useQuery(api.stories.list, {});
  const [newStory, setNewStory] = useState(false);
  const [location] = useLocation();
  const createDoc = useCreateDoc();

  const userById = useMemo(() => new Map(users?.map((u) => [u._id, u]) ?? []), [users]);
  const viewers = useMemo(() => {
    const m = new Map<string, Viewer[]>();
    for (const p of online ?? []) {
      if (now - p.lastSeen > ONLINE_MS || p.userId === me._id) continue;
      const list = m.get(p.docId) ?? [];
      if (!list.some((x) => x.userId === p.userId)) list.push(p);
      m.set(p.docId, list);
    }
    return m;
  }, [online, now, me._id]);

  // Inactive documents are left out unless asked for or searched for. The one
  // you're on stays, even if it went inactive while you had it open.
  const inactive = (d: DocItem) => isInactive(d, now);
  const hidden =
    docs && !showTrash && !showInactive && !search.trim()
      ? docs.filter((d) => d._id !== route?.id && inactive(d))
      : [];
  const listed = docs?.filter((d) => !hidden.includes(d));
  const inactiveCount = docs?.filter(inactive).length ?? 0;

  const claudeOffline = worker !== undefined && (!worker || now - worker.lastSeen > 35_000);
  const directorOffline = director !== undefined && (!director || now - director.lastSeen > 35_000);
  const meta = (d: DocItem) =>
    (d.lastEditedBy && d.lastEditedBy !== me._id && userById.get(d.lastEditedBy)
      ? `${userById.get(d.lastEditedBy)!.name} · `
      : "") + relativeTime(d.updatedAt, now);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 px-4">
        <Link href="/" className="flex items-center gap-2">
          <img src="/icon.svg" alt="" className="size-7 rounded-lg" />
          <span className="font-semibold tracking-tight">Dystory</span>
        </Link>
        <button
          onClick={toggleSidebar}
          className="ml-auto grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
          aria-label="Hide sidebar"
        >
          <PanelLeftClose size={18} />
        </button>
      </div>

      {showTrash ? (
        <div className="flex items-center justify-between px-4 pt-1 pb-2">
          <span className="text-sm font-semibold">Trash</span>
          <button
            onClick={() => setShowTrash(false)}
            className="rounded-lg px-2.5 py-1 text-sm font-medium text-accent hover:bg-surface-2"
          >
            Done
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-2 px-3">
            <div className="flex gap-2">
              <button
                onClick={() => setNewStory(true)}
                className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-ink text-sm font-medium text-bg shadow-soft transition hover:opacity-90"
              >
                <Clapperboard size={16} /> New story
              </button>
              <button
                onClick={() => createDoc()}
                title="New document"
                className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink shadow-soft transition hover:border-line-strong"
              >
                <Plus size={16} /> Doc
              </button>
            </div>
            <label className="flex h-9 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm focus-within:border-line-strong">
              <Search size={15} className="text-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search"
                aria-label="Search documents"
                className="w-full bg-transparent outline-none placeholder:text-muted"
              />
            </label>
          </div>
          <div className="mt-2 space-y-0.5 px-2">
            <NavLink href="/reviews" active={location.startsWith("/reviews") || location.startsWith("/v/")} icon={Film} label="Reviews" />
            <NavLink href="/voices" active={location.startsWith("/voices")} icon={AudioLines} label="Voices" />
            <NotifyToggle />
          </div>
        </>
      )}

      <nav className="scroll-thin flex-1 overflow-y-auto px-2 pb-3">
        {!showTrash && (
          <StoryList
            stories={(stories ?? []).filter(
              (st) => !search.trim() || st.title.toLowerCase().includes(search.trim().toLowerCase()),
            )}
            loading={stories === undefined}
          />
        )}
        {!showTrash && (
          <div className="mt-3 flex items-center pr-0 pl-2">
            <span className="flex-1 text-[11px] font-semibold tracking-wider text-muted uppercase">Documents</span>
            <button
              onClick={() => setShowInactive(!showInactive)}
              aria-pressed={showInactive}
              title="Also list documents nobody has opened in two days, and ones marked inactive"
              className="flex h-7 items-center gap-1.5 rounded-lg px-1.5 text-xs text-muted hover:bg-surface-2 hover:text-ink"
            >
              <span
                className={cn(
                  "relative h-3.5 w-6 shrink-0 rounded-full transition-colors",
                  showInactive ? "bg-accent" : "bg-line-strong",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 size-2.5 rounded-full bg-white transition-[left]",
                    showInactive ? "left-3" : "left-0.5",
                  )}
                />
              </span>
              Show inactive
              {inactiveCount > 0 && <span className="tabular-nums">{inactiveCount}</span>}
            </button>
            <button
              onClick={() => setCreatingCategory(true)}
              title="New category"
              aria-label="New category"
              className="grid size-7 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
            >
              <FolderPlus size={15} />
            </button>
          </div>
        )}
        {docs === undefined && <p className="px-3 py-2 text-sm text-muted">Loading…</p>}
        {showTrash ? (
          <>
            {docs?.length === 0 && <p className="px-3 py-2 text-sm text-muted">Trash is empty.</p>}
            {docs?.map((d) => (
              <TrashRow key={d._id} docId={d._id} title={d.title} onRestored={() => setShowTrash(false)} />
            ))}
          </>
        ) : (
          listed && (
            <DocTree
              docs={listed}
              hidden={hidden}
              inactive={inactive}
              onShowInactive={() => setShowInactive(true)}
              search={search}
              creatingCategory={creatingCategory}
              onCreatingDone={() => setCreatingCategory(false)}
              meta={meta}
              viewers={viewers}
            />
          )
        )}
      </nav>

      <div className="space-y-1 border-t border-line p-2">
        {!showTrash && (
          <button
            onClick={() => setShowTrash(true)}
            className="flex h-9 w-full items-center gap-2.5 rounded-xl px-2.5 text-sm text-ink-2 hover:bg-surface-2"
          >
            <Trash2 size={16} className="text-muted" /> Trash
          </button>
        )}
        {claudeOffline && (
          <div
            className="mx-1 flex items-center gap-2 rounded-lg bg-amber-500/12 px-2.5 py-2 text-xs text-amber-600"
            title="Start the app with `bun run dev` to run the AI worker"
          >
            <span className="size-1.5 rounded-full bg-amber-500" /> Claude is offline
          </div>
        )}
        {directorOffline && (
          <div
            className="mx-1 flex items-center gap-2 rounded-lg bg-amber-500/12 px-2.5 py-2 text-xs text-amber-600"
            title="The director worker isn't running, so stories don't move forward"
          >
            <span className="size-1.5 rounded-full bg-amber-500" /> The director is offline
          </div>
        )}
        <button
          onClick={() => setProfileOpen(true)}
          className="flex h-11 w-full items-center gap-2.5 rounded-xl px-2 hover:bg-surface-2"
          aria-label="Profile and settings"
        >
          <Avatar name={me.name} color={me.color} size={28} />
          <span className="truncate text-sm font-medium">{me.name}</span>
        </button>
      </div>
      {profileOpen && <ProfileDialog onClose={() => setProfileOpen(false)} onSwitchUser={onSwitchUser} />}
      {newStory && <NewStoryDialog onClose={() => setNewStory(false)} />}
    </div>
  );
}

function NavLink({ href, active, icon: Icon, label }: { href: string; active: boolean; icon: typeof Film; label: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm",
        active ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:bg-surface-2",
      )}
    >
      <Icon size={15} className="text-muted" /> {label}
    </Link>
  );
}

/** Chrome notifications for this browser: on when the director hands a story back. */
function NotifyToggle() {
  const me = useMe();
  const { state, toggle } = useNotifications(me._id);
  const toast = useToast();
  if (state === "unsupported") return null;
  const label =
    state === "on" ? "Notifications on" : state === "blocked" ? "Notifications blocked" : "Turn on notifications";
  const title =
    state === "on"
      ? "This browser gets a notification when the director finishes and hands a story back. Click to turn off."
      : state === "blocked"
        ? "Chrome is blocking notifications for this site. Allow them from the lock icon in the address bar."
        : "Get a notification in this browser when the director finishes and hands a story back.";
  const Icon = state === "on" ? Bell : BellOff;
  return (
    <button
      onClick={() =>
        state === "blocked"
          ? toast({ message: "Chrome is blocking notifications here. Allow them from the icon left of the address." })
          : void toggle()
      }
      disabled={state === "loading"}
      title={title}
      className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-ink-2 hover:bg-surface-2 disabled:opacity-60"
    >
      <Icon size={15} className={state === "on" ? "text-accent" : "text-muted"} /> {label}
    </button>
  );
}

type StoryItem = NonNullable<ReturnType<typeof useQuery<typeof api.stories.list>>>[number];

/** Stories in production first, then the rest; each with its stage and who has the ball. */
function StoryList({ stories, loading }: { stories: StoryItem[]; loading: boolean }) {
  const [, params] = useRoute("/s/:id/*?");
  if (loading) return null;
  return (
    <div className="mt-1">
      <div className="flex h-8 items-center pl-2">
        <span className="text-[11px] font-semibold tracking-wider text-muted uppercase">Stories</span>
      </div>
      {stories.length === 0 && <p className="px-3 py-1 text-sm text-muted">No stories yet.</p>}
      <div className="space-y-0.5">
        {stories.map((st) => (
          <Link
            key={st._id}
            href={`/s/${st._id}`}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5",
              params?.id === st._id ? "bg-surface-2" : "hover:bg-surface-2",
            )}
          >
            <span className={cn("size-2 shrink-0 rounded-full", STATE_TONE[st.state].dot)} title={STATE_LABEL[st.state]} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{st.title}</span>
              <span className="block truncate text-xs text-muted">
                {st.stage === "done" ? "Published" : `${stageInfo(st.stage).label} · ${STATE_LABEL[st.state]}`}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/**
 * The document list. Without categories it's a flat list; once there are
 * some, documents are grouped into collapsible, nestable sections. Documents
 * can be dragged between sections, and sections dragged before, after or
 * into one another.
 */
function DocTree({
  docs,
  hidden,
  inactive,
  onShowInactive,
  search,
  creatingCategory,
  onCreatingDone,
  meta,
  viewers,
}: {
  docs: DocItem[];
  /** Inactive documents left out of `docs`. */
  hidden: DocItem[];
  inactive: (d: DocItem) => boolean;
  onShowInactive: () => void;
  search: string;
  creatingCategory: boolean;
  onCreatingDone: () => void;
  meta: (d: DocItem) => string;
  viewers: Map<string, Viewer[]>;
}) {
  const { list: categories, byId, parentOf, children, path, subtree, pathLabel } = useCategories();
  const [collapsed, setCollapsed] = useCollapsedCategories();
  const [, params] = useRoute("/d/:id");
  const setCategory = useMutation(api.docs.setCategory);
  const moveCategoryTo = useMutation(api.categories.move);
  const toast = useToast();
  const [dragging, setDragging] = useState<{ kind: "doc" | "category"; id: string } | null>(null);
  const [over, setOver] = useState<{ key: string; zone: Zone } | null>(null);
  const [creatingIn, setCreatingIn] = useState<CategoryId | null>(null);

  const q = search.trim().toLowerCase();
  const groupOf = (d: DocItem) => (d.categoryId && byId.has(d.categoryId) ? d.categoryId : UNCATEGORIZED);

  // Open the sections holding the document you just navigated to.
  const activeDoc = docs.find((d) => d._id === params?.id);
  const activeKey = activeDoc ? groupOf(activeDoc) : null;
  const activePath =
    activeKey === UNCATEGORIZED ? UNCATEGORIZED : activeKey && path(activeKey).map((c) => c._id).join(",");
  useEffect(() => {
    for (const key of activePath?.split(",") ?? []) setCollapsed(key, false);
  }, [params?.id, activePath, setCollapsed]);

  // A drag that ends anywhere (dropped or cancelled) clears the drop highlight.
  useEffect(() => {
    if (!dragging) return;
    const end = () => {
      setDragging(null);
      setOver(null);
    };
    window.addEventListener("dragend", end);
    window.addEventListener("drop", end);
    return () => {
      window.removeEventListener("dragend", end);
      window.removeEventListener("drop", end);
    };
  }, [dragging]);

  if (categories === undefined) return null;

  const row = (d: DocItem) => (
    <DocRow
      key={d._id}
      doc={d}
      active={params?.id === d._id}
      inactive={inactive(d)}
      meta={meta(d)}
      viewers={viewers.get(d._id)}
      draggable={categories.length > 0}
      onDragStart={() => setDragging({ kind: "doc", id: d._id })}
    />
  );

  const newCategoryRow = creatingCategory && (
    <NewCategoryRow categories={categories} parentId={null} onDone={onCreatingDone} />
  );

  if (categories.length === 0) {
    const visible = docs.filter((d) => !q || (d.title || "Untitled").toLowerCase().includes(q));
    return (
      <div className="space-y-0.5">
        {newCategoryRow}
        {visible.length === 0 &&
          (!q && hidden.length ? (
            <InactiveNote count={hidden.length} onShow={onShowInactive} />
          ) : (
            <p className="px-3 py-2 text-sm text-muted">{q ? "No matches." : "No documents yet."}</p>
          ))}
        {visible.map(row)}
      </div>
    );
  }

  const docsIn = new Map<string, DocItem[]>();
  for (const d of docs) docsIn.set(groupOf(d), [...(docsIn.get(groupOf(d)) ?? []), d]);
  const hiddenIn = (key: string) => hidden.filter((d) => groupOf(d) === key).length;
  const subtreeDocs = (id: CategoryId) => [...subtree(id)].flatMap((k) => docsIn.get(k) ?? []);

  // Searching matches document titles, and category names: a matching
  // category shows everything in it.
  const categoryMatches = (id: CategoryId) => path(id).some((c) => c.name.toLowerCase().includes(q));
  const docMatches = (d: DocItem) => {
    if (!q || (d.title || "Untitled").toLowerCase().includes(q)) return true;
    const key = groupOf(d);
    return key !== UNCATEGORIZED && categoryMatches(key);
  };
  const shows = (c: Category) => !q || categoryMatches(c._id) || subtreeDocs(c._id).some(docMatches);

  const moveDoc = async (docId: Id<"docs">, to: Category | null) => {
    const d = docs.find((x) => x._id === docId);
    if (!d || (d.categoryId ?? null) === (to?._id ?? null)) return;
    const from = d.categoryId ?? null;
    await setCategory({ docId, categoryId: to?._id ?? null });
    toast({
      message: `Moved “${d.title || "Untitled"}” to ${to ? pathLabel(to._id) : "Uncategorized"}`,
      action: { label: "Undo", run: () => setCategory({ docId, categoryId: from }) },
    });
  };

  const moveCategory = async (id: string, targetId: CategoryId | null, zone: Zone) => {
    const dragged = byId.get(id as CategoryId);
    const target = targetId && byId.get(targetId);
    if (!dragged || (target && subtree(dragged._id).has(target._id))) return;
    const fromParent = parentOf(dragged);
    const fromSiblings = children(fromParent).map((c) => c._id);
    const parent = !target ? null : zone === "inside" ? target._id : parentOf(target);
    const siblings = children(parent)
      .map((c) => c._id)
      .filter((x) => x !== dragged._id);
    const at = !target || zone === "inside" ? 0 : siblings.indexOf(target._id) + (zone === "after" ? 1 : 0);
    siblings.splice(at, 0, dragged._id);
    await moveCategoryTo({ categoryId: dragged._id, parentId: parent, siblingIds: siblings });
    if (parent) setCollapsed(parent, false);
    if (parent === fromParent) return;
    toast({
      message: parent ? `Moved “${dragged.name}” into ${pathLabel(parent)}` : `Moved “${dragged.name}” to the top level`,
      action: {
        label: "Undo",
        run: () => moveCategoryTo({ categoryId: dragged._id, parentId: fromParent, siblingIds: fromSiblings }),
      },
    });
  };

  // A category can't be dropped onto itself or anything inside it.
  const draggedCategory = dragging?.kind === "category" ? (dragging.id as CategoryId) : null;
  const blocked = (c: Category | null) => !c || (!!draggedCategory && subtree(draggedCategory).has(c._id));
  const finishDrop = () => {
    setDragging(null);
    setOver(null);
  };

  // The whole section takes documents, and categories dropped "into" it.
  const sectionDrop = (key: string, c: Category | null) => ({
    onDragOver: (e: DragEvent) => {
      const types = e.dataTransfer.types;
      if (types.includes(DRAG_CATEGORY) && blocked(c)) {
        // Keep enclosing sections from lighting up instead.
        if (c) e.stopPropagation();
        return;
      }
      if (!types.includes(DRAG_DOC) && !types.includes(DRAG_CATEGORY)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      if (over?.key !== key || over.zone !== "inside") setOver({ key, zone: "inside" });
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o?.key === key ? null : o));
    },
    onDrop: (e: DragEvent) => {
      const docId = e.dataTransfer.getData(DRAG_DOC);
      const catId = e.dataTransfer.getData(DRAG_CATEGORY);
      if (!docId && !catId) return;
      e.preventDefault();
      e.stopPropagation();
      if (docId) moveDoc(docId as Id<"docs">, c);
      else if (c) moveCategory(catId, c._id, "inside");
      finishDrop();
    },
  });

  // A category dragged over a header goes before it, after it, or into it,
  // depending on whether it's over the top, bottom or middle of the header.
  const headerDrop = (c: Category) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_CATEGORY) || !draggedCategory) return;
      e.stopPropagation();
      if (blocked(c)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const r = e.currentTarget.getBoundingClientRect();
      const y = (e.clientY - r.top) / r.height;
      const zone: Zone = y < 0.3 ? "before" : y > 0.7 ? "after" : "inside";
      if (over?.key !== c._id || over.zone !== zone) setOver({ key: c._id, zone });
    },
    onDrop: (e: DragEvent) => {
      const catId = e.dataTransfer.getData(DRAG_CATEGORY);
      if (!catId || over?.key !== c._id) return;
      e.preventDefault();
      e.stopPropagation();
      moveCategory(catId, c._id, over.zone);
      finishDrop();
    },
  });

  const deleteNote = (c: Category) => {
    const nDocs = docsIn.get(c._id)?.length ?? 0;
    const nKids = children(c._id).length;
    if (!nDocs && !nKids) return "It's empty, so nothing else changes.";
    const parent = parentOf(c);
    const dest = parent ? byId.get(parent)!.name : null;
    const lines = [];
    if (nDocs) {
      lines.push(`${nDocs === 1 ? "Its document moves" : `Its ${nDocs} documents move`} to ${dest ?? "Uncategorized"}.`);
    }
    if (nKids) {
      lines.push(
        `${nKids === 1 ? "Its subcategory moves" : `Its ${nKids} subcategories move`} ${dest ? `into ${dest}` : "to the top level"}.`,
      );
    }
    return `${lines.join(" ")} Nothing is deleted.`;
  };

  const sectionClass = (key: string) =>
    cn("relative rounded-xl transition-colors", over?.key === key && over.zone === "inside" && "bg-accent/8 ring-1 ring-accent/40");
  const indicator = (key: string) =>
    over?.key === key &&
    over.zone !== "inside" && (
      <div
        className={cn(
          "pointer-events-none absolute inset-x-2 z-10 h-0.5 rounded-full bg-accent",
          over.zone === "before" ? "-top-0.5" : "-bottom-0.5",
        )}
      />
    );

  const renderCategory = (c: Category): ReactNode => {
    if (!shows(c)) return null;
    const key = c._id;
    const open = !!q || !collapsed.has(key);
    const kids = children(key);
    const own = (docsIn.get(key) ?? []).filter(docMatches);
    const total = subtreeDocs(key);
    const parent = parentOf(c);
    return (
      <section key={key} {...sectionDrop(key, c)} className={sectionClass(key)}>
        {indicator(key)}
        <GroupHeader
          category={c}
          count={q ? total.filter(docMatches).length : total.length}
          open={open}
          onToggle={() => setCollapsed(key, !collapsed.has(key))}
          onDragStart={() => setDragging({ kind: "category", id: key })}
          dropProps={headerDrop(c)}
          deleteNote={deleteNote(c)}
          onNewSubcategory={() => {
            setCollapsed(key, false);
            setCreatingIn(key);
          }}
          onMoveToTop={parent ? () => moveCategory(key, path(key)[0]!._id, "after") : undefined}
        />
        {open && (
          <div className="space-y-0.5 pb-1 pl-3">
            {creatingIn === key && (
              <NewCategoryRow categories={categories} parentId={key} onDone={() => setCreatingIn(null)} />
            )}
            {kids.map(renderCategory)}
            {own.map(row)}
            {!q &&
              !kids.length &&
              !own.length &&
              creatingIn !== key &&
              (hiddenIn(key) ? (
                <InactiveNote count={hiddenIn(key)} onShow={onShowInactive} />
              ) : (
                <EmptyGroup category={c} />
              ))}
          </div>
        )}
      </section>
    );
  };

  const uncategorized = docsIn.get(UNCATEGORIZED) ?? [];
  const uncategorizedShown = uncategorized.filter(docMatches);
  const showUncategorized = q
    ? uncategorizedShown.length > 0
    : // Shown when it has something, or as a drop target while dragging a document.
      uncategorized.length > 0 || dragging?.kind === "doc";

  return (
    <div className="space-y-1">
      {newCategoryRow}
      {children(null).map(renderCategory)}
      {showUncategorized && (
        <section {...sectionDrop(UNCATEGORIZED, null)} className={sectionClass(UNCATEGORIZED)}>
          <GroupHeader
            category={null}
            count={q ? uncategorizedShown.length : uncategorized.length}
            open={!!q || !collapsed.has(UNCATEGORIZED)}
            onToggle={() => setCollapsed(UNCATEGORIZED, !collapsed.has(UNCATEGORIZED))}
          />
          {(q || !collapsed.has(UNCATEGORIZED)) && (
            <div className="space-y-0.5 pb-1 pl-3">{uncategorizedShown.map(row)}</div>
          )}
        </section>
      )}
      {q && !docs.some(docMatches) && <p className="px-3 py-2 text-sm text-muted">No matches.</p>}
    </div>
  );
}

function DocRow({
  doc: d,
  active,
  inactive,
  meta,
  viewers,
  draggable,
  onDragStart,
}: {
  doc: DocItem;
  active: boolean;
  inactive: boolean;
  meta: string;
  viewers: Viewer[] | undefined;
  draggable: boolean;
  onDragStart: () => void;
}) {
  return (
    <Link
      href={`/d/${d._id}`}
      draggable={draggable}
      onDragStart={(e) => {
        if (!draggable) return;
        e.dataTransfer.setData(DRAG_DOC, d._id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      className={cn(
        "group flex items-start gap-2.5 rounded-xl px-2.5 py-2 transition",
        active ? "bg-surface shadow-soft" : "hover:bg-surface-2/70",
        inactive && !active && "opacity-60",
      )}
    >
      <FileText size={16} className="mt-0.5 shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-sm font-medium", !d.title && "text-muted")}>{d.title || "Untitled"}</div>
        <div className="mt-0.5 truncate text-xs text-muted">
          {inactive && "Inactive · "}
          {meta}
        </div>
      </div>
      <div className="flex -space-x-1.5 pt-0.5">
        {viewers?.map((v) => (
          <Avatar key={v.userId} name={v.name} color={v.color} size={20} ring title={`${v.name} is here`} />
        ))}
      </div>
    </Link>
  );
}

const iconBtn =
  "grid size-6 shrink-0 place-items-center rounded-md text-muted hover:bg-surface hover:text-ink focus-visible:opacity-100";

function GroupHeader({
  category,
  count,
  open,
  onToggle,
  onDragStart,
  dropProps,
  deleteNote = "",
  onNewSubcategory,
  onMoveToTop,
}: {
  category: Category | null;
  count: number;
  open: boolean;
  onToggle: () => void;
  onDragStart?: () => void;
  dropProps?: DropProps;
  deleteNote?: string;
  onNewSubcategory?: () => void;
  onMoveToTop?: () => void;
}) {
  const createDoc = useCreateDoc();
  const update = useMutation(api.categories.update);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const label = category?.name ?? "Uncategorized";

  return (
    <div
      draggable={!!onDragStart && !renaming}
      onDragStart={(e) => {
        if (!category || !onDragStart) return;
        e.dataTransfer.setData(DRAG_CATEGORY, category._id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      {...dropProps}
      className="group/header flex h-8 items-center gap-0.5 rounded-lg pr-1 hover:bg-surface-2/70"
    >
      {renaming && category ? (
        <div className="flex min-w-0 flex-1 items-center gap-2 pl-6">
          <span className="size-2.5 shrink-0 rounded-full" style={{ background: category.color }} />
          <InlineName
            initial={category.name}
            onDone={(name) => {
              setRenaming(false);
              if (name && name !== category.name) update({ categoryId: category._id, name });
            }}
          />
        </div>
      ) : (
        <button
          onClick={onToggle}
          onDoubleClick={() => category && setRenaming(true)}
          aria-expanded={open}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-1 text-left"
        >
          <ChevronRight
            size={14}
            className={cn("shrink-0 text-muted transition-transform duration-150", open && "rotate-90")}
          />
          {category ? (
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: category.color }} />
          ) : (
            <span className="size-2.5 shrink-0 rounded-full border border-dashed border-muted" />
          )}
          <span className={cn("ml-0.5 truncate text-[13px] font-semibold", category ? "text-ink-2" : "text-muted")}>
            {label}
          </span>
          <span className="shrink-0 text-xs text-muted tabular-nums">{count}</span>
        </button>
      )}
      {category && !renaming && (
        <div
          className={cn(
            "flex items-center opacity-0 transition-opacity group-hover/header:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100",
            menuOpen && "opacity-100",
          )}
        >
          <button
            onClick={() => createDoc(category._id)}
            className={iconBtn}
            aria-label={`New document in ${category.name}`}
            title={`New document in ${category.name}`}
          >
            <Plus size={15} />
          </button>
          <button
            ref={menuRef}
            onClick={() => setMenuOpen((o) => !o)}
            className={iconBtn}
            aria-label={`${category.name} options`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <MoreHorizontal size={15} />
          </button>
        </div>
      )}
      {menuOpen && category && (
        <Popover anchor={menuRef} onClose={() => setMenuOpen(false)} className="w-64">
          <CategoryMenu
            category={category}
            deleteNote={deleteNote}
            onRename={() => {
              setMenuOpen(false);
              setRenaming(true);
            }}
            onNewSubcategory={() => {
              setMenuOpen(false);
              onNewSubcategory?.();
            }}
            onMoveToTop={
              onMoveToTop &&
              (() => {
                setMenuOpen(false);
                onMoveToTop();
              })
            }
            onClose={() => setMenuOpen(false)}
          />
        </Popover>
      )}
    </div>
  );
}

function CategoryMenu({
  category,
  deleteNote,
  onRename,
  onNewSubcategory,
  onMoveToTop,
  onClose,
}: {
  category: Category;
  deleteNote: string;
  onRename: () => void;
  onNewSubcategory: () => void;
  onMoveToTop?: () => void;
  onClose: () => void;
}) {
  const update = useMutation(api.categories.update);
  const remove = useMutation(api.categories.remove);
  const [confirming, setConfirming] = useState(false);
  const item =
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none hover:bg-surface-2 focus-visible:bg-surface-2";

  if (confirming) {
    return (
      <div className="p-2">
        <p className="text-sm font-medium">Delete “{category.name}”?</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">{deleteNote}</p>
        <div className="mt-3 flex justify-end gap-1">
          <button autoFocus onClick={() => setConfirming(false)} className="h-8 rounded-lg px-3 text-sm outline-none hover:bg-surface-2 focus-visible:bg-surface-2">
            Cancel
          </button>
          <button
            onClick={() => {
              onClose();
              remove({ categoryId: category._id });
            }}
            className="h-8 rounded-lg bg-danger px-3 text-sm font-medium text-white"
          >
            Delete
          </button>
        </div>
      </div>
    );
  }

  return (
    <div role="menu">
      <button role="menuitem" autoFocus className={item} onClick={onNewSubcategory}>
        <FolderPlus size={15} className="text-muted" /> New subcategory
      </button>
      <button role="menuitem" className={item} onClick={onRename}>
        <Pencil size={15} className="text-muted" /> Rename
      </button>
      {onMoveToTop && (
        <button role="menuitem" className={item} onClick={onMoveToTop}>
          <ArrowUpLeft size={15} className="text-muted" /> Move to top level
        </button>
      )}
      <div className="px-2.5 pt-1.5 pb-2">
        <div className="mb-1.5 text-xs text-muted">Color</div>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORY_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => update({ categoryId: category._id, color: c })}
              aria-label={`Color ${c}`}
              aria-pressed={c === category.color}
              className={cn(
                "size-5 rounded-full transition hover:scale-110",
                c === category.color && "ring-2 ring-ink ring-offset-2 ring-offset-surface",
              )}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>
      <div className="my-1 h-px bg-line" />
      <button role="menuitem" className={cn(item, "text-danger")} onClick={() => setConfirming(true)}>
        <Trash2 size={15} /> Delete category
      </button>
    </div>
  );
}

function InactiveNote({ count, onShow }: { count: number; onShow: () => void }) {
  return (
    <p className="mx-1 px-2 py-2 text-xs text-muted">
      {count === 1 ? "1 inactive document." : `${count} inactive documents.`}{" "}
      <button onClick={onShow} className="font-medium text-accent hover:underline">
        Show
      </button>
    </p>
  );
}

function EmptyGroup({ category }: { category: Category }) {
  const createDoc = useCreateDoc();
  return (
    <div className="mx-1 rounded-lg border border-dashed border-line-strong px-3 py-2.5 text-xs leading-relaxed text-muted">
      Drag documents here, or{" "}
      <button onClick={() => createDoc(category._id)} className="font-medium text-accent hover:underline">
        start a new one
      </button>
      .
    </div>
  );
}

function NewCategoryRow({
  categories,
  parentId,
  onDone,
}: {
  categories: Category[];
  parentId: CategoryId | null;
  onDone: () => void;
}) {
  const me = useMe();
  const create = useMutation(api.categories.create);
  const color = useMemo(() => nextCategoryColor(categories), [categories]);
  const ref = useRef<HTMLDivElement>(null);
  // The sidebar may be scrolled down; bring the new field into view.
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);
  return (
    <div ref={ref} className="flex h-8 items-center gap-2 rounded-lg bg-surface pr-1 pl-6 shadow-soft">
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <InlineName
        initial=""
        placeholder={parentId ? "Subcategory name" : "Category name"}
        onDone={(name) => {
          onDone();
          if (name) create({ userId: me._id, name, color, parentId: parentId ?? undefined });
        }}
      />
    </div>
  );
}

/** A one-line name field: Enter or clicking away saves, Escape cancels (reports ""). */
function InlineName({
  initial,
  placeholder,
  onDone,
}: {
  initial: string;
  placeholder?: string;
  onDone: (name: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (name: string) => {
    if (done.current) return;
    done.current = true;
    onDone(name.trim());
  };
  return (
    <input
      autoFocus
      value={value}
      placeholder={placeholder}
      maxLength={60}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(value);
        if (e.key === "Escape") finish("");
      }}
      aria-label="Category name"
      className="h-7 min-w-0 flex-1 bg-transparent text-[13px] font-semibold outline-none placeholder:font-normal placeholder:text-muted"
    />
  );
}

function TrashRow({ docId, title, onRestored }: { docId: Id<"docs">; title: string; onRestored: () => void }) {
  const setTrashed = useMutation(api.docs.setTrashed);
  const deleteForever = useMutation(api.docs.deleteForever);
  const [, navigate] = useLocation();
  const [confirming, setConfirming] = useState(false);
  const btn = "rounded-lg px-2 py-1 text-xs font-medium hover:bg-surface";
  return (
    <div className="rounded-xl px-2.5 py-2 hover:bg-surface-2/70">
      <div className={cn("truncate text-sm", !title && "text-muted")}>{title || "Untitled"}</div>
      {confirming ? (
        <div className="mt-1 flex items-center gap-1 text-xs">
          <span className="mr-auto text-danger">Delete forever, with its history?</span>
          <button onClick={() => setConfirming(false)} className={btn}>
            Cancel
          </button>
          <button onClick={() => deleteForever({ docId })} className={cn(btn, "text-danger")}>
            Delete
          </button>
        </div>
      ) : (
        <div className="mt-1 flex gap-1">
          <button
            onClick={async () => {
              await setTrashed({ docId, trashed: false });
              onRestored();
              navigate(`/d/${docId}`);
            }}
            className={cn(btn, "-ml-2 text-accent")}
          >
            Restore
          </button>
          <button onClick={() => setConfirming(true)} className={cn(btn, "text-muted hover:text-danger")}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
