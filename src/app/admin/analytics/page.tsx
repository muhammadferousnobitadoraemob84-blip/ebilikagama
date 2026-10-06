"use client";

// Analytics Dashboard (spec §8) — aggregated statistics from real Visitor
// Records + Radio playback data. No per-user rankings.

import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";

interface AnalyticsResp {
  totals: {
    sessions: number;
    uniqueUsers: number;
    activeUsers: number;
    radioPlays: number;
    radioSessions: number;
    radioAirtimeSeconds: number;
    azanHeard: number;
    tvViews: number;
    replayViews: number;
    quranPlays: number;
    scheduleViews: number;
    avgSessionSeconds: number;
  };
  featureUsage: { feature: string; action: string; count: number }[];
  daily: { date: string; count: number }[];
  peakHours: { hour: number; count: number }[];
}

function fmtDur(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

export default function AnalyticsPage() {
  const { t } = useLanguage();
  const vr = t as unknown as (key: string) => string;
  const [range, setRange] = useState("7d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<AnalyticsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ range });
      if (range === "custom" && from && to) {
        params.set("from", from);
        params.set("to", to);
      }
      const res = await fetch(`/api/analytics?${params}`, { cache: "no-store" });
      if (!res.ok) {
        setError(res.status === 403 ? vr("vrec_access_denied_desc") : vr("an_err"));
        return;
      }
      setData(await res.json());
      setError("");
    } catch {
      setError(vr("an_err"));
    } finally {
      setLoading(false);
    }
  }, [range, from, to, vr]);

  useEffect(() => {
    load();
  }, [load]);

  const maxDaily = data ? Math.max(1, ...data.daily.map((d) => d.count)) : 1;
  const maxHour = data ? Math.max(1, ...data.peakHours.map((h) => h.count)) : 1;

  const cards = data
    ? [
        { label: vr("vrec_summary_visits"), value: data.totals.sessions },
        { label: vr("an_unique_users"), value: data.totals.uniqueUsers },
        { label: vr("vrec_summary_active"), value: data.totals.activeUsers },
        { label: vr("an_radio_plays"), value: data.totals.radioPlays },
        { label: vr("an_radio_sessions"), value: data.totals.radioSessions },
        { label: vr("an_airtime"), value: fmtDur(data.totals.radioAirtimeSeconds) },
        { label: vr("an_azan_heard"), value: data.totals.azanHeard },
        { label: vr("an_tv_views"), value: data.totals.tvViews },
        { label: vr("an_replay_views"), value: data.totals.replayViews },
        { label: vr("an_quran_plays"), value: data.totals.quranPlays },
        { label: vr("an_schedule_views"), value: data.totals.scheduleViews },
        { label: vr("an_avg_session"), value: fmtDur(data.totals.avgSessionSeconds) },
      ]
    : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-white text-2xl font-bold">{vr("an_title")}</h1>
          <p className="text-gray-400 text-sm mt-1">{vr("an_subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={range} onChange={(e) => setRange(e.target.value)} className="admin-input !py-2 text-xs sm:max-w-[150px]">
            <option value="today">{vr("today")}</option>
            <option value="7d">{vr("rep_7d")}</option>
            <option value="30d">{vr("rep_30d")}</option>
            <option value="90d">{vr("rep_90d")}</option>
            <option value="custom">{vr("rep_custom")}</option>
          </select>
          {range === "custom" && (
            <>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="admin-input !py-2 text-xs sm:max-w-[150px]" aria-label={vr("vrec_from")} />
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="admin-input !py-2 text-xs sm:max-w-[150px]" aria-label={vr("vrec_to")} />
            </>
          )}
        </div>
      </div>

      {error && <div className="bg-red-600/10 border border-red-600/30 text-red-400 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
        {loading && !data
          ? Array.from({ length: 8 }).map((_, i) => <div key={i} className="admin-card !p-4 h-20 animate-pulse" />)
          : cards.map((c) => (
              <div key={c.label} className="admin-card !p-4">
                <p className="text-gray-500 text-[11px] uppercase tracking-wide truncate">{c.label}</p>
                <p className="text-white text-xl font-bold mt-1">{typeof c.value === "number" ? c.value.toLocaleString() : c.value}</p>
              </div>
            ))}
      </div>

      {/* Daily activity bars */}
      {data && data.daily.length > 0 && (
        <div className="admin-card">
          <h2 className="text-white font-semibold text-sm mb-3">{vr("an_daily")}</h2>
          <div className="flex items-end gap-1 h-32 overflow-x-auto pb-1">
            {data.daily.map((d) => (
              <div key={d.date} className="flex flex-col items-center gap-1 min-w-[24px] flex-1">
                <div
                  className="w-full bg-red-600/70 rounded-t min-h-[2px]"
                  style={{ height: `${Math.max(2, (d.count / maxDaily) * 100)}%` }}
                  title={`${d.date}: ${d.count}`}
                />
                <span className="text-gray-600 text-[9px] whitespace-nowrap">{d.date.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Peak hours */}
      {data && data.peakHours.length > 0 && (
        <div className="admin-card">
          <h2 className="text-white font-semibold text-sm mb-3">{vr("an_peak")}</h2>
          <div className="space-y-2">
            {data.peakHours.map((h) => (
              <div key={h.hour} className="flex items-center gap-3 text-xs">
                <span className="text-gray-400 font-mono w-12">{String(h.hour).padStart(2, "0")}:00</span>
                <div className="flex-1 h-3 bg-gray-800 rounded-full overflow-hidden">
                  <div className="h-full bg-red-600/70 rounded-full" style={{ width: `${(h.count / maxHour) * 100}%` }} />
                </div>
                <span className="text-gray-500 w-10 text-right">{h.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feature usage */}
      {data && data.featureUsage.length > 0 && (
        <div className="admin-card">
          <h2 className="text-white font-semibold text-sm mb-3">{vr("an_feature_usage")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {data.featureUsage.slice(0, 24).map((f, i) => (
              <div key={`${f.feature}-${f.action}-${i}`} className="flex items-center justify-between bg-gray-900/60 border border-white/10 rounded-lg px-3 py-2 text-xs">
                <span className="text-gray-300 truncate">{f.feature} → {f.action}</span>
                <span className="text-white font-semibold ml-2">{f.count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
