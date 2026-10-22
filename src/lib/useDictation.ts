import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useToast } from "../components/Toast";
import { checkReady, MAX_SECONDS, Recording, SpeechError, transcribe } from "./speech";

export type DictationPhase = "idle" | "starting" | "recording" | "transcribing";

type Options = {
  /** The microphone is on: show where the words will land. */
  onStart?: () => void;
  onText: (text: string) => void;
  /** Dictation is over: after onText, or when cancelled, silent or failed. */
  onEnd?: () => void;
};

// One microphone at a time: starting a dictation finishes any other.
let active: { stop: () => void } | null = null;

/**
 * Record, then transcribe. Click once to start, again to stop; Escape
 * cancels while recording or transcribing.
 */
export function useDictation(options: Options) {
  const opts = useRef(options);
  opts.current = options;
  const toast = useToast();
  const [phase, setPhaseState] = useState<DictationPhase>("idle");
  const [seconds, setSeconds] = useState(0);
  const phaseRef = useRef<DictationPhase>("idle");
  const recording = useRef<Recording | null>(null);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const attempts = useRef(0);
  const self = useRef({ stop: () => {} });

  const setPhase = (p: DictationPhase) => {
    phaseRef.current = p;
    if (mounted.current) setPhaseState(p);
  };

  const end = useCallback(() => {
    if (active === self.current) active = null;
    setPhase("idle");
    if (mounted.current) setSeconds(0);
    opts.current.onEnd?.();
  }, []);

  const send = useCallback(
    async (wav: Blob) => {
      setPhase("transcribing");
      const controller = new AbortController();
      request.current = controller;
      try {
        const text = await transcribe(wav, controller.signal);
        if (!mounted.current) return;
        if (text) opts.current.onText(text);
        else toast({ message: "Didn't catch any words." });
        end();
      } catch (e) {
        if (controller.signal.aborted || !mounted.current) return;
        end();
        const retry = () => {
          if (!mounted.current || phaseRef.current !== "idle") return;
          opts.current.onStart?.();
          void send(wav);
        };
        toast(
          {
            message: e instanceof SpeechError ? e.message : "Transcription failed.",
            action: { label: "Retry", run: retry },
          },
          12_000,
        );
      } finally {
        if (request.current === controller) request.current = null;
      }
    },
    [end, toast],
  );

  const stop = useCallback(async () => {
    const rec = recording.current;
    if (!rec) return;
    recording.current = null;
    if (active === self.current) active = null;
    setPhase("transcribing");
    const attempt = attempts.current;
    let audio: Awaited<ReturnType<Recording["finish"]>>;
    try {
      audio = await rec.finish();
    } catch (e) {
      if (attempts.current !== attempt) return;
      end();
      toast({ message: e instanceof SpeechError ? e.message : "Couldn't read the recording." });
      return;
    }
    // Cancelled while the recording was being converted.
    if (attempts.current !== attempt || !mounted.current) return;
    if (!audio) {
      end();
      toast({ message: "Didn't hear anything. Check your microphone." });
      return;
    }
    await send(audio.wav);
  }, [end, send, toast]);
  self.current.stop = () => void stop();

  const start = useCallback(async () => {
    if (phaseRef.current !== "idle") return;
    active?.stop();
    const attempt = ++attempts.current;
    setPhase("starting");
    const [ready, mic] = await Promise.allSettled([checkReady(), Recording.start()]);
    const rec = mic.status === "fulfilled" ? mic.value : null;
    // Cancelled (Escape) or unmounted while the microphone was starting.
    if (attempts.current !== attempt || !mounted.current) {
      rec?.cancel();
      return;
    }
    const failure = ready.status === "rejected" ? ready.reason : mic.status === "rejected" ? mic.reason : null;
    if (!rec || failure) {
      rec?.cancel();
      setPhase("idle");
      toast({ message: failure instanceof SpeechError ? failure.message : "Couldn't start dictation." });
      return;
    }
    recording.current = rec;
    active = self.current;
    setSeconds(0);
    setPhase("recording");
    opts.current.onStart?.();
  }, [toast]);

  const cancel = useCallback(() => {
    const p = phaseRef.current;
    if (p === "idle") return;
    attempts.current++;
    recording.current?.cancel();
    recording.current = null;
    request.current?.abort();
    request.current = null;
    if (p === "starting") setPhase("idle");
    else end();
  }, [end]);

  /** Start, or stop and transcribe. Does nothing while busy, so a double click can't lose a recording. */
  const toggle = useCallback(() => {
    if (phaseRef.current === "idle") void start();
    else if (phaseRef.current === "recording") void stop();
  }, [start, stop]);

  const level = useCallback(() => recording.current?.level() ?? 0, []);

  // The clock, and the automatic stop at the limit.
  useEffect(() => {
    if (phase !== "recording") return;
    const startedAt = Date.now();
    const t = setInterval(() => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      setSeconds(s);
      if (s >= MAX_SECONDS) void stop();
    }, 250);
    return () => clearInterval(t);
  }, [phase, stop]);

  useEffect(() => {
    if (phase === "idle") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      cancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [phase, cancel]);

  // Let go of the microphone when the page goes away mid-dictation.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      recording.current?.cancel();
      request.current?.abort();
      if (active === self.current) active = null;
    };
  }, []);

  return { phase, seconds, level, toggle, cancel };
}

export type Dictation = ReturnType<typeof useDictation>;

/**
 * Dictation into a text box. The words go in where the cursor was when the
 * microphone came on (the end, if the box wasn't focused), and that spot
 * moves with any typing or live edits that land in the meantime.
 */
export function useTextDictation(
  field: RefObject<HTMLTextAreaElement | null>,
  value: string,
  onChange: (value: string) => void,
  options: { onStart?: () => void } = {},
) {
  const at = useRef<number | null>(null);
  const text = useRef(value);
  const latest = useRef({ onChange, options });
  latest.current = { onChange, options };

  useLayoutEffect(() => {
    if (at.current !== null && value !== text.current) at.current = mapPosition(text.current, value, at.current);
    text.current = value;
  }, [value]);

  const mark = () => {
    const el = field.current;
    at.current = el && document.activeElement === el ? el.selectionEnd : text.current.length;
  };

  const dictation = useDictation({
    onStart: () => {
      if (at.current === null) mark();
    },
    onText: (words) => {
      const v = text.current;
      const pos = Math.min(at.current ?? v.length, v.length);
      const before = v.slice(0, pos);
      const after = v.slice(pos);
      let insert = words;
      if (before && !/[\s([{“‘"'/-]$/.test(before)) insert = ` ${insert}`;
      const caret = pos + insert.length;
      if (/^[\p{L}\p{N}]/u.test(after)) insert = `${insert} `;
      latest.current.onChange(before + insert + after);
      // Carry on typing after the words, unless you've moved to another field.
      requestAnimationFrame(() => {
        const el = field.current;
        if (!el) return;
        const focus = document.activeElement;
        if (focus !== el && focus?.closest("input, textarea, select, [contenteditable]")) return;
        el.focus({ preventScroll: true });
        el.setSelectionRange(caret, caret);
      });
    },
    onEnd: () => {
      at.current = null;
    },
  });

  const { toggle: toggleDictation } = dictation;
  const toggle = useCallback(() => {
    if (dictation.phase === "idle") {
      mark();
      latest.current.options.onStart?.();
    }
    toggleDictation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dictation.phase, toggleDictation]);

  return { ...dictation, toggle };
}

/**
 * Where `pos` in `before` ends up in `after`: right after the text that led
 * up to it, if that's still there (nearest to where it was), or else by
 * treating the change as a single edit.
 */
function mapPosition(before: string, after: string, pos: number) {
  const lead = before.slice(Math.max(0, pos - 24), pos);
  if (lead) {
    let best = -1;
    for (let i = after.indexOf(lead); i !== -1; i = after.indexOf(lead, i + 1)) {
      const at = i + lead.length;
      if (best === -1 || Math.abs(at - pos) < Math.abs(best - pos)) best = at;
    }
    if (best !== -1) return best;
  }
  const max = Math.min(before.length, after.length);
  let start = 0;
  while (start < max && before[start] === after[start]) start++;
  // Text typed right at the spot goes after the dictated words.
  if (pos <= start) return pos;
  let end = 0;
  while (end < max - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  if (pos >= before.length - end) return pos + after.length - before.length;
  return after.length - end; // the text around the spot was replaced
}
