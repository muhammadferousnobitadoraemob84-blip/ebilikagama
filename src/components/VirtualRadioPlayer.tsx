"use client";

// Virtual Radio player — synchronized Drive-powered 24/7 radio.
//
// Source of truth is the MATH, never a stored cursor:
//   position(serverNow) = (serverNow − epoch) mod totalDuration
// Every visitor computes the same track + offset at the same instant.
// Pause is local (like muting a real radio); Play rejoins the live point.
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
  serverNow,
  type ServerClockSync,
  type VirtualRadioState,
} from "@/lib/virtual-radio";

type PlayerStatus =
  | "loading" // fetching radio state / first clock sync
  | "syncing" // state ready, audio joining the live point
  | "playing"
  | "paused" // user-visible idle (before first play)
  | "error";

export default function VirtualRadioPlayer() {
  const { t } = useLanguage();

  const [state, setState] = useState<VirtualRadioState>(EMPTY_RADIO_STATE);
  const [status, setStatus] = useState<PlayerStatus>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [, forceTick] = useState(0); // 4Hz UI clock re-render

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const syncRef = useRef<ServerClockSync | null>(null);
  const currentDriveIdRef = useRef<string | null>(null);
  const wantPlayRef = useRef(false); // user intent; survives track transitions
  const applyingRef = useRef(false); // guard against recursive 'loadedmetadata'

  // ── State fetch + refresh on tab focus ─────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/virtual-radio/status", { cache: "no-store" });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data: VirtualRadioState = await res.json();
        if (!cancelled) setState(data);
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
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
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

  // ── Core: make the <audio> element play the live timeline point ────
  const applyLivePosition = useCallback(
    async (audio: HTMLAudioElement) => {
      if (applyingRef.current) return;
      applyingRef.current = true;
      try {
        // Poor sample quality? Take one more before seeking.
        if (!syncRef.current || syncRef.current.rttMs > MAX_ACCEPTABLE_RTT_MS) {
          await syncClock();
        }
        const pos = getSyncedPosition(state, syncRef.current);
        if (!pos) return;

        const track = state.tracks[pos.index];
        if (!track) return;
        const url = `/api/virtual-radio/stream?id=${encodeURIComponent(track.driveId)}`;

        if (currentDriveIdRef.current !== track.driveId) {
          // Different track: swap source, then seek once metadata is known.
          currentDriveIdRef.current = track.driveId;
          audio.src = url;
          await new Promise<void>((resolve) => {
            const onMeta = () => {
              audio.removeEventListener("loadedmetadata", onMeta);
              resolve();
            };
            audio.addEventListener("loadedmetadata", onMeta);
            audio.load();
            setTimeout(resolve, 8000); // never hang the join on a slow file
          });
        }

        const target = Math.max(0, Math.min(pos.offset, (audio.duration || track.duration) - 0.25));
        if (Number.isFinite(audio.duration) && Math.abs(audio.currentTime - target) > 1.0) {
          audio.currentTime = target;
        }
        if (wantPlayRef.current) {
          await audio.play().catch(() => {
            /* autoplay block or load hiccup: user presses play again */
          });
        }
      } finally {
        applyingRef.current = false;
      }
    },
    [state, syncClock]
  );

  // Rejoin the live point when the user presses play.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !state.epoch || status !== "syncing") return;

    applyLivePosition(audio);
    setStatus("playing");

    // Gentle drift correction: every 30s, if local playback is >1s off the
    // math timeline (buffer stalls etc.), re-seek to the computed position.
    const drift = setInterval(() => {
      if (!wantPlayRef.current) return;
      const pos = getSyncedPosition(state, syncRef.current);
      if (!pos) return;
      const track = state.tracks[pos.index];
      if (track && currentDriveIdRef.current !== track.driveId) {
        applyLivePosition(audio); // track boundary crossed while stalled
      } else if (Math.abs(audio.currentTime - pos.offset) > 1.0) {
        applyLivePosition(audio);
      }
    }, 30000);

    return () => clearInterval(drift);
  }, [status, state, applyLivePosition]);

  // ── Controls ────────────────────────────────────────────────────────
  const handlePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    wantPlayRef.current = true;
    setErrorMsg(null);
    setStatus("syncing");
    if (!syncRef.current) await syncClock();
    const pos = getSyncedPosition(state, syncRef.current);
    setStatus("playing");
    if (pos && currentDriveIdRef.current !== state.tracks[pos.index]?.driveId) {
      applyLivePosition(audio); // first join: load + seek
    } else {
      audio.play().catch(() => setStatus("error"));
    }
  };

  const handlePause = () => {
    // Local pause only — the shared timeline keeps advancing (like a real radio).
    wantPlayRef.current = false;
    audioRef.current?.pause();
    setStatus("paused");
  };

  const handleRetry = () => {
    setStatus("loading");
    setErrorMsg(null);
    window.location.reload();
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
        preload="auto"
        onError={() => {
          if (wantPlayRef.current) {
            setStatus("error");
            setErrorMsg(t("vr_play_error"));
          }
        }}
        onStalled={() => {
          // Network hiccup: nudge back onto the timeline at next tick.
          if (wantPlayRef.current && audioRef.current) applyLivePosition(audioRef.current);
        }}
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
