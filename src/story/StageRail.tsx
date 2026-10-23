// The stages down the left of a story: done, where it is now, what's next.
// Clicking a stage only shows it (scrolls the thread there); redoing from an
// earlier stage or skipping ahead is a separate, confirmed action in its menu.
import { useQuery } from "convex/react";
import { Check, Clapperboard, FileText, Images, LoaderCircle, MessagesSquare, MoreHorizontal, NotebookPen } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { api } from "../../convex/_generated/api";
import { Popover } from "../components/Popover";
import { cn } from "../lib/hooks";
import { relativeTime } from "../lib/time";
import { STAGES, stageIndex, type StageId } from "../../shared/stages";
import { StageMoveDialog } from "./stageUi";
import type { StoryData, StoryView } from "./StoryPage";

export function StageRail({
  story,
  view,
  counts,
  onStage,
}: {
  story: StoryData;
  view: StoryView;
  counts: { images?: number; notes?: number };
  onStage: (stage: StageId) => void;
}) {
  const approvals = useQuery(api.requests.approvals, { storyId: story._id });
  const users = useQuery(api.users.list);
  const names = useMemo(() => new Map(users?.map((u) => [u._id, u.name.split(" ")[0]]) ?? []), [users]);
  const [move, setMove] = useState<StageId | null>(null);
  const at = stageIndex(story.stage);
  const steps = STAGES.filter((s) => s.id !== "done");
  const base = `/s/${story._id}`;

  return (
    <nav className="flex h-full flex-col">
      <ol className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {steps.map((s, i) => {
          const done = i < at || story.stage === "done";
          const current = s.id === story.stage;
          const approved = approvals?.[s.id];
          let sub: string | null = null;
          if (current) {
            sub =
              story.state === "review"
                ? "Ready for your OK"
                : story.state === "waiting"
                  ? "Needs you"
                  : story.state === "writing"
                    ? "Writing"
                    : "Director working";
          } else if (done) {
            sub = approved
              ? `${approved.by ? `${names.get(approved.by) ?? "Someone"} · ` : ""}${relativeTime(approved.at)}`
              : "Done";
          }
          const needsYou = current && (story.state === "review" || story.state === "waiting");
          return (
            <li key={s.id} className="group relative">
              <button
                onClick={() => onStage(s.id)}
                title={s.hint}
                className={cn(
                  "mb-1 flex w-full items-start gap-2.5 rounded-xl px-2 py-1.5 text-left transition",
                  current
                    ? needsYou
                      ? story.state === "waiting"
                        ? "bg-amber-500/12"
                        : "bg-accent/10"
                      : "bg-surface-2"
                    : "hover:bg-surface-2",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full border text-[10px]",
                    done
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : current
                        ? needsYou
                          ? story.state === "waiting"
                            ? "border-amber-500 bg-amber-500 text-white"
                            : "border-accent bg-accent text-white"
                          : "border-accent text-accent"
                        : "border-line-strong",
                  )}
                >
                  {done ? (
                    <Check size={11} strokeWidth={3} />
                  ) : current && story.state === "working" ? (
                    <LoaderCircle size={11} className="animate-spin" />
                  ) : current ? (
                    <span className="size-1.5 rounded-full bg-current" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block truncate text-sm",
                      current ? "font-semibold text-ink" : done ? "text-ink-2" : "text-muted",
                    )}
                  >
                    {s.label}
                  </span>
                  {sub && (
                    <span
                      className={cn(
                        "block truncate text-[11px]",
                        needsYou
                          ? story.state === "waiting"
                            ? "font-semibold text-amber-700 dark:text-amber-300"
                            : "font-semibold text-accent"
                          : "text-muted",
                      )}
                    >
                      {needsYou ? sub.toUpperCase() : sub}
                    </span>
                  )}
                </span>
              </button>
              {!current && story.stage !== "script" && (
                <StageMenu
                  label={done ? "Redo from here…" : "Skip ahead to here…"}
                  onPick={() => setMove(s.id)}
                />
              )}
            </li>
          );
        })}
      </ol>

      <div className="shrink-0 space-y-0.5 border-t border-line px-2 py-2">
        <ViewLink href={base + "/thread"} active={view === "thread"} icon={MessagesSquare} label="Thread" />
        <ViewLink href={base + "/script"} active={view === "script"} icon={FileText} label="Script" />
        <ViewLink
          href={base + "/review"}
          active={view === "review"}
          icon={Clapperboard}
          label="Cuts"
          count={story.latestVersion || undefined}
        />
        <ViewLink href={base + "/images"} active={view === "images"} icon={Images} label="Images" count={counts.images} />
        <ViewLink href={base + "/notes"} active={view === "notes"} icon={NotebookPen} label="Notes" count={counts.notes} />
      </div>
      {move && <StageMoveDialog story={story} to={move} onClose={() => setMove(null)} />}
    </nav>
  );
}

function StageMenu({ label, onPick }: { label: string; onPick: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        onClick={() => setOpen(true)}
        className={cn(
          "absolute top-1.5 right-1 grid size-7 place-items-center rounded-lg text-muted hover:bg-surface hover:text-ink",
          open ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        )}
        aria-label="Stage options"
      >
        <MoreHorizontal size={15} />
      </button>
      {open && (
        <Popover anchor={ref} onClose={() => setOpen(false)} placement="right-start" className="w-52 p-1">
          <button
            onClick={() => {
              setOpen(false);
              onPick();
            }}
            className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surface-2"
          >
            {label}
          </button>
        </Popover>
      )}
    </>
  );
}

function ViewLink({
  href,
  active,
  icon: Icon,
  label,
  count,
}: {
  href: string;
  active: boolean;
  icon: typeof FileText;
  label: string;
  count?: number;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm transition-colors",
        active ? "bg-surface-2 font-medium text-ink" : "text-muted hover:bg-surface-2 hover:text-ink",
      )}
    >
      <Icon size={15} />
      <span className="flex-1">{label}</span>
      {!!count && <span className="text-xs tabular-nums">{count}</span>}
    </Link>
  );
}
