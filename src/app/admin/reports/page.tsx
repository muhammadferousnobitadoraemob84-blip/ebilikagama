"use client";

// Reports (spec §23) — date-filtered report categories with CSV/XLSX-style
// export. Exports are audited server-side; only authorized data is returned.

import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";

const CATEGORIES = [
  "radio_broadcast",
  "visitor_activity",
  "user_session",
  "schedule_adherence",
  "system_health",
  "incident",
  "admin_audit",
] as const;

export default function ReportsPage() {
  const { t } = useLanguage();
  const vr = t as unknown as (key: string) => string;
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("radio_broadcast");
  const from = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  const [fromD, setFromD] = useState(from);
  const [toD, setToD] = useState(to);
  const [data, setData] = useState<{ header: string[]; rows: (string | number | null)[][] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ category, from: fromD, to: toD, format: "json" });
      const res = await fetch(`/api/reports?${params}`, { cache: "no-store" });
      if (!res.ok) {
        setError(res.status === 403 ? vr("vrec_access_denied_desc") : vr("rep_err"));
        return;
      }
      setData(await res.json());
    } catch {
      setError(vr("rep_err"));
    } finally {
      setLoading(false);
    }
  }, [category, fromD, toD, vr]);

  useEffect(() => {
    load();
  }, [load]);

  const exportCsv = () => {
    window.location.href = `/api/reports?category=${category}&from=${fromD}&to=${toD}&format=csv`;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-white text-2xl font-bold">{vr("rep_title")}</h1>
          <p className="text-gray-400 text-sm mt-1">{vr("rep_subtitle")}</p>
        </div>
        <button onClick={exportCsv} className="admin-btn admin-btn-secondary text-xs">{vr("vrec_export")}</button>
      </div>

      <div className="admin-card">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-gray-500 text-[11px] uppercase mb-1">{vr("rep_category")}</label>
            <select value={category} onChange={(e) => setCategory(e.target.value as typeof category)} className="admin-input !py-2 text-xs">
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{vr(`rep_cat_${c}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-gray-500 text-[11px] uppercase mb-1">{vr("vrec_from")}</label>
            <input type="date" value={fromD} onChange={(e) => setFromD(e.target.value)} className="admin-input !py-2 text-xs" />
          </div>
          <div>
            <label className="block text-gray-500 text-[11px] uppercase mb-1">{vr("vrec_to")}</label>
            <input type="date" value={toD} onChange={(e) => setToD(e.target.value)} className="admin-input !py-2 text-xs" />
          </div>
          <div className="flex items-end">
            <button onClick={load} disabled={loading} className="admin-btn admin-btn-primary text-xs w-full">
              {loading ? vr("loading") : vr("sh_run")}
            </button>
          </div>
        </div>
      </div>

      {error && <div className="bg-red-600/10 border border-red-600/30 text-red-400 px-4 py-3 rounded-xl text-sm">{error}</div>}

      <div className="admin-card !p-0 overflow-hidden">
        <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-900 z-10">
              <tr className="border-b border-white/10 text-left text-gray-400 text-xs uppercase">
                {data?.header.map((h) => (
                  <th key={h} className="py-3 px-3 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!data ? (
                <tr><td colSpan={3} className="py-14 text-center"><div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin mx-auto" /></td></tr>
              ) : data.rows.length === 0 ? (
                <tr><td colSpan={data.header.length} className="py-14 text-center text-gray-500 text-sm">{vr("vrec_empty")}</td></tr>
              ) : (
                data.rows.slice(0, 300).map((row, i) => (
                  <tr key={i} className="border-b border-white/5">
                    {row.map((cell, j) => (
                      <td key={j} className="py-2 px-3 text-gray-300 text-xs whitespace-nowrap max-w-[280px] truncate">{String(cell ?? "—")}</td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {data && data.rows.length > 300 && (
          <div className="px-3 py-2 border-t border-white/10 text-gray-500 text-xs">
            {vr("rep_showing_first")} 300 {vr("vrec_of")} {data.rows.length.toLocaleString()} — {vr("rep_export_hint")}
          </div>
        )}
      </div>
    </div>
  );
}
