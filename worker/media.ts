// Posting files from this machine to the media server (media/server.ts), the
// way the browser does: chunked video uploads, images with a thumbnail, and
// voice samples.
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";

const MEDIA = `http://127.0.0.1:${process.env.MEDIA_PORT || 5191}`;

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(MEDIA + path, init);
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error || `Media server answered ${res.status} for ${path}`);
  return body;
}

async function run(cmd: string[]) {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`${cmd[0]} failed: ${err.trim().split("\n").slice(-3).join(" ")}`);
  return out;
}

export type VideoFile = {
  fileId: string;
  fileName: string;
  size: number;
  duration: number;
  width: number;
  height: number;
  fps: number;
};

/** Uploads a video file; the media server remuxes it for fast playback and makes a thumbnail. */
export async function uploadVideo(path: string): Promise<VideoFile> {
  const size = (await stat(path)).size;
  const { uploadId, chunkSize } = await call<{ uploadId: string; chunkSize: number }>("/media/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: basename(path), size }),
  });
  const file = Bun.file(path);
  let offset = 0;
  while (offset < size) {
    const chunk = await file.slice(offset, offset + chunkSize).arrayBuffer();
    const res = await fetch(`${MEDIA}/media/uploads/${uploadId}?offset=${offset}`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: chunk,
    });
    const body = (await res.json()) as { received?: number; error?: string };
    if (res.status === 409 && body.received !== undefined) {
      offset = body.received;
      continue;
    }
    if (!res.ok || body.received === undefined) throw new Error(body.error || `Upload failed at byte ${offset}`);
    offset = body.received;
  }
  return call<VideoFile>(`/media/uploads/${uploadId}/finish`, { method: "POST" });
}

export type ImageFile = { file: string; thumb: string; size: number; fileName: string; width: number; height: number };

/** Uploads an image with a 640-pixel thumbnail for the grid. */
export async function uploadImage(path: string): Promise<ImageFile> {
  const probe = JSON.parse(
    await run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", path]),
  );
  const { width, height } = probe.streams?.[0] ?? {};
  if (!width || !height) throw new Error(`${path} isn't an image ffprobe can read`);
  const dir = await mkdtemp(join(tmpdir(), "dystory-thumb-"));
  try {
    const thumb = join(dir, "thumb.jpg");
    await run(["ffmpeg", "-v", "error", "-y", "-i", path, "-vf", "scale='min(640,iw)':-2", "-q:v", "4", thumb]);
    const form = new FormData();
    form.append("file", Bun.file(path), basename(path));
    form.append("thumb", Bun.file(thumb), "thumb.jpg");
    const res = await call<{ file: string; thumb: string; size: number }>("/media/images", { method: "POST", body: form });
    return { ...res, fileName: basename(path), width, height };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Uploads a voice sample for the catalog. */
export async function uploadAudio(path: string) {
  const ext = extname(path).toLowerCase();
  if (![".wav", ".mp3", ".flac", ".ogg", ".m4a"].includes(ext)) throw new Error("Use a WAV, MP3, FLAC, Ogg or M4A file");
  return call<{ file: string; duration: number; size: number }>(`/media/audio?name=${encodeURIComponent(basename(path))}`, {
    method: "POST",
    body: Bun.file(path),
  });
}
