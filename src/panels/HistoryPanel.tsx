import { generateHTML } from "@tiptap/core";
import { useMutation, useQuery } from "convex/react";
import { diffWords } from "diff";
import {
  Bookmark,
  BookmarkPlus,
  Clock,
  FilePlus2,
  RotateCcw,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { schemaExtensions } from "../../shared/extensions";
import { Avatar, ClaudeAvatar } from "../components/Avatar";
import { Modal } from "../components/Modal";
import { useMe } from "../lib/identity";
import { cn } from "../lib/hooks";
import { clockTime, dayLabel } from "../lib/time";
import { markdownToPlain } from "../lib/plain";

type VersionRow = Omit<Doc<"docVersions">, "content" | "markdown">;

const KIND: Record<Doc<"docVersions">["kind"], { label: string; icon: LucideIcon }> = {
  initial: { label: "Created", icon: FilePlus2 },
  auto: { label: "Edits", icon: Clock },
  manual: { label: "Saved version", icon: Bookmark },
  "ai-before": { label: "Before Claude's changes", icon: Clock },
  "ai-after": { label: "Claude's changes", icon: Sparkles },
  "before-restore": { label: "Before restoring", icon: Clock },
  restore: { label: "Restored", icon: RotateCcw },
};

type UserLite = { _id: Id<"users">; name: string };

/** "Sam's edits", "Jordan and Sam's edits", "Saved version: First draft"… */
function versionTitle(
  v: Pick<VersionRow, "kind" | "label" | "authors">,
  users: Map<Id<"users">, UserLite>,
  meId: Id<"users">,
): string {
  if (v.kind === "manual" || v.kind === "restore") return v.label ?? KIND[v.kind].label;
  if (v.kind !== "auto") return KIND[v.kind].label;
  const mine = v.authors.includes(meId);
  const others = v.authors
    .filter((a) => a !== meId)
    .map((a) => users.get(a)?.name)
    .filter(Boolean) as string[];
  const join = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
  if (others.length === 0) return mine ? "Your edits" : "Edits";
  return mine ? `${join(others)}'s and your edits` : `${join(others)}'s edits`;
}

export function HistoryPanel({ docId, onClose }: { docId: Id<"docs">; onClose: () => void }) {
  const me = useMe();
  const versions = useQuery(api.docVersions.list, { docId });
  const users = useQuery(api.users.list);
  const saveNamed = useMutation(api.docVersions.saveNamed);
  const [naming, setNaming] = useState(false);
  const [label, setLabel] = useState("");
  const [open, setOpen] = useState<Id<"docVersions"> | null>(null);

  const userById = useMemo(() => new Map(users?.map((u) => [u._id, u]) ?? []), [users]);
  const groups = useMemo(() => {
    const out: { day: string; rows: VersionRow[] }[] = [];
    for (const v of versions ?? []) {
      const day = dayLabel(v._creationTime);
      if (out.at(-1)?.day !== day) out.push({ day, rows: [] });
      out.at(-1)!.rows.push(v);
    }
    return out;
  }, [versions]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
        <span className="font-semibold">History</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setNaming((n) => !n)}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-ink-2 hover:bg-surface-2"
          >
            <BookmarkPlus size={15} /> Save version
          </button>
          <button
            onClick={onClose}
            className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
            aria-label="Close"
          >
            <X size={17} />
          </button>
        </div>
      </div>

      {naming && (
        <form
          className="flex gap-2 border-b border-line p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            await saveNamed({ docId, userId: me._id, label: label || "Saved version" });
            setLabel("");
            setNaming(false);
          }}
        >
          <input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Name this version (e.g. First draft)"
            className="h-9 flex-1 rounded-xl border border-line bg-bg px-3 text-sm outline-none focus:border-line-strong"
          />
          <button className="h-9 rounded-xl bg-ink px-3 text-sm font-medium text-bg">Save</button>
        </form>
      )}

      <div className="scroll-thin flex-1 overflow-y-auto px-2 py-2">
        <p className="px-2 pb-1 text-xs text-muted">Saved automatically every minute and around every Claude edit.</p>
        {groups.map((g) => (
          <Fragment key={g.day}>
            <div className="sticky top-0 z-10 bg-surface/95 px-2 pt-3 pb-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase backdrop-blur">
              {g.day}
            </div>
            {g.rows.map((v) => {
              const kind = KIND[v.kind];
              return (
                <button
                  key={v._id}
                  onClick={() => setOpen(v._id)}
                  className="flex w-full items-start gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-surface-2"
                >
                  <span
                    className={cn(
                      "mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg",
                      v.byAi ? "bg-ai-soft text-ai" : v.kind === "manual" ? "bg-accent/10 text-accent" : "bg-surface-2 text-muted",
                    )}
                  >
                    <kind.icon size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {versionTitle(v, userById, me._id)}
                    </span>
                    {v.byAi && v.label && (
                      <span className="block truncate text-xs text-muted italic">“{v.label}”</span>
                    )}
                    <span className="mt-1 flex items-center gap-2 text-xs text-muted">
                      {clockTime(v._creationTime)}
                      {(v.added > 0 || v.removed > 0) && (
                        <span>
                          {v.added > 0 && <span className="text-emerald-600">+{v.added}</span>}
                          {v.added > 0 && v.removed > 0 && " "}
                          {v.removed > 0 && <span className="text-red-500">−{v.removed}</span>}
                        </span>
                      )}
                      <span>{v.words} words</span>
                    </span>
                  </span>
                  <span className="flex shrink-0 -space-x-1.5 pt-0.5">
                    {v.byAi && <ClaudeAvatar size={20} ring />}
                    {v.authors.map((a) => {
                      const u = userById.get(a);
                      return u ? <Avatar key={a} name={u.name} color={u.color} size={20} ring /> : null;
                    })}
                  </span>
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>
      {open && <VersionViewer versionId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function VersionViewer({ versionId, onClose }: { versionId: Id<"docVersions">; onClose: () => void }) {
  const me = useMe();
  const version = useQuery(api.docVersions.get, { versionId });
  const users = useQuery(api.users.list);
  const restore = useMutation(api.docVersions.restore);
  const [tab, setTab] = useState<"changes" | "full">("changes");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const userById = useMemo(() => new Map(users?.map((u) => [u._id, u]) ?? []), [users]);

  const html = useMemo(() => {
    if (!version) return "";
    try {
      return generateHTML(JSON.parse(version.content), schemaExtensions);
    } catch {
      return "<p>Couldn't render this version.</p>";
    }
  }, [version]);

  return (
    <Modal onClose={onClose} className="flex h-[92vh] max-w-3xl flex-col sm:h-[85vh]">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">
            {version ? versionTitle(version, userById, me._id) : "Loading…"}
          </div>
          {version && (
            <div className="text-xs text-muted">
              {dayLabel(version._creationTime)}, {clockTime(version._creationTime)}
              {tab === "changes" && version.previousAt && <> · compared with {clockTime(version.previousAt)}</>}
            </div>
          )}
        </div>
        <div className="flex rounded-lg bg-surface-2 p-0.5 text-xs font-medium">
          {(["changes", "full"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn("rounded-md px-2.5 py-1", tab === t ? "bg-surface shadow-soft" : "text-muted")}
            >
              {t === "changes" ? "Changes" : "Full text"}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
          aria-label="Close"
        >
          <X size={17} />
        </button>
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto px-5 py-6 sm:px-10">
        {version &&
          (tab === "full" ? (
            <>
              <h1 className="mb-6 font-serif text-3xl font-semibold">{version.title || "Untitled"}</h1>
              <div className="doc !min-h-0 !pb-6" dangerouslySetInnerHTML={{ __html: html }} />
            </>
          ) : (
            <Changes
              before={version.previousMarkdown}
              after={version.markdown}
              titleBefore={version.previousTitle}
              titleAfter={version.title}
              isFirst={version.kind === "initial"}
            />
          ))}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-4 py-3">
        {confirming ? (
          <>
            <span className="mr-auto text-sm text-ink-2">
              Replace the document with this version? The current one is saved to History first.
            </span>
            <button onClick={() => setConfirming(false)} className="h-9 rounded-xl px-3 text-sm hover:bg-surface-2">
              Cancel
            </button>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await restore({ versionId, userId: me._id });
                  onClose();
                } finally {
                  setBusy(false);
                }
              }}
              className="h-9 rounded-xl bg-ink px-4 text-sm font-medium text-bg disabled:opacity-40"
            >
              Restore
            </button>
          </>
        ) : (
          <button
            disabled={!version}
            onClick={() => setConfirming(true)}
            className="flex h-9 items-center gap-1.5 rounded-xl bg-ink px-4 text-sm font-medium text-bg disabled:opacity-40"
          >
            <RotateCcw size={15} /> Restore this version
          </button>
        )}
      </div>
    </Modal>
  );
}

/** Word-level diff of the Markdown, with long unchanged stretches folded. */
function Changes({
  before,
  after,
  titleBefore,
  titleAfter,
  isFirst,
}: {
  before: string;
  after: string;
  titleBefore: string;
  titleAfter: string;
  isFirst: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const parts = useMemo(() => diffWords(markdownToPlain(before), markdownToPlain(after)), [before, after]);
  const changed = parts.some((p) => p.added || p.removed);

  return (
    <div className="diff font-serif text-[1.05rem] leading-[1.8] whitespace-pre-wrap">
      {isFirst && <p className="mb-4 font-sans text-sm text-muted">The document as it was first saved.</p>}
      {titleBefore !== titleAfter && !isFirst && (
        <p className="mb-5 font-sans text-sm">
          Title: <del>{titleBefore || "Untitled"}</del> → <ins>{titleAfter || "Untitled"}</ins>
        </p>
      )}
      {!changed && <p className="font-sans text-sm text-muted">No changes to the text in this version.</p>}
      {parts.map((p, i) => {
        if (p.added) return <ins key={i}>{p.value}</ins>;
        if (p.removed) return <del key={i}>{p.value}</del>;
        const v = p.value;
        if (v.length < 500 || expanded.has(i)) return <span key={i}>{v}</span>;
        const head = i === 0 ? "" : v.slice(0, 180);
        const tail = i === parts.length - 1 ? "" : v.slice(-180);
        return (
          <span key={i}>
            {head}
            <button
              onClick={() => setExpanded((s) => new Set(s).add(i))}
              className="mx-1 my-2 block rounded-lg bg-surface-2 px-3 py-1 font-sans text-xs text-muted hover:text-ink"
            >
              ··· show unchanged text ···
            </button>
            {tail}
          </span>
        );
      })}
    </div>
  );
}
