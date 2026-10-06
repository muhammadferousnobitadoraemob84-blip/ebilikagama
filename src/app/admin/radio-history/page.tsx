"use client";

// Radio Broadcast History (§4) + Broadcast Timeline / Black Box (§6).
// History rows come from REAL playback records (never scheduler math); the
// timeline shows EXPECTED vs ACTUAL with the signed deviation.

import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";

interface HistRow {
  id: string;
  trackId: string;
  trackTitle: string;
  startedAt: string;
  endedAt: string | null;
  durationPlayed: number;
  expectedDuration: number;
  status: string;
  azanPrayer: string | null;
  interruptionReason: string | null;
}
interface HistResp {
  rows: HistRow[];
  total: number;
  page: number;
  pageSize: number;
  stats: {
    byStatus: Record<string, number>;
    totalAirtimeSeconds: number;
    verifiedPlays: number;
    topTracks: { trackId: string; title: string; plays: number; seconds: number }[];
  };
}

interface TlEvent {
  id: string;
  kind: string;
  label: string;
  expectedAt: string | null;
  actualAt: string;
  diffSeconds: number | null;
}
interface TlResp {
  events: TlEvent[];
  stats: { matched: number; minor: number; off: number; avgAzanDiff: number | null; avgStartDiff: number | null; avgResumeDiff: number | null };
}

const STATUS_BADGE: Record<string, string> = {
  playing: "bg-blue-600/20 text-blue-300",
  completed: "bg-green-600/20 text-green-400",
  interrupted: "bg-yellow-600/20 text-yellow-300",
  azan_interrupted: "bg-emerald-600/20 text-emerald-300",
  error: "bg-red-600/20 text-red-400",
  skipped: "bg-gray-600/20 text-gray-400",
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
function fmtDur(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export default function RadioHistoryPage() {
  const { t } = useLanguage();
  const vr = t as unknown as (key: string) => string;
  const [tab, setTab] = useState<"history" | "timeline">("history");
  const [range, setRange] = useState("today");
  const [hist, setHist] = useState<HistResp | null>(null);
  const [tl, setTl] = useState<TlResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const loadHist = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ range, page: String(page), pageSize: "50" });
      if (statusFilter) params.set("status", statusFilter);
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/radio-playback?${params}`, { cache: "no-store" });
      if (!res.ok) {
        setError(res.status === 403 ? vr("vrec_access_denied_desc") : vr("rh_err"));
        return;
      }
      setHist(await res.json());
      setError("");
    } catch {
      setError(vr("rh_err"));
    } finally {
      setLoading(false);
    }
  }, [range, page, statusFilter, search, vr]);

  const loadTl = useCallback(async () => {
    try {
      const res = await fetch(`/api/radio-timeline?range=${range}`, { cache: "no-store" });
      if (res.ok) setTl(await res.json());
    } catch {
      // transient
    }
  }, [range]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (tab === "history") loadHist();
      else loadTl();
    }, 200);
    return () => clearTimeout(timer);
  }, [tab, loadHist, loadTl]);

  const totalPages = hist ? Math.max(1, Math.ceil(hist.total / hist.pageSize)) : 1;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-white text-2xl font-bold">{vr("rh_title")}</h1>
          <p className="text-gray-400 text-sm mt-1">{vr("rh_subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={range} onChange={(e) => { setRange(e.target.value); setPage(1); }} className="admin-input !py-2 text-xs">
            <option value="today">{vr("today")}</option>
            <option value="7d">{vr("rep_7d")}</option>
            <option value="30d">{vr("rep_30d")}</option>
            <option value="90d">{vr("rep_90d")}</option>
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setTab("history")}
          className={`admin-btn text-xs ${tab === "history" ? "admin-btn-primary" : "admin-btn-secondary"}`}
        >
          {vr("rh_tab_history")}
        </button>
        <button
          onClick={() => setTab("timeline")}
          className={`admin-btn text-xs ${tab === "timeline" ? "admin-btn-primary" : "admin-btn-secondary"}`}
        >
          {vr("rh_tab_timeline")}
        </button>
      </div>

      {error && <div className="bg-red-600/10 border border-red-600/30 text-red-400 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {tab === "history" && (
        <>
          {/* Proof-of-play summary */}
          {hist && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="admin-card !p-4">
                <p className="text-gray-500 text-[11px] uppercase">{vr("rh_airtime")}</p>
                <p className="text-white text-xl font-bold">{fmtDur(hist.stats.totalAirtimeSeconds)}</p>
              </div>
              <div className="admin-card !p-4">
                <p className="text-gray-500 text-[11px] uppercase">{vr("rh_verified_plays")}</p>
                <p className="text-white text-xl font-bold">{hist.stats.verifiedPlays}</p>
              </div>
              <div className="admin-card !p-4">
                <p className="text-gray-500 text-[11px] uppercase">{vr("rh_completed")}</p>
                <p className="text-green-400 text-xl font-bold">{hist.stats.byStatus.completed ?? 0}</p>
              </div>
              <div className="admin-card !p-4">
                <p className="text-gray-500 text-[11px] uppercase">{vr("cc_azan_scheduler")}</p>
                <p className="text-emerald-300 text-xl font-bold">{hist.stats.byStatus.azan_interrupted ?? 0}</p>
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="admin-card">
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder={vr("rh_search")}
                className="admin-input flex-1 min-w-0 text-sm"
              />
              <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="admin-input !py-2 text-xs sm:max-w-[180px]">
                <option value="">{vr("admin_all")}</option>
                <option value="completed">{vr("rh_st_completed")}</option>
                <option value="interrupted">{vr("rh_st_interrupted")}</option>
                <option value="azan_interrupted">{vr("rh_st_azan")}</option>
                <option value="error">{vr("rec_failed")}</option>
              </select>
            </div>
          </div>

          <div className="admin-card !p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-gray-400 text-xs uppercase">
                    <th className="py-3 px-3 whitespace-nowrap">{vr("vrec_th_datetime")}</th>
                    <th className="py-3 px-3">{vr("cc_current_track")}</th>
                    <th className="py-3 px-3">{vr("epg_duration")}</th>
                    <th className="py-3 px-3">{vr("vrec_th_action")}</th>
                    <th className="py-3 px-3">{vr("azan_file")}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && !hist ? (
                    <tr><td colSpan={5} className="py-14 text-center"><div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin mx-auto" /></td></tr>
                  ) : !hist || hist.rows.length === 0 ? (
                    <tr><td colSpan={5} className="py-14 text-center text-gray-500 text-sm">{vr("vrec_empty")}</td></tr>
                  ) : (
                    hist.rows.map((r) => (
                      <tr key={r.id} className="border-b border-white/5">
                        <td className="py-2.5 px-3 whitespace-nowrap text-gray-300 text-xs font-mono">{fmtTime(r.startedAt)}</td>
                        <td className="py-2.5 px-3">
                          <p className="text-white text-xs font-medium truncate max-w-[240px]">{r.trackTitle.replace(/\.[^.]+$/, "")}</p>
                          <p className="text-gray-600 text-[10px] font-mono truncate max-w-[240px]">{r.trackId}</p>
                        </td>
                        <td className="py-2.5 px-3 text-gray-300 text-xs font-mono whitespace-nowrap">
                          {r.endedAt ? `${fmtDur(r.durationPlayed)} / ${fmtDur(r.expectedDuration)}` : "…"}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${STATUS_BADGE[r.status] ?? "bg-gray-600/20 text-gray-400"}`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-emerald-300/90 text-xs">{r.azanPrayer ?? "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {hist && hist.total > hist.pageSize && (
              <div className="flex items-center justify-between px-3 py-3 border-t border-white/10">
                <p className="text-gray-500 text-xs">{hist.total.toLocaleString()} {vr("vrec_records_total")}</p>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="admin-btn admin-btn-secondary !py-1.5 !px-3 text-xs disabled:opacity-40">{vr("vrec_prev")}</button>
                  <span className="text-gray-400 text-xs">{page} / {totalPages}</span>
                  <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="admin-btn admin-btn-secondary !py-1.5 !px-3 text-xs disabled:opacity-40">{vr("vrec_next")}</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {tab === "timeline" && tl && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="admin-card !p-4 text-center">
              <p className="text-green-400 text-xl font-bold">✓ {tl.stats.matched}</p>
              <p className="text-gray-500 text-[11px]">{vr("tl_match")}</p>
            </div>
            <div className="admin-card !p-4 text-center">
              <p className="text-yellow-400 text-xl font-bold">⚠ {tl.stats.minor}</p>
              <p className="text-gray-500 text-[11px]">{vr("tl_minor")}</p>
            </div>
            <div className="admin-card !p-4 text-center">
              <p className="text-red-400 text-xl font-bold">{tl.stats.off}</p>
              <p className="text-gray-500 text-[11px]">{vr("tl_off")}</p>
            </div>
          </div>

          <div className="admin-card">
            <ol className="relative border-l border-white/10 ml-2 space-y-4">
              {tl.events.length === 0 && <li className="text-gray-500 text-sm ml-4">{vr("vrec_empty")}</li>}
              {tl.events.map((e) => {
                const diff = e.diffSeconds;
                const ok = diff != null && Math.abs(diff) <= 1.5;
                const minor = diff != null && Math.abs(diff) > 1.5 && Math.abs(diff) <= 30;
                return (
                  <li key={e.id} className="ml-4">
                    <span className={`absolute -left-[5px] w-2 h-2 rounded-full mt-1.5 ${ok ? "bg-green-500" : minor ? "bg-yellow-400" : "bg-gray-500"}`} />
                    <div className="flex flex-wrap items-baseline gap-x-3">
                      <span className="text-gray-300 font-mono text-xs">{fmtTime(e.actualAt)}</span>
                      <span className="text-white text-sm font-medium">{e.label}</span>
                      <span className="text-gray-500 text-[10px] uppercase tracking-wide">{e.kind}</span>
                    </div>
                    <p className={`text-[11px] mt-0.5 ${ok ? "text-green-400" : minor ? "text-yellow-400" : "text-gray-500"}`}>
                      {diff == null
                        ? `${vr("tl_expected")}: — · ${vr("tl_actual")}: ${fmtTime(e.actualAt)}`
                        : ok
                          ? `✓ MATCH · ${vr("tl_diff")}: ${diff > 0 ? "+" : ""}${Math.round(diff * 10) / 10}s`
                          : `⚠ ${vr("tl_diff")}: ${diff > 0 ? "+" : ""}${Math.round(diff * 10) / 10}s`}
                      {e.expectedAt ? ` · ${vr("tl_expected")}: ${fmtTime(e.expectedAt)}` : ""}
                    </p>
                  </li>
                );
              })}
            </ol>
          </div>
        </>
      )}
    </div>
  );
}
