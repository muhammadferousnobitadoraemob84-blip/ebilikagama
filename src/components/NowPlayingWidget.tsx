"use client";

// Homepage now-playing widget for the Virtual Radio.
//
// Same timeline math as the radio player: the server returns a lightweight
// snapshot (track names + durations + server time); the client ticks the
// position locally each second using the shared getRadioPosition() and its
// clock offset, refetching periodically. Renders NOTHING when the radio is
// disabled/unconfigured or the fetch fails — the homepage is unchanged.

import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import {
  formatDuration,
  getRadioPosition,
  type VirtualRadioState,
} from "@/lib/virtual-radio";
import type { AzanPrayer } from "@/lib/azan";

interface NowPlaying {
  enabled: boolean;
  epoch?: number;
  totalDuration?: number;
  trackCount: number;
  serverTime: number;
  tracks?: { fileName: string; duration: number }[];
  position?: {
    index: number;
    offset: number;
    fileName: string;
    duration: number;
    next: string | null;
  } | null;
  azan?: {
    active: { prayer: string; fileName: string; offset: number; duration: number; endsAt: number } | null;
    next: { prayer: string; startsAt: number } | null;
  };
}

function prettyTitle(fileName: string): string {
  return fileName.replace(/\.(mp3|m4a|ogg|wav|flac|aac|opus)$/i, "").trim();
}

export default function NowPlayingWidget() {
  const { t } = useLanguage();
  const [data, setData] = useState<NowPlaying | null>(null);
  const [offsetMs, setOffsetMs] = useState<number | null>(null);
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/virtual-radio/now-playing", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const np: NowPlaying = await res.json();
      setOffsetMs(np.serverTime - Date.now());
      setData(np);
    } catch {
      // transient — keep last snapshot; widget self-corrects on next poll
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [load]);

  // 1s re-render for the moving progress bar.
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const visible =
    data?.enabled && data.epoch && data.tracks && data.tracks.length > 0;
  if (!visible) return null;

  const miniState: VirtualRadioState = {
    enabled: true,
    folderId: null,
    folderName: null,
    epoch: data.epoch ?? null,
    tracks: (data.tracks ?? []).map((t) => ({
      driveId: "",
      fileName: t.fileName,
      duration: t.duration,
      size: null,
      mimeType: "audio/mpeg",
    })),
    totalDuration: data.totalDuration ?? 0,
    lastScanAt: null,
    pending: [],
  };

  const pos =
    offsetMs != null
      ? getRadioPosition(miniState, Date.now() + offsetMs)
      : null;
  const current = pos ? miniState.tracks[pos.index] : null;
  if (!pos || !current) return null;

  const progress = Math.min(100, (pos.offset / current.duration) * 100);

  // Live azan overrides the playlist display (metadata only — same info the
  // player shows). Next-azan hint renders when nothing is live.
  const azanActive = data?.azan?.active ?? null;
  const azanNext = data?.azan?.next ?? null;
  const serverNow = offsetMs != null ? Date.now() + offsetMs : null;
  const azanProgress =
    azanActive && serverNow != null
      ? Math.min(100, Math.max(0, ((serverNow - (azanActive.endsAt - azanActive.duration * 1000)) / (azanActive.duration * 1000)) * 100))
      : 0;

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
      <a
        href="/radio"
        className="group block bg-gray-900 border border-white/10 hover:border-red-600/40 rounded-xl px-4 sm:px-5 py-3.5 transition-colors"
      >
        <div className="flex items-center gap-3 sm:gap-4">
          {/* LIVE indicator */}
          <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${azanActive ? "bg-green-500" : "bg-red-500"}`} />
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${azanActive ? "bg-green-500" : "bg-red-500"}`} />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-red-400 text-[11px] font-bold tracking-widest uppercase">
                {azanActive ? t("azan_now_live") : t("np_on_air")}
              </span>
              <span className="text-gray-500 text-[11px] uppercase tracking-wider">
                eBilikAgama Radio
              </span>
            </div>
            {azanActive ? (
              <>
                {/* Prayer name ONLY — azan file names/metadata (e.g. station
                    branding inside the Drive file's own name) stay internal. */}
                <p className="text-white text-sm sm:text-base font-medium truncate mt-0.5">
                  {t(`azan_event_${azanActive.prayer as AzanPrayer}`)}
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <div className="h-1 flex-1 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full" style={{ width: `${azanProgress}%` }} />
                  </div>
                  <span className="text-gray-400 text-xs font-mono flex-shrink-0">
                    {formatDuration(azanActive.offset)} / {formatDuration(azanActive.duration)}
                  </span>
                </div>
              </>
            ) : (
              <>
                <p className="text-white text-sm sm:text-base font-medium truncate mt-0.5">
                  {prettyTitle(current.fileName)}
                </p>
                {/* Progress */}
                <div className="mt-2 flex items-center gap-3">
                  <div className="h-1 flex-1 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-red-600 rounded-full"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <span className="text-gray-400 text-xs font-mono flex-shrink-0">
                    {formatDuration(pos.offset)} / {formatDuration(current.duration)}
                  </span>
                </div>
                {azanNext && (
                  <p className="text-gray-500 text-[11px] mt-1.5">
                    {t("azan_next")}: {azanNext.prayer.charAt(0).toUpperCase() + azanNext.prayer.slice(1)}{" "}
                    {new Date(azanNext.startsAt).toLocaleTimeString("en-GB", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit" })}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Listen CTA */}
          <span className="hidden sm:inline-flex items-center gap-1.5 text-red-400 group-hover:text-red-300 text-sm font-medium flex-shrink-0">
            {t("np_listen")}
            <svg
              className="w-4 h-4 transition-transform group-hover:translate-x-0.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </span>
        </div>
      </a>
    </section>
  );
}
