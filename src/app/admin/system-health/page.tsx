"use client";

// System Health Monitor (spec §2) — real checks, GREEN/YELLOW/RED/GRAY,
// RUN SYSTEM CHECK performs fresh probes server-side on every click.

import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";

interface Check {
  key: string;
  label: string;
  level: "green" | "yellow" | "red" | "gray";
  status: string;
  detail: string;
  responseTimeMs: number | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
}
interface Report {
  checkedAt: string;
  checks: Check[];
  summary: { green: number; yellow: number; red: number; gray: number };
  overall: "healthy" | "degraded" | "unhealthy";
}

const LEVEL_STYLE: Record<string, { dot: string; text: string }> = {
  green: { dot: "bg-green-500", text: "text-green-400" },
  yellow: { dot: "bg-yellow-400", text: "text-yellow-400" },
  red: { dot: "bg-red-500", text: "text-red-400" },
  gray: { dot: "bg-gray-600", text: "text-gray-500" },
};

export default function SystemHealthPage() {
  const { t } = useLanguage();
  const vr = t as unknown as (key: string) => string;
  const [report, setReport] = useState<Report | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const run = useCallback(async () => {
    setRunning(true);
    setError("");
    try {
      const res = await fetch("/api/system-health", { cache: "no-store" });
      if (!res.ok) {
        setError(res.status === 403 ? vr("vrec_access_denied_desc") : vr("sh_err"));
        return;
      }
      setReport(await res.json());
    } catch {
      setError(vr("sh_err"));
    } finally {
      setRunning(false);
    }
  }, [vr]);

  useEffect(() => {
    run();
  }, [run]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-white text-2xl font-bold">{vr("sh_title")}</h1>
          <p className="text-gray-400 text-sm mt-1">{vr("sh_subtitle")}</p>
        </div>
        <button onClick={run} disabled={running} className="admin-btn admin-btn-primary text-sm">
          {running ? vr("sh_running") : vr("sh_run")}
        </button>
      </div>

      {error && <div className="bg-red-600/10 border border-red-600/30 text-red-400 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {report && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(
              [
                ["green", vr("sh_ok")],
                ["yellow", vr("sh_warn")],
                ["red", vr("sh_err_short")],
                ["gray", vr("sh_na")],
              ] as const
            ).map(([level, label]) => (
              <div key={level} className="admin-card !p-4 flex items-center gap-3">
                <span className={`w-3 h-3 rounded-full ${LEVEL_STYLE[level].dot}`} />
                <div>
                  <p className="text-white text-xl font-bold">{report.summary[level]}</p>
                  <p className="text-gray-500 text-[11px]">{label}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-gray-500 text-xs">
            {vr("sh_last_run")}: {new Date(report.checkedAt).toLocaleString()} · {vr("sh_overall")}:{" "}
            <span className={LEVEL_STYLE[report.overall === "healthy" ? "green" : report.overall === "degraded" ? "yellow" : "red"].text}>
              {vr(report.overall === "healthy" ? "sh_overall_ok" : report.overall === "degraded" ? "sh_overall_degraded" : "sh_overall_bad")}
            </span>
          </p>
        </>
      )}

      <div className="admin-card !p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-gray-400 text-xs uppercase">
                <th className="py-3 px-4">{vr("sh_col_service")}</th>
                <th className="py-3 px-4">{vr("sh_col_status")}</th>
                <th className="py-3 px-4">{vr("sh_col_detail")}</th>
                <th className="py-3 px-4 whitespace-nowrap">{vr("sh_col_time")}</th>
              </tr>
            </thead>
            <tbody>
              {!report ? (
                <tr>
                  <td colSpan={4} className="py-14 text-center">
                    <div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin mx-auto" />
                  </td>
                </tr>
              ) : (
                report.checks.map((c) => {
                  const st = LEVEL_STYLE[c.level];
                  return (
                    <tr key={c.key} className="border-b border-white/5 align-top">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${st.dot}`} />
                          <span className="text-white text-xs font-medium">{c.label}</span>
                        </div>
                        {(c.lastSuccessAt || c.lastFailureAt) && (
                          <p className="text-gray-600 text-[10px] mt-1 ml-[18px]">
                            {c.lastSuccessAt && `✓ ${new Date(c.lastSuccessAt).toLocaleTimeString()}`}
                            {c.lastFailureAt && ` · ✗ ${new Date(c.lastFailureAt).toLocaleTimeString()}`}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`text-xs font-semibold ${st.text}`}>{c.status}</span>
                      </td>
                      <td className="py-3 px-4 text-gray-400 text-xs max-w-md">
                        {c.detail}
                        {c.level === "red" && c.lastError && (
                          <span className="block text-red-300/80 text-[11px] mt-0.5 font-mono break-all">{c.lastError}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-gray-500 text-xs whitespace-nowrap">
                        {c.responseTimeMs != null ? `${c.responseTimeMs} ms` : "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
