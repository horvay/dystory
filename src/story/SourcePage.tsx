// A remake's Source view: what to remake (a link, a video file, or a song
// that already exists in make_real) and what the director should watch out
// for. People fill it in before the remake starts; after that it shows what
// was given, and changes go to the director through the thread.
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { FileVideo, FolderOpen, Link2, LoaderCircle, Upload, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import { cn, useFileDrag } from "../lib/hooks";
import { bytes, timecode } from "../lib/time";
import { uploadFile, UploadError } from "../lib/upload";
import { REMAKE_STAGES, type StageId } from "../../shared/stages";
import type { StoryData } from "./StoryPage";

type Source = NonNullable<StoryData["source"]>;

/** The stages an adopted song can already be at. */
const START_STAGES = REMAKE_STAGES.filter((s) => s.id !== "source" && s.id !== "done");

export function SourcePage({ story }: { story: StoryData }) {
  const setSource = useMutation(api.stories.setSource);
  const editable = story.stage === "source";
  const saved: Source = story.source ?? { notes: "" };
  const adopt = saved.adopt;

  // The text boxes keep their own copy while someone types; the rest is read from the story.
  const [url, setUrl] = useState(saved.url ?? "");
  const [notes, setNotes] = useState(saved.notes);
  const [error, setError] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ name: string; size: number; sent: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const save = async (next: Partial<Source>) => {
    setError(null);
    try {
      await setSource({ storyId: story._id, source: { ...saved, url: url.trim() || undefined, notes, ...next } });
    } catch (e) {
      setError(e instanceof ConvexError ? String(e.data) : "Couldn't save that. Try again.");
    }
  };

  const sendFile = async (file: File) => {
    if (!editable || adopt) return;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setError(null);
    setUpload({ name: file.name, size: file.size, sent: 0 });
    try {
      const info = await uploadFile(file, (sent) => setUpload({ name: file.name, size: file.size, sent }), ctl.signal);
      setUrl("");
      await save({ url: undefined, file: { fileId: info.fileId, fileName: info.fileName, duration: info.duration } });
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError(e instanceof UploadError ? e.message : "The upload failed. Try again.");
      }
    } finally {
      if (abort.current === ctl) {
        abort.current = null;
        setUpload(null);
      }
    }
  };
  const dragging = useFileDrag((files) => files[0] && void sendFile(files[0]), editable && !adopt);

  const field =
    "w-full rounded-xl border border-line bg-bg px-3 outline-none placeholder:text-muted focus:border-accent disabled:opacity-70";

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <h1 className="font-serif text-2xl font-medium tracking-tight">
          {adopt ? "A song already in progress" : "What are we remaking?"}
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          {adopt
            ? "The director picks this song up where it stands and posts its cuts here from now on."
            : "A cartoon video becomes live action, shot for shot. The director maps the shots, shows you the cast, then the stills, then renders."}
        </p>

        {adopt ? (
          <Section icon={<FolderOpen size={16} />} title="The song">
            <p className="rounded-xl border border-line bg-surface px-3 py-2.5 font-mono text-sm">work/{adopt}/depth</p>
            <label className="mt-4 block text-sm font-medium">Where is it now?</label>
            <p className="mb-1.5 text-xs text-muted">The director starts on this stage. It reads the song's own log for the details.</p>
            <select
              disabled={!editable}
              value={saved.startAt ?? "breakdown"}
              onChange={(e) => void save({ startAt: e.target.value as StageId })}
              className={cn(field, "h-10")}
            >
              {START_STAGES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}: {s.hint}
                </option>
              ))}
            </select>
          </Section>
        ) : (
          <>
            <Section icon={<Link2 size={16} />} title="A link">
              <input
                value={url}
                disabled={!editable || !!upload}
                placeholder="https://www.youtube.com/watch?v=…"
                onChange={(e) => setUrl(e.target.value)}
                onBlur={() => (url.trim() || saved.url) && void save(url.trim() ? { url: url.trim(), file: undefined } : { url: undefined })}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                className={cn(field, "h-10")}
              />
              <p className="mt-1.5 text-xs text-muted">YouTube, or anything else yt-dlp can download.</p>
            </Section>

            <Section icon={<FileVideo size={16} />} title="Or a video file">
              {saved.file && !upload ? (
                <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-2.5">
                  <img
                    src={`/media/thumbs/${saved.file.fileId}.jpg`}
                    alt=""
                    className="h-12 w-20 shrink-0 rounded-lg bg-black object-cover"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{saved.file.fileName}</span>
                    <span className="text-xs text-muted">{timecode(saved.file.duration)}</span>
                  </span>
                  {editable && (
                    <button
                      onClick={() => void save({ file: undefined })}
                      className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
                      aria-label="Remove the file"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              ) : upload ? (
                <div className="rounded-xl border border-line bg-surface px-3 py-2.5">
                  <div className="flex items-center gap-2 text-sm">
                    <LoaderCircle size={15} className="shrink-0 animate-spin text-accent" />
                    <span className="min-w-0 flex-1 truncate">{upload.name}</span>
                    <span className="shrink-0 text-xs text-muted tabular-nums">
                      {upload.sent >= upload.size ? "Processing…" : `${bytes(upload.sent)} of ${bytes(upload.size)}`}
                    </span>
                    <button
                      onClick={() => abort.current?.abort()}
                      className="grid size-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
                      aria-label="Cancel the upload"
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full bg-accent transition-[width]"
                      style={{ width: `${Math.min(100, (upload.sent / upload.size) * 100)}%` }}
                    />
                  </div>
                </div>
              ) : (
                editable && (
                  <button
                    onClick={() => picker.current?.click()}
                    className={cn(
                      "flex h-20 w-full items-center justify-center gap-2 rounded-xl border border-dashed text-sm transition",
                      dragging ? "border-accent bg-accent/8 text-accent" : "border-line-strong text-muted hover:border-ink-2 hover:text-ink",
                    )}
                  >
                    <Upload size={16} /> {dragging ? "Drop it here" : "Choose a video, or drop one here"}
                  </button>
                )
              )}
              {!editable && !saved.file && <p className="text-sm text-muted">No file.</p>}
              <input
                ref={picker}
                type="file"
                accept="video/*,.mkv"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void sendFile(f);
                }}
              />
            </Section>
          </>
        )}

        <Section title="What should the director know?">
          <textarea
            value={notes}
            disabled={!editable}
            rows={5}
            placeholder="Who sings and who never does, characters that need a new look, parts to leave out, anything that went wrong on an earlier video."
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== saved.notes && void save({})}
            className={cn(field, "resize-y py-2.5 text-sm leading-relaxed")}
          />
        </Section>

        {error && <p className="mt-4 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        {!editable && (
          <p className="mt-6 text-sm text-muted">
            The remake has started, so this is how it was set up. To change something now, write to the director in the thread.
          </p>
        )}
      </div>
    </div>
  );
}

function Section({ icon, title, children }: { icon?: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        {icon && <span className="text-muted">{icon}</span>}
        {title}
      </h2>
      {children}
    </section>
  );
}
