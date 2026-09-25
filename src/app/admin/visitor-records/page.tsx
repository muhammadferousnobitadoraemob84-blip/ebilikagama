"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";

/**
 * Visitor Records — admin-only.
 * Follows the existing Admin Panel conventions (admin-card / admin-input /
 * admin-btn, LanguageProvider translations). All data comes from the
 * admin-gated /api/visitor-records endpoints; this page performs no
 * authorization logic of its own.
 */

interface Row {
  id: string;
  createdAt: string;
  userId: string;
  fullName: string | null;
  username: string;
  role: string;
  feature: string;
  action: string;
  page: string | null;
  sessionId: string;
}

interface UserOption {
  id: string;
  username: string;
  fullName: string | null;
  role: string;
}

interface RecentUser {
  sessionId: string;
  userId: string;
  fullName: string | null;
  username: string;
  role: string;
  lastActivityAt: string;
  lastFeature: string | null;
  lastAction: string | null;
  sessionStatus: string;
}

interface ListResponse {
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
  users: UserOption[];
  summary: {
    totalVisits: number;
    activeSessions: number;
    uniqueUsers: number;
    todayActivities: number;
  };
  recentUsers: RecentUser[];
}

interface SessionDetail {
  user: { id: string; username: string; fullName: string | null; role: string };
  session: {
    id: string;
    loginAt: string;
    lastActivityAt: string;
    logoutAt: string | null;
    status: string;
  };
  activities: {
    id: string;
    feature: string;
    action: string;
    page: string | null;
    metadata: string | null;
    createdAt: string;
  }[];
}

const FEATURES = [
  "",
  "homepage",
  "tv",
  "radio",
  "replay",
  "quran",
  "schedule",
  "auth",
  "other",
] as const;

const PAGE_SIZE = 50;

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}
function fmtTime(iso: string): string {
  return new Date(iso).toTimeString().slice(0, 8);
}
function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export default function VisitorRecordsPage() {
  const { t } = useLanguage();
  const vr = t as unknown as (key: string) => string;

  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState("");

  // Filters
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [featureFilter, setFeatureFilter] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [page, setPage] = useState(1);

  // Live activity
  const [live, setLive] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const liveRef = useRef(live);
  liveRef.current = live;

  // Detail modal
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Retention
  const [retention, setRetention] = useState("365");
  const [retentionSaved, setRetentionSaved] = useState(false);

  const fetchList = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(PAGE_SIZE));
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (userFilter) params.set("userId", userFilter);
      if (roleFilter) params.set("role", roleFilter);
      if (featureFilter) params.set("feature", featureFilter);
      if (search.trim()) params.set("search", search.trim());
      params.set("sort", sort);
      const res = await fetch(`/api/visitor-records?${params.toString()}`);
      if (res.status === 403) {
        setAccessDenied(true);
        setLoading(false);
        return;
      }
      if (!res.ok) throw new Error("failed");
      setData(await res.json());
      setLastRefresh(new Date());
      setError("");
    } catch {
      setError(vr("vrec_err_load"));
    } finally {
      setLoading(false);
    }
  }, [page, from, to, userFilter, roleFilter, featureFilter, search, sort, vr]);

  // Debounced fetch on filter change
  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      fetchList();
    }, 250);
    return () => clearTimeout(timer);
  }, [fetchList]);

  // Lightweight polling for live activity (spec §11) — no new infra.
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      fetchList();
    }, 15_000);
    return () => clearInterval(id);
  }, [live, fetchList]);

  // Retention setting
  useEffect(() => {
    fetch("/api/visitor-records/retention")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.value) setRetention(d.value);
      })
      .catch(() => {});
  }, []);

  const saveRetention = async (applyNow: boolean) => {
    try {
      const res = await fetch("/api/visitor-records/retention", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: retention, applyNow }),
      });
      if (res.ok) {
        setRetentionSaved(true);
        setTimeout(() => setRetentionSaved(false), 3000);
        if (applyNow) fetchList();
      }
    } catch {
      // non-fatal
    }
  };

  const openDetail = async (sessionId: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/visitor-records/session/${sessionId}`);
      if (res.ok) setDetail(await res.json());
    } catch {
      // ignore
    } finally {
      setDetailLoading(false);
    }
  };

  const exportCsv = () => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (userFilter) params.set("userId", userFilter);
    if (roleFilter) params.set("role", roleFilter);
    if (featureFilter) params.set("feature", featureFilter);
    if (search.trim()) params.set("search", search.trim());
    params.set("sort", sort);
    window.location.href = `/api/visitor-records/export?${params.toString()}`;
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const rangeStart = data ? (data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1) : 0;
  const rangeEnd = data ? Math.min(data.total, data.page * data.pageSize) : 0;

  const featureLabel = useMemo(
    () => (f: string) => {
      const map: Record<string, string> = {
        homepage: vr("vrec_feature_homepage"),
        tv: vr("vrec_feature_tv"),
        radio: vr("vrec_feature_radio"),
        replay: vr("vrec_feature_replay"),
        quran: vr("vrec_feature_quran"),
        schedule: vr("vrec_feature_schedule"),
        auth: vr("vrec_feature_auth"),
        other: vr("vrec_feature_other"),
      };
      return map[f] ?? f;
    },
    [vr]
  );

  const actionLabel = useMemo(
    () => (a: string) => {
      const map: Record<string, string> = {
        login: vr("vrec_action_login"),
        logout: vr("vrec_action_logout"),
        page_opened: vr("vrec_action_page_opened"),
        tv_channel_opened: vr("vrec_action_tv_channel_opened"),
        program_selected: vr("vrec_action_program_selected"),
        radio_opened: vr("vrec_action_radio_opened"),
        radio_play: vr("vrec_action_radio_play"),
        radio_pause: vr("vrec_action_radio_pause"),
        radio_azan_played: vr("vrec_action_radio_azan_played"),
        radio_track_changed: vr("vrec_action_radio_track_changed"),
        replay_opened: vr("vrec_action_replay_opened"),
        video_played: vr("vrec_action_video_played"),
        video_paused: vr("vrec_action_video_paused"),
        quran_opened: vr("vrec_action_quran_opened"),
        surah_selected: vr("vrec_action_surah_selected"),
        audio_played: vr("vrec_action_audio_played"),
        audio_paused: vr("vrec_action_audio_paused"),
        search_used: vr("vrec_action_search_used"),
        language_changed: vr("vrec_action_language_changed"),
        theme_changed: vr("vrec_action_theme_changed"),
        other: vr("vrec_action_other"),
      };
      return map[a] ?? a;
    },
    [vr]
  );

  const roleLabel = (r: string) =>
    r === "owner" ? vr("um_role_owner") : r === "admin" ? vr("um_role_admin") : vr("um_role_user");

  if (accessDenied) {
    return (
      <div className="text-center py-20">
        <div className="w-16 h-16 bg-red-600/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h2 className="text-white text-xl font-bold mb-2">{vr("vrec_access_denied_title")}</h2>
        <p className="text-gray-400">{vr("vrec_access_denied_desc")}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-white text-2xl font-bold">{vr("vrec_title")}</h1>
          <p className="text-gray-400 mt-1">{vr("vrec_subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportCsv} className="admin-btn admin-btn-secondary flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            {vr("vrec_export")}
          </button>
          <button
            onClick={() => setLive((v) => !v)}
            className={`admin-btn flex items-center gap-2 ${live ? "admin-btn-primary" : "admin-btn-secondary"}`}
            title={vr("vrec_live")}
          >
            <span className={`w-2 h-2 rounded-full ${live ? "bg-green-400 animate-pulse" : "bg-gray-500"}`} />
            {vr("vrec_live")}
          </button>
        </div>
      </div>

      {/* Summary dashboard (spec §10) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        {[
          { label: vr("vrec_summary_visits"), value: data?.summary.totalVisits ?? 0, icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
          { label: vr("vrec_summary_active"), value: data?.summary.activeSessions ?? 0, icon: "M13 10V3L4 14h7v7l9-11h-7z" },
          { label: vr("vrec_summary_users"), value: data?.summary.uniqueUsers ?? 0, icon: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" },
          { label: vr("vrec_summary_today"), value: data?.summary.todayActivities ?? 0, icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
        ].map((card) => (
          <div key={card.label} className="admin-card !p-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-red-600/15 border border-red-600/30 rounded-lg flex items-center justify-center flex-shrink-0">
                <svg className="w-4.5 h-4.5 w-[18px] h-[18px] text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={card.icon} />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-gray-400 text-[11px] uppercase tracking-wide truncate">{card.label}</p>
                <p className="text-white text-xl font-bold">{loading ? "—" : card.value.toLocaleString()}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Most recently active users */}
      {data && data.recentUsers.length > 0 && (
        <div className="admin-card mb-6">
          <h2 className="text-white font-semibold text-sm mb-3">{vr("vrec_recent_users")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {data.recentUsers.map((u) => (
              <button
                key={u.sessionId}
                onClick={() => openDetail(u.sessionId)}
                className="text-left bg-gray-900/60 border border-white/10 rounded-xl p-3 hover:border-white/25 transition-colors"
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-white text-sm font-medium truncate">{u.fullName || u.username}</span>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${
                    u.sessionStatus === "active"
                      ? "bg-green-600/20 text-green-400"
                      : "bg-gray-600/20 text-gray-400"
                  }`}>
                    {u.sessionStatus === "active" ? vr("vrec_status_active") : vr("vrec_status_inactive")}
                  </span>
                </div>
                <p className="text-gray-500 text-xs">
                  {u.lastFeature ? featureLabel(u.lastFeature) : "—"}
                  {u.lastAction ? ` · ${actionLabel(u.lastAction)}` : ""}
                </p>
                <p className="text-gray-600 text-[11px] mt-0.5">{fmtTime(u.lastActivityAt)}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filters + search */}
      <div className="admin-card mb-4">
        <div className="flex flex-col lg:flex-row gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="admin-input flex-1 min-w-0"
            placeholder={vr("vrec_search_placeholder")}
          />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:flex lg:items-center gap-2 lg:gap-3">
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={from}
                onChange={(e) => { setFrom(e.target.value); setPage(1); }}
                className="admin-input !px-2 !py-2 text-xs"
                aria-label={vr("vrec_from")}
              />
              <span className="text-gray-500 text-xs">→</span>
              <input
                type="date"
                value={to}
                onChange={(e) => { setTo(e.target.value); setPage(1); }}
                className="admin-input !px-2 !py-2 text-xs"
                aria-label={vr("vrec_to")}
              />
            </div>
            <select value={userFilter} onChange={(e) => { setUserFilter(e.target.value); setPage(1); }} className="admin-input !py-2 text-xs max-w-[150px]">
              <option value="">{vr("vrec_all_users")}</option>
              {data?.users.map((u) => (
                <option key={u.id} value={u.id}>{u.fullName || u.username}</option>
              ))}
            </select>
            <select value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }} className="admin-input !py-2 text-xs">
              <option value="">{vr("vrec_all_roles")}</option>
              <option value="user">{vr("um_role_user")}</option>
              <option value="admin">{vr("um_role_admin")}</option>
              <option value="owner">{vr("um_role_owner")}</option>
            </select>
            <select value={featureFilter} onChange={(e) => { setFeatureFilter(e.target.value); setPage(1); }} className="admin-input !py-2 text-xs">
              <option value="">{vr("vrec_all_features")}</option>
              {FEATURES.filter(Boolean).map((f) => (
                <option key={f} value={f}>{featureLabel(f)}</option>
              ))}
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value as "newest" | "oldest")} className="admin-input !py-2 text-xs">
              <option value="newest">{vr("vrec_sort_newest")}</option>
              <option value="oldest">{vr("vrec_sort_oldest")}</option>
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-600/10 border border-red-600/30 text-red-400 px-4 py-3 rounded-xl text-sm mb-4">
          {error}
        </div>
      )}

      {/* Records table */}
      <div className="admin-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-gray-400 text-xs uppercase">
                <th className="py-3 px-3 whitespace-nowrap">{vr("vrec_th_datetime")}</th>
                <th className="py-3 px-3">{vr("vrec_th_user")}</th>
                <th className="py-3 px-3">{vr("vrec_th_role")}</th>
                <th className="py-3 px-3">{vr("vrec_th_feature")}</th>
                <th className="py-3 px-3">{vr("vrec_th_action")}</th>
                <th className="py-3 px-3">{vr("vrec_th_page")}</th>
                <th className="py-3 px-3">{vr("vrec_th_session")}</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center">
                    <div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin mx-auto" />
                  </td>
                </tr>
              ) : !data || data.rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-gray-400">
                    {vr("vrec_empty")}
                  </td>
                </tr>
              ) : (
                data.rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-white/5 hover:bg-white/5 cursor-pointer"
                    onClick={() => openDetail(r.sessionId)}
                  >
                    <td className="py-2.5 px-3 whitespace-nowrap text-gray-300 text-xs">
                      {fmtDate(r.createdAt)}{" "}
                      <span className="text-gray-500">{fmtTime(r.createdAt)}</span>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="text-white text-xs font-medium">{r.fullName || "—"}</span>
                      <span className="block text-gray-500 text-[11px]">{r.username}</span>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                        r.role === "owner"
                          ? "bg-red-600/20 text-red-400"
                          : r.role === "admin"
                          ? "bg-blue-600/20 text-blue-400"
                          : "bg-gray-600/20 text-gray-300"
                      }`}>
                        {roleLabel(r.role)}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-gray-300 text-xs">{featureLabel(r.feature)}</td>
                    <td className="py-2.5 px-3 text-gray-300 text-xs">{actionLabel(r.action)}</td>
                    <td className="py-2.5 px-3 text-gray-500 text-xs font-mono">{r.page || "—"}</td>
                    <td className="py-2.5 px-3 text-gray-600 text-[10px] font-mono" title={r.sessionId}>
                      {r.sessionId.slice(0, 10)}…
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination (spec §9) */}
        {data && data.total > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 mt-1 border-t border-white/10">
            <p className="text-gray-500 text-xs">
              {vr("vrec_showing")} {rangeStart}–{rangeEnd} {vr("vrec_of")} {data.total.toLocaleString()}
              {lastRefresh && (
                <span className="hidden sm:inline text-gray-600">
                  {" · "}
                  {vr("vrec_updated")} {fmtTime(lastRefresh.toISOString())}
                </span>
              )}
            </p>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="admin-btn admin-btn-secondary !py-1.5 !px-3 text-xs disabled:opacity-40"
              >
                {vr("vrec_prev")}
              </button>
              <span className="text-gray-400 text-xs px-2">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="admin-btn admin-btn-secondary !py-1.5 !px-3 text-xs disabled:opacity-40"
              >
                {vr("vrec_next")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Retention (spec §15) */}
      <div className="admin-card mt-6">
        <h2 className="text-white font-semibold text-sm mb-1">{vr("vrec_retention_title")}</h2>
        <p className="text-gray-500 text-xs mb-3">{vr("vrec_retention_desc")}</p>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <select value={retention} onChange={(e) => setRetention(e.target.value)} className="admin-input !py-2 text-xs sm:max-w-[200px]">
            <option value="30">{vr("vrec_retention_30")}</option>
            <option value="90">{vr("vrec_retention_90")}</option>
            <option value="180">{vr("vrec_retention_180")}</option>
            <option value="365">{vr("vrec_retention_1y")}</option>
            <option value="forever">{vr("vrec_retention_forever")}</option>
          </select>
          <button onClick={() => saveRetention(false)} className="admin-btn admin-btn-secondary text-xs">
            {vr("vrec_retention_save")}
          </button>
          <button onClick={() => saveRetention(true)} className="admin-btn admin-btn-primary text-xs">
            {vr("vrec_retention_apply")}
          </button>
          {retentionSaved && <span className="text-green-400 text-xs self-center">{vr("vrec_retention_saved")}</span>}
        </div>
      </div>

      {/* Detail modal (spec §6) */}
      {(detailLoading || detail) && (
        <div
          className="fixed inset-0 bg-black/70 z-[70] flex items-center justify-center p-4"
          onClick={() => { setDetail(null); setDetailLoading(false); }}
        >
          <div
            className="admin-card !p-0 w-full max-w-lg max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {detailLoading || !detail ? (
              <div className="py-16 flex items-center justify-center">
                <div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3 p-5 border-b border-white/10">
                  <div className="min-w-0">
                    <h3 className="text-white font-semibold truncate">{detail.user.fullName || detail.user.username}</h3>
                    <p className="text-gray-500 text-xs mt-0.5">{detail.user.username} · {roleLabel(detail.user.role)}</p>
                  </div>
                  <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-white p-1" aria-label={vr("vrec_close")}>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="p-5 space-y-1.5 border-b border-white/10 text-xs">
                  <div className="flex justify-between gap-3">
                    <span className="text-gray-500">{vr("vrec_user_id")}</span>
                    <span className="text-gray-300 font-mono truncate">{detail.user.id}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-gray-500">{vr("vrec_session_id")}</span>
                    <span className="text-gray-300 font-mono truncate">{detail.session.id}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-gray-500">{vr("vrec_login")}</span>
                    <span className="text-gray-300">{fmtDate(detail.session.loginAt)} {fmtTime(detail.session.loginAt)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-gray-500">{vr("vrec_last_activity")}</span>
                    <span className="text-gray-300">{fmtDate(detail.session.lastActivityAt)} {fmtTime(detail.session.lastActivityAt)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-gray-500">{vr("vrec_logout")}</span>
                    <span className="text-gray-300">
                      {detail.session.logoutAt
                        ? `${fmtDate(detail.session.logoutAt)} ${fmtTime(detail.session.logoutAt)}`
                        : vr("vrec_session_inactive")}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-gray-500">{vr("vrec_session_duration")}</span>
                    <span className="text-gray-300">
                      {fmtDuration(
                        new Date(detail.session.logoutAt ?? detail.session.lastActivityAt).getTime() -
                          new Date(detail.session.loginAt).getTime()
                      )}
                    </span>
                  </div>
                </div>

                <div className="p-5 overflow-y-auto">
                  <h4 className="text-white font-semibold text-xs uppercase tracking-wide mb-3">
                    {vr("vrec_session_activity")}
                  </h4>
                  <ol className="relative border-l border-white/10 ml-2 space-y-3">
                    {detail.activities.map((a) => (
                      <li key={a.id} className="ml-4">
                        <span className="absolute -left-[5px] w-2 h-2 rounded-full bg-red-500/70 mt-1.5" />
                        <p className="text-gray-200 text-xs">
                          <span className="text-gray-500 font-mono mr-2">{fmtTime(a.createdAt)}</span>
                          {featureLabel(a.feature)} → {actionLabel(a.action)}
                        </p>
                        {a.page && <p className="text-gray-600 text-[11px] font-mono ml-14">{a.page}</p>}
                      </li>
                    ))}
                    {detail.activities.length === 0 && (
                      <li className="text-gray-500 text-xs">{vr("vrec_empty")}</li>
                    )}
                  </ol>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
