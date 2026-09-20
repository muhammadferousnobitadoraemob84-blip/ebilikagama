// Virtual Radio: synchronized 24/7 playlist engine.
//
// CORE CONCEPT — the "radio timeline":
//   position(t) = (t − epoch) mod totalDuration
//
// There is exactly ONE timeline per radio, anchored by a fixed epoch
// (radio_started_at, a setting). Every client computes the same
// song + offset at the same wall-clock instant — no per-visitor
// playlists, no stored "current track" that drifts. The radio keeps
// "playing" with zero browsers open because the timeline is pure math.
//
// Storage: ONLY lightweight metadata in the existing Setting key/value
// table (see virtual-radio-store.ts). No audio bytes ever leave Drive.
//
// This module is shared client+server and has no I/O dependencies.

export interface VirtualRadioTrack {
  /** Google Drive file ID — the ONLY storage reference, never audio bytes. */
  driveId: string;
  fileName: string;
  /** seconds; detected server-side from MP3 frame headers */
  duration: number;
  /** bytes, for range-request hints */
  size: number | null;
  mimeType: string;
}

/**
 * A discovered, accessible track whose duration couldn't be determined
 * server-side (yet). PLAYABLE ≠ duration-known: these are kept apart from
 * the synchronized playlist (which needs exact durations for the timeline
 * math) until a duration is measured (browser metadata fallback or rescan).
 */
export interface VirtualRadioPendingTrack {
  driveId: string;
  fileName: string;
  size: number | null;
  mimeType: string;
  /** Why server-side detection failed (duration only — accessibility held). */
  reason: string;
  addedAt: string; // ISO timestamp of the scan that produced it
}

export interface VirtualRadioState {
  enabled: boolean;
  folderId: string | null;
  folderName: string | null;
  epoch: number | null; // unix ms — timeline anchor
  tracks: VirtualRadioTrack[];
  totalDuration: number; // seconds, sum of track durations
  lastScanAt: string | null;
  /** Accessible tracks with unknown duration — NOT part of the timeline. */
  pending: VirtualRadioPendingTrack[];
}

export const EMPTY_RADIO_STATE: VirtualRadioState = {
  enabled: false,
  folderId: null,
  folderName: null,
  epoch: null,
  tracks: [],
  totalDuration: 0,
  lastScanAt: null,
  pending: [],
};

/** Timeline-safe slice of a state: only tracks with real durations. */
export function playlistWithoutPending(state: VirtualRadioState): VirtualRadioState {
  if (!state.pending?.length) return state;
  return { ...state, tracks: state.tracks, totalDuration: state.totalDuration };
}

// ─── Timeline math (pure, deterministic, shared by every client) ────

export interface RadioPosition {
  index: number; // track index in the playlist
  offset: number; // seconds into that track
  cyclePosition: number; // seconds since the start of the playlist cycle
  cycle: number; // how many complete playlist loops since the epoch
}

/**
 * Which track and offset the radio is at at absolute time `nowMs`.
 * Uses modular arithmetic — identical for every observer at the same instant.
 */
export function getRadioPosition(state: VirtualRadioState, nowMs: number): RadioPosition | null {
  if (!state.epoch || state.tracks.length === 0 || state.totalDuration <= 0) return null;

  const elapsed = (nowMs - state.epoch) / 1000;
  if (elapsed < 0) {
    // Radio starts in the future — clamp to the beginning.
    return { index: 0, offset: 0, cyclePosition: 0, cycle: 0 };
  }

  const cyclePosition = elapsed % state.totalDuration;
  const cycle = Math.floor(elapsed / state.totalDuration);

  let index = 0;
  let remaining = cyclePosition;
  for (let i = 0; i < state.tracks.length; i++) {
    if (remaining < state.tracks[i].duration) {
      index = i;
      break;
    }
    remaining -= state.tracks[i].duration;
    index = i; // handles the exact-final-boundary edge (remaining === total)
  }

  return { index, offset: remaining, cyclePosition, cycle };
}

/** Upcoming tracks after the current position (for preloading). */
export function getNextTracks(state: VirtualRadioState, index: number, count = 2): VirtualRadioTrack[] {
  if (state.tracks.length === 0) return [];
  const out: VirtualRadioTrack[] = [];
  for (let i = 1; i <= count; i++) {
    out.push(state.tracks[(index + i) % state.tracks.length]);
  }
  return out;
}

export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

// ─── Server-time synchronization ────────────────────────────────────
//
// The client must not trust its own clock. It estimates:
//   serverNow ≈ Date.now() + offsetMs
// where offsetMs is derived from a round trip to /api/virtual-radio/time:
//   offset ≈ serverMidpoint − clientMidpoint  (NTP-style, cancels half the RTT)

export interface ServerClockSync {
  /** Add this to Date.now() to approximate the server clock. */
  offsetMs: number;
  /** Round-trip time of the sample, ms — a quality indicator. */
  rttMs: number;
  sampledAt: number; // client Date.now() when the sample was taken
}

export function computeClockOffset(clientSentMs: number, clientReceivedMs: number, serverNowMs: number): ServerClockSync {
  const rtt = Math.max(0, clientReceivedMs - clientSentMs);
  const clientMidpoint = (clientSentMs + clientReceivedMs) / 2;
  return { offsetMs: serverNowMs - clientMidpoint, rttMs: rtt, sampledAt: clientReceivedMs };
}

/**
 * Best current estimate of the server clock. `Date.now() + offset` —
 * the offset drift is negligible over the minutes a radio session lasts,
 * and each page load / visibility-return takes a fresh sample.
 */
export function serverNow(sync: ServerClockSync): number {
  return Date.now() + sync.offsetMs;
}

/**
 * Quality gate: with RTT over this threshold the midpoint estimate gets
 * noisy (Drive/network jitter). The player resamples when it sees a bad one.
 */
export const MAX_ACCEPTABLE_RTT_MS = 1500;

// ─── Client-side radio position helper ──────────────────────────────

/**
 * Compute where the radio is right now, using the synced clock.
 * Returns null when the radio has no timeline (disabled/empty) or
 * the clock hasn't been synced yet.
 */
export function getSyncedPosition(state: VirtualRadioState, sync: ServerClockSync | null): RadioPosition | null {
  if (!sync) return null;
  return getRadioPosition(state, serverNow(sync));
}
