import { useCallback, useSyncExternalStore } from "react";

export type PlaybackState = {
  time: number;
  duration: number;
  paused: boolean;
  volume: number;
  muted: boolean;
  rate: number;
  buffered: number; // seconds buffered ahead of the start, for the scrubber
};

/**
 * The <video> element's state as a tiny store, so the playhead can update every
 * frame while only the pieces that show it re-render (not the comment list).
 */
export class Playback {
  video: HTMLVideoElement | null = null;
  fps = 30;
  state: PlaybackState = { time: 0, duration: 0, paused: true, volume: 1, muted: false, rate: 1, buffered: 0 };
  private listeners = new Set<() => void>();
  private frame = 0;
  private detach?: () => void;

  attach(video: HTMLVideoElement | null) {
    this.detach?.();
    this.detach = undefined;
    this.video = video;
    if (!video) return;
    const sync = () => this.read();
    const events = [
      "timeupdate", "play", "pause", "seeked", "seeking", "loadedmetadata",
      "durationchange", "volumechange", "ratechange", "progress", "ended",
    ];
    for (const e of events) video.addEventListener(e, sync);
    const onPlay = () => this.loop();
    video.addEventListener("play", onPlay);
    this.read();
    this.detach = () => {
      for (const e of events) video.removeEventListener(e, sync);
      video.removeEventListener("play", onPlay);
      cancelAnimationFrame(this.frame);
    };
  }

  private loop() {
    cancelAnimationFrame(this.frame);
    const tick = () => {
      this.read();
      if (this.video && !this.video.paused) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private read() {
    const v = this.video;
    if (!v) return;
    let buffered = 0;
    for (let i = 0; i < v.buffered.length; i++) {
      if (v.buffered.start(i) <= v.currentTime + 0.5) buffered = Math.max(buffered, v.buffered.end(i));
    }
    this.state = {
      time: v.currentTime,
      duration: Number.isFinite(v.duration) ? v.duration : this.state.duration,
      paused: v.paused,
      volume: v.volume,
      muted: v.muted,
      rate: v.playbackRate,
      buffered,
    };
    for (const l of this.listeners) l();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  seek(t: number) {
    const v = this.video;
    if (!v) return;
    const end = this.state.duration || v.duration || 0;
    v.currentTime = Math.min(Math.max(0, t), end ? end - 0.001 : t);
    this.read();
  }
  play() {
    this.video?.play().catch(() => {});
  }
  pause() {
    this.video?.pause();
  }
  toggle() {
    if (this.video?.paused) this.play();
    else this.pause();
  }
  /** Move by whole frames (pauses first, like an editor would). */
  step(frames: number) {
    this.pause();
    // Land in the middle of the frame so rounding never shows the previous one.
    const current = Math.floor(this.state.time * this.fps + 1e-3);
    this.seek((current + frames + 0.5) / this.fps);
  }
}

export function usePlayback<T>(pb: Playback, pick: (s: PlaybackState) => T): T {
  const get = useCallback(() => pick(pb.state), [pb, pick]);
  return useSyncExternalStore(pb.subscribe, get, get);
}
