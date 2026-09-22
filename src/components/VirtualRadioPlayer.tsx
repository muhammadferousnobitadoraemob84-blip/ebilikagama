"use client";

// Virtual Radio player — synchronized Drive-powered 24/7 radio.
//
// Source of truth is the MATH, never a stored cursor:
//   position(serverNow) = (serverNow − epoch) mod totalDuration
// Every visitor computes the same track + offset at the same instant.
// Pause is local (like muting a real radio); Play rejoins the live point.
//
// AZAN INTERRUPTION MODEL (per-browser, timeline untouched):
//   1. When an azan window opens, each playing browser FREEZES its current
//      track + offset locally (server data only defines WHICH azan plays —
//      playback state stays out of Neon and out of other users' browsers).
//   2. The <audio> element plays the azan at its server-computed offset.
//   3. On the azan's real `ended` event: exactly 3 s of silence, then the
//      listener's LOCAL continuation timeline starts — same track, same
//      offset, advancing in real time — so the song continues exactly where
//      it was interrupted. The shared timeline keeps running underneath and
//      is rejoined automatically once the continuation window expires.
//   4. Azan events this browser heard to completion are remembered, so the
//      (still-active-for-seconds) server window can never drag the listener
//      back into an azan that just ended for them.
//
// PLAYBACK STATE: the UI "playing" state is driven ONLY by the element's
// real `playing`/`pause`/`waiting` events — never set speculatively.
//
// Visuals intentionally mirror RadioPlayer.tsx (vinyl, red controls) so the
// prototype blends into the existing radio page design.

import { useCallback, useEffect, useRef, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import {
  EMPTY_RADIO_STATE,
  MAX_ACCEPTABLE_RTT_MS,
  computeClockOffset,
  formatDuration,
  getSyncedPosition,
  positionFromCycle,
  serverNow,
  type ServerClockSync,
  type VirtualRadioState,
} from "@/lib/virtual-radio";
import { emptyAzanSchedule, type AzanSchedule } from "@/lib/azan";

type PlayerStatus =
  | "loading" // fetching radio state / first clock sync
  | "syncing" // audio element is genuinely loading/buffering
  | "playing" // the element is actually producing audio
  | "paused" // user-visible idle (before first play / after pause)
  | "error";

const AZAN_RESUME_DELAY_MS = 3000;
/** How long after an azan ends a frozen pre-azan position may be restored. */
const AZAN_FROZEN_VALIDITY_MS = AZAN_RESUME_DELAY_MS + 12_000;
/** The local post-azan continuation timeline stays authoritative this long. */
const RESUME_BASE_TTL_S = (AZAN_FROZEN_VALIDITY_MS - AZAN_RESUME_DELAY_MS) / 1000;

/**
 * Full pre-azan snapshot (LOCAL to this browser — never sent anywhere).
 * `cyclePosition` anchors the listener's LOCAL continuation timeline that
 * runs after the azan (same track, same offset, advancing in real time) —
 * the shared radio timeline keeps running underneath and is rejoined
 * once the local continuation window expires.
 */
interface FrozenResume {
  index: number;
  driveId: string;
  offsetSeconds: number;
  cyclePosition: number;
  /** Server-clock ms until which restoring this snapshot still makes sense. */
  validUntilServerMs: number;
}

/** Local continuation timeline after an azan: anchor + how long it stays authoritative. */
interface ResumeBase {
  /** Server-clock ms when the local continuation timeline starts (azan end + 3 s). */
  startServerMs: number;
  /** Timeline position (seconds into the playlist cycle) at startServerMs. */
  cyclePosition: number;
}

export interface VirtualRadioPlayerProps {
  /**
   * Called the moment an azan ACTUALLY starts playing (used by the admin
   * Radio Recording system to create real markers, not scheduled guesses).
   */
  onAzanStart?: (info: { prayer: string; startedAt: number }) => void;
}

export default function VirtualRadioPlayer({ onAzanStart }: VirtualRadioPlayerProps = {}) {
  const { t } = useLanguage();

  const [state, setState] = useState<VirtualRadioState>(EMPTY_RADIO_STATE);
  const [status, setStatus] = useState<PlayerStatus>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [, forceTick] = useState(0); // 4Hz UI clock re-render

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const syncRef = useRef<ServerClockSync | null>(null);
  const currentDriveIdRef = useRef<string | null>(null);
  const wantPlayRef = useRef(false); // user intent; survives track transitions
  const applyingRef = useRef(false); // guard against re-entrant applyLivePosition
  const playIdRef = useRef(0); // serializes play() promises; stale ones are ignored

  // Azan overlay state (server-computed schedule; refreshed by polling).
  const lastActiveAzanRef = useRef<AzanSchedule["active"]>(null);
  const [azan, setAzan] = useState<AzanSchedule>(emptyAzanSchedule());
  const azanRef = useRef<AzanSchedule>(emptyAzanSchedule());
  azanRef.current = azan;
  if (azan.active) lastActiveAzanRef.current = azan.active; // remember the window even after it clears
  const azanKeyRef = useRef<string | null>(null); // azan event currently loaded in <audio>

  // Pre-azan playback snapshot + post-azan continuation (LOCAL — never sent anywhere).
  const frozenResumeRef = useRef<FrozenResume | null>(null);
  const resumeBaseRef = useRef<ResumeBase | null>(null);
  const azanResumeTimerRef = useRef<number | null>(null);
  // Azan events this browser already heard to completion — their windows may
  // still be active server-side for a few seconds (window ≈ file duration),
  // but a listener must never be dragged back into an azan that just ended.
  const finishedAzanKeysRef = useRef<Set<string>>(new Set());

  const streamUrl = useCallback(
    (driveId: string) => `/api/virtual-radio/stream?id=${encodeURIComponent(driveId)}`,
    []
  );

  /** Point the element at `track` ONCE. No-op when it already has that src. */
  const loadTrack = useCallback(
    (audio: HTMLAudioElement, driveId: string) => {
      if (currentDriveIdRef.current === driveId) return Promise.resolve();
      currentDriveIdRef.current = driveId;
      audio.src = streamUrl(driveId);
      // Wait for metadata (duration needed for a safe seek), but never hang
      // the join on a slow file — the seek clamps to `track.duration` anyway.
      return new Promise<void>((resolve) => {
        const onMeta = () => {
          audio.removeEventListener("loadedmetadata", onMeta);
          resolve();
        };
        audio.addEventListener("loadedmetadata", onMeta);
        audio.load();
        setTimeout(resolve, 8000);
      });
    },
    [streamUrl]
  );

  // ── State fetch + refresh on tab focus ─────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/virtual-radio/status", { cache: "no-store" });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data: VirtualRadioState & { azan?: AzanSchedule } = await res.json();
        if (!cancelled) {
          setState(data);
          // Leave "loading" once the timeline is in hand — otherwise the
          // play button stays disabled forever (browser-tested deadlock).
          setStatus((s) => (s === "loading" ? "paused" : s));
          // Capture the azan schedule so applyLivePosition can overlay it.
          setAzan(data.azan ?? emptyAzanSchedule());
        }
      } catch {
        if (!cancelled) {
          setStatus("error");
          setErrorMsg(t("vr_unavailable"));
        }
      }
    }

    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    // Poll the (tiny, cached) status every 30s so a mid-session azan start
    // is picked up within half a minute without any heavyweight refetch.
    const poll = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      clearInterval(poll);
    };
  }, [t]);

  // ── Clock sync: sample /api/virtual-radio/time ─────────────────────
  const syncClock = useCallback(async (): Promise<ServerClockSync | null> => {
    try {
      const sent = Date.now();
      const res = await fetch("/api/virtual-radio/time", { cache: "no-store" });
      const received = Date.now();
      if (!res.ok) return null;
      const data = await res.json();
      const sample = computeClockOffset(sent, received, data.serverTime);
      syncRef.current = sample;
      return sample;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    syncClock();
    // Re-sync when the tab becomes visible again (clock drift / wake-from-sleep).
    const onVis = () => {
      if (document.visibilityState === "visible") syncClock();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [syncClock]);

  // ── UI clock tick (4Hz is plenty for a seconds display) ────────────
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);

  // ── Core: make the <audio> element play the right thing right now ──
  const applyLivePosition = useCallback(
    async (audio: HTMLAudioElement) => {
      if (applyingRef.current) return;
      applyingRef.current = true;
      const playId = ++playIdRef.current;
      try {
        // Poor sample quality? Take one more before seeking.
        if (!syncRef.current || syncRef.current.rttMs > MAX_ACCEPTABLE_RTT_MS) {
          await syncClock();
        }

        // ── AZAN OVERLAY ─────────────────────────────────────────────
        // While an azan window is active, the stream plays the azan at its
        // server-computed offset. The RADIO timeline is untouched; where the
        // listener re-enters afterwards is decided by the frozen snapshot.
        const liveAzan = azanRef.current.active;
        const azanKey = liveAzan ? `${liveAzan.prayer}:${liveAzan.startedAt}` : null;
        if (liveAzan && liveAzan.driveId && azanKey && !finishedAzanKeysRef.current.has(azanKey)) {
          resumeBaseRef.current = null; // a fresh azan supersedes any continuation
          const isNewAzan = azanKeyRef.current !== azanKey;
          azanKeyRef.current = azanKey;
          if (isNewAzan) {
            // Freeze the pre-azan position ONCE per azan event. Uses the
            // shared timeline math only to OBSERVE where the listener was —
            // the shared timeline itself is never mutated.
            if (!frozenResumeRef.current) {
              const prePos = getSyncedPosition(state, syncRef.current);
              const preTrack = prePos ? state.tracks[prePos.index] : undefined;
              if (preTrack && prePos) {
                frozenResumeRef.current = {
                  index: prePos.index,
                  driveId: preTrack.driveId,
                  offsetSeconds: prePos.offset,
                  cyclePosition: prePos.cyclePosition,
                  validUntilServerMs: liveAzan.endsAt + AZAN_FROZEN_VALIDITY_MS,
                };
              }
            }
            // Fire exactly once per azan event — when it truly starts playing.
            onAzanStart?.({ prayer: liveAzan.prayer, startedAt: liveAzan.startedAt });
            if (!wantPlayRef.current) return; // idle visitors: no audio work
            await loadTrack(audio, liveAzan.driveId);
            if (playId !== playIdRef.current) return;
          }
          const target = Math.max(0, Math.min(liveAzan.offset, (audio.duration || liveAzan.duration) - 0.25));
          if (Number.isFinite(audio.duration) && Math.abs(audio.currentTime - target) > 1.0) {
            audio.currentTime = target;
          }
          if (wantPlayRef.current) {
            await audio.play().catch(() => {
              /* autoplay block: user presses play again */
            });
          }
          return;
        }
        azanKeyRef.current = null;

        // ── POST-AZAN LOCAL CONTINUATION TIMELINE ────────────────────
        // The listener's own timeline resumes at (azan end + 3 s) from the
        // frozen pre-azan position and advances in real time — so the SAME
        // song continues from the SAME offset, exactly like being
        // interrupted mid-song. Drift correction and the ended handler both
        // drive off this base, so nothing can yank the listener to the
        // shared (already advanced) timeline during the continuation window.
        if (resumeBaseRef.current) {
          const base = resumeBaseRef.current;
          const frozen = frozenResumeRef.current;
          if (!frozen) {
            resumeBaseRef.current = null; // lost the snapshot — rejoin live
          } else {
            const nowServerMs = syncRef.current ? serverNow(syncRef.current) : Date.now();
            const elapsed = (nowServerMs - base.startServerMs) / 1000;
            if (elapsed < -1) {
              return; // 3 s grace not over yet (a check raced the timer)
            }
            if (elapsed > RESUME_BASE_TTL_S) {
              // Continuation window expired — rejoin the shared timeline.
              resumeBaseRef.current = null;
              frozenResumeRef.current = null;
            } else {
              const cyclePos = base.cyclePosition + elapsed;
              const mapped = positionFromCycle(state, cyclePos);
              const contTrack = state.tracks[mapped.index];
              if (!contTrack) return;
              if (currentDriveIdRef.current !== contTrack.driveId) {
                await loadTrack(audio, contTrack.driveId);
                if (playId !== playIdRef.current) return;
              }
              const maxSeek = (audio.duration || contTrack.duration) - 0.25;
              const target = Math.max(0, Math.min(mapped.offset, maxSeek));
              if (Number.isFinite(audio.duration) && Math.abs(audio.currentTime - target) > 1.0) {
                audio.currentTime = target;
              }
              if (wantPlayRef.current) {
                await audio.play().catch(() => { /* user presses play again */ });
              }
              return;
            }
          }
        }

        // ── LIVE RADIO TIMELINE (normal path) ────────────────────────
        const pos = getSyncedPosition(state, syncRef.current);
        const liveTrack = pos ? state.tracks[pos.index] : undefined;
        if (!liveTrack || !pos) return;

        if (!wantPlayRef.current) return; // idle: nothing to load or play

        if (currentDriveIdRef.current !== liveTrack.driveId) {
          await loadTrack(audio, liveTrack.driveId); // single load, buffered stream
          if (playId !== playIdRef.current) return;
        }

        const maxSeek = (audio.duration || liveTrack.duration) - 0.25;
        const target = Math.max(0, Math.min(pos.offset, maxSeek));
        if (Number.isFinite(audio.duration) && Math.abs(audio.currentTime - target) > 1.0) {
          audio.currentTime = target;
        }
        await audio.play().catch(() => {
          /* autoplay block or load hiccup: user presses play again */
        });
      } finally {
        applyingRef.current = false;
      }
    },
    [state, syncClock, onAzanStart, loadTrack]
  );

  // A playing listener is interrupted the moment the azan window is seen —
  // including when the window opened while the tab was hidden/backgrounded
  // (lastActiveAzanRef keeps the event visible until the next poll clears it).
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || status !== "playing" || !wantPlayRef.current) return;
    const live = azanRef.current.active ?? lastActiveAzanRef.current;
    if (!live || !live.driveId) return;
    const key = `${live.prayer}:${live.startedAt}`;
    if (finishedAzanKeysRef.current.has(key)) return;
    if (azanKeyRef.current === null || azanKeyRef.current !== key) {
      applyLivePosition(audio);
    }
  }, [azan, status, applyLivePosition]);

  // Gentle drift correction: re-align ONLY while actually playing, never
  // during azan or the post-azan continuation, and never by reloading the
  // source (a re-load would restart buffering from zero).
  useEffect(() => {
    const drift = setInterval(() => {
      const audio = audioRef.current;
      if (!audio || !wantPlayRef.current || audio.paused) return;
      if (azanRef.current.active) return; // azan plays on its own schedule
      if (resumeBaseRef.current) return; // local continuation is authoritative
      const pos = getSyncedPosition(state, syncRef.current);
      if (!pos) return;
      const track = state.tracks[pos.index];
      if (track && currentDriveIdRef.current !== track.driveId) {
        applyLivePosition(audio); // boundary crossed → swap to next track
      } else if (Math.abs(audio.currentTime - pos.offset) > 8) {
        applyLivePosition(audio); // hard drift (wake-from-sleep etc.)
      }
    }, 15000);
    return () => clearInterval(drift);
  }, [state, applyLivePosition]);

  // Next-track preload: warm ONE element with the following track while the
  // current one plays — no full-playlist downloads, no extra Drive churn.
  useEffect(() => {
    if (status !== "playing") return;
    const pos = getSyncedPosition(state, syncRef.current);
    const track = pos ? state.tracks[pos.index] : null;
    const next = pos ? state.tracks[(pos.index + 1) % state.tracks.length] : null;
    if (!track || !next || next.driveId === track.driveId) return;
    const remaining = track.duration - pos!.offset;
    if (remaining > 45) return; // only when the current track is ending
    const el = document.createElement("video"); // <video> shares the media stack
    el.preload = "auto";
    el.style.display = "none";
    el.src = streamUrl(next.driveId);
    el.load();
    const cleanup = () => {
      el.removeAttribute("src");
      el.load();
      el.remove();
    };
    const t = setTimeout(cleanup, 60_000);
    return () => {
      clearTimeout(t);
      cleanup();
    };
  }, [status, state, streamUrl]);

  // ── Controls ────────────────────────────────────────────────────────
  const handlePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    wantPlayRef.current = true;
    setErrorMsg(null);
    // UI stays on "syncing" until the element's own `playing` event fires —
    // no fake playing state while the browser is still loading/buffering.
    setStatus((s) => (s === "playing" ? s : "syncing"));
    if (!syncRef.current) await syncClock();
    applyLivePosition(audio); // decides azan vs continuation vs live, then plays
  };

  const handlePause = () => {
    // Local pause only — the shared timeline keeps advancing (like a real radio).
    wantPlayRef.current = false;
    if (azanResumeTimerRef.current !== null) {
      clearTimeout(azanResumeTimerRef.current);
      azanResumeTimerRef.current = null;
    }
    audioRef.current?.pause();
    setStatus("paused");
  };

  const handleRetry = () => {
    setStatus("loading");
    setErrorMsg(null);
    window.location.reload();
  };

  // ── Real element events → honest UI state ──────────────────────────
  const onAudioPlay = () => {
    // Programmatic seeks inside applyLivePosition also emit pause/play; only
    // trust them when we're not mid-apply (applyLivePosition sets states).
    if (!applyingRef.current) setStatus((s) => (s === "syncing" || s === "paused" ? "playing" : s));
  };
  const onAudioPlaying = () => setStatus((s) => (s !== "error" ? "playing" : s));
  const onAudioPause = () => {
    if (applyingRef.current) return; // internal seek shuffle, not a user pause
    if (!wantPlayRef.current) setStatus("paused");
  };
  const onAudioWaiting = () => {
    if (wantPlayRef.current) setStatus((s) => (s === "playing" ? "syncing" : s));
  };
  const onAudioError = () => {
    if (wantPlayRef.current) {
      setStatus("error");
      setErrorMsg(t("vr_play_error"));
    }
  };
  const onAudioEnded = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const wasAzan = azanRef.current.active || azanKeyRef.current !== null;
    if (wasAzan) {
      // AZAN FINISHED → exactly ~3 s of silence, then the SAME track from the
      // frozen pre-azan offset on the listener's LOCAL continuation timeline.
      // Warm the radio source DURING the silence so resume is instant.
      const endedKey = azanKeyRef.current;
      if (endedKey) finishedAzanKeysRef.current.add(endedKey);
      azanKeyRef.current = null;
      setStatus("syncing");
      const frozen = frozenResumeRef.current;
      const track = frozen ? state.tracks[frozen.index] : null;
      if (frozen && track) {
        if (currentDriveIdRef.current !== track.driveId) {
          currentDriveIdRef.current = track.driveId;
          audio.src = streamUrl(track.driveId);
          audio.load();
        }
        resumeBaseRef.current = {
          startServerMs: (syncRef.current ? serverNow(syncRef.current) : Date.now()) + AZAN_RESUME_DELAY_MS,
          cyclePosition: frozen.cyclePosition,
        };
      }
      if (azanResumeTimerRef.current !== null) clearTimeout(azanResumeTimerRef.current);
      azanResumeTimerRef.current = window.setTimeout(() => {
        azanResumeTimerRef.current = null;
        if (wantPlayRef.current && audioRef.current) applyLivePosition(audioRef.current);
      }, AZAN_RESUME_DELAY_MS);
    } else if (wantPlayRef.current) {
      // A radio track reached its natural end before the drift loop ran.
      applyLivePosition(audio);
    }
  };

  // ── Derived UI state ────────────────────────────────────────────────
  const pos = getSyncedPosition(state, syncRef.current);
  const track = pos ? state.tracks[pos.index] : null;
  const nextTrack = pos ? state.tracks[(pos.index + 1) % state.tracks.length] : null;
  const onAir = state.enabled && !!pos;
  const isLive = status === "playing" && onAir;

  // Never-configured prototype: render nothing so the existing radio page
  // stays visually untouched until an admin sets it up.
  if (status !== "loading" && !state.folderId && state.tracks.length === 0) {
    return null;
  }

  const resetError = () => {
    if (status === "error") setStatus("paused");
  };

  return (
    <div className="bg-gray-900 border border-white/10 rounded-2xl overflow-hidden">
      <audio
        ref={audioRef}
        data-virtual-radio=""
        preload="auto"
        onPlay={onAudioPlay}
        onPlaying={onAudioPlaying}
        onPause={onAudioPause}
        onWaiting={onAudioWaiting}
        onEnded={onAudioEnded}
        onError={onAudioError}
      />

      <div className="flex flex-col items-center p-6 sm:p-8">
        {/* Vinyl Record Visual — same design language as RadioPlayer.tsx */}
        <div className="relative w-48 h-48 sm:w-64 sm:h-64 mb-6">
          <div
            className="absolute inset-0 rounded-full bg-gradient-to-br from-gray-800 via-gray-900 to-black border-2 border-gray-700 shadow-2xl"
            style={{ animation: isLive ? "spin-slow 4s linear infinite" : "none" }}
          >
            <div className="absolute inset-3 rounded-full border border-gray-700/30" />
            <div className="absolute inset-6 rounded-full border border-gray-700/20" />
            <div className="absolute inset-9 rounded-full border border-gray-700/30" />
            <div className="absolute inset-12 rounded-full border border-gray-700/20" />
            <div className="absolute inset-15 rounded-full border border-gray-700/30" />
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-white/5 via-transparent to-transparent" />
          </div>

          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className="w-20 h-20 sm:w-28 sm:h-28 rounded-full bg-gradient-to-br from-red-700 via-red-800 to-red-900 border-2 border-red-600/50 flex items-center justify-center shadow-lg"
              style={{ animation: isLive ? "spin-slow 4s linear infinite" : "none" }}
            >
              <svg className="w-8 h-8 sm:w-10 sm:h-10 text-white/90" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
            </div>
          </div>

          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-3 h-3 rounded-full bg-gray-900 border border-gray-600" />
          </div>
        </div>

        {/* Station identity */}
        <h2 className="text-white text-xl sm:text-2xl font-bold text-center">eBilikAgama Radio</h2>
        <p className="text-gray-500 text-xs mt-1 text-center">{state.folderName || "Google Drive library"}</p>

        {/* Status badges */}
        <div className="flex items-center gap-2 mt-4 flex-wrap justify-center">
          {onAir ? (
            <span className="flex items-center gap-1.5 bg-green-600/10 border border-green-600/30 px-2.5 py-1 rounded-full">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-green-400 text-xs font-bold tracking-wide">{t("vr_on_air")}</span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5 bg-red-600/10 border border-red-600/30 px-2.5 py-1 rounded-full">
              <span className="w-2 h-2 bg-red-500 rounded-full" />
              <span className="text-red-400 text-xs font-bold tracking-wide">{t("radio_offline")}</span>
            </span>
          )}
          {isLive && (
            <span className="flex items-center gap-1.5 bg-white/5 border border-white/10 px-2.5 py-1 rounded-full">
              <span className="text-gray-300 text-[10px] font-bold tracking-widest">{t("vr_synced")}</span>
              {syncRef.current && (
                <span className="text-gray-500 text-[10px]">±{Math.round(syncRef.current.rttMs)}ms</span>
              )}
            </span>
          )}
        </div>

        {/* AZAN OVERLAY — live azan takes over the display. Only the prayer
            name is shown; azan file names/metadata are internal and never
            rendered publicly (no station branding from Drive metadata). */}
        {azan.active && (
          <div className="mt-4 w-full max-w-md bg-emerald-600/15 border border-emerald-500/40 rounded-xl px-4 py-3 text-center">
            <p className="text-emerald-300 text-[11px] font-bold tracking-widest uppercase animate-pulse">
              {t("azan_now_live")}
            </p>
            <p className="text-white text-sm font-semibold mt-1">
              {t(`azan_event_${azan.active.prayer as "subuh" | "zohor" | "asar" | "maghrib" | "isyak"}`)}
            </p>
            <p className="text-emerald-200/80 text-xs mt-0.5 font-mono">
              {formatDuration(azan.active.offset)} / {formatDuration(azan.active.duration)}
            </p>
          </div>
        )}

        {/* Post-azan resume hint (3-second grace while the same track reloads) */}
        {!azan.active && finishedAzanKeysRef.current.size > 0 && status === "syncing" && (
          <div className="mt-4 w-full max-w-md bg-gray-800/60 border border-white/10 rounded-xl px-4 py-2 text-center">
            <p className="text-gray-300 text-xs">{t("azan_joining_soon")}</p>
          </div>
        )}

        {/* States */}
        {status === "loading" && (
          <div className="flex flex-col items-center gap-3 mt-8">
            <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-400 text-sm">{t("vr_loading")}</p>
          </div>
        )}

        {status === "error" && (
          <div className="flex flex-col items-center gap-2 mt-8">
            <p className="text-red-400 text-sm">{errorMsg || t("vr_play_error")}</p>
            <button onClick={handleRetry} className="text-red-300 underline text-sm hover:text-red-200">
              {t("vr_retry")}
            </button>
          </div>
        )}

        {!onAir && status !== "loading" && status !== "error" && (
          <p className="text-gray-400 text-sm text-center mt-6 uppercase font-semibold">{t("vr_disabled")}</p>
        )}

        {onAir && status !== "error" && (
          <>
            {/* Now Playing */}
            <div className="mt-5 w-full max-w-md text-center">
              <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1.5">
                {t("vr_now_playing")}
              </p>
              <p className="text-white text-base sm:text-lg font-semibold leading-tight truncate">
                {track ? track.fileName.replace(/\.[^.]+$/, "") : "…"}
              </p>
              {nextTrack && (
                <p className="text-gray-500 text-xs mt-1 truncate">
                  {t("vr_up_next")}: {nextTrack.fileName.replace(/\.[^.]+$/, "")}
                </p>
              )}
              {azan.next && (
                <p className="text-emerald-400/90 text-xs mt-1 truncate">
                  {t("azan_next")}: {t(`azan_event_${azan.next.prayer as "subuh" | "zohor" | "asar" | "maghrib" | "isyak"}`)}{" "}
                  {new Date(azan.next.startsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}
                </p>
              )}
            </div>

            {/* Track progress */}
            <div className="mt-4 w-full max-w-md">
              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-red-600 rounded-full transition-[width] duration-300"
                  style={{
                    width: track && pos ? `${Math.min(100, (pos.offset / track.duration) * 100)}%` : "0%",
                  }}
                />
              </div>
              <div className="flex justify-between text-gray-500 text-xs mt-1.5 font-mono">
                <span>{formatDuration(pos?.offset ?? 0)}</span>
                <span>{track ? formatDuration(track.duration) : "0:00"}</span>
              </div>
            </div>

            {/* Join hint while paused */}
            {status === "paused" && pos && (
              <p className="text-gray-500 text-xs mt-3 italic">
                {t("vr_press_play")} — {t("vr_starting_at")} {formatDuration(pos.offset)}
              </p>
            )}
          </>
        )}
      </div>

      {/* Controls bar — same layout as RadioPlayer.tsx */}
      <div className="bg-gray-800/50 px-6 py-4 flex items-center gap-4">
        <button
          onClick={status === "playing" ? handlePause : handlePlay}
          disabled={!onAir || status === "loading"}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors flex-shrink-0 ${
            onAir && status !== "loading" ? "bg-red-600 hover:bg-red-500" : "bg-gray-700 cursor-not-allowed"
          }`}
          aria-label={status === "playing" ? "Pause" : "Play"}
        >
          {status === "playing" ? (
            <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : status === "syncing" ? (
            <svg className="w-6 h-6 text-white animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          ) : (
            <svg className="w-6 h-6 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        <div className="flex items-center gap-2 ml-auto text-gray-500 text-xs">
          {status === "playing" && (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              {t("vr_live_badge")}
            </span>
          )}
          {status === "syncing" && (
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-4 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
              {t("vr_syncing")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
