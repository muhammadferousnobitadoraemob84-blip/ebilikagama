"use client";

// Admin Audit Log (spec §9) — immutable append-only trail, filterable,
// exportable, with Owner-only retention management.

import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";

interface Row {
  id: string;
  actorUserId: string | null;
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  result: string;
  metadata: string | null;
  createdAt: string;
}
interface Resp {
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
  actions: string[];
  actors: { id: string | null; name: string | null; count: number }[];
  retention: string;
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString([], { hour12: false });
}

export default function AuditLogsPage() {
  const { t } = useLanguage();
  const vr = t as unknown as (key: string) => string;
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [retention, setRetention] = useState("365");
  const [retSaved, setRetSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "50" });
      if (action) params.set("action", action);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/audit-logs?${params}`, { cache: "no-store" });
      if (!res.ok) {
        setError(res.status === 403 ? vr("vrec_access_denied_desc") : vr("al_err"));
        return;
      }
      const d: Resp = await res.json();
      setData(d);
      setRetention(d.retention);
      setError("");
    } catch {
      setError(vr("al_err"));
    } finally {
      setLoading(false);
    }
  }, [page, action, from, to, search, vr]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  const exportCsv = () => {
    const params = new URLSearchParams({ export: "1" });
    if (action) params.set("action", action);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (search.trim()) params.set("search", search.trim());
    window.location.href = `/api/audit-logs?${params}`;
  };

  const saveRetention = async () => {
    try {
      const res = await fetch("/api/audit-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: retention, applyNow: true }),
      });
      if (res.ok) {
        setRetSaved(true);
        setTimeout(() => setRetSaved(false), 2500);
      }
    } catch {
      // non-fatal
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-white text-2xl font-bold">{vr("al_title")}</h1>
          <p className="text-gray-400 text-sm mt-1">{vr("al_subtitle")}</p>
        </div>
        <button onClick={exportCsv} className="admin-btn admin-btn-secondary text-xs">{vr("vrec_export")}</button>
      </div>

      {error && <div className="bg-red-600/10 border border-red-600/30 text-red-400 px-4 py-3 rounded-xl text-sm">{error}</div>}

      <div className="admin-card">
        <div className="flex flex-col lg:flex-row gap-2">
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder={vr("al_search")} className="admin-input flex-1 min-w-0 text-sm" />
          <select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className="admin-input !py-2 text-xs lg:max-w-[240px]">
            <option value="">{vr("admin_all")}</option>
            {(data?.actions ?? []).map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="admin-input !py-2 text-xs lg:max-w-[150px]" aria-label={vr("vrec_from")} />
          <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="admin-input !py-2 text-xs lg:max-w-[150px]" aria-label={vr("vrec_to")} />
        </div>
      </div>

      <div className="admin-card !p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-gray-400 text-xs uppercase">
                <th className="py-3 px-3 whitespace-nowrap">{vr("vrec_th_datetime")}</th>
                <th className="py-3 px-3">{vr("vrec_th_user")}</th>
                <th className="py-3 px-3">{vr("vrec_th_action")}</th>
                <th className="py-3 px-3">{vr("al_target")}</th>
                <th className="py-3 px-3">{vr("al_meta")}</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                <tr><td colSpan={5} className="py-14 text-center"><div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin mx-auto" /></td></tr>
              ) : !data || data.rows.length === 0 ? (
                <tr><td colSpan={5} className="py-14 text-center text-gray-500 text-sm">{vr("vrec_empty")}</td></tr>
              ) : (
                data.rows.map((r) => (
                  <tr key={r.id} className="border-b border-white/5">
                    <td className="py-2.5 px-3 whitespace-nowrap text-gray-300 text-xs">{fmt(r.createdAt)}</td>
                    <td className="py-2.5 px-3 text-white text-xs font-medium">{r.actorName ?? vr("al_system")}</td>
                    <td className="py-2.5 px-3">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded font-mono ${r.result === "failure" ? "bg-red-600/20 text-red-400" : "bg-white/10 text-gray-300"}`}>
                        {r.action}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-gray-400 text-xs font-mono truncate max-w-[160px]">
                      {r.targetType ? `${r.targetType}:${r.targetId ?? "—"}` : "—"}
                    </td>
                    <td className="py-2.5 px-3 text-gray-500 text-[11px] truncate max-w-[260px]">{r.metadata ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {data && data.total > data.pageSize && (
          <div className="flex items-center justify-between px-3 py-3 border-t border-white/10">
            <p className="text-gray-500 text-xs">{data.total.toLocaleString()} {vr("vrec_records_total")}</p>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="admin-btn admin-btn-secondary !py-1.5 !px-3 text-xs disabled:opacity-40">{vr("vrec_prev")}</button>
              <span className="text-gray-400 text-xs">{page} / {totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="admin-btn admin-btn-secondary !py-1.5 !px-3 text-xs disabled:opacity-40">{vr("vrec_next")}</button>
            </div>
          </div>
        )}
      </div>

      {/* Retention — Owner only server-side (§9/§31) */}
      <div className="admin-card">
        <h2 className="text-white font-semibold text-sm mb-1">{vr("al_retention_title")}</h2>
        <p className="text-gray-500 text-xs mb-3">{vr("al_retention_desc")}</p>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <select value={retention} onChange={(e) => setRetention(e.target.value)} className="admin-input !py-2 text-xs sm:max-w-[200px]">
            <option value="30">{vr("vrec_retention_30")}</option>
            <option value="90">{vr("vrec_retention_90")}</option>
            <option value="180">{vr("vrec_retention_180")}</option>
            <option value="365">{vr("vrec_retention_1y")}</option>
            <option value="forever">{vr("vrec_retention_forever")}</option>
          </select>
          <button onClick={saveRetention} className="admin-btn admin-btn-primary text-xs">{vr("vrec_retention_apply")}</button>
          {retSaved && <span className="text-green-400 text-xs self-center">{vr("vrec_retention_saved")}</span>}
        </div>
      </div>
    </div>
  );
}
