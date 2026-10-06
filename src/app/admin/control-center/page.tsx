"use client";

// Broadcast Control Center (spec §1) — the main operational dashboard.
// Real data only: every card is computed from live system state. Auto-refresh
// without full page reload (poll + pause when the tab is hidden).

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLanguage } from "@/components/LanguageProvider";
import { formatDuration } from "@/lib/virtual-radio";

interface CCData {
  serverTime: number;
  radio: {
    enabled: boolean;
    online: boolean;
    currentTrack: { id: string; title: string; position: number; duration: number } | null;
    nextTrack: { id: string; title: string; duration: number } | null;
    totalDuration: number;
    trackCount: number;
    pendingCount: number;
    schedulerStatus: string;
    azan: {
      active: { prayer: string; startedAt: number; endsAt: number; offset: number } | null;
      next: { prayer: string; startsAt: number; countdownSeconds: number } | null;
      usingTestTimes: boolean;
    };
    azanSchedulerStatus: string;
  };
  channels: { id: string; name: string; category: string; status: string; currentProgram: string | null }[];
  specialChannels: { id: string; name: string; category: string; status: string; currentProgram: string | null }[];
  system: {
    database: { ok: boolean; latencyMs: number | null; down: boolean };
    drive: { connected: boolean };
    jakim: { zone: string | null; source: string | null; updatedAt: string | null; dayCount: number; todayCovered: boolean };
    twitch: { reachable: boolean };
    youtube: { connected: boolean };
    scheduler: string;
    azanScheduler: string;
    auth: { ok: boolean; actor: string; role: string };
  };
  users: {
    activeSessions: number;
    recentActivity: { user: string; role: string; feature: string; action: string; at: string }[];
  };
}

function Dot({ ok, gray }: { ok: boolean; gray?: boolean }) {
  return (
    <span
      className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${gray ? "bg-gray-600" : ok ? "bg-green-500 animate-pulse" : "bg-red-500"}`}
    />
  );
}

function fmtClock(isoOrMs: string | number): string {
  return new Date(isoOrMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export default function ControlCenterPage() {
  const { t } = useLanguage();
  const vr = t as unknown as (key: string) => string;
  const [data, setData] = useState<CCData | null>(null);
  const [error, setError] = useState("");
  const [live, setLive] = useState(true);
  const liveRef = useRef(live);
  liveRef.current = live;

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/control-center", { cache: "no-store" });
      if (!res.ok) {
        setError(res.status === 403 ? vr("vrec_access_denied_desc") : vr("cc_err_load"));
        return;
      }
      setData(await res.json());
      setError("");
    } catch {
      setError(vr("cc_err_load"));
    }
  }, [vr]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 10_000);
    return () => clearInterval(id);
  }, [live, load]);

  const r = data?.radio;
  const nowServer = data?.serverTime ?? Date.now();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-white text-2xl font-bold">{vr("cc_title")}</h1>
          <p className="text-gray-400 text-sm mt-1">{vr("cc_subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setLive((v) => !v)}
            className={`admin-btn text-xs flex items-center gap-2 ${live ? "admin-btn-primary" : "admin-btn-secondary"}`}
          >
            <span className={`w-2 h-2 rounded-full ${live ? "bg-green-400 animate-pulse" : "bg-gray-500"}`} />
            {vr("vrec_live")}
          </button>
          <button onClick={load} className="admin-btn admin-btn-secondary text-xs">
            {vr("vr_admin_refresh")}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-600/10 border border-red-600/30 text-red-400 px-4 py-3 rounded-xl text-sm">{error}</div>
      )}

      {/* ── RADIO ── */}
      <div className="admin-card">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <h2 className="text-white font-semibold flex items-center gap-2">
            <Dot ok={!!r?.online} gray={!r?.enabled} />
            {vr("nav_radio")} — {r?.online ? vr("status_online") : r?.enabled ? vr("cc_starting") : vr("status_offline")}
          </h2>
          <Link href="/admin/virtual-radio" className="text-red-400 hover:text-red-300 text-xs">
            {vr("cc_manage_radio")} →
          </Link>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          <div className="bg-gray-900/60 border border-white/10 rounded-lg p-3">
            <p className="text-gray-500 text-[11px] uppercase">{vr("cc_current_track")}</p>
            <p className="text-white font-medium truncate">{r?.currentTrack?.title.replace(/\.[^.]+$/, "") ?? "—"}</p>
            <p className="text-gray-500 text-[11px] font-mono">
              {r?.currentTrack ? `${formatDuration(r.currentTrack.position)} / ${formatDuration(r.currentTrack.duration)}` : ""}
            </p>
          </div>
          <div className="bg-gray-900/60 border border-white/10 rounded-lg p-3">
            <p className="text-gray-500 text-[11px] uppercase">{vr("cc_track_id")}</p>
            <p className="text-gray-300 text-xs font-mono truncate">{r?.currentTrack?.id ?? "—"}</p>
          </div>
          <div className="bg-gray-900/60 border border-white/10 rounded-lg p-3">
            <p className="text-gray-500 text-[11px] uppercase">{vr("vr_up_next")}</p>
            <p className="text-white font-medium truncate">{r?.nextTrack?.title.replace(/\.[^.]+$/, "") ?? "—"}</p>
          </div>
          <div className="bg-gray-900/60 border border-white/10 rounded-lg p-3">
            <p className="text-gray-500 text-[11px] uppercase">{vr("cc_playlist")}</p>
            <p className="text-white font-medium">
              {r?.trackCount ?? 0} <span className="text-gray-500 text-xs">· {formatDuration(r?.totalDuration ?? 0)}</span>
              {r?.pendingCount ? <span className="text-yellow-400 text-xs"> +{r.pendingCount}</span> : null}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 text-sm">
          <div className={`rounded-lg p-3 border ${r?.azan.active ? "bg-emerald-600/15 border-emerald-500/40" : "bg-gray-900/60 border-white/10"}`}>
            <p className="text-gray-500 text-[11px] uppercase">{vr("azan_now_live")}</p>
            {r?.azan.active ? (
              <p className="text-emerald-300 font-semibold">
                {vr(`azan_event_${r.azan.active.prayer}`)} · {formatDuration(r.azan.active.offset)}
              </p>
            ) : (
              <p className="text-gray-400">{vr("rec_none")}</p>
            )}
          </div>
          <div className="bg-gray-900/60 border border-white/10 rounded-lg p-3">
            <p className="text-gray-500 text-[11px] uppercase">{vr("azan_next")} / {vr("azan_countdown")}</p>
            {r?.azan.next ? (
              <p className="text-white font-semibold">
                {vr(`azan_event_${r.azan.next.prayer}`)} ·{" "}
                <span className="font-mono text-emerald-400">
                  {(() => {
                    const s = Math.max(0, r.azan.next.startsAt - nowServer) / 1000;
                    const h = String(Math.floor(s / 3600)).padStart(2, "0");
                    const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
                    const sec = String(Math.floor(s % 60)).padStart(2, "0");
                    return `${h}:${m}:${sec}`;
                  })()}
                </span>
                {r.azan.usingTestTimes && <span className="ml-2 text-[10px] text-amber-400">{vr("azan_tm_testing")}</span>}
              </p>
            ) : (
              <p className="text-gray-400">{vr("azan_no_schedule")}</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-3 text-[11px]">
          <span className="bg-white/5 border border-white/10 text-gray-300 px-2 py-1 rounded-full">
            {vr("cc_radio_scheduler")}: <span className={r?.schedulerStatus === "RUNNING" ? "text-green-400" : "text-yellow-400"}>{r?.schedulerStatus ?? "—"}</span>
          </span>
          <span className="bg-white/5 border border-white/10 text-gray-300 px-2 py-1 rounded-full">
            {vr("cc_azan_scheduler")}: <span className={r?.azanSchedulerStatus === "ARMED" || r?.azanSchedulerStatus === "AZAN_ACTIVE" ? "text-green-400" : "text-gray-400"}>{r?.azanSchedulerStatus ?? "—"}</span>
          </span>
        </div>
      </div>

      {/* ── TV CHANNELS ── */}
      <div className="admin-card">
        <h2 className="text-white font-semibold mb-3">{vr("nav_saluran_tv")}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
          {(data?.channels ?? []).map((c) => (
            <div key={c.id} className="flex items-center gap-3 bg-gray-900/60 border border-white/10 rounded-lg px-3 py-2.5">
              <Dot ok={c.status === "online"} gray={c.status === "unknown"} />
              <div className="min-w-0 flex-1">
                <p className="text-white text-sm font-medium truncate">{c.name}</p>
                <p className="text-gray-500 text-[11px] truncate">{c.currentProgram ?? vr("no_program_available")}</p>
              </div>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${c.status === "online" ? "bg-green-600/20 text-green-400" : c.status === "offline" ? "bg-gray-600/20 text-gray-400" : "bg-yellow-600/20 text-yellow-400"}`}>
                {c.status === "online" ? vr("live") : c.status === "offline" ? vr("offline") : vr("checking_status")}
              </span>
            </div>
          ))}
          {(!data || data.channels.length === 0) && <p className="text-gray-500 text-sm">{vr("no_channels")}</p>}
        </div>
      </div>

      {/* ── SPECIAL CHANNELS ── */}
      <div className="admin-card">
        <h2 className="text-white font-semibold mb-3">{vr("nav_saluran_khas")}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
          {(data?.specialChannels ?? []).map((c) => (
            <div key={c.id} className="flex items-center gap-3 bg-gray-900/60 border border-white/10 rounded-lg px-3 py-2.5">
              <Dot ok={c.status === "online"} gray={c.status === "unknown"} />
              <div className="min-w-0 flex-1">
                <p className="text-white text-sm font-medium truncate">{c.name}</p>
                <p className="text-gray-500 text-[11px] truncate">{c.currentProgram ?? vr("no_program_available")}</p>
              </div>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${c.status === "online" ? "bg-green-600/20 text-green-400" : "bg-gray-600/20 text-gray-400"}`}>
                {c.status === "online" ? vr("live") : vr("offline")}
              </span>
            </div>
          ))}
          {(!data || data.specialChannels.length === 0) && <p className="text-gray-500 text-sm">{vr("no_channels")}</p>}
        </div>
      </div>

      {/* ── SYSTEM ── */}
      <div className="admin-card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-white font-semibold">{vr("cc_system")}</h2>
          <Link href="/admin/system-health" className="text-red-400 hover:text-red-300 text-xs">
            {vr("sh_title")} →
          </Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
          {[
            { label: "Neon DB", ok: data?.system.database.ok, extra: data?.system.database.latencyMs != null ? `${data.system.database.latencyMs}ms` : "" },
            { label: "Google Drive", ok: data?.system.drive.connected, gray: !data?.system.drive.connected },
            { label: "JAKIM", ok: data?.system.jakim.todayCovered, gray: !data?.system.jakim.zone },
            { label: "Twitch", ok: data?.system.twitch.reachable },
            { label: "YouTube", ok: data?.system.youtube.connected, gray: !data?.system.youtube.connected },
            { label: vr("vrec_th_session"), ok: true, extra: `@${data?.system.auth.actor ?? ""}` },
          ].map((s) => (
            <div key={s.label} className="bg-gray-900/60 border border-white/10 rounded-lg p-2.5 flex items-center gap-2">
              <Dot ok={!!s.ok} gray={s.gray} />
              <div className="min-w-0">
                <p className="text-gray-300 truncate">{s.label}</p>
                {s.extra && <p className="text-gray-600 text-[10px] truncate">{s.extra}</p>}
              </div>
            </div>
          ))}
        </div>
        {data?.system.jakim.zone && (
          <p className="text-gray-500 text-[11px] mt-2">
            {vr("cc_jakim_zone")}: <span className="text-gray-300 font-mono">{data.system.jakim.zone}</span> · {data.system.jakim.dayCount} {vr("azan_synced_days").toLowerCase()} · {data.system.jakim.updatedAt ? new Date(data.system.jakim.updatedAt).toLocaleString() : "—"}
          </p>
        )}
      </div>

      {/* ── USERS ── */}
      <div className="admin-card">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h2 className="text-white font-semibold">{vr("cc_users")}</h2>
          <span className="text-xs text-gray-400">
            {vr("vrec_summary_active")}: <span className="text-green-400 font-semibold">{data?.users.activeSessions ?? 0}</span>
          </span>
        </div>
        <ul className="space-y-1.5">
          {(data?.users.recentActivity ?? []).map((a, i) => (
            <li key={i} className="flex items-center gap-3 text-xs">
              <span className="text-gray-500 font-mono flex-shrink-0">{fmtClock(a.at)}</span>
              <span className="text-white truncate max-w-[140px]">{a.user}</span>
              <span className="text-gray-500">·</span>
              <span className="text-gray-400">{a.feature} → {a.action}</span>
              <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${a.role === "owner" ? "bg-red-600/20 text-red-400" : a.role === "admin" ? "bg-blue-600/20 text-blue-400" : "bg-gray-600/20 text-gray-400"}`}>
                {a.role}
              </span>
            </li>
          ))}
          {(!data || data.users.recentActivity.length === 0) && <li className="text-gray-500 text-sm">{vr("vrec_empty")}</li>}
        </ul>
      </div>
    </div>
  );
}
