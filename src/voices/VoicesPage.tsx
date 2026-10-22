import { useMutation, useQuery } from "convex/react";
import { AudioLines, Copy, PanelLeft, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { Modal } from "../components/Modal";
import { useShell } from "../components/Shell";
import { useToast } from "../components/Toast";
import { copyText } from "../lib/clipboard";
import { relativeTime, timecode } from "../lib/time";

type Voice = Doc<"voices"> & { storyTitle: string | null };

/** The voice catalog: voices approved in a story, ready to cast in the next one. */
export function VoicesPage() {
  const voices = useQuery(api.voices.list, {});
  const { sidebarOpen, toggleSidebar } = useShell();
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          {!sidebarOpen && (
            <button
              onClick={toggleSidebar}
              className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
              aria-label="Show sidebar"
            >
              <PanelLeft size={18} />
            </button>
          )}
          <h1 className="font-semibold tracking-tight">Voices</h1>
          <span className="hidden text-sm text-muted sm:inline">Approved in a story, ready to cast again.</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        {voices === undefined ? (
          <p className="py-20 text-center text-muted">Loading…</p>
        ) : voices.length === 0 ? (
          <div className="mx-auto mt-10 flex max-w-md flex-col items-center rounded-3xl border-2 border-dashed border-line-strong px-6 py-14 text-center">
            <AudioLines size={30} className="text-muted" />
            <p className="mt-4 text-lg font-semibold">No voices yet</p>
            <p className="mt-1 text-sm text-muted">
              When you approve a story's casting, the director adds every new voice here, with its reference recording
              and how it was made. Later stories cast from this list first.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {voices.map((v) => (
              <VoiceCard key={v._id} voice={v} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function VoiceCard({ voice }: { voice: Voice }) {
  const setTrashed = useMutation(api.voices.setTrashed);
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-soft">
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent">
          <AudioLines size={19} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{voice.name}</p>
          <p className="truncate text-xs text-muted">
            {[voice.character && `Made for ${voice.character}`, voice.storyTitle && `in “${voice.storyTitle}”`, relativeTime(voice._creationTime)]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <button
          onClick={() => setEditing(true)}
          title="Edit"
          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
        >
          <Pencil size={15} />
        </button>
        <button
          onClick={() => {
            void setTrashed({ voiceId: voice._id, trashed: true });
            toast({
              message: `Removed “${voice.name}” from the catalog`,
              action: { label: "Undo", run: () => void setTrashed({ voiceId: voice._id, trashed: false }) },
            });
          }}
          title="Remove from the catalog"
          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-danger"
        >
          <Trash2 size={15} />
        </button>
      </div>
      <p className="mt-3 text-sm text-ink-2">{voice.description}</p>
      <audio controls preload="none" src={`/media/audio/${voice.audioFile}`} className="mt-3 h-9 w-full" />
      <p className="mt-1 text-xs text-muted">
        Reference, {timecode(voice.duration)}: “{voice.refText.length > 160 ? `${voice.refText.slice(0, 160)}…` : voice.refText}”
      </p>
      <button
        onClick={async () => (await copyText(voice.refPath)) && toast({ message: "Copied the reference path" })}
        className="mt-2 flex max-w-full items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-left font-mono text-[11px] text-ink-2 hover:text-ink"
        title="Copy the path"
      >
        <Copy size={11} className="shrink-0" />
        <span className="truncate">{voice.refPath}</span>
      </button>
      {voice.notes && (
        <details className="mt-2 text-xs text-ink-2">
          <summary className="cursor-pointer text-muted">How it was made</summary>
          <p className="mt-1 whitespace-pre-wrap">{voice.notes}</p>
        </details>
      )}
      {voice.storyId && (
        <Link href={`/s/${voice.storyId}`} className="mt-2 inline-block text-xs font-medium text-accent hover:underline">
          Open the story
        </Link>
      )}
      {editing && <EditVoiceDialog voice={voice} onClose={() => setEditing(false)} />}
    </div>
  );
}

function EditVoiceDialog({ voice, onClose }: { voice: Voice; onClose: () => void }) {
  const update = useMutation(api.voices.update);
  const [name, setName] = useState(voice.name);
  const [character, setCharacter] = useState(voice.character ?? "");
  const [description, setDescription] = useState(voice.description);
  const [notes, setNotes] = useState(voice.notes ?? "");
  const field = "w-full rounded-xl border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent";
  return (
    <Modal onClose={onClose} className="max-w-lg">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await update({ voiceId: voice._id, name, character, description, notes });
          onClose();
        }}
        className="space-y-3 p-5"
      >
        <h2 className="font-semibold">Edit voice</h2>
        <label className="block text-xs text-muted">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} className={`${field} mt-1`} />
        </label>
        <label className="block text-xs text-muted">
          Made for
          <input value={character} onChange={(e) => setCharacter(e.target.value)} className={`${field} mt-1`} />
        </label>
        <label className="block text-xs text-muted">
          What it sounds like
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={`${field} mt-1 resize-none`} />
        </label>
        <label className="block text-xs text-muted">
          How it was made
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} className={`${field} mt-1 resize-none`} />
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="h-9 rounded-xl px-4 text-sm hover:bg-surface-2">
            Cancel
          </button>
          <button className="h-9 rounded-xl bg-ink px-4 text-sm font-medium text-bg">Save</button>
        </div>
      </form>
    </Modal>
  );
}
