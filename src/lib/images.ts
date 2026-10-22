// Reference images go to the media server in one request (media/server.ts).
// The browser decodes each image first: that gives its size (so the grid can
// lay out before it loads), applies a phone photo's rotation, and makes a
// small thumbnail for the grid.

export type ImageInfo = { file: string; thumb: string; size: number; fileName: string; width: number; height: number };

const WEB_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
const THUMB_WIDTH = 720;

export function isImageFile(f: File) {
  return f.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|avif|heic|heif)$/i.test(f.name);
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

function draw(bitmap: ImageBitmap, width: number) {
  const height = Math.max(1, Math.round((bitmap.height * width) / bitmap.width));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

export class ImageError extends Error {}

export async function uploadImage(file: File): Promise<ImageInfo> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ImageError(`Couldn't read ${file.name}. Try a JPEG or PNG.`);
  }
  const { width, height } = bitmap;
  let upload: Blob = file;
  let fileName = file.name;
  let thumb: Blob | null = null;
  try {
    // HEIC and friends: this browser can read it, others can't, so store a JPEG.
    if (!WEB_TYPES.includes(file.type)) {
      upload = (await toBlob(draw(bitmap, width), "image/jpeg", 0.92)) ?? file;
      fileName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    }
    // GIFs keep their animation in the grid; small images are their own thumbnail.
    if (file.type !== "image/gif" && width > THUMB_WIDTH * 1.25) {
      const canvas = draw(bitmap, THUMB_WIDTH);
      thumb = await toBlob(canvas, "image/webp", 0.82);
      if (thumb?.type !== "image/webp") thumb = await toBlob(canvas, "image/jpeg", 0.85); // older Safari
    }
  } finally {
    bitmap.close();
  }

  const form = new FormData();
  form.append("file", upload, fileName);
  if (thumb) form.append("thumb", thumb, thumb.type === "image/webp" ? "thumb.webp" : "thumb.jpg");
  const res = await fetch("/media/images", { method: "POST", body: form });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ImageError(body?.error ?? `Couldn't upload ${file.name}`);
  return { ...(body as { file: string; thumb: string; size: number }), fileName, width, height };
}
