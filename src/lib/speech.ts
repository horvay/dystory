// Dictation: the browser records the microphone, converts it to the 16 kHz
// mono WAV that Whisper wants, and the server (stt/server.ts, proxied at
// /stt) turns it into text.

const SAMPLE_RATE = 16_000;
/** Recordings stop on their own after this long. */
export const MAX_SECONDS = 10 * 60;

/** A failure with a message that can be shown as is. */
export class SpeechError extends Error {}

/** A microphone recording in progress. */
export class Recording {
  private chunks: Blob[] = [];
  private buf: Float32Array<ArrayBuffer>;
  private stopped: Promise<void>;

  private constructor(
    private stream: MediaStream,
    private recorder: MediaRecorder,
    private ctx: AudioContext,
    private analyser: AnalyserNode,
  ) {
    this.buf = new Float32Array(analyser.fftSize);
    recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.stopped = new Promise((resolve) => (recorder.onstop = () => resolve()));
    recorder.start(1000);
  }

  static async start(): Promise<Recording> {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      throw new SpeechError(
        window.isSecureContext ? "This browser can't record audio." : "Dictation only works over HTTPS.",
      );
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      const name = (e as DOMException).name;
      if (name === "NotAllowedError" || name === "SecurityError") {
        throw new SpeechError("The microphone is blocked. Allow it in site settings.");
      }
      if (name === "NotFoundError" || name === "OverconstrainedError") throw new SpeechError("No microphone found.");
      throw new SpeechError("Couldn't start the microphone.");
    }
    const ctx = new AudioContext();
    void ctx.resume();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    return new Recording(stream, new MediaRecorder(stream), ctx, analyser);
  }

  /** How loud the microphone is right now, 0 to 1, for a level meter. */
  level(): number {
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (const s of this.buf) sum += s * s;
    const rms = Math.sqrt(sum / this.buf.length);
    // Speech sits around 0.02–0.2 RMS; spread that over the meter.
    return Math.min(1, Math.max(0, (20 * Math.log10(rms + 1e-9) + 50) / 40));
  }

  /** Stop and return the recording as a 16 kHz WAV, or null if it was silent. */
  async finish(): Promise<{ wav: Blob; seconds: number } | null> {
    if (this.recorder.state !== "inactive") this.recorder.stop();
    await this.stopped;
    this.release();
    try {
      const encoded = await new Blob(this.chunks, { type: this.recorder.mimeType }).arrayBuffer();
      const decoded = await this.ctx.decodeAudioData(encoded);
      const samples = await resample(decoded);
      if (samples.length < SAMPLE_RATE / 4 || peak(samples) < 0.01) return null;
      return { wav: encodeWav(samples), seconds: samples.length / SAMPLE_RATE };
    } catch {
      throw new SpeechError("Couldn't read the recording.");
    } finally {
      void this.ctx.close();
    }
  }

  cancel() {
    if (this.recorder.state !== "inactive") this.recorder.stop();
    this.release();
    void this.ctx.close();
  }

  private release() {
    for (const t of this.stream.getTracks()) t.stop();
  }
}

/** Mix down to mono at 16 kHz. */
async function resample(buffer: AudioBuffer): Promise<Float32Array> {
  const length = Math.ceil(buffer.duration * SAMPLE_RATE);
  if (length === 0) return new Float32Array();
  const offline = new OfflineAudioContext(1, length, SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  return (await offline.startRendering()).getChannelData(0);
}

function peak(samples: Float32Array) {
  let max = 0;
  for (const s of samples) max = Math.max(max, Math.abs(s));
  return max;
}

function encodeWav(samples: Float32Array): Blob {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per frame
  view.setUint16(34, 16, true); // bits per sample
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => {
    const v = Math.max(-1, Math.min(1, s));
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  });
  return new Blob([view.buffer], { type: "audio/wav" });
}

const OFFLINE = "Dictation isn't running on the server right now.";

/** Whether the server can transcribe right now; throws a SpeechError if not. */
export async function checkReady(): Promise<void> {
  let status: { ready: boolean; error?: string } | null = null;
  try {
    const res = await fetch("/stt/status", { cache: "no-store" });
    status = res.ok ? await res.json() : null;
  } catch {}
  if (!status) throw new SpeechError(OFFLINE);
  if (!status.ready) throw new SpeechError(status.error ?? OFFLINE);
}

/** Turn speech into text. */
export async function transcribe(wav: Blob, signal?: AbortSignal): Promise<string> {
  const form = new FormData();
  form.append("audio", wav, "speech.wav");
  let res: Response;
  try {
    res = await fetch("/stt/transcribe", { method: "POST", body: form, signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new SpeechError(OFFLINE);
  }
  const body = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
  if (!res.ok || typeof body?.text !== "string") throw new SpeechError(body?.error ?? OFFLINE);
  return body.text;
}
