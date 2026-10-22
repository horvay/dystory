// Speech-to-text for dictation. Keeps whisper.cpp's server (built by
// stt/setup.sh) running on a private port with the model loaded, and answers
// the browser on STT_PORT, which Vite proxies at /stt:
//
//   GET  /stt/status      -> { ready, model, error? }
//   POST /stt/transcribe  multipart: audio (16 kHz WAV) -> { text }
//
// When dictation isn't set up it says so in /stt/status and keeps running,
// because `bun run dev` stops everything as soon as one process exits.
import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";

const DIR = join(import.meta.dir, "..", ".stt");
const PORT = Number(process.env.STT_PORT || 5193);
const WHISPER_PORT = Number(process.env.STT_WHISPER_PORT || 5194);
const MODEL = process.env.STT_MODEL || "small.en";
const BIN = join(DIR, "whisper-server");
const MODEL_FILE = join(DIR, "models", `ggml-${MODEL}.bin`);
const VAD_FILE = join(DIR, "models", "ggml-silero-v6.2.0.bin");
const MAX_UPLOAD = 40 * 1024 * 1024; // about 20 minutes of 16 kHz WAV
const WHISPER = `http://127.0.0.1:${WHISPER_PORT}`;

let ready = false;
let problem: string | null = "Dictation is starting up. Try again shortly.";
let child: ReturnType<typeof Bun.spawn> | null = null;
let quitting = false;
// whisper-server is chatty; keep its recent output for when it crashes.
const recent: string[] = [];

async function collect(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of stream) {
    const lines = (pending + decoder.decode(chunk, { stream: true })).split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const gpu = line.match(/ggml_vulkan: \d+ = ([^|]+?) \(/)?.[1];
      if (gpu) console.log(`[stt] running on the GPU: ${gpu}`);
      recent.push(line);
      if (recent.length > 40) recent.shift();
    }
  }
}

function launch() {
  if (!existsSync(BIN) || !existsSync(MODEL_FILE)) {
    problem = "Dictation isn't set up on this server yet.";
    console.log("[stt] Dictation isn't set up. Run `bun run stt:setup`, then restart.");
    return;
  }
  const args = [
    BIN,
    ...["--host", "127.0.0.1", "--port", String(WHISPER_PORT)],
    ...["-m", MODEL_FILE, "-t", String(Math.min(8, availableParallelism()))],
    ...["-l", MODEL.endsWith(".en") ? "en" : "auto"],
    "--no-timestamps",
    "--suppress-nst",
  ];
  // Voice activity detection skips the silences, which is faster and stops
  // Whisper from inventing words for them ("you" for room noise). whisper.cpp's
  // own defaults (0.5 threshold, splitting at 0.1 s pauses, 30 ms padding) cut
  // quiet words and word edges; these keep them, like faster-whisper's.
  if (existsSync(VAD_FILE)) {
    args.push("--vad", "-vm", VAD_FILE, "-vt", "0.3", "-vsd", "2000", "-vp", "400");
  }
  if (process.env.STT_GPU === "0") args.push("--no-gpu");

  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  child = proc;
  void collect(proc.stdout);
  void collect(proc.stderr);
  const startedAt = Date.now();
  void waitUntilReady(proc, startedAt);
  void proc.exited.then((code) => {
    if (child === proc) child = null;
    ready = false;
    if (quitting) return;
    problem = "The speech model is restarting. Try again shortly.";
    console.log(`[stt] whisper-server exited (${code}); last output:\n${recent.join("\n")}`);
    // Back off when it can't even start.
    setTimeout(launch, Date.now() - startedAt < 10_000 ? 15_000 : 2_000);
  });
}

async function waitUntilReady(proc: NonNullable<typeof child>, startedAt: number) {
  while (child === proc) {
    const res = await fetch(`${WHISPER}/health`).catch(() => null);
    if (res?.ok) {
      ready = true;
      problem = null;
      const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(`[stt] ${MODEL} loaded in ${secs}s, serving 127.0.0.1:${PORT}`);
      return;
    }
    await Bun.sleep(300);
  }
}

// Sound annotations Whisper sometimes writes: [BLANK_AUDIO], (music), *sighs*.
const ANNOTATION = /\[[^\]]*\]|\(\s*[\p{L}' ]{1,30}\)|\*\s*[\p{L}' ]{1,30}\*/gu;

function clean(text: string) {
  return text.replace(ANNOTATION, " ").replace(/\s+/g, " ").trim();
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function transcribe(req: Request) {
  if (!ready) return json({ error: problem }, 503);
  if (Number(req.headers.get("content-length") || 0) > MAX_UPLOAD) {
    return json({ error: "That recording is too long to transcribe." }, 413);
  }
  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return json({ error: "No recording came through." }, 400);

  // No prompt: given the text around the cursor as a hint, Whisper sometimes
  // wrote a paraphrase of that text instead of quiet or unclear speech.
  const body = new FormData();
  body.append("file", audio, "speech.wav");
  body.append("response_format", "json");
  body.append("temperature", "0");
  body.append("temperature_inc", "0.2");
  const started = Date.now();
  const res = await fetch(`${WHISPER}/inference`, { method: "POST", body, signal: req.signal }).catch(() => null);
  const out = (await res?.json().catch(() => null)) as { text?: string; error?: string } | null;
  if (!res?.ok || typeof out?.text !== "string") {
    console.log(`[stt] transcription failed: ${res?.status ?? "no response"} ${out?.error ?? ""}`);
    return json({ error: "Transcription failed." }, 502);
  }
  const text = clean(out.text);
  const seconds = (audio.size - 44) / 32_000;
  console.log(`[stt] ${seconds.toFixed(1)}s of audio in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return json({ text });
}

Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  maxRequestBodySize: MAX_UPLOAD,
  idleTimeout: 255, // long recordings take a while on the CPU
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === "/stt/status" && req.method === "GET") {
      return json({ ready, model: MODEL, ...(problem && { error: problem }) });
    }
    if (pathname === "/stt/transcribe" && req.method === "POST") return transcribe(req);
    return json({ error: "Not found" }, 404);
  },
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    quitting = true;
    child?.kill();
    process.exit(0);
  });
}

// A whisper-server left behind by a run that was killed outright would hold
// the port; it can only be ours, since this checkout's binary is in the path.
Bun.spawnSync(["pkill", "-f", `^${BIN} `]);
launch();
