"use client";

// Admin: Virtual Radio prototype configuration + diagnostics.
// Minimal UI on purpose: folder → scan → enable → verify sync.

import { useCallback, useEffect, useRef, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import {
  computeClockOffset,
  formatDuration,
  getRadioPosition,
  type VirtualRadioState,
} from "@/lib/virtual-radio";

interface FolderItem {
  id: string;
  name: string;
  path: string;
}

interface ScanResult {
  success?: boolean;
  discovered?: number;
  indexed?: number;
  skipped?: number;
  noDuration?: number;
  errors?: { fileName: string; error: string }[];
  totalDuration?: number;
  epoch?: number;
  error?: string;
}

interface Diagnostic {
  serverTime: number;
  serverTimeIso: string;
  epoch: number | null;
  enabled: boolean;
  totalDuration: number;
  trackCount: number;
  position: {
    index: number;
    cycle: number;
    offset: number;
    cyclePosition: number;
    fileName: string | null;
  } | null;
}

export default function AdminVirtualRadio() {
  const { t } = useLanguage();
  const [state, setState] = useState<VirtualRadioState | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  // Folder browser state
  const [browserOpen, setBrowserOpen] = useState(false);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [crumbs, setCrumbs] = useState<FolderItem[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);

  // Diagnostics
  const [diag, setDiag] = useState<Diagnostic | null>(null);
  const [clientNow, setClientNow] = useState<number | null>(null);
  const [offsetMs, setOffsetMs] = useState<number | null>(null);
  const [rttMs, setRttMs] = useState<number | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [, tick] = useState(0);
  const sentAtRef = useRef<number>(0);

  const loadState = useCallback(async () => {
    try {
      const res = await fetch("/api/virtual-radio/config", { cache: "no-store" });
      if (res.ok) setState(await res.json());
      else setPageError(`Config load failed (${res.status})`);
    } catch {
      setPageError("Config load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDiag = useCallback(async () => {
    try {
      const sent = Date.now();
      sentAtRef.current = sent;
      const res = await fetch("/api/virtual-radio/diagnostic", { cache: "no-store" });
      const received = Date.now();
      if (!res.ok) return;
      const data: Diagnostic = await res.json();
      setDiag(data);
      const sample = computeClockOffset(sent, received, data.serverTime);
      setClientNow(Date.now());
      setOffsetMs(Math.round(sample.offsetMs));
      setRttMs(sample.rttMs);
    } catch {
      // transient
    }
  }, []);

  useEffect(() => {
    loadState();
    loadDiag();
  }, [loadState, loadDiag]);

  // 1s diagnostics refresh (cheap: one tiny admin JSON call)
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(loadDiag, 1000);
    return () => clearInterval(id);
  }, [autoRefresh, loadDiag]);

  // Live client-side position re-render
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);

  // ── Folder browser (reuses the Quran folder-listing endpoint) ──────
  const openFolderBrowser = useCallback(
    async (parentId: string | null, name: string | null) => {
      setBrowserOpen(true);
      setFoldersLoading(true);
      try {
        const params = new URLSearchParams();
        if (parentId) params.set("parentId", parentId);
        const res = await fetch(`/api/quran-audio/folders?${params}`, { cache: "no-store" });
        const data = await res.json();
        if (res.ok) {
          setFolders(data.folders || []);
          setCrumbs((c) => (parentId ? [...c, { id: parentId, name: name || "?", path: "" }] : []));
        } else {
          setFolders([]);
          setPageError(data.error || t("vr_admin_drive_connect"));
        }
      } catch {
        setFolders([]);
      } finally {
        setFoldersLoading(false);
      }
    },
    [t]
  );

  const handleScan = async () => {
    setScanning(true);
    setScanResult(null);
    setPageError(null);
    try {
      const res = await fetch("/api/virtual-radio/scan", { method: "POST" });
      const data: ScanResult = await res.json();
      setScanResult(data);
      await loadState();
    } catch {
      setScanResult({ error: "Scan request failed" });
    } finally {
      setScanning(false);
    }
  };

  const handleToggle = async () => {
    if (!state) return;
    setBusy(true);
    try {
      await fetch("/api/virtual-radio/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !state.enabled }),
      });
      await loadState();
    } finally {
      setBusy(false);
    }
  };

  const handleSelectFolder = async (f: FolderItem) => {
    setBusy(true);
    setPageError(null);
    try {
      const res = await fetch("/api/virtual-radio/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId: f.id, folderName: f.name }),
      });
      const data = await res.json();
      if (!res.ok) setPageError(data.error || "Failed to set folder");
      setBrowserOpen(false);
      await loadState();
    } finally {
      setBusy(false);
    }
  };

  // ── Client-side position from the synced clock ─────────────────────
  const clientOffsetFromServer =
    diag && offsetMs != null ? Date.now() + offsetMs - diag.serverTime : null;
  const clientPos =
    state && state.epoch && state.tracks.length > 0
      ? getRadioPosition(state, Date.now() + (offsetMs ?? 0))
      : null;
  const driftMs =
    diag && clientPos && diag.position
      ? Math.round((clientPos.cyclePosition - diag.position.cyclePosition) * 1000)
      : null;

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const scanInfo = scanResult && !scanResult.success ? scanResult.error : null;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-white text-xl sm:text-2xl font-bold">{t("vr_admin_title")}</h1>
        <p className="text-gray-500 text-sm mt-1">{t("vr_admin_subtitle")}</p>
      </div>

      {pageError && (
        <div className="bg-red-900/20 border border-red-600/30 text-red-300 text-sm rounded-lg px-4 py-3">
          {pageError}
        </div>
      )}

      {/* Configuration card */}
      <div className="bg-gray-900 border border-white/10 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-gray-400 text-xs uppercase tracking-wider font-semibold">{t("vr_admin_folder")}</p>
            <p className="text-white font-medium mt-0.5">
              {state?.folderName || <span className="text-gray-500">{t("vr_admin_folder_none")}</span>}
            </p>
            {state?.folderId && <p className="text-gray-600 text-xs font-mono mt-0.5">{state.folderId}</p>}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => openFolderBrowser(null, null)}
              className="bg-white/10 hover:bg-white/20 text-white text-sm px-4 py-2 rounded-lg transition-colors"
            >
              {t("vr_admin_choose")}
            </button>
            <button
              onClick={handleScan}
              disabled={scanning || !state?.folderId}
              className="bg-red-600 hover:bg-red-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {scanning ? t("vr_admin_scanning") : t("vr_admin_scan")}
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-white/5">
          <div>
            <p className="text-gray-500 text-xs">{t("vr_admin_status")}</p>
            <p className={`text-sm font-semibold ${state?.enabled ? "text-green-400" : "text-gray-500"}`}>
              {state?.enabled ? t("vr_on_air") : t("radio_offline")}
            </p>
          </div>
          <div>
            <p className="text-gray-500 text-xs">{t("vr_admin_tracks")}</p>
            <p className="text-white text-sm font-semibold">{state?.tracks.length ?? 0}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs">{t("vr_admin_total_duration")}</p>
            <p className="text-white text-sm font-semibold">{formatDuration(state?.totalDuration ?? 0)}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs">{t("vr_admin_last_scan")}</p>
            <p className="text-white text-sm font-semibold">
              {state?.lastScanAt ? new Date(state.lastScanAt).toLocaleString() : t("vr_admin_never")}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-white/5">
          <span className="text-gray-300 text-sm font-medium">{t("vr_admin_enable")}</span>
          <button
            onClick={handleToggle}
            disabled={busy || !state?.folderId || (state?.tracks.length ?? 0) === 0}
            className={`relative w-12 h-6 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              state?.enabled ? "bg-green-600" : "bg-gray-700"
            }`}
            aria-label="Toggle radio"
          >
            <span
              className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                state?.enabled ? "translate-x-[22px]" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Scan result */}
      {scanResult && (
        <div
          className={`rounded-xl border p-4 text-sm ${
            scanResult.success
              ? "bg-green-900/10 border-green-600/30 text-green-200"
              : "bg-red-900/20 border-red-600/30 text-red-300"
          }`}
        >
          {scanResult.success ? (
            <>
              <p className="font-semibold">
                Scan complete: {scanResult.indexed}/{scanResult.discovered} tracks indexed
                {scanResult.noDuration ? `, ${scanResult.noDuration} skipped (no duration)` : ""}
              </p>
              <p className="mt-1 opacity-80">
                Total duration {formatDuration(scanResult.totalDuration ?? 0)} · epoch set · radio timeline is live
              </p>
              {(scanResult.errors?.length ?? 0) > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer opacity-70">{scanResult.errors!.length} warnings</summary>
                  <ul className="mt-1 space-y-0.5 text-xs opacity-80">
                    {scanResult.errors!.map((e, i) => (
                      <li key={i}>• {e.fileName}: {e.error}</li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          ) : (
            <p>{scanInfo || "Scan failed"}</p>
          )}
        </div>
      )}

      {/* Playlist table */}
      {state && state.tracks.length > 0 && (
        <div className="bg-gray-900 border border-white/10 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-white/5">
            <p className="text-gray-300 text-sm font-semibold">{t("vr_admin_playlist")}</p>
          </div>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/5 sticky top-0">
                <tr className="text-left text-gray-500 text-xs uppercase tracking-wider">
                  <th className="px-5 py-2 font-semibold">#</th>
                  <th className="px-5 py-2 font-semibold">File</th>
                  <th className="px-5 py-2 font-semibold text-right">Duration</th>
                </tr>
              </thead>
              <tbody>
                {state.tracks.map((track, i) => {
                  const isCurrent = clientPos?.index === i;
                  return (
                    <tr
                      key={track.driveId}
                      className={`border-t border-white/5 ${isCurrent ? "bg-red-600/10" : ""}`}
                    >
                      <td className="px-5 py-2 text-gray-500 font-mono">{String(i + 1).padStart(3, "0")}</td>
                      <td className="px-5 py-2 text-white truncate max-w-xs">
                        {isCurrent && <span className="text-red-400 mr-1.5">▶</span>}
                        {track.fileName}
                      </td>
                      <td className="px-5 py-2 text-gray-400 text-right font-mono">
                        {formatDuration(track.duration)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Synchronization diagnostics — admin-only */}
      <div className="bg-gray-900 border border-white/10 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
          <div>
            <p className="text-gray-300 text-sm font-semibold">{t("vr_admin_diag")}</p>
            <p className="text-gray-600 text-xs mt-0.5">{t("vr_admin_diag_hint")}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                autoRefresh
                  ? "bg-green-600/10 border-green-600/30 text-green-400"
                  : "bg-white/5 border-white/10 text-gray-400"
              }`}
            >
              {t("vr_admin_autorefresh")}
            </button>
            <button
              onClick={() => { loadDiag(); }}
              className="text-xs px-2.5 py-1 rounded border bg-white/5 border-white/10 text-gray-300 hover:bg-white/10"
            >
              {t("vr_admin_refresh")}
            </button>
          </div>
        </div>
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5 text-sm">
          <DiagRow label={t("vr_admin_server_time")} value={diag ? new Date(diag.serverTime).toISOString() : "…"} mono />
          <DiagRow label={t("vr_admin_client_time")} value={clientNow ? new Date(clientNow).toISOString() : "…"} mono />
          <DiagRow
            label={t("vr_admin_offset")}
            value={offsetMs != null ? `${offsetMs > 0 ? "+" : ""}${offsetMs} ms (rtt ${rttMs} ms)` : "…"}
            mono
            highlight={offsetMs != null && Math.abs(offsetMs) < 5000}
          />
          <DiagRow
            label={t("vr_admin_epoch")}
            value={diag?.epoch ? new Date(diag.epoch).toISOString() : "not set"}
            mono
          />
          <DiagRow
            label={`${t("vr_admin_position")} (server)`}
            value={
              diag?.position
                ? `#${diag.position.index + 1} ${diag.position.fileName} @ ${formatDuration(diag.position.offset)} (cycle ${diag.position.cycle})`
                : "—"
            }
            mono
          />
          <DiagRow
            label={`${t("vr_admin_position")} (client)`}
            value={
              clientPos
                ? `#${clientPos.index + 1} ${state?.tracks[clientPos.index]?.fileName ?? "?"} @ ${formatDuration(clientPos.offset)} (cycle ${clientPos.cycle})`
                : "—"
            }
            mono
          />
          <DiagRow
            label="Client↔server drift"
            value={driftMs != null ? `${driftMs > 0 ? "+" : ""}${driftMs} ms` : "…"}
            mono
            highlight={driftMs != null && Math.abs(driftMs) < 1500}
          />
          <DiagRow
            label={t("vr_admin_track_offset")}
            value={clientPos ? formatDuration(clientPos.offset) : "—"}
            mono
          />
          <DiagRow label={t("vr_admin_total_duration")} value={formatDuration(diag?.totalDuration ?? 0)} mono />
          <DiagRow label="Tracks" value={String(diag?.trackCount ?? 0)} mono />
          {clientOffsetFromServer != null && (
            <DiagRow
              label="Clock model check (client−server)"
              value={`${clientNow != null && diag ? Math.round(clientNow + (offsetMs ?? 0) - diag.serverTime) : 0} ms`}
              mono
            />
          )}
        </div>
      </div>

      {/* Folder browser modal */}
      {browserOpen && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => setBrowserOpen(false)}
        >
          <div
            className="bg-gray-900 border border-white/10 rounded-xl w-full max-w-lg max-h-[70vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
              <p className="text-white text-sm font-semibold">Google Drive folders</p>
              <button onClick={() => setBrowserOpen(false)} className="text-gray-500 hover:text-white text-xl leading-none">
                ×
              </button>
            </div>
            <div className="px-5 py-2 border-b border-white/5 flex flex-wrap gap-1.5 text-xs">
              <button
                onClick={() => { setCrumbs([]); openFolderBrowser(null, null); }}
                className="text-red-400 hover:text-red-300"
              >
                My Drive
              </button>
              {crumbs.map((c, i) => (
                <span key={c.id} className="text-gray-500">
                  {" / "}
                  <button
                    onClick={() => { setCrumbs(crumbs.slice(0, i + 1)); openFolderBrowser(c.id, c.name); }}
                    className="text-gray-400 hover:text-white"
                  >
                    {c.name}
                  </button>
                </span>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {foldersLoading ? (
                <div className="flex justify-center py-10">
                  <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : folders.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-10">No subfolders here.</p>
              ) : (
                folders.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-white/5 group"
                  >
                    <button
                      onClick={() => openFolderBrowser(f.id, f.name)}
                      className="flex items-center gap-2.5 text-sm text-gray-200 hover:text-white truncate"
                    >
                      <svg className="w-4 h-4 text-yellow-500/80 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                      </svg>
                      <span className="truncate">{f.name}</span>
                    </button>
                    <button
                      onClick={() => handleSelectFolder(f)}
                      disabled={busy}
                      className="text-xs bg-red-600/90 hover:bg-red-500 text-white px-3 py-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-2"
                    >
                      Select
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DiagRow({
  label,
  value,
  mono,
  highlight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/5 pb-1.5">
      <span className="text-gray-500 text-xs flex-shrink-0">{label}</span>
      <span
        className={`${mono ? "font-mono" : ""} text-xs text-right ${
          highlight === true ? "text-green-400" : highlight === false ? "text-yellow-400" : "text-gray-300"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
