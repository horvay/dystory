// Chunked upload to the media server (media/server.ts). Each chunk is retried
// on its own, and the server says how much it already has, so a flaky Wi-Fi
// moment costs one chunk rather than the whole file.

export type FileInfo = {
  fileId: string;
  fileName: string;
  size: number;
  duration: number;
  width: number;
  height: number;
  fps: number;
};

export class UploadError extends Error {}

function putChunk(url: string, chunk: Blob, onBytes: (n: number) => void, signal: AbortSignal) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => onBytes(e.loaded);
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.response });
    xhr.onerror = () => reject(new Error("network"));
    xhr.ontimeout = () => reject(new Error("timeout"));
    const abort = () => xhr.abort();
    signal.addEventListener("abort", abort, { once: true });
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    xhr.send(chunk);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function uploadFile(
  file: File,
  onProgress: (sent: number) => void,
  signal: AbortSignal,
): Promise<FileInfo> {
  const start = await fetch("/media/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, size: file.size }),
    signal,
  });
  if (!start.ok) throw new UploadError((await start.json().catch(() => null))?.error ?? "Couldn't start the upload");
  const { uploadId, chunkSize } = (await start.json()) as { uploadId: string; chunkSize: number };
  const base = `/media/uploads/${uploadId}`;

  try {
    let offset = 0;
    let failures = 0;
    while (offset < file.size) {
      const chunk = file.slice(offset, offset + chunkSize);
      try {
        const { status, body } = await putChunk(
          `${base}?offset=${offset}`,
          chunk,
          (n) => onProgress(offset + n),
          signal,
        );
        if (status === 200 || status === 409) {
          offset = body.received;
          failures = 0;
          onProgress(offset);
          continue;
        }
        if (status === 404 || status === 400) throw new UploadError(body?.error ?? "Upload rejected");
        throw new Error(`HTTP ${status}`);
      } catch (e) {
        if (e instanceof UploadError || (e as Error).name === "AbortError") throw e;
        if (++failures > 6) throw new UploadError("The connection keeps dropping. Try again.");
        await sleep(500 * 2 ** failures);
      }
    }

    const done = await fetch(`${base}/finish`, { method: "POST", signal });
    const body = await done.json().catch(() => null);
    if (!done.ok) throw new UploadError(body?.error ?? "The server couldn't process that video");
    return body as FileInfo;
  } catch (e) {
    fetch(base, { method: "DELETE" }).catch(() => {});
    throw e;
  }
}
