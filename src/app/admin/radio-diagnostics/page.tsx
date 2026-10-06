"use client";

// Radio Diagnostics (spec §3) — RUN RADIO TEST performs a full real
// inspection server-side; results show per-test pass/fail with detail.

import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";

interface Test {
  key: string;
  label: string;
  level: "green" | "yellow" | "red" | "gray";
  passed: boolean | null;
  detail: string;
  responseTimeMs: number | null;
}
interface Report {
  checkedAt: string;
  serverTime: number;
  tests: Test[];
  passed: number;
  failed: number;
  warnings: number;
}

const DOT: Record<string, string> = {
  green: "bg-green-500",
  yellow: "bg-yellow-400",
  red: "bg-red-500",
  gray: "bg-gray-600",
};
const TEXT: Record<string, string> = {
  green: "text-green-400",
  yellow: "text-yellow-400",
  red: "text-red-400",
  gray: "text-gray-500",
};

export default function RadioDiagnosticsPage() {
  const { t } = useLanguage();
  const vr = t as unknown as (key: string) => string;
  const [report, setReport] = useState<Report | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const run = useCallback(async () => {
    setRunning(true);
    setError("");
    try {
      const res = await fetch("/api/radio-diagnostics", { cache: "no-store" });
      if (!res.ok) {
        setError(res.status === 403 ? vr("vrec_access_denied_desc") : vr("rd_err"));
        return;
      }
      setReport(await res.json());
    } catch {
      setError(vr("rd_err"));
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
          <h1 className="text-white text-2xl font-bold">{vr("rd_title")}</h1>
          <p className="text-gray-400 text-sm mt-1">{vr("rd_subtitle")}</p>
        </div>
        <button onClick={run} disabled={running} className="admin-btn admin-btn-primary text-sm">
          {running ? vr("rd_running") : vr("rd_run")}
        </button>
      </div>

      {error && <div className="bg-red-600/10 border border-red-600/30 text-red-400 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {report && (
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="bg-green-600/10 border border-green-600/30 text-green-400 px-3 py-1.5 rounded-full font-semibold">
            ✓ {vr("rd_passed")}: {report.passed}
          </span>
          <span className="bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 px-3 py-1.5 rounded-full font-semibold">
            ⚠ {vr("rd_warnings")}: {report.warnings}
          </span>
          <span className="bg-red-600/10 border border-red-600/30 text-red-400 px-3 py-1.5 rounded-full font-semibold">
            ✗ {vr("rd_failed")}: {report.failed}
          </span>
          <span className="text-gray-500 self-center">{new Date(report.checkedAt).toLocaleString()}</span>
        </div>
      )}

      <div className="admin-card !p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-gray-400 text-xs uppercase">
                <th className="py-3 px-4">{vr("rd_col_test")}</th>
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
                report.tests.map((ts) => (
                  <tr key={ts.key} className="border-b border-white/5">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${DOT[ts.level]}`} />
                        <span className="text-white text-xs font-medium">{ts.label}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`text-xs font-semibold ${TEXT[ts.level]}`}>
                        {ts.passed === true ? `✓ ${vr("rd_pass")}` : ts.passed === false ? `✗ ${vr("rd_fail")}` : "—"}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-400 text-xs max-w-lg">{ts.detail}</td>
                    <td className="py-3 px-4 text-gray-500 text-xs whitespace-nowrap">
                      {ts.responseTimeMs != null ? `${ts.responseTimeMs} ms` : "—"}
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
