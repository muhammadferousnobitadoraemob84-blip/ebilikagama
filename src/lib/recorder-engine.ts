"use client";

// Radio audio tap + azan event bus (client-only).
//
// CAPTURE ARCHITECTURE — what is recorded and what is NOT:
// The VirtualRadioPlayer plays BOTH radio tracks and azan interruptions
// through ONE same-origin <audio> element (/api/virtual-radio/stream?id=…).
// This module taps that element with the Web Audio API:
//
//   <audio> ──createMediaElementSource──▶ MediaStreamAudioDestinationNode ──▶ MediaRecorder
//                                    └▶ ctx.destination (audible output preserved)
//
// A MediaElementSource captures ONLY that element's audio. It cannot see the
// microphone, the webcam, other tabs, system/desktop audio, YouTube, or any
// other page audio. If the radio element is silent, the recording is silent —
// there is no other input wired in.
//
// One caveat handled here: createMediaElementSource() reroutes the element's
// audio through the AudioContext, so the tap node is created ONCE and reused
// across recordings (creating it twice on the same element throws).
//
// TIMING: elapsed time is measured against the SERVER-CLOCK samples from the
// virtual-radio sync endpoint (same reference the radio timeline uses), not
// the local clock. Azan events are reported by the player the moment they
// actually start playing (onAzanStart callback), so markers reflect the real
// broadcast, not the scheduled prayer time.

export interface ServerClockSample {
  /** unix ms by the server's clock, sampled at `localAt` */
  serverTime: number;
  localAt: number;
  rttMs: number;
}

export interface RecordedAzanEvent {
  prayer: string;
  /** seconds into the recording when the azan actually began */
  offsetSeconds: number;
  /** unix ms (server clock) when the azan actually began */
  actualStartAt: number;
}

interface EngineState {
  running: boolean;
  startedAtServer: number; // unix ms (server clock)
  startedAtLocal: number;
  chunks: Blob[];
  recorder: MediaRecorder | null;
  stream: MediaStream | null;
  events: RecordedAzanEvent[];
}

export class RecorderEngine {
  private state: EngineState | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private destNode: MediaStreamAudioDestinationNode | null = null;
  private audioCtx: AudioContext | null = null;

  /** Wire the radio <audio> element once; idempotent. */
  async attach(audioEl: HTMLAudioElement): Promise<void> {
    if (this.sourceNode) return; // already tapped — reuse (2nd create() throws)
    const Ctx: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioCtx = new Ctx();
    if (this.audioCtx.state === "suspended") await this.audioCtx.resume();
    this.sourceNode = this.audioCtx.createMediaElementSource(audioEl);
    this.destNode = this.audioCtx.createMediaStreamDestination();
    this.sourceNode.connect(this.destNode);
    this.sourceNode.connect(this.audioCtx.destination); // keep it audible
  }

  get attached(): boolean {
    return !!this.sourceNode;
  }

  /**
   * Start capturing. Returns the server-clock start time used as t=0.
   * `sample` must be a fresh server-clock sample (rtt < ~500ms ideally).
   */
  start(sample: ServerClockSample): number {
    if (!this.sourceNode || !this.destNode) {
      throw new Error("Recorder not attached to the radio audio element");
    }
    if (this.state?.running) throw new Error("Already recording");
    if (typeof MediaRecorder === "undefined") {
      throw new Error("MediaRecorder is not supported in this browser");
    }

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(this.destNode.stream, {
      mimeType,
      audioBitsPerSecond: 128_000,
    });

    const nowLocal = Date.now();
    const startedAtServer = sample.serverTime + (nowLocal - sample.localAt);

    this.state = {
      running: true,
      startedAtServer,
      startedAtLocal: nowLocal,
      chunks: [],
      recorder,
      stream: this.destNode.stream,
      events: [],
    };

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.state?.chunks.push(e.data);
    };
    recorder.start(10_000); // timeslice: 10s chunks → bounded memory, crash-resilient
    return startedAtServer;
  }

  /** Called by the player the instant an azan actually starts playing. */
  markAzan(prayer: string, sample: ServerClockSample | null): RecordedAzanEvent | null {
    if (!this.state?.running) return null;
    const nowLocal = Date.now();
    const elapsed = (nowLocal - this.state.startedAtLocal) / 1000;
    const actualStartAt = sample
      ? sample.serverTime + (nowLocal - sample.localAt)
      : this.state.startedAtServer + elapsed * 1000;
    const ev: RecordedAzanEvent = { prayer, offsetSeconds: Math.round(elapsed), actualStartAt };
    // dedupe (prayer fires once per window; retries must not double-mark)
    if (!this.state.events.some((e) => e.prayer === ev.prayer && Math.abs(e.offsetSeconds - ev.offsetSeconds) < 5)) {
      this.state.events.push(ev);
    }
    return ev;
  }

  get events(): RecordedAzanEvent[] {
    return this.state ? [...this.state.events] : [];
  }

  get running(): boolean {
    return !!this.state?.running;
  }

  /** Server-clock unix ms for t=0 of the current recording. */
  get startedAtServer(): number | null {
    return this.state?.startedAtServer ?? null;
  }

  /** Elapsed seconds (used for live UI + heartbeats). */
  elapsedSeconds(): number {
    if (!this.state) return 0;
    return (Date.now() - this.state.startedAtLocal) / 1000;
  }

  /**
   * Stop and produce the single Blob to upload. Resolves once all remaining
   * dataavailable events flush (MediaRecorder guarantees the final one
   * arrives before `stop` event fires).
   */
  async stop(): Promise<{ blob: Blob; mimeType: string; durationSeconds: number; events: RecordedAzanEvent[] }> {
    if (!this.state || !this.state.running) throw new Error("Not recording");
    const st = this.state;
    const durationSeconds = (Date.now() - st.startedAtLocal) / 1000;

    await new Promise<void>((resolve) => {
      const rec = st.recorder!;
      const onStop = () => {
        rec.removeEventListener("stop", onStop);
        resolve();
      };
      rec.addEventListener("stop", onStop);
      if (rec.state !== "inactive") rec.stop();
      else resolve();
      setTimeout(resolve, 5000); // never hang forever on a wedged recorder
    });

    st.running = false;
    const blob = new Blob(st.chunks, { type: st.recorder?.mimeType ?? "audio/webm" });
    st.chunks = [];
    return { blob, mimeType: blob.type, durationSeconds, events: [...st.events] };
  }

  /** Abandon without producing output (start failed, user cancels). */
  abort(): void {
    try {
      if (this.state?.recorder && this.state.recorder.state !== "inactive") {
        this.state.recorder.stop();
      }
    } catch {
      /* ignore */
    }
    this.state = null;
  }
}

/**
 * Best supported recording mimeType, in preference order.
 * All browsers that support MediaRecorder support audio/webm; the codec
 * variants are opportunistic.
 */
export function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}

/**
 * Keep the screen awake during long recordings where supported.
 * Returns a release function. (Chrome/Edge only; harmless no-op elsewhere.)
 */
export async function requestWakeLock(): Promise<() => void> {
  try {
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
    };
    if (!nav.wakeLock) return () => {};
    const sentinel = await nav.wakeLock.request("screen");
    const onVis = () => {
      if (document.visibilityState === "visible") {
        nav.wakeLock?.request("screen").catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      sentinel.release().catch(() => {});
    };
  } catch {
    return () => {};
  }
}

/** Filename for a recording: eBilikAgama_Radio_2026-09-22_0000.webm */
export function recordingFileName(startedAtServer: number): string {
  // Format in Malaysia time (UTC+8) regardless of the admin's local clock.
  const d = new Date(startedAtServer + 8 * 3600 * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
  return `eBilikAgama_Radio_${date}_${time}.webm`;
}

/** Predictable unique-ifier if a file with the same minute already exists. */
export function uniquifyFileName(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  let i = 2;
  while (existing.includes(`${stem}_${i}${ext}`)) i++;
  return `${stem}_${i}${ext}`;
}
