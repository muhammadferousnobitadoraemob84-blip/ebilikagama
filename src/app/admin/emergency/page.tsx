"use client";

// Emergency Broadcast / Override (spec §11). Activation ALWAYS requires an
// explicit confirmation dialog; every transition is audit-logged server-side.

import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";

interface Row {
  id: string;
  title: string;
  description: string | null;
  channelName: string | null;
  mediaType: string;
  startsAt: string;
  endsAt: string;
  status: string;
  activatedAt: string | null;
  stoppedAt: string | null;
  createdByName: string | null;
}
interface Resp {
  rows: Row[];
  active: { id: string; title: string; description: string | null; channelName: string | null; endsAt: string } | null;
}

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString([], { hour12: false }) : "—";
}

const ST: Record<string, string> = {
  scheduled: "bg-blue-600/20 text-blue-300",
  active: "bg-red-600/25 text-red-300 animate-pulse",
  stopped: "bg-gray-600/20 text-gray-400",
  expired: "bg-gray-600/20 text-gray-500",
};

export default function EmergencyPage() {
  const { t } = useLanguage();
  const vr = t as unknown as (key: string) => string;
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<Row | null>(null);
  const [stopping, setStopping] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);

  // Form
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [mediaType, setMediaType] = useState("text");
  const [mediaRef, setMediaRef] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/emergency-broadcast", { cache: "no-store" });
      if (!res.ok) {
        setError(res.status === 403 ? vr("vrec_access_denied_desc") : vr("eb_err"));
        return;
      }
      setData(await res.json());
      setError("");
    } catch {
      setError(vr("eb_err"));
    } finally {
      setLoading(false);
    }
  }, [vr]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    if (!title.trim() || !startsAt || !endsAt) return;
    setBusy(true);
    try {
      const res = await fetch("/api/emergency-broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", title, description, mediaType, mediaRef: mediaRef || null, startsAt, endsAt }),
      });
      const d = await res.json();
      if (!res.ok) setError(d.error || vr("eb_err"));
      else {
        setTitle(""); setDescription(""); setMediaRef(""); setStartsAt(""); setEndsAt("");
        load();
      }
    } catch {
      setError(vr("eb_err"));
    } finally {
      setBusy(false);
    }
  };

  const activate = async (row: Row) => {
    setBusy(true);
    try {
      await fetch("/api/emergency-broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "activate", id: row.id, confirm: true }),
      });
      setConfirming(null);
      load();
    } catch {
      setError(vr("eb_err"));
    } finally {
      setBusy(false);
    }
  };

  const stop = async (row: Row) => {
    setBusy(true);
    try {
      await fetch("/api/emergency-broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop", id: row.id, stopReason: "manual_stop" }),
      });
      setStopping(null);
      load();
    } catch {
      setError(vr("eb_err"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-white text-2xl font-bold">{vr("eb_title")}</h1>
        <p className="text-gray-400 text-sm mt-1">{vr("eb_subtitle")}</p>
      </div>

      {/* Active override banner */}
      {data?.active && (
        <div className="bg-red-600/15 border border-red-500/40 rounded-xl p-4">
          <p className="text-red-300 text-xs font-bold uppercase tracking-widest">{vr("eb_active_now")}</p>
          <p className="text-white text-lg font-bold mt-1">{data.active.title}</p>
          {data.active.description && <p className="text-gray-300 text-sm mt-0.5">{data.active.description}</p>}
          <p className="text-gray-500 text-xs mt-1">{vr("eb_until")} {fmt(data.active.endsAt)}</p>
        </div>
      )}

      {error && <div className="bg-red-600/10 border border-red-600/30 text-red-400 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {/* Create form */}
      <div className="admin-card space-y-3">
        <h2 className="text-white font-semibold text-sm">{vr("eb_new")}</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} placeholder={vr("nc_title_ph")} className="admin-input text-sm" />
          <select value={mediaType} onChange={(e) => setMediaType(e.target.value)} className="admin-input !py-2 text-sm">
            <option value="text">{vr("eb_mt_text")}</option>
            <option value="youtube">{vr("eb_mt_youtube")}</option>
            <option value="replay">{vr("eb_mt_replay")}</option>
          </select>
        </div>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder={vr("nc_msg_ph")} className="admin-input text-sm resize-none" />
        {mediaType !== "text" && (
          <input value={mediaRef} onChange={(e) => setMediaRef(e.target.value)} placeholder={mediaType === "youtube" ? "https://youtube.com/watch?v=…" : vr("eb_replay_id")} className="admin-input text-sm" />
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-gray-500 text-[11px] uppercase mb-1">{vr("eb_start")}</label>
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="admin-input !py-2 text-sm" />
          </div>
          <div>
            <label className="block text-gray-500 text-[11px] uppercase mb-1">{vr("eb_end")}</label>
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="admin-input !py-2 text-sm" />
          </div>
        </div>
        <button onClick={create} disabled={busy || !title.trim() || !startsAt || !endsAt} className="admin-btn admin-btn-primary text-sm disabled:opacity-50">
          {busy ? vr("loading") : vr("eb_create")}
        </button>
      </div>

      {/* List */}
      <div className="admin-card !p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-gray-400 text-xs uppercase">
                <th className="py-3 px-3">{vr("nc_th_title")}</th>
                <th className="py-3 px-3 whitespace-nowrap">{vr("eb_window")}</th>
                <th className="py-3 px-3">{vr("inc_status")}</th>
                <th className="py-3 px-3 text-right">{vr("inc_actions")}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="py-14 text-center"><div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin mx-auto" /></td></tr>
              ) : !data || data.rows.length === 0 ? (
                <tr><td colSpan={4} className="py-14 text-center text-gray-500 text-sm">{vr("vrec_empty")}</td></tr>
              ) : (
                data.rows.map((r) => (
                  <tr key={r.id} className="border-b border-white/5">
                    <td className="py-2.5 px-3">
                      <p className="text-white text-xs font-semibold">{r.title}</p>
                      <p className="text-gray-500 text-[11px]">{r.mediaType}{r.createdByName ? ` · @${r.createdByName}` : ""}</p>
                    </td>
                    <td className="py-2.5 px-3 text-gray-400 text-xs whitespace-nowrap">
                      {fmt(r.startsAt)}
                      <span className="block text-gray-600">→ {fmt(r.endsAt)}</span>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${ST[r.status] ?? "bg-gray-600/20"}`}>{vr(`eb_st_${r.status}`)}</span>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {(r.status === "scheduled") && (
                          <button onClick={() => setConfirming(r)} className="text-red-400 hover:text-red-300 text-[11px] px-2 py-1 font-semibold">
                            {vr("eb_activate")}
                          </button>
                        )}
                        {r.status === "active" && (
                          <button onClick={() => setStopping(r)} className="text-gray-300 hover:text-white text-[11px] px-2 py-1 font-semibold">
                            {vr("eb_stop")}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Activation confirmation (explicit — never silent) */}
      {confirming && (
        <div className="fixed inset-0 bg-black/70 z-[70] flex items-center justify-center p-4" onClick={() => !busy && setConfirming(null)}>
          <div className="admin-card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-white font-bold text-lg">{vr("eb_confirm_title")}</h3>
            <p className="text-gray-300 text-sm mt-2">{vr("eb_confirm_desc")}</p>
            <div className="bg-gray-900/60 border border-white/10 rounded-lg p-3 mt-3 text-sm">
              <p className="text-white font-semibold">{confirming.title}</p>
              <p className="text-gray-500 text-xs mt-1">{fmt(confirming.startsAt)} → {fmt(confirming.endsAt)}</p>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setConfirming(null)} disabled={busy} className="flex-1 admin-btn admin-btn-secondary text-sm">{vr("logout_cancel")}</button>
              <button onClick={() => activate(confirming)} disabled={busy} className="flex-1 admin-btn admin-btn-primary text-sm">
                {busy ? vr("loading") : vr("eb_confirm_yes")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stop confirmation */}
      {stopping && (
        <div className="fixed inset-0 bg-black/70 z-[70] flex items-center justify-center p-4" onClick={() => !busy && setStopping(null)}>
          <div className="admin-card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-white font-bold text-lg">{vr("eb_stop_title")}</h3>
            <p className="text-gray-300 text-sm mt-2">{vr("eb_stop_desc")}</p>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setStopping(null)} disabled={busy} className="flex-1 admin-btn admin-btn-secondary text-sm">{vr("logout_cancel")}</button>
              <button onClick={() => stop(stopping)} disabled={busy} className="flex-1 admin-btn admin-btn-danger text-sm">{vr("eb_stop")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
