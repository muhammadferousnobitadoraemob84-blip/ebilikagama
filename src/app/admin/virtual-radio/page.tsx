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
import {
  AZAN_PRAYERS,
  JAKIM_ZONES,
  type AzanAssignments,
  type AzanFile,
  type AzanPrayer,
  type PdfParseResult,
} from "@/lib/azan";
import type { TranslationKey } from "@/lib/i18n";

// Browser-side duration verification for pending tracks (HTML5 metadata).
interface PendingRow {
  driveId: string;
  fileName: string;
  size: number | null;
  mimeType: string;
  reason: string;
}
interface FileDiag {
  fileName: string;
  driveId: string;
  mimeType: string;
  size: number | null;
  extension: string | null;
  proxyPath: string;
  httpStatus: number | null;
  contentType: string | null;
  contentLength: string | null;
  acceptRanges: string | null;
  rangeWorks: boolean | null;
  servedVia: string | null;
  bytesReceived: number;
  serverParse?: string;
  serverDuration?: number | null;
  serverTagBytes?: number;
  finalClassification?: string;
  error?: string;
}

/**
 * Measure one track's duration with a plain HTMLAudioElement + preload
 * "metadata" + loadedmetadata/durationchange. Fetches only the metadata
 * the browser needs (usually the first few KB via range requests against
 * the stream proxy) — never the whole file.
 */
function measureDuration(src: string, timeoutMs = 20000): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = new Audio();
    let settled = false;
    const done = (value: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      audio.removeAttribute("src");
      audio.load(); // release the network fetch
      resolve(value);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const d = audio.duration;
      if (Number.isFinite(d) && d > 0) done(d);
      // durationchange may still fire with the real value later (some
      // webm/estimating streams start with Infinity) — wait briefly.
    };
    audio.ondurationchange = () => {
      const d = audio.duration;
      if (Number.isFinite(d) && d > 0) done(d);
    };
    audio.onerror = () => done(null);
    audio.onstalled = () => {
      /* keep waiting until timeout */
    };
    audio.src = src;
    audio.load();
  });
}

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
  pendingCount?: number;
  pendingFiles?: string[];
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

// Azan admin snapshot (GET /api/virtual-radio/azan)
interface AzanSnapshot {
  serverTime: number;
  files: AzanFile[];
  assignments: AzanAssignments;
  prayerZone: string | null;
  prayerTimes: {
    zone: string;
    source: "pdf" | "jakim_api";
    updatedAt: string;
    dayCount: number;
    today: {
      imsak: string | null;
      subuh: string;
      syuruk: string;
      zohor: string;
      asar: string;
      maghrib: string;
      isyak: string;
    } | null;
  } | null;
  schedule: {
    active: {
      prayer: string;
      fileName: string;
      startedAt: number;
      endsAt: number;
      offset: number;
      duration: number;
    } | null;
    next: { prayer: string; fileName: string; startsAt: number } | null;
  };
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

  // Duration verification state
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<null | {
    promoted: { fileName: string; duration: number }[];
    stillPending: string[];
    rejected: { fileName: string; reason: string }[];
  }>(null);
  // Per-file HTTP diagnostics: driveId → FileDiag
  const [fileDiags, setFileDiags] = useState<Record<string, FileDiag>>({});
  const [diagLoading, setDiagLoading] = useState<Record<string, boolean>>({});

  // ── AZAN & PRAYER TIMES state ─────────────────────────────────────
  const [azanState, setAzanState] = useState<AzanSnapshot | null>(null);
  const [azanScanning, setAzanScanning] = useState(false);
  const [azanScanResult, setAzanScanResult] = useState<null | {
    azanCount: number;
    azanFiles: AzanFile[];
    ignoredMusic: string[];
    errors: { fileName: string; error: string }[];
    pendingCount: number;
    error?: string;
  }>(null);
  const [azanAssign, setAzanAssign] = useState<AzanAssignments | null>(null);
  const [azanSaving, setAzanSaving] = useState(false);
  const [azanSavedMsg, setAzanSavedMsg] = useState(false);
  const [zone, setZone] = useState("");
  const [jakimBusy, setJakimBusy] = useState(false);
  const [jakimResult, setJakimResult] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfPreview, setPdfPreview] = useState<(PdfParseResult & { fileName: string }) | null>(null);
  const [pdfBusyConfirm, setPdfBusyConfirm] = useState(false);
  const [pdfResult, setPdfResult] = useState<string | null>(null);
  const pdfFileRef = useRef<HTMLInputElement | null>(null);
  const [testPrayer, setTestPrayer] = useState<AzanPrayer>("subuh");

  // Prayer Time Test Mode (admin-only; official JAKIM data never modified)
  const [tm, setTm] = useState<{
    enabled: boolean;
    overrides: Partial<Record<AzanPrayer, string>>;
    expiresAt: number | null;
    active: boolean;
  } | null>(null);
  const [officialToday, setOfficialToday] = useState<Record<string, string> | null>(null);
  const [tmBusy, setTmBusy] = useState(false);
  const [tmMsg, setTmMsg] = useState<string | null>(null);
  const [tmExpiresIn, setTmExpiresIn] = useState<string | null>(null);
  const [tmDraft, setTmDraft] = useState<Partial<Record<AzanPrayer, string>>>({});
  const [tmExpiryDraft, setTmExpiryDraft] = useState<string>("");
  useEffect(() => {
    if (tm) setTmDraft(tm.overrides ?? {});
  }, [tm]);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const testAudioRef = useRef<HTMLAudioElement | null>(null);
  // 1s tick drives the countdown re-render
  const [, azanTick] = useState(0);

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

  const loadTestMode = useCallback(async () => {
    try {
      const res = await fetch("/api/virtual-radio/azan/test-mode", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setTm(data.testMode);
      setOfficialToday(data.officialToday);
    } catch {
      /* admin-only convenience — silent */
    }
  }, []);

  const loadAzan = useCallback(async () => {
    try {
      const res = await fetch("/api/virtual-radio/azan", { cache: "no-store" });
      if (!res.ok) return;
      const data: AzanSnapshot = await res.json();
      setAzanState(data);
      setAzanAssign((prev) => prev ?? data.assignments);
      setZone((prev) => prev || data.prayerZone || "");
    } catch {
      // transient
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
    loadAzan();
    loadTestMode();
  }, [loadState, loadDiag, loadAzan, loadTestMode]);

  // 1s tick for the azan countdown
  useEffect(() => {
    const id = setInterval(() => azanTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  /**
   * Browser HTML5 metadata fallback: measure every pending track through the
   * stream proxy and post verified durations. Only runs when the admin clicks.
   */
  const handleVerifyDurations = async () => {
    if (!state?.pending?.length) return;
    setVerifying(true);
    setVerifyResult(null);
    setPageError(null);
    try {
      const durations: Record<string, number> = {};
      // Sequential on purpose: parallel audio decodes contend for the same
      // network path and skew timings; metadata loads are fast.
      for (const p of state.pending) {
        const src = `/api/virtual-radio/stream?id=${encodeURIComponent(p.driveId)}`;
        const d = await measureDuration(src);
        if (d != null) durations[p.driveId] = d;
      }
      if (Object.keys(durations).length === 0) {
        setVerifyResult({ promoted: [], stillPending: state.pending.map((p) => p.fileName), rejected: [] });
        await loadState();
        return;
      }
      const res = await fetch("/api/virtual-radio/verify-durations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ durations }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPageError(data.error || "Verification failed");
      } else {
        setVerifyResult(data);
      }
      await loadState();
    } catch {
      setPageError("Verification failed");
    } finally {
      setVerifying(false);
    }
  };

  const loadFileDiag = async (driveId: string) => {
    setDiagLoading((m) => ({ ...m, [driveId]: true }));
    try {
      const res = await fetch(`/api/virtual-radio/file-diagnostic?id=${encodeURIComponent(driveId)}`, {
        cache: "no-store",
      });
      const data: FileDiag = await res.json();
      setFileDiags((m) => ({ ...m, [driveId]: data }));
    } catch {
      setFileDiags((m) => ({ ...m, [driveId]: { fileName: "?", driveId, error: "Diagnostic request failed" } as FileDiag }));
    } finally {
      setDiagLoading((m) => ({ ...m, [driveId]: false }));
    }
  };

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

  // ── AZAN handlers ─────────────────────────────────────────────────
  const handleAzanScan = async () => {
    setAzanScanning(true);
    setAzanScanResult(null);
    try {
      const res = await fetch("/api/virtual-radio/azan/scan", { method: "POST" });
      const data = await res.json();
      setAzanScanResult(data);
      await loadAzan();
    } catch {
      setAzanScanResult({ azanCount: 0, azanFiles: [], ignoredMusic: [], errors: [], pendingCount: 0, error: "Scan request failed" });
    } finally {
      setAzanScanning(false);
    }
  };

  const handleSaveAssignments = async () => {
    if (!azanAssign) return;
    setAzanSaving(true);
    setAzanSavedMsg(false);
    try {
      const res = await fetch("/api/virtual-radio/azan/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(azanAssign),
      });
      if (res.ok) {
        setAzanSavedMsg(true);
        setTimeout(() => setAzanSavedMsg(false), 2500);
        await loadAzan();
      } else {
        const d = await res.json().catch(() => ({}));
        setPageError(d.error || "Failed to save assignments");
      }
    } finally {
      setAzanSaving(false);
    }
  };

  const handleJakimSync = async () => {
    const z = zone.trim().toUpperCase();
    if (!z) {
      setPageError("Choose a prayer zone first");
      return;
    }
    setJakimBusy(true);
    setJakimResult(null);
    try {
      const res = await fetch("/api/virtual-radio/prayer-times/jakim-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zone: z, period: "year" }),
      });
      const data = await res.json();
      if (res.ok) {
        setJakimResult(
          `✓ ${data.dayCount} days stored (${data.from} → ${data.to}), skipped ${data.rowsSkipped}`
        );
      } else {
        setJakimResult(`✗ ${data.error || "Sync failed"}`);
      }
      await loadAzan();
    } catch {
      setJakimResult("✗ Sync request failed");
    } finally {
      setJakimBusy(false);
    }
  };

  const handlePdfParse = async () => {
    const f = pdfFileRef.current?.files?.[0];
    if (!f) {
      setPageError("Choose a JAKIM PDF first");
      return;
    }
    setPdfBusy(true);
    setPdfPreview(null);
    setPdfResult(null);
    try {
      const form = new FormData();
      form.append("file", f);
      const res = await fetch("/api/virtual-radio/prayer-times/pdf", { method: "POST", body: form });
      const data = await res.json();
      if (res.ok) setPdfPreview(data);
      else setPageError(data.error || "PDF parse failed");
    } catch {
      setPageError("PDF parse request failed");
    } finally {
      setPdfBusy(false);
    }
  };

  const handlePdfConfirm = async () => {
    if (!pdfPreview) return;
    const z = zone.trim().toUpperCase();
    if (!z) {
      setPageError("Choose a prayer zone first");
      return;
    }
    setPdfBusyConfirm(true);
    try {
      const res = await fetch("/api/virtual-radio/prayer-times/pdf-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          zone: z,
          year: pdfPreview.detectedYear,
          month: pdfPreview.detectedMonth,
          rows: pdfPreview.rows,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setPdfResult(`✓ ${data.savedDays} days saved for ${z}`);
        setPdfPreview(null);
        if (pdfFileRef.current) pdfFileRef.current.value = "";
      } else {
        setPdfResult(`✗ ${data.error || "Save failed"}`);
      }
      await loadAzan();
    } catch {
      setPdfResult("✗ Save request failed");
    } finally {
      setPdfBusyConfirm(false);
    }
  };

  const handleTestAzan = async () => {
    setTestMsg(null);
    testAudioRef.current?.pause();
    try {
      const res = await fetch("/api/virtual-radio/azan/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prayer: testPrayer }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTestMsg(`✗ ${data.error}`);
        return;
      }
      const audio = new Audio(data.streamUrl);
      testAudioRef.current = audio;
      audio.play().catch(() => setTestMsg("Browser blocked playback — click again"));
      setTestMsg(`▶ ${data.fileName}`);
    } catch {
      setTestMsg("✗ Test request failed");
    }
  };

  // ── Prayer Time Test Mode handlers (ADMIN-ONLY; official JAKIM data is
  // never written to — overrides live in their own Setting key) ──
  const applyTestMode = async (overrides: Partial<Record<AzanPrayer, string>>, expiresAt: number | null) => {
    setTmBusy(true);
    setTmMsg(null);
    try {
      const res = await fetch("/api/virtual-radio/azan/test-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply", overrides, expiresAt }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTmMsg(`✗ ${data.error ?? "Save failed"}`);
        return;
      }
      setTm(data.testMode);
      setTmMsg("✓ " + t("azan_tm_saved"));
      await loadAzan();
    } catch {
      setTmMsg("✗ Test mode request failed");
    } finally {
      setTmBusy(false);
      setTimeout(() => setTmMsg(null), 4000);
    }
  };

  const resetTestMode = async () => {
    setTmBusy(true);
    setTmMsg(null);
    try {
      const res = await fetch("/api/virtual-radio/azan/test-mode", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setTmMsg(`✗ ${data.error ?? "Reset failed"}`);
        return;
      }
      setTm(data.testMode);
      setTmMsg("✓ " + t("azan_tm_using_official"));
      await loadAzan();
    } catch {
      setTmMsg("✗ Reset request failed");
    } finally {
      setTmBusy(false);
      setTimeout(() => setTmMsg(null), 4000);
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
            <p className="text-white text-sm font-semibold">
              {state?.tracks.length ?? 0}
              {state?.pending?.length ? (
                <span className="text-yellow-400 text-xs font-normal"> +{state.pending.length} {t("vr_admin_pending_short")}</span>
              ) : null}
            </p>
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
                {scanResult.pendingCount
                  ? `, ${scanResult.pendingCount} playable but duration-pending`
                  : ""}
                {scanResult.noDuration ? `, ${scanResult.noDuration} failed` : ""}
              </p>
              <p className="mt-1 opacity-80">
                Total duration {formatDuration(scanResult.totalDuration ?? 0)} · epoch set · radio timeline is live
              </p>
              {(scanResult.errors?.length ?? 0) > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer opacity-70">{scanResult.errors!.length} errors (inaccessible files)</summary>
                  <ul className="mt-1 space-y-0.5 text-xs opacity-80">
                    {scanResult.errors!.map((e, i) => (
                      <li key={i}>• {e.fileName}: {e.error}</li>
                    ))}
                  </ul>
                </details>
              )}
              {(scanResult.pendingFiles?.length ?? 0) > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer opacity-70">
                    {scanResult.pendingFiles!.length} file(s) pending duration verification
                  </summary>
                  <ul className="mt-1 space-y-0.5 text-xs opacity-80">
                    {scanResult.pendingFiles!.map((n, i) => (
                      <li key={i}>• {n} — playable, duration not measured yet</li>
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

      {/* Duration-pending tracks: non-blocking warning + browser verification */}
      {state?.pending && state.pending.length > 0 && (
        <div className="bg-yellow-900/10 border border-yellow-600/30 rounded-xl p-4 text-sm">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <p className="text-yellow-300 font-semibold">
                Some tracks need duration verification ({state.pending.length})
              </p>
              <p className="text-gray-400 text-xs mt-1 max-w-xl">
                These files are accessible and playable, but their duration couldn't be measured
                server-side, so they can't participate in the synchronized timeline math yet.
                Verify below (browser metadata check, a few KB per file — never a full download)
                or rescan after re-saving them without large embedded album art.
              </p>
            </div>
            <button
              onClick={handleVerifyDurations}
              disabled={verifying}
              className="bg-yellow-600/90 hover:bg-yellow-500 disabled:bg-gray-700 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors flex-shrink-0"
            >
              {verifying ? t("vr_admin_verifying") : t("vr_admin_verify_durations")}
            </button>
          </div>
          <ul className="mt-3 space-y-1">
            {state.pending.map((p) => (
              <li key={p.driveId} className="text-gray-300 text-xs flex items-center justify-between gap-3">
                <span className="truncate">
                  • {p.fileName} — {p.reason}
                </span>
                <button
                  onClick={() => loadFileDiag(p.driveId)}
                  className="text-red-400 hover:text-red-300 flex-shrink-0 underline"
                >
                  {t("vr_admin_diag_file")}
                </button>
              </li>
            ))}
          </ul>
          {verifyResult && (
            <div className="mt-3 border-t border-yellow-600/20 pt-3 text-xs space-y-1">
              {verifyResult.promoted.length > 0 && (
                <p className="text-green-300">
                  ✓ Verified &amp; added to playlist: {verifyResult.promoted.map((p) => `${p.fileName} (${formatDuration(p.duration)})`).join(", ")}
                </p>
              )}
              {verifyResult.rejected.length > 0 && (
                <p className="text-red-300">
                  ✗ Could not verify: {verifyResult.rejected.map((r) => `${r.fileName} (${r.reason})`).join(", ")}
                </p>
              )}
              {verifyResult.stillPending.length > 0 && (
                <p className="text-gray-400">Still pending: {verifyResult.stillPending.join(", ")}</p>
              )}
            </div>
          )}
          {/* Per-file HTTP diagnostics (admin only) */}
          {Object.entries(fileDiags).map(([id, d]) => (
            <div key={id} className="mt-3 bg-black/30 rounded-lg p-3 text-xs font-mono text-gray-300 overflow-x-auto">
              <p className="text-white font-semibold">{d.fileName || id}</p>
              {d.error ? (
                <p className="text-red-300">Error: {d.error}</p>
              ) : (
                <>
                  <p>Drive ID: {d.driveId}</p>
                  <p>MIME: {d.mimeType} · ext: {d.extension} · size: {d.size ?? "?"} B</p>
                  <p>Proxy: {d.proxyPath}</p>
                  <p>HTTP {d.httpStatus} · {d.contentType} · len {d.contentLength} · ranges {d.rangeWorks ? "OK" : "NO"} · via {d.servedVia}</p>
                  <p>Server parse: {d.serverParse} · duration {d.serverDuration ?? "—"}s · tag {d.serverTagBytes ?? "?"} B</p>
                  <p className={d.finalClassification?.startsWith("PLAYABLE +") ? "text-green-300" : "text-yellow-300"}>
                    Final: {d.finalClassification}
                  </p>
                </>
              )}
            </div>
          ))}
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

      {/* ══ AZAN & PRAYER TIMES ══ */}
      <div className="bg-gray-900 border border-white/10 rounded-xl p-5 space-y-5">
        <h2 className="text-white font-bold tracking-wide">{t("azan_section")} &amp; {t("azan_source_title")}</h2>

        {/* ── AZAN AUDIO ── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <p className="text-gray-300 text-sm font-semibold">{t("azan_section")}</p>
            <button
              onClick={handleAzanScan}
              disabled={azanScanning || !state?.folderId}
              className="bg-red-600 hover:bg-red-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {azanScanning ? t("azan_scanning") : t("azan_scan")}
            </button>
          </div>
          {!state?.folderId && (
            <p className="text-gray-500 text-xs">{t("vr_admin_folder_none")}</p>
          )}

          {azanScanResult && (
            <div
              className={`rounded-lg border p-3 text-sm ${
                azanScanResult.error
                  ? "bg-red-900/20 border-red-600/30 text-red-300"
                  : "bg-green-900/10 border-green-600/30 text-green-200"
              }`}
            >
              {azanScanResult.error ? (
                <p>{azanScanResult.error}</p>
              ) : (
                <>
                  <p className="font-semibold">
                    {t("azan_scan_done").replace("{done}", String(azanScanResult.azanCount))}
                    {azanScanResult.pendingCount ? `, ${azanScanResult.pendingCount} ${t("azan_pending_suffix")}` : ""}
                    {azanScanResult.errors.length ? `, ${azanScanResult.errors.length} ${t("azan_failed_suffix")}` : ""}
                  </p>
                  {azanScanResult.ignoredMusic.length > 0 && (
                    <details className="mt-1.5">
                      <summary className="cursor-pointer opacity-70">
                        {t("azan_ignored_count")} ({azanScanResult.ignoredMusic.length})
                      </summary>
                      <ul className="mt-1 space-y-0.5 text-xs opacity-80">
                        {azanScanResult.ignoredMusic.slice(0, 15).map((n, i) => (
                          <li key={i}>• {n}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              )}
            </div>
          )}

          {/* Detected azan files */}
          {azanState && azanState.files.length > 0 && (
            <div className="border border-white/5 rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-white/5">
                  <tr className="text-left text-gray-500 uppercase tracking-wider">
                    <th className="px-3 py-1.5 font-semibold">{t("azan_col_file")}</th>
                    <th className="px-3 py-1.5 font-semibold">{t("azan_col_mime")}</th>
                    <th className="px-3 py-1.5 font-semibold text-right">{t("azan_col_duration")}</th>
                    <th className="px-3 py-1.5 font-semibold">{t("azan_col_status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {azanState.files.map((f) => (
                    <tr key={f.driveId} className="border-t border-white/5">
                      <td className="px-3 py-1.5 text-white">
                        {f.fileName}
                        <span className="block text-gray-600 font-mono text-[10px]">{f.driveId}</span>
                      </td>
                      <td className="px-3 py-1.5 text-gray-400">{f.mimeType}</td>
                      <td className="px-3 py-1.5 text-gray-400 text-right font-mono">
                        {f.duration > 0 ? formatDuration(f.duration) : "—"}
                      </td>
                      <td className="px-3 py-1.5">
                        {f.unavailable ? (
                          <span className="text-red-400">{t("azan_status_unavailable")}</span>
                        ) : f.durationPending ? (
                          <span className="text-yellow-400">{t("azan_pending_suffix")}</span>
                        ) : (
                          <span className="text-green-400">✓ {t("azan_status_ready")}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {azanState && azanState.files.length === 0 && (
            <p className="text-gray-500 text-xs">{t("azan_none_found")}</p>
          )}

          {/* Role mapping */}
          {azanState && azanState.files.length > 0 && azanAssign && (
            <div className="space-y-2 pt-1">
              <p className="text-gray-400 text-xs uppercase tracking-wider font-semibold">{t("azan_role")}</p>
              {AZAN_PRAYERS.map((prayer) => (
                <div key={prayer} className="flex items-center gap-3">
                  <span className="text-gray-300 text-sm w-20 flex-shrink-0">{t(`prayer_${prayer}` as TranslationKey)}</span>
                  <select
                    value={azanAssign[prayer] ?? ""}
                    onChange={(e) =>
                      setAzanAssign((a) => ({ ...a!, [prayer]: e.target.value || null }))
                    }
                    className="bg-gray-800 border border-white/10 rounded-lg text-sm text-white px-3 py-1.5 flex-1 min-w-0"
                  >
                    <option value="">— {t("azan_unassigned")} —</option>
                    {azanState.files
                      .filter((f) => !f.unavailable)
                      .map((f) => (
                        <option key={f.driveId} value={f.driveId}>
                          {f.fileName}
                        </option>
                      ))}
                  </select>
                </div>
              ))}
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={handleSaveAssignments}
                  disabled={azanSaving}
                  className="bg-red-600 hover:bg-red-500 disabled:bg-gray-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  {azanSaving ? "…" : t("azan_save_assign")}
                </button>
                {azanSavedMsg && <span className="text-green-400 text-sm">✓ {t("azan_assign_saved")}</span>}
              </div>
            </div>
          )}
        </div>

        {/* ── PRAYER TIME SOURCE ── */}
        <div className="space-y-3 pt-3 border-t border-white/5">
          <p className="text-gray-300 text-sm font-semibold">{t("azan_source_title")}</p>

          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="azan-zone-select" className="text-gray-400 text-xs flex-shrink-0">
              {t("azan_zone")}
            </label>
            {/* Wrapper constrains the native select (which otherwise sizes to
                its longest option text and overflows the card). */}
            <div className="w-full min-w-0 sm:w-auto sm:flex-1 sm:max-w-sm">
              <select
                id="azan-zone-select"
                value={JAKIM_ZONES.some((z) => z.code === zone) ? zone : ""}
                onChange={(e) => setZone(e.target.value)}
                className="w-full max-w-full box-border bg-gray-800 border border-white/10 rounded-lg text-sm text-white px-3 py-1.5"
              >
                <option value="">— {t("azan_zone")} —</option>
                {JAKIM_ZONES.map((z) => (
                  <option key={z.code} value={z.code}>
                    {z.code} — {z.name}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-gray-600 text-xs basis-full sm:basis-auto">{t("azan_zone_hint")}</p>
          </div>

          {/* Option B: JAKIM API */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={handleJakimSync}
              disabled={jakimBusy || !zone}
              className="bg-red-600 hover:bg-red-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {jakimBusy ? t("azan_jakim_syncing") : t("azan_jakim_sync")}
            </button>
            {jakimResult && <span className="text-xs text-gray-300">{jakimResult}</span>}
          </div>

          {/* Option A: PDF import */}
          <div className="space-y-2">
            <p className="text-gray-400 text-xs uppercase tracking-wider font-semibold">{t("azan_pdf_title")}</p>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="min-w-0 flex-1 sm:max-w-md">
              <input
                ref={pdfFileRef}
                type="file"
                accept="application/pdf"
                aria-label={t("azan_choose_file")}
                className="w-full max-w-full box-border text-xs text-gray-400 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-white/10 file:text-white file:text-xs file:cursor-pointer"
              />
              </div>
              <button
                onClick={handlePdfParse}
                disabled={pdfBusy}
                className="bg-white/10 hover:bg-white/20 disabled:bg-gray-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors flex-shrink-0"
              >
                {pdfBusy ? t("azan_pdf_parsing") : t("azan_pdf_parse")}
              </button>
            </div>
            {pdfPreview && (
              <div className="space-y-2">
                <p className="text-gray-500 text-xs">
                  {pdfPreview.fileName} · {pdfPreview.rows.length} rows
                  {pdfPreview.detectedYear ? ` · ${pdfPreview.detectedMonth}/${pdfPreview.detectedYear}` : ""}
                </p>
                {pdfPreview.warnings.length > 0 && (
                  <p className="text-yellow-400 text-xs">⚠ {pdfPreview.warnings.join(" · ")}</p>
                )}
                <div className="max-h-56 overflow-y-auto border border-white/5 rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="bg-white/5 sticky top-0">
                      <tr className="text-left text-gray-500 uppercase">
                        <th className="px-2.5 py-1.5">Day</th>
                        <th className="px-2.5 py-1.5">Subuh</th>
                        <th className="px-2.5 py-1.5">Zohor</th>
                        <th className="px-2.5 py-1.5">Asar</th>
                        <th className="px-2.5 py-1.5">Maghrib</th>
                        <th className="px-2.5 py-1.5">Isyak</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pdfPreview.rows.map((r) => (
                        <tr key={r.day} className={`border-t border-white/5 ${r.confidence === "low" ? "bg-yellow-900/10" : ""}`}>
                          <td className="px-2.5 py-1 text-gray-300 font-mono">{r.day}</td>
                          <td className={`px-2.5 py-1 font-mono ${r.subuh ? "text-white" : "text-red-400"}`}>{r.subuh ?? "?"}</td>
                          <td className={`px-2.5 py-1 font-mono ${r.zohor ? "text-white" : "text-red-400"}`}>{r.zohor ?? "?"}</td>
                          <td className={`px-2.5 py-1 font-mono ${r.asar ? "text-white" : "text-red-400"}`}>{r.asar ?? "?"}</td>
                          <td className={`px-2.5 py-1 font-mono ${r.maghrib ? "text-white" : "text-red-400"}`}>{r.maghrib ?? "?"}</td>
                          <td className={`px-2.5 py-1 font-mono ${r.isyak ? "text-white" : "text-red-400"}`}>{r.isyak ?? "?"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handlePdfConfirm}
                    disabled={pdfBusyConfirm || !pdfPreview.detectedYear || !pdfPreview.detectedMonth}
                    className="bg-green-600 hover:bg-green-500 disabled:bg-gray-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                  >
                    {pdfBusyConfirm ? t("azan_pdf_saving") : t("azan_pdf_confirm")}
                  </button>
                  <button
                    onClick={() => setPdfPreview(null)}
                    className="text-gray-400 hover:text-white text-sm"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}
            {pdfResult && <p className="text-xs text-gray-300">{pdfResult}</p>}
          </div>

          {/* Current prayer-time status */}
          {azanState?.prayerTimes && (
            <div className="bg-black/30 rounded-lg p-3 text-xs space-y-1">
              <p>
                <span className="text-gray-500">Zone:</span> <span className="text-white font-mono">{azanState.prayerTimes.zone}</span>
                <span className="text-gray-500"> · source:</span>{" "}
                <span className="text-white">{azanState.prayerTimes.source === "jakim_api" ? t("azan_source_api") : t("azan_source_pdf")}</span>
                <span className="text-gray-500"> · {t("azan_synced_days")}:</span> <span className="text-white">{azanState.prayerTimes.dayCount}</span>
                <span className="text-gray-500"> · {t("azan_last_update")}:</span>{" "}
                <span className="text-white">{new Date(azanState.prayerTimes.updatedAt).toLocaleString()}</span>
              </p>
              {azanState.prayerTimes.today && (
                <p className="font-mono text-gray-300">
                  {t("azan_times_for")}: Subuh {azanState.prayerTimes.today.subuh} · Zohor {azanState.prayerTimes.today.zohor} · Asar{" "}
                  {azanState.prayerTimes.today.asar} · Maghrib {azanState.prayerTimes.today.maghrib} · Isyak {azanState.prayerTimes.today.isyak}
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── AZAN SCHEDULER status + TEST AZAN ── */}
        <div className="space-y-3 pt-3 border-t border-white/5">
          <p className="text-gray-300 text-sm font-semibold">{t("azan_scheduler_title")}</p>
          {azanState && (azanState.schedule.next || azanState.schedule.active) ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {azanState.schedule.active ? (
                <div className="col-span-2 sm:col-span-4 bg-green-900/20 border border-green-600/30 rounded-lg p-3">
                  <p className="text-green-300 font-semibold">
                    🔴 {t("azan_now_live")}: {azanState.schedule.active.prayer.toUpperCase()} — {azanState.schedule.active.fileName}
                  </p>
                  <p className="text-green-400/70 text-xs font-mono mt-0.5">
                    {formatDuration(azanState.schedule.active.offset)} / {formatDuration(azanState.schedule.active.duration)}
                  </p>
                </div>
              ) : (
                <>
                  <div>
                    <p className="text-gray-500 text-xs">{t("azan_next_prayer")}</p>
                    <p className="text-white text-sm font-semibold capitalize">{azanState.schedule.next!.prayer}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs">{t("azan_prayer_time")}</p>
                    <p className="text-white text-sm font-semibold font-mono">
                      {new Date(azanState.schedule.next!.startsAt).toLocaleTimeString("en-GB", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs">{t("azan_file")}</p>
                    <p className="text-white text-sm font-semibold truncate">{azanState.schedule.next!.fileName}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs">{t("azan_countdown")}</p>
                    <p className="text-white text-sm font-semibold font-mono">{
                      (() => {
                        const serverNow = Date.now() + (offsetMs ?? 0);
                        const s = Math.max(0, Math.floor((azanState.schedule.next!.startsAt - serverNow) / 1000));
                        const h = String(Math.floor(s / 3600)).padStart(2, "0");
                        const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
                        const sec = String(s % 60).padStart(2, "0");
                        return `${h}:${m}:${sec}`;
                      })()
                    }</p>
                  </div>
                </>
              )}
            </div>
          ) : (
            <p className="text-gray-500 text-xs">{t("azan_no_schedule")}</p>
 )}

          {/* TEST AZAN */}
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={testPrayer}
              onChange={(e) => setTestPrayer(e.target.value as AzanPrayer)}
              className="bg-gray-800 border border-white/10 rounded-lg text-sm text-white px-3 py-1.5"
            >
              {AZAN_PRAYERS.map((p) => (
                <option key={p} value={p}>
                  {t(`prayer_${p}` as TranslationKey)}
                </option>
              ))}
            </select>
            <button
              onClick={handleTestAzan}
              className="bg-white/10 hover:bg-white/20 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              ▶ {t("azan_test_play")}
            </button>
          </div>
          {testMsg && <p className="text-xs text-gray-300">{testMsg}</p>}
        </div>

        {/* ── PRAYER TIME TEST MODE (ADMIN-ONLY) ──
            Temporary scheduler overrides for azan testing. Test values live
            in their own Setting key — the official JAKIM/PDF prayer-time
            data is NEVER modified. Auto-expires (safety reset). Separate
            from "Play Test Azan", which only previews audio. */}
        <div className="space-y-3 pt-3 border-t border-white/5">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-gray-300 text-sm font-semibold">{t("azan_tm_title")}</p>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                tm?.active
                  ? "bg-amber-500/10 border-amber-500/40 text-amber-300"
                  : "bg-gray-800 border-white/10 text-gray-400"
              }`}
            >
              {tm?.active ? "ON" : "OFF"}
            </span>
            <span className="text-xs text-gray-500">
              {t("azan_tm_scheduler")}:{" "}
              <span className={tm?.active ? "text-amber-300 font-semibold" : "text-gray-300"}>
                {tm?.active ? t("azan_tm_using_test") : t("azan_tm_using_official")}
              </span>
            </span>
          </div>
          <p className="text-gray-600 text-xs">{t("azan_tm_hint")}</p>
          {officialToday && (
            <div className="space-y-1.5">
              {AZAN_PRAYERS.map((p) => (
                <div key={p} className="flex items-center gap-3 flex-wrap text-xs">
                  <span className="text-gray-400 w-16 capitalize">{t(`prayer_${p}` as TranslationKey)}</span>
                  <span className="text-gray-600">{t("azan_tm_official")}:</span>
                  <span className="text-white font-mono">{officialToday[p] ?? "—"}</span>
                  <input
                    type="time"
                    value={tmDraft[p] ?? ""}
                    onChange={(e) => setTmDraft((d) => ({ ...d, [p]: e.target.value }))}
                    className="bg-gray-800 border border-white/10 rounded text-white text-xs px-2 py-1 w-24"
                    aria-label={`${p} test override`}
                  />
                  {tm?.active && tm.overrides?.[p] ? (
                    <span className="text-amber-300">
                      {t("azan_tm_testing")}: <span className="font-mono">{tm.overrides[p]}</span>
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-xs text-gray-500">{t("azan_tm_expires")}</label>
            <input
              type="datetime-local"
              value={tmExpiryDraft}
              onChange={(e) => setTmExpiryDraft(e.target.value)}
              className="bg-gray-800 border border-white/10 rounded text-white text-xs px-2 py-1"
            />
            <button
              disabled={tmBusy}
              onClick={() => {
                // Empty expiry → 1 h default safety window (API caps at 6 h).
                const ms = tmExpiryDraft ? new Date(tmExpiryDraft).getTime() : Date.now() + 3_600_000;
                applyTestMode(tmDraft, ms);
              }}
              className="bg-white/10 hover:bg-white/20 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              {t("azan_tm_apply")}
            </button>
            <button
              disabled={tmBusy}
              onClick={resetTestMode}
              className="bg-red-600/20 border border-red-500/40 hover:bg-red-600/30 text-red-300 text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              {t("azan_tm_reset")}
            </button>
            {tm?.active && tm.expiresAt != null && (
              <span className="text-xs text-amber-300/80 font-mono">
                {t("azan_tm_expires_in")}{" "}
                {(() => {
                  const s = Math.max(0, Math.floor((tm.expiresAt - (Date.now() + (offsetMs ?? 0))) / 1000));
                  const h = String(Math.floor(s / 3600)).padStart(2, "0");
                  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
                  const sec = String(s % 60).padStart(2, "0");
                  return `${h}:${m}:${sec}`;
                })()}
              </span>
            )}
          </div>
          {tmMsg && <p className="text-xs text-gray-300">{tmMsg}</p>}
        </div>
      </div>

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
