"use client";

// Notification Center (spec §12) — admin announcements with targeting
// (all users / role / specific users), expiry, read counts. Rate-limited
// server-side against spam.

import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";

interface Row {
  id: string;
  title: string;
  message: string;
  targetAll: boolean;
  targetRole: string | null;
  feature: string | null;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string | null;
  active: boolean;
  readCount: number;
}

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString([], { hour12: false }) : "—";
}

export default function NotificationsAdminPage() {
  const { t } = useLanguage();
  const vr = t as unknown as (key: string) => string;
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [targetAll, setTargetAll] = useState(true);
  const [targetRole, setTargetRole] = useState("user");
  const [expiresAt, setExpiresAt] = useState("");
  const [feature, setFeature] = useState("");
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications?scope=admin", { cache: "no-store" });
      if (!res.ok) {
        setError(res.status === 403 ? vr("vrec_access_denied_desc") : vr("nc_err"));
        return;
      }
      const d = await res.json();
      setRows(d.rows ?? []);
      setError("");
    } catch {
      setError(vr("nc_err"));
    } finally {
      setLoading(false);
    }
  }, [vr]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    if (!title.trim() || !message.trim()) return;
    setSaving(true);
    setOk("");
    try {
      const res = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          message,
          targetAll,
          targetRole: targetAll ? null : targetRole,
          feature: feature || null,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error || vr("nc_err"));
        return;
      }
      setOk(vr("nc_created"));
      setTitle("");
      setMessage("");
      setExpiresAt("");
      setFeature("");
      load();
    } catch {
      setError(vr("nc_err"));
    } finally {
      setSaving(false);
      setTimeout(() => { setOk(""); setError(""); }, 3500);
    }
  };

  const deactivate = async (id: string) => {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      load();
    } catch {
      // transient
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-white text-2xl font-bold">{vr("nc_title")}</h1>
        <p className="text-gray-400 text-sm mt-1">{vr("nc_subtitle")}</p>
      </div>

      {error && <div className="bg-red-600/10 border border-red-600/30 text-red-400 px-4 py-3 rounded-xl text-sm">{error}</div>}
      {ok && <div className="bg-green-600/10 border border-green-600/30 text-green-400 px-4 py-3 rounded-xl text-sm">{ok}</div>}

      {/* Create */}
      <div className="admin-card space-y-3">
        <h2 className="text-white font-semibold text-sm">{vr("nc_new")}</h2>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} placeholder={vr("nc_title_ph")} className="admin-input text-sm" />
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} rows={3} placeholder={vr("nc_msg_ph")} className="admin-input text-sm resize-none" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-gray-500 text-[11px] uppercase mb-1">{vr("nc_target")}</label>
            <div className="flex items-center gap-3 text-xs">
              <label className="flex items-center gap-1.5 text-gray-300">
                <input type="checkbox" checked={targetAll} onChange={(e) => setTargetAll(e.target.checked)} />
                {vr("nc_all_users")}
              </label>
              {!targetAll && (
                <select value={targetRole} onChange={(e) => setTargetRole(e.target.value)} className="admin-input !py-1.5 text-xs">
                  <option value="user">{vr("um_role_user")}</option>
                  <option value="admin">{vr("um_role_admin")}</option>
                </select>
              )}
            </div>
          </div>
          <div>
            <label className="block text-gray-500 text-[11px] uppercase mb-1">{vr("nc_feature")}</label>
            <input value={feature} onChange={(e) => setFeature(e.target.value)} placeholder="radio / tv / replay…" className="admin-input !py-2 text-xs" />
          </div>
          <div>
            <label className="block text-gray-500 text-[11px] uppercase mb-1">{vr("nc_expiry")}</label>
            <input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="admin-input !py-2 text-xs" />
          </div>
          <div className="flex items-end">
            <button onClick={create} disabled={saving || !title.trim() || !message.trim()} className="admin-btn admin-btn-primary text-xs w-full disabled:opacity-50">
              {saving ? vr("loading") : vr("nc_publish")}
            </button>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="admin-card !p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-gray-400 text-xs uppercase">
                <th className="py-3 px-3">{vr("nc_th_title")}</th>
                <th className="py-3 px-3">{vr("nc_th_target")}</th>
                <th className="py-3 px-3 whitespace-nowrap">{vr("nc_th_created")}</th>
                <th className="py-3 px-3 whitespace-nowrap">{vr("nc_th_expiry")}</th>
                <th className="py-3 px-3 whitespace-nowrap">{vr("nc_th_reads")}</th>
                <th className="py-3 px-3 text-right">{vr("inc_actions")}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="py-14 text-center"><div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin mx-auto" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="py-14 text-center text-gray-500 text-sm">{vr("vrec_empty")}</td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className={`border-b border-white/5 align-top ${!r.active ? "opacity-50" : ""}`}>
                    <td className="py-2.5 px-3">
                      <p className="text-white text-xs font-semibold">{r.title}</p>
                      <p className="text-gray-500 text-[11px] max-w-sm line-clamp-2">{r.message}</p>
                    </td>
                    <td className="py-2.5 px-3 text-gray-400 text-xs whitespace-nowrap">
                      {r.targetAll ? vr("nc_all_users") : `${vr("um_role_label")}: ${r.targetRole}`}
                      {r.feature && <span className="block text-gray-600 text-[10px]">{r.feature}</span>}
                    </td>
                    <td className="py-2.5 px-3 text-gray-400 text-xs whitespace-nowrap">
                      {fmt(r.createdAt)}
                      {r.createdBy && <span className="block text-gray-600 text-[10px]">@{r.createdBy}</span>}
                    </td>
                    <td className="py-2.5 px-3 text-gray-400 text-xs whitespace-nowrap">{fmt(r.expiresAt)}</td>
                    <td className="py-2.5 px-3 text-white text-xs font-semibold">{r.readCount}</td>
                    <td className="py-2.5 px-3 text-right">
                      {r.active && (
                        <button onClick={() => deactivate(r.id)} className="text-red-400 hover:text-red-300 text-[11px] px-2 py-1">
                          {vr("nc_deactivate")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
