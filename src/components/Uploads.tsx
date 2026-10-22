import { useMutation } from "convex/react";
import { CheckCircle2, CircleAlert, Loader2, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useMe } from "../lib/identity";
import { bytes } from "../lib/time";
import { uploadFile, UploadError } from "../lib/upload";
import { useToast } from "./Toast";

type Target = { kind: "new" } | { kind: "version"; videoId: Id<"videos"> };

export type Upload = {
  id: number;
  name: string;
  size: number;
  sent: number;
  speed: number; // bytes per second, smoothed
  status: "uploading" | "processing" | "done" | "error";
  error?: string;
  target: Target;
};

type Ctx = { uploads: Upload[]; start: (files: File[], target: Target) => void };
const UploadsCtx = createContext<Ctx>({ uploads: [], start: () => {} });
export const useUploads = () => useContext(UploadsCtx);

export function isVideoFile(f: File) {
  return f.type.startsWith("video/") || /\.(mp4|m4v|mov)$/i.test(f.name);
}

export function UploadsProvider({ children }: { children: ReactNode }) {
  const me = useMe();
  const toast = useToast();
  const [location, navigate] = useLocation();
  const here = useRef(location);
  here.current = location;
  const create = useMutation(api.videos.create);
  const addVersion = useMutation(api.videos.addVersion);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const nextId = useRef(1);
  const aborts = useRef(new Map<number, AbortController>());

  const patch = useCallback(
    (id: number, p: Partial<Upload>) => setUploads((us) => us.map((u) => (u.id === id ? { ...u, ...p } : u))),
    [],
  );

  const runOne = useCallback(
    async (file: File, target: Target) => {
      const id = nextId.current++;
      const abort = new AbortController();
      aborts.current.set(id, abort);
      setUploads((us) => [
        ...us,
        { id, name: file.name, size: file.size, sent: 0, speed: 0, status: "uploading", target },
      ]);
      let last = { t: performance.now(), sent: 0 };
      let speed = 0;
      try {
        const info = await uploadFile(
          file,
          (sent) => {
            const now = performance.now();
            if (now - last.t > 400) {
              const instant = ((sent - last.sent) / (now - last.t)) * 1000;
              speed = speed ? speed * 0.6 + instant * 0.4 : instant;
              last = { t: now, sent };
            }
            patch(id, { sent, speed, status: sent >= file.size ? "processing" : "uploading" });
          },
          abort.signal,
        );
        patch(id, { status: "processing" });
        if (target.kind === "new") {
          const videoId = await create({ userId: me._id, ...info });
          toast({ message: `Uploaded ${file.name}`, action: { label: "Open", run: () => navigate(`/v/${videoId}`) } });
        } else {
          const number = await addVersion({ videoId: target.videoId, userId: me._id, ...info });
          // Still on that video: switch to the new cut. Elsewhere: offer it.
          if (here.current === `/v/${target.videoId}`) navigate(`/v/${target.videoId}?v=${number}`);
          else toast({
            message: `Version ${number} is ready`,
            action: { label: "Show", run: () => navigate(`/v/${target.videoId}?v=${number}`) },
          });
        }
        patch(id, { status: "done", sent: file.size });
        setTimeout(() => setUploads((us) => us.filter((u) => u.id !== id)), 4000);
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          setUploads((us) => us.filter((u) => u.id !== id));
        } else {
          patch(id, {
            status: "error",
            error: e instanceof UploadError ? e.message : "Upload failed. Check the connection and try again.",
          });
        }
      } finally {
        aborts.current.delete(id);
      }
    },
    [addVersion, create, me._id, navigate, patch, toast],
  );

  const start = useCallback(
    (files: File[], target: Target) => {
      const videos = files.filter(isVideoFile);
      if (videos.length < files.length) toast({ message: "Only video files can be uploaded" });
      // A new version takes one file; new videos can come in bulk.
      for (const f of target.kind === "version" ? videos.slice(0, 1) : videos) void runOne(f, target);
    },
    [runOne, toast],
  );

  const busy = uploads.some((u) => u.status === "uploading" || u.status === "processing");
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  return (
    <UploadsCtx.Provider value={{ uploads, start }}>
      {children}
      {uploads.length > 0 && (
        <div className="fixed right-4 bottom-4 z-[80] w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line bg-surface shadow-float">
          {uploads.map((u) => (
            <UploadRow
              key={u.id}
              u={u}
              onCancel={() => aborts.current.get(u.id)?.abort()}
              onDismiss={() => setUploads((us) => us.filter((x) => x.id !== u.id))}
            />
          ))}
        </div>
      )}
    </UploadsCtx.Provider>
  );
}

function UploadRow({ u, onCancel, onDismiss }: { u: Upload; onCancel: () => void; onDismiss: () => void }) {
  const pct = u.size ? Math.min(100, (u.sent / u.size) * 100) : 0;
  const remaining = u.speed > 0 ? (u.size - u.sent) / u.speed : 0;
  return (
    <div className="border-b border-line px-4 py-3 last:border-b-0">
      <div className="flex items-center gap-2">
        {u.status === "done" ? (
          <CheckCircle2 size={16} className="shrink-0 text-emerald-500" />
        ) : u.status === "error" ? (
          <CircleAlert size={16} className="shrink-0 text-danger" />
        ) : (
          <Loader2 size={16} className="shrink-0 animate-spin text-muted" />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{u.name}</span>
        {(u.status === "uploading" || u.status === "error") && (
          <button
            onClick={u.status === "error" ? onDismiss : onCancel}
            aria-label={u.status === "error" ? "Dismiss" : "Cancel upload"}
            className="grid size-6 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
          >
            <X size={14} />
          </button>
        )}
      </div>
      {u.status === "error" ? (
        <p className="mt-1 text-xs text-danger">{u.error}</p>
      ) : (
        <>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${u.status === "uploading" ? pct : 100}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted tabular-nums">
            {u.status === "uploading"
              ? `${bytes(u.sent)} of ${bytes(u.size)}${u.speed ? ` · ${bytes(u.speed)}/s · ${eta(remaining)}` : ""}`
              : u.status === "processing"
                ? "Preparing for playback…"
                : u.target.kind === "version"
                  ? "New version added"
                  : "Done"}
          </p>
        </>
      )}
    </div>
  );
}

function eta(s: number) {
  if (s < 60) return `${Math.max(1, Math.round(s))}s left`;
  return `${Math.round(s / 60)} min left`;
}
