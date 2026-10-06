"use client";

// System Incidents (§19) — meaningful failures with status transitions
// (open → investigating → resolved). Safe messages only; no stack traces.

import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";

interface Row {
  id: string;
  service: string;
  severity: string;
  message: string;
  status: string;
  firstDetectedAt: string;
  lastDetectedAt: string;
  resolvedAt: string | null;
  occurrences: number;
}
interface Resp {
  rows: Row[];
  byStatus: Record<string, number>;
  services: string[];
}

const SEV: Record<string, string> = {
  info: "bg-blue-600/20 text-blue-300",
  warning: "bg-yellow-600/20 text-yellow-300",
  error: "bg-red-600/20 text-red-400",
  critical: "bg-red-800/40 text-red-300",
};
const ST: Record<string, string> = {
  open: "bg-red-600/20 text-red-400",
  investigating: "bg-yellow-600/20 text-yellow-300",
  resolved: "bg-green-600/20 text-green-400",
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString([], { hour12: false });
}

export default function IncidentsPage() {
  const { t } = useLanguage();
  const vr = t as unknown as (key: string) => string;
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [service, setService] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (service) params.set("service", service);
      const res = await fetch(`/api/incidents?${params}`, { cache: "no-store" });
      if (!res.ok) {
        setError(res.status === 403 ? vr("vrec_access_denied_desc") : vr("inc_err"));
        return;
      }
      setData(await res.json());
      setError("");
    } catch {
      setError(vr("inc_err"));
    } finally {
      setLoading(false);
    }
  }, [status, service, vr]);

  useEffect(() => {
    load();
  }, [load]);

  const setStatusFor = async (id: string, next: string) => {
    try {
      await fetch("/api/incidents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: next }),
      });
      load();
    } catch {
      // transient
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-white text-2xl font-bold">{vr("inc_title")}</h1>
        <p className="text-gray-400 text-sm mt-1">{vr("inc_subtitle")}</p>
      </div>

      {error && <div className="bg-red-600/10 border border-red-600/30 text-red-400 px-4 py-3 rounded-xl text-sm">{error}</div>}

      <div className="grid grid-cols-3 gap-3">
        {["open", "investigating", "resolved"].map((s) => (
          <div key={s} className="admin-card !p-4 text-center">
            <p className={`text-xl font-bold ${s === "open" ? "text-red-400" : s === "investigating" ? "text-yellow-400" : "text-green-400"}`}>
              {data?.byStatus[s] ?? 0}
            </p>
            <p className="text-gray-500 text-[11px] uppercase">{vr(`inc_st_${s}`)}</p>
          </div>
        ))}
      </div>

      <div className="admin-card">
        <div className="flex flex-col sm:flex-row gap-2">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="admin-input !py-2 text-xs sm:max-w-[180px]">
            <option value="">{vr("admin_all")}</option>
            <option value="open">{vr("inc_st_open")}</option>
            <option value="investigating">{vr("inc_st_investigating")}</option>
            <option value="resolved">{vr("inc_st_resolved")}</option>
          </select>
          <select value={service} onChange={(e) => setService(e.target.value)} className="admin-input !py-2 text-xs sm:max-w-[180px]">
            <option value="">{vr("inc_all_services")}</option>
            {(data?.services ?? []).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="admin-card !p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-gray-400 text-xs uppercase">
                <th className="py-3 px-3 whitespace-nowrap">{vr("inc_first")}</th>
                <th className="py-3 px-3">{vr("inc_service")}</th>
                <th className="py-3 px-3">{vr("inc_message")}</th>
                <th className="py-3 px-3">{vr("inc_status")}</th>
                <th className="py-3 px-3 text-right">{vr("inc_actions")}</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                <tr><td colSpan={5} className="py-14 text-center"><div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin mx-auto" /></td></tr>
              ) : !data || data.rows.length === 0 ? (
                <tr><td colSpan={5} className="py-14 text-center text-gray-500 text-sm">{vr("inc_empty")}</td></tr>
              ) : (
                data.rows.map((r) => (
                  <tr key={r.id} className="border-b border-white/5 align-top">
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <p className="text-gray-300 text-xs">{fmt(r.firstDetectedAt)}</p>
                      <p className="text-gray-600 text-[10px]">
                        {vr("inc_last")}: {fmt(r.lastDetectedAt)} · ×{r.occurrences}
                      </p>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="text-gray-300 text-xs font-mono">{r.service}</span>
                      <span className={`block mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded w-fit ${SEV[r.severity] ?? "bg-gray-600/20 text-gray-400"}`}>
                        {r.severity}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-gray-300 text-xs max-w-sm">{r.message}</td>
                    <td className="py-2.5 px-3">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${ST[r.status] ?? "bg-gray-600/20"}`}>{vr(`inc_st_${r.status}`)}</span>
                      {r.resolvedAt && <p className="text-green-500/70 text-[10px] mt-1">{fmt(r.resolvedAt)}</p>}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {r.status === "open" && (
                          <button onClick={() => setStatusFor(r.id, "investigating")} className="text-yellow-400 hover:text-yellow-300 text-[11px] px-2 py-1">
                            {vr("inc_investigate")}
                          </button>
                        )}
                        {r.status !== "resolved" && (
                          <button onClick={() => setStatusFor(r.id, "resolved")} className="text-green-400 hover:text-green-300 text-[11px] px-2 py-1">
                            {vr("inc_resolve")}
                          </button>
                        )}
                        {r.status === "resolved" && (
                          <button onClick={() => setStatusFor(r.id, "open")} className="text-gray-400 hover:text-white text-[11px] px-2 py-1">
                            {vr("inc_reopen")}
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
    </div>
  );
}
