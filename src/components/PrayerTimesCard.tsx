"use client";

// Homepage prayer-times card.
//
// Shows today's JAKIM prayer times for the admin-configured zone plus a live
// countdown to the next prayer. The countdown uses the server-provided clock
// (offset-corrected like the radio widget) — never the raw local clock.
// Renders NOTHING when prayer times are unconfigured or the fetch fails —
// the homepage is unchanged. Design mirrors NowPlayingWidget (same section
// rhythm, gray-900 card, white/10 border, red accent).

import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n";

interface PrayerTimesToday {
  configured: boolean;
  serverTime: number;
  zone?: string;
  date?: string;
  source?: string;
  today?: {
    imsak: string | null;
    subuh: string;
    syuruk: string;
    zohor: string;
    asar: string;
    maghrib: string;
    isyak: string;
  } | null;
  next?: { prayer: string; startsAt: number; timeLabel: string } | null;
}

const GRID: { key: TranslationKey; field: "imsak" | "subuh" | "syuruk" | "zohor" | "asar" | "maghrib" | "isyak" }[] = [
  { key: "pt_imsak", field: "imsak" },
  { key: "prayer_subuh", field: "subuh" },
  { key: "pt_syuruk", field: "syuruk" },
  { key: "prayer_zohor", field: "zohor" },
  { key: "prayer_asar", field: "asar" },
  { key: "prayer_maghrib", field: "maghrib" },
  { key: "prayer_isyak", field: "isyak" },
];

export default function PrayerTimesCard() {
  const { t } = useLanguage();
  const [data, setData] = useState<PrayerTimesToday | null>(null);
  // serverNow ≈ Date.now() + offsetMs (server clock expressed locally).
  const [offsetMs, setOffsetMs] = useState<number | null>(null);
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/virtual-radio/prayer-times/today", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const pt: PrayerTimesToday = await res.json();
      setOffsetMs(pt.serverTime - Date.now());
      setData(pt);
    } catch {
      // transient — keep last snapshot
    }
  }, []);

  useEffect(() => {
    load();
    // Times change at most daily — an occasional refresh is plenty.
    const id = setInterval(load, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [load]);

  // 1s re-render for the ticking countdown.
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const visible = data?.configured && data.today;
  if (!visible) return null;

  const today = data.today!;
  const next = data.next ?? null;
  const serverNow = offsetMs != null ? Date.now() + offsetMs : null;
  const secsLeft =
    next && serverNow != null ? Math.max(0, Math.floor((next.startsAt - serverNow) / 1000)) : null;
  const countdown =
    secsLeft != null
      ? `${String(Math.floor(secsLeft / 3600)).padStart(2, "0")}:${String(
          Math.floor((secsLeft % 3600) / 60)
        ).padStart(2, "0")}:${String(secsLeft % 60).padStart(2, "0")}`
      : null;

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
      <div className="bg-gray-900 border border-white/10 rounded-xl px-4 sm:px-5 py-4">
        {/* Header: title + zone badge */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-red-400 text-[11px] font-bold tracking-widest uppercase">
              {t("pt_today_title")}
            </span>
            <span className="text-gray-500 text-[11px] uppercase tracking-wider">
              eBilikAgama
            </span>
          </div>
          <span className="text-gray-400 text-[11px] font-mono bg-white/5 border border-white/10 rounded px-2 py-0.5">
            {data.zone}
          </span>
        </div>

        {/* Times grid — next prayer highlighted */}
        <div className="mt-3 grid grid-cols-4 sm:grid-cols-7 gap-2">
          {GRID.map(({ key, field }) => {
            const value = today[field];
            const isNext = next?.prayer === field;
            return (
              <div
                key={field}
                className={`rounded-lg px-2 py-2 text-center border ${
                  isNext
                    ? "bg-red-600/10 border-red-600/40"
                    : "bg-white/[0.03] border-white/5"
                }`}
              >
                <p
                  className={`text-[10px] uppercase tracking-wider ${
                    isNext ? "text-red-400 font-semibold" : "text-gray-500"
                  }`}
                >
                  {t(key)}
                </p>
                <p
                  className={`text-sm sm:text-base font-mono font-semibold mt-0.5 ${
                    isNext ? "text-red-300" : "text-white"
                  } ${value ? "" : "opacity-40"}`}
                >
                  {value ?? "--:--"}
                </p>
              </div>
            );
          })}
        </div>

        {/* Next-prayer countdown */}
        {next && countdown && (
          <p className="mt-3 text-xs text-gray-400">
            {t("pt_next")}:{" "}
            <span className="text-red-400 font-semibold">
              {t(`prayer_${next.prayer}` as TranslationKey)}
            </span>{" "}
            <span className="text-gray-500">({next.timeLabel})</span>
            {" · "}
            <span className="text-white font-mono font-semibold">{countdown}</span>
          </p>
        )}
      </div>
    </section>
  );
}
