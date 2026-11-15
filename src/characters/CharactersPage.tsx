import { useMutation, useQuery } from "convex/react";
import { Copy, PanelLeft, Pencil, Trash2, UserRound } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { Modal } from "../components/Modal";
import { useShell } from "../components/Shell";
import { useToast } from "../components/Toast";
import { copyText } from "../lib/clipboard";
import { relativeTime } from "../lib/time";

type Character = Doc<"characters"> & { storyTitle: string | null };

/** The character catalog: profiles approved in a story, ready to reuse in the next one. */
export function CharactersPage() {
  const characters = useQuery(api.characters.list, {});
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
          <h1 className="font-semibold tracking-tight">Characters</h1>
          <span className="hidden text-sm text-muted sm:inline">Approved in a story, ready to appear again.</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        {characters === undefined ? (
          <p className="py-20 text-center text-muted">Loading…</p>
        ) : characters.length === 0 ? (
          <div className="mx-auto mt-10 flex max-w-md flex-col items-center rounded-3xl border-2 border-dashed border-line-strong px-6 py-14 text-center">
            <UserRound size={30} className="text-muted" />
            <p className="mt-4 text-lg font-semibold">No characters yet</p>
            <p className="mt-1 text-sm text-muted">
              When you approve a story's character looks, the director adds every new profile here, with its model
              sheet and the description it draws them from. Later stories look here first.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {characters.map((c) => (
              <CharacterCard key={c._id} character={c} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function CharacterCard({ character }: { character: Character }) {
  const setTrashed = useMutation(api.characters.setTrashed);
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
      <a href={`/media/images/${character.file}`} target="_blank" rel="noreferrer" title="Open the model sheet">
        <img
          src={`/media/images/${character.thumb}`}
          alt={`${character.name} model sheet`}
          width={character.width}
          height={character.height}
          loading="lazy"
          className="aspect-video w-full bg-surface-2 object-contain"
        />
      </a>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{character.name}</p>
            <p className="truncate text-xs text-muted">
              {[character.storyTitle && `From “${character.storyTitle}”`, relativeTime(character._creationTime)]
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
              void setTrashed({ characterId: character._id, trashed: true });
              toast({
                message: `Removed “${character.name}” from the catalog`,
                action: { label: "Undo", run: () => void setTrashed({ characterId: character._id, trashed: false }) },
              });
            }}
            title="Remove from the catalog"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-danger"
          >
            <Trash2 size={15} />
          </button>
        </div>
        <p className="mt-3 text-sm whitespace-pre-wrap text-ink-2">{character.description}</p>
        {character.style && <p className="mt-2 text-xs text-muted">Style: {character.style}</p>}
        <button
          onClick={async () => (await copyText(character.sheetPath)) && toast({ message: "Copied the model sheet path" })}
          className="mt-2 flex max-w-full items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-left font-mono text-[11px] text-ink-2 hover:text-ink"
          title="Copy the path"
        >
          <Copy size={11} className="shrink-0" />
          <span className="truncate">{character.sheetPath}</span>
        </button>
        {character.notes && (
          <details className="mt-2 text-xs text-ink-2">
            <summary className="cursor-pointer text-muted">How it was made</summary>
            <p className="mt-1 whitespace-pre-wrap">{character.notes}</p>
          </details>
        )}
        {character.storyId && (
          <Link href={`/s/${character.storyId}`} className="mt-2 inline-block text-xs font-medium text-accent hover:underline">
            Open the story
          </Link>
        )}
      </div>
      {editing && <EditCharacterDialog character={character} onClose={() => setEditing(false)} />}
    </div>
  );
}

function EditCharacterDialog({ character, onClose }: { character: Character; onClose: () => void }) {
  const update = useMutation(api.characters.update);
  const [name, setName] = useState(character.name);
  const [description, setDescription] = useState(character.description);
  const [style, setStyle] = useState(character.style ?? "");
  const [notes, setNotes] = useState(character.notes ?? "");
  const field = "w-full rounded-xl border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent";
  return (
    <Modal onClose={onClose} className="max-w-lg">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await update({ characterId: character._id, name, description, style, notes });
          onClose();
        }}
        className="space-y-3 p-5"
      >
        <h2 className="font-semibold">Edit character</h2>
        <label className="block text-xs text-muted">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} className={`${field} mt-1`} />
        </label>
        <label className="block text-xs text-muted">
          What they look like
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className={`${field} mt-1 resize-none`} />
        </label>
        <label className="block text-xs text-muted">
          Art style
          <input value={style} onChange={(e) => setStyle(e.target.value)} className={`${field} mt-1`} />
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
