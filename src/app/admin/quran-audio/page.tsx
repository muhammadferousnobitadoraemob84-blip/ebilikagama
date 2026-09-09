"use client";

import { useState, useEffect, useCallback } from "react";
import { useLanguage } from "@/components/LanguageProvider";

interface QuranAudioEntry {
  id: string;
  surahName: string;
  surahNumber: number;
  ayahNumber: number;
  audioType: string;
  reciterName: string;
  fileName: string;
  fileSize: number | null;
  duration: number | null;
  googleDriveId: string;
  googleDriveUrl: string | null;
  status: string;
  createdAt: string;
}

interface DriveFolder {
  id: string;
  name: string;
  path: string;
}

interface FolderState {
  connected: boolean;
  email: string | null;
  folderId: string | null;
  folderName: string;
  qari: string;
  lastSync: string | null;
}

interface ScanResult {
  totalFiles: number;
  indexed: number;
  needsReview: number;
  duplicates: number;
  deleted: number;
  errors: number;
  totalInDatabase: number;
  lastScan: string;
}

const COMMON_QARIS = [
  "Mishary Rashid Alafasy",
  "Abdul Basit Abdul Samad",
  "Maher Al Muaiqly",
  "Saud Al-Shuraim",
  "Yasser Al-Dosari",
  "Muhammad Siddiq Al-Minshawi",
  "Mohamed Al Tablawi",
  "Ahmed Al Ajmi",
  "Sudais and Shuraim",
  "Abu Bakr Al Shatri",
  "Nasser Al Qatami",
  "Ali Jaber",
  "Husary",
  "Minshawi",
  "Ayyoub",
  "Muhsin Al-Qasim",
  "Abdullah Awad Al Juhani",
  "Fares Abbad",
  "Khalifah Al-Tunaiji",
];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const SURAH_LIST = [
  { number: 1, name: "Al-Fatihah" }, { number: 2, name: "Al-Baqarah" },
  { number: 3, name: "Ali 'Imran" }, { number: 4, name: "An-Nisa" },
  { number: 5, name: "Al-Ma'idah" }, { number: 6, name: "Al-An'am" },
  { number: 7, name: "Al-A'raf" }, { number: 8, name: "Al-Anfal" },
  { number: 9, name: "At-Tawbah" }, { number: 10, name: "Yunus" },
  { number: 11, name: "Hud" }, { number: 12, name: "Yusuf" },
  { number: 13, name: "Ar-Ra'd" }, { number: 14, name: "Ibrahim" },
  { number: 15, name: "Al-Hijr" }, { number: 16, name: "An-Nahl" },
  { number: 17, name: "Al-Isra" }, { number: 18, name: "Al-Kahf" },
  { number: 19, name: "Maryam" }, { number: 20, name: "Taha" },
  { number: 21, name: "Al-Anbiya" }, { number: 22, name: "Al-Hajj" },
  { number: 23, name: "Al-Mu'minun" }, { number: 24, name: "An-Nur" },
  { number: 25, name: "Al-Furqan" }, { number: 26, name: "Ash-Shu'ara" },
  { number: 27, name: "An-Naml" }, { number: 28, name: "Al-Qasas" },
  { number: 29, name: "Al-Ankabut" }, { number: 30, name: "Ar-Rum" },
  { number: 31, name: "Luqman" }, { number: 32, name: "As-Sajdah" },
  { number: 33, name: "Al-Ahzab" }, { number: 34, name: "Saba" },
  { number: 35, name: "Fatir" }, { number: 36, name: "Ya-Sin" },
  { number: 37, name: "As-Saffat" }, { number: 38, name: "Sad" },
  { number: 39, name: "Az-Zumar" }, { number: 40, name: "Ghafir" },
  { number: 41, name: "Fussilat" }, { number: 42, name: "Ash-Shura" },
  { number: 43, name: "Az-Zukhruf" }, { number: 44, name: "Ad-Dukhan" },
  { number: 45, name: "Al-Jathiyah" }, { number: 46, name: "Al-Ahqaf" },
  { number: 47, name: "Muhammad" }, { number: 48, name: "Al-Fath" },
  { number: 49, name: "Al-Hujurat" }, { number: 50, name: "Qaf" },
  { number: 51, name: "Adh-Dhariyat" }, { number: 52, name: "At-Tur" },
  { number: 53, name: "An-Najm" }, { number: 54, name: "Al-Qamar" },
  { number: 55, name: "Ar-Rahman" }, { number: 56, name: "Al-Waqi'ah" },
  { number: 57, name: "Al-Hadid" }, { number: 58, name: "Al-Mujadilah" },
  { number: 59, name: "Al-Hashr" }, { number: 60, name: "Al-Mumtahanah" },
  { number: 61, name: "As-Saf" }, { number: 62, name: "Al-Jumu'ah" },
  { number: 63, name: "Al-Munafiqun" }, { number: 64, name: "At-Taghabun" },
  { number: 65, name: "At-Talaq" }, { number: 66, name: "At-Tahrim" },
  { number: 67, name: "Al-Mulk" }, { number: 68, name: "Al-Qalam" },
  { number: 69, name: "Al-Haqqah" }, { number: 70, name: "Al-Ma'arij" },
  { number: 71, name: "Nuh" }, { number: 72, name: "Al-Jinn" },
  { number: 73, name: "Al-Muzzammil" }, { number: 74, name: "Al-Muddaththir" },
  { number: 75, name: "Al-Qiyamah" }, { number: 76, name: "Al-Insan" },
  { number: 77, name: "Al-Mursalat" }, { number: 78, name: "An-Naba" },
  { number: 79, name: "An-Nazi'at" }, { number: 80, name: "Abasa" },
  { number: 81, name: "At-Takwir" }, { number: 82, name: "Al-Infitar" },
  { number: 83, name: "Al-Mutaffifin" }, { number: 84, name: "Al-Inshiqaq" },
  { number: 85, name: "Al-Buruj" }, { number: 86, name: "At-Tariq" },
  { number: 87, name: "Al-A'la" }, { number: 88, name: "Al-Ghashiyah" },
  { number: 89, name: "Al-Fajr" }, { number: 90, name: "Al-Balad" },
  { number: 91, name: "Ash-Shams" }, { number: 92, name: "Al-Layl" },
  { number: 93, name: "Ad-Duhaa" }, { number: 94, name: "Ash-Sharh" },
  { number: 95, name: "At-Tin" }, { number: 96, name: "Al-Alaq" },
  { number: 97, name: "Al-Qadr" }, { number: 98, name: "Al-Bayyinah" },
  { number: 99, name: "Az-Zalzalah" }, { number: 100, name: "Al-Adiyat" },
  { number: 101, name: "Al-Qari'ah" }, { number: 102, name: "At-Takathur" },
  { number: 103, name: "Al-Asr" }, { number: 104, name: "Al-Humazah" },
  { number: 105, name: "Al-Fil" }, { number: 106, name: "Quraysh" },
  { number: 107, name: "Al-Ma'un" }, { number: 108, name: "Al-Kawthar" },
  { number: 109, name: "Al-Kafirun" }, { number: 110, name: "An-Nasr" },
  { number: 111, name: "Al-Masad" }, { number: 112, name: "Al-Ikhlas" },
  { number: 113, name: "Al-Falaq" }, { number: 114, name: "An-Nas" },
];

export default function QuranAudioPage() {
  const { t } = useLanguage();

  // ── Persisted state (from database) ──
  const [savedState, setSavedState] = useState<FolderState>({
    connected: false, email: null, folderId: null, folderName: "", qari: "", lastSync: null,
  });

  // ── Working/editing state ──
  const [editFolderId, setEditFolderId] = useState<string | null>(null);
  const [editFolderName, setEditFolderName] = useState("");
  const [editQari, setEditQari] = useState("");
  const [editCustomQari, setEditCustomQari] = useState("");
  const [editShowCustomQari, setEditShowCustomQari] = useState(false);

  // ── UI state ──
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const [driveFolders, setDriveFolders] = useState<DriveFolder[]>([]);
  const [folderBrowsing, setFolderBrowsing] = useState(false);
  const [currentParentId, setCurrentParentId] = useState("root");
  const [currentParentPath, setCurrentParentPath] = useState("");
  const [folderPageToken, setFolderPageToken] = useState<string | null>(null);
  const [folderSearch, setFolderSearch] = useState("");
  const [folderSearchMode, setFolderSearchMode] = useState(false);
  const [tempSelectedFolderId, setTempSelectedFolderId] = useState<string | null>(null);
  const [tempSelectedFolderName, setTempSelectedFolderName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  // ── Scan state ──
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);

  // ── Playback test state ──
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // ── Audio entries state ──
  const [entries, setEntries] = useState<QuranAudioEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(true);
  const [filterSurah, setFilterSurah] = useState<number | "">("");
  const [filterReciter, setFilterReciter] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteFromDrive, setDeleteFromDrive] = useState(false);

  // ── Load persisted config ──
  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/quran-audio/folder");
      if (res.ok) {
        const data = await res.json();
        const state: FolderState = {
          connected: data.connected || false,
          email: data.email || null,
          folderId: data.folderId || null,
          folderName: data.folderName || "",
          qari: data.qari || "",
          lastSync: data.lastSync || null,
        };
        setSavedState(state);
        // Initialize editing state from saved
        setEditFolderId(state.folderId);
        setEditFolderName(state.folderName);
        setEditQari(state.qari);
      }
    } catch { /* Error */ }
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  // ── Load audio entries ──
  const fetchEntries = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterSurah) params.set("surah", String(filterSurah));
      if (filterReciter) params.set("reciter", filterReciter);
      const query = params.toString() ? `?${params.toString()}` : "";
      const res = await fetch(`/api/quran-audio${query}`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data);
      }
    } catch { /* Error */ }
    setLoadingEntries(false);
  }, [filterSurah, filterReciter]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  // ── Compute unsaved changes ──
  const effectiveEditQari = editShowCustomQari ? editCustomQari.trim() : editQari;
  const isConfigured = !!savedState.folderId && !!savedState.qari;
  const hasUnsavedChanges =
    editFolderId !== savedState.folderId ||
    editFolderName !== savedState.folderName ||
    effectiveEditQari !== savedState.qari;
  const canSave = !!editFolderId && !!effectiveEditQari && !!savedState.connected;

  // ── Google Drive OAuth ──
  const handleConnectDrive = () => {
    window.location.href = "/api/google-drive/auth";
  };

  const handleDisconnectDrive = async () => {
    if (!confirm("Disconnect Google Drive? This will also clear the Quran Audio configuration.")) return;
    try {
      await fetch("/api/quran-audio/folder", { method: "DELETE" });
      await fetch("/api/google-drive/disconnect", { method: "POST" });
      await fetchConfig();
      setScanResult(null);
    } catch { /* Error */ }
  };

  // ── Save configuration ──
  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setSaveMessage("");
    try {
      const res = await fetch("/api/quran-audio/folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderId: editFolderId,
          folderName: editFolderName,
          qari: effectiveEditQari,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSavedState({
          ...savedState,
          folderId: editFolderId,
          folderName: editFolderName,
          qari: effectiveEditQari,
        });
        setSaveMessage("✓ Quran Audio settings saved successfully.");
        setTimeout(() => setSaveMessage(""), 5000);
      } else {
        alert(data.error || "Failed to save settings");
      }
    } catch {
      alert("Failed to save settings. Please try again.");
    }
    setSaving(false);
  };

  // ── Folder browser ──
  const loadFolders = useCallback(async (parentId: string, search?: string, pageToken?: string) => {
    setFolderBrowsing(true);
    try {
      const params = new URLSearchParams();
      if (parentId) params.set("parentId", parentId);
      if (search) params.set("search", search);
      if (pageToken) params.set("pageToken", pageToken);
      const res = await fetch(`/api/quran-audio/folders?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (pageToken) {
          setDriveFolders((prev) => [...prev, ...(data.folders || [])]);
        } else {
          setDriveFolders(data.folders || []);
        }
        setFolderPageToken(data.nextPageToken || null);
        setCurrentParentId(data.parentId || parentId);
        setCurrentParentPath(data.parentPath || "");
      }
    } catch { /* Error */ }
    setFolderBrowsing(false);
  }, []);

  const openFolderBrowser = () => {
    setShowFolderBrowser(true);
    setTempSelectedFolderId(editFolderId);
    setTempSelectedFolderName(editFolderName);
    setFolderSearch("");
    setFolderSearchMode(false);
    loadFolders("root");
  };

  const handleFolderSearch = () => {
    if (folderSearch.trim()) {
      setFolderSearchMode(true);
      loadFolders("root", folderSearch.trim());
    } else {
      setFolderSearchMode(false);
      loadFolders("root");
    }
  };

  const navigateIntoFolder = (folderId: string) => {
    setFolderSearchMode(false);
    setFolderSearch("");
    loadFolders(folderId);
  };

  const handleConfirmFolder = () => {
    if (!tempSelectedFolderId) return;
    setEditFolderId(tempSelectedFolderId);
    setEditFolderName(tempSelectedFolderName);
    setShowFolderBrowser(false);
  };

  // ── Scan / Sync ──
  const handleScan = async () => {
    if (!savedState.qari) return;
    setScanning(true);
    setScanResult(null);
    try {
      const res = await fetch("/api/quran-audio/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reciterName: savedState.qari }),
      });
      const data = await res.json();
      if (res.ok) {
        setScanResult(data);
        await fetchEntries();
        await fetchConfig();
      } else {
        alert(data.error || "Scan failed");
      }
    } catch (err) {
      alert("Scan failed: " + (err instanceof Error ? err.message : "Unknown error"));
    }
    setScanning(false);
  };

  // ── Playback test: verifies the REAL stream pipeline end-to-end ──
  const runPlaybackTest = async () => {
    if (entries.length === 0) {
      setTestResult({ ok: false, message: "No indexed audio to test. Scan Google Drive first." });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const sample = entries[0];
      const res = await fetch(
        `/api/quran-audio/stream?id=${encodeURIComponent(sample.id)}`,
        { headers: { Range: "bytes=0-1" } }
      );
      const marker = res.headers.get("X-Error");
      const via = res.headers.get("X-Served-Via");
      if (res.ok) {
        setTestResult({
          ok: true,
          message: `✓ Playback OK — audio bytes reach the browser (via ${via || "stream"}). Visitors can play Quran audio.`,
        });
      } else if (marker === "drive-scope-reconnect-required") {
        setTestResult({
          ok: false,
          message:
            "✕ Google Drive authorization cannot download file content (the stored permission predates the required download scope). Click 'Reconnect Google Drive' below, approve the new permission, then Sync. Your folder and Qari settings are preserved.",
        });
      } else if (res.status === 404 || marker === "file-not-found") {
        setTestResult({
          ok: false,
          message: "✕ The audio file no longer exists in Google Drive. Re-sync the folder to update the index.",
        });
      } else {
        setTestResult({
          ok: false,
          message: `✕ Stream failed (HTTP ${res.status}${marker ? `, ${marker}` : ""}). Check server logs for details.`,
        });
      }
    } catch {
      setTestResult({ ok: false, message: "✕ Network error while testing playback." });
    }
    setTesting(false);
  };

  // ── Delete entry ──
  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this audio entry?")) return;
    setDeleting(id);
    try {
      const params = new URLSearchParams({ id });
      if (deleteFromDrive) params.set("deleteFromDrive", "true");
      const res = await fetch(`/api/quran-audio?${params.toString()}`, { method: "DELETE" });
      if (res.ok) { await fetchEntries(); }
      else { const data = await res.json(); alert(data.error || "Delete failed"); }
    } catch (error) { alert("Delete failed: " + (error instanceof Error ? error.message : "Unknown error")); }
    setDeleting(null);
  };

  const existingReciters = [...new Set(entries.map((e) => e.reciterName))];

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-white text-2xl font-bold mb-2">Quran Audio</h1>
        <p className="text-gray-400 text-sm">
          Connect your Google Drive folder containing Quran audio files. The system scans and indexes the files automatically.
        </p>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          SECTION 1: QURAN AUDIO SOURCE CONFIGURATION
          ═══════════════════════════════════════════════════════════ */}
      <div className="bg-gray-900 rounded-xl border border-white/10 p-6 mb-6">
        <div className="flex items-center gap-3 mb-5">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${savedState.connected ? "bg-emerald-600" : "bg-gray-700"}`}>
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <div>
            <h2 className="text-white font-semibold">Quran Audio Source</h2>
            <p className="text-gray-400 text-xs">
              {isConfigured
                ? "Configuration saved. You can scan/sync your Google Drive folder below."
                : "Set up your Google Drive connection and Qari to get started."
              }
            </p>
          </div>
        </div>

        {/* ── Google Drive Connection ── */}
        <div className="mb-4">
          <label className="block text-gray-400 text-xs mb-2 font-medium uppercase tracking-wider">
            Google Drive
          </label>
          {savedState.connected ? (
            <div className="bg-emerald-900/20 border border-emerald-500/30 rounded-lg p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-emerald-400 text-sm font-medium">✓ Connected</span>
                {savedState.email && (
                  <span className="text-gray-400 text-xs">— {savedState.email}</span>
                )}
              </div>
              <button
                onClick={handleDisconnectDrive}
                className="text-red-400 hover:text-red-300 text-xs"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={handleConnectDrive}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              {t("quran_drive_connect")}
            </button>
          )}
        </div>

        {/* ── Folder Selection ── */}
        {savedState.connected && (
          <div className="mb-4">
            <label className="block text-gray-400 text-xs mb-2 font-medium uppercase tracking-wider">
              Quran Audio Folder
            </label>
            {editFolderId ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-gray-800 border border-white/10 rounded-lg p-3 flex items-center gap-2">
                  <svg className="w-4 h-4 text-yellow-400 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                  </svg>
                  <span className="text-white text-sm truncate">{editFolderName || editFolderId}</span>
                  {editFolderId !== savedState.folderId && (
                    <span className="text-yellow-400 text-xs shrink-0">• changed</span>
                  )}
                </div>
                <button
                  onClick={openFolderBrowser}
                  className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-2.5 rounded-lg text-sm shrink-0"
                >
                  Change
                </button>
              </div>
            ) : (
              <button
                onClick={openFolderBrowser}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
              >
                Select Folder
              </button>
            )}
          </div>
        )}

        {/* ── Qari Selection ── */}
        {savedState.connected && (
          <div className="mb-5">
            <label className="block text-gray-400 text-xs mb-2 font-medium uppercase tracking-wider">
              Qari / Reciter *
            </label>
            {!editShowCustomQari ? (
              <div className="flex flex-wrap gap-2 items-center">
                <select
                  value={editQari}
                  onChange={(e) => setEditQari(e.target.value)}
                  className="bg-gray-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:border-emerald-500 focus:outline-none min-w-[280px]"
                >
                  <option value="">Select Qari</option>
                  {COMMON_QARIS.map((q) => (
                    <option key={q} value={q}>{q}</option>
                  ))}
                </select>
                <button
                  onClick={() => setEditShowCustomQari(true)}
                  className="text-emerald-400 hover:text-emerald-300 text-xs whitespace-nowrap"
                >
                  + Custom Qari
                </button>
                {effectiveEditQari !== savedState.qari && effectiveEditQari && (
                  <span className="text-yellow-400 text-xs">• changed</span>
                )}
              </div>
            ) : (
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={editCustomQari}
                  onChange={(e) => setEditCustomQari(e.target.value)}
                  placeholder="Enter qari name..."
                  className="bg-gray-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:border-emerald-500 focus:outline-none flex-1 max-w-md"
                />
                <button
                  onClick={() => { setEditShowCustomQari(false); setEditCustomQari(""); }}
                  className="text-gray-400 hover:text-white text-xs whitespace-nowrap"
                >
                  Use dropdown
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Save Button ── */}
        {savedState.connected && (
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving || !canSave}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              {saving ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Saving...
                </span>
              ) : (
                "Save"
              )}
            </button>
            {hasUnsavedChanges && !saving && (
              <span className="text-yellow-400 text-xs font-medium">Unsaved changes</span>
            )}
            {saveMessage && (
              <span className="text-emerald-400 text-xs">{saveMessage}</span>
            )}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════
          SECTION 2: CONFIGURATION DASHBOARD (shown after save)
          ═══════════════════════════════════════════════════════════ */}
      {isConfigured && (
        <div className="bg-gray-900 rounded-xl border border-white/10 p-6 mb-6">
          <h3 className="text-white font-semibold text-sm mb-4">Configuration Status</h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <div className="bg-gray-800 rounded-lg p-3">
              <p className="text-gray-400 text-xs mb-1">Folder</p>
              <p className="text-white text-sm font-medium truncate">{savedState.folderName || "—"}</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-3">
              <p className="text-gray-400 text-xs mb-1">Qari</p>
              <p className="text-white text-sm font-medium">{savedState.qari}</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-3">
              <p className="text-gray-400 text-xs mb-1">Last Sync</p>
              <p className="text-white text-sm font-medium">{formatDate(savedState.lastSync)}</p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleScan}
              disabled={scanning}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {scanning ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Scanning...
                </span>
              ) : savedState.lastSync ? (
                "Sync Google Drive"
              ) : (
                "Scan Google Drive"
              )}
            </button>
            <button
              onClick={openFolderBrowser}
              className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm transition-colors"
            >
              Change Folder
            </button>
            <button
              onClick={() => {
                setEditShowCustomQari(true);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm transition-colors"
            >
              Change Qari
            </button>
            <button
              onClick={runPlaybackTest}
              disabled={testing || entries.length === 0}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {testing ? "Testing..." : "Test Playback"}
            </button>
          </div>

          {/* Playback test result */}
          {testResult && (
            <div
              className={`mt-4 rounded-lg p-4 border ${
                testResult.ok
                  ? "bg-emerald-900/20 border-emerald-500/30"
                  : "bg-red-900/20 border-red-500/30"
              }`}
            >
              <p className={`text-sm ${testResult.ok ? "text-emerald-300" : "text-red-300"}`}>
                {testResult.message}
              </p>
              {!testResult.ok && testResult.message.includes("Reconnect") && (
                <button
                  onClick={handleConnectDrive}
                  className="mt-3 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  Reconnect Google Drive
                </button>
              )}
            </div>
          )}

          {/* Scan Result */}
          {scanResult && (
            <div className="mt-4 bg-gray-800 rounded-lg p-4">
              <h4 className="text-white text-sm font-medium mb-3">Scan Results</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-3">
                <div className="text-center">
                  <div className="text-lg font-bold text-white">{scanResult.totalFiles}</div>
                  <div className="text-xs text-gray-400">Total Files</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-emerald-400">{scanResult.indexed}</div>
                  <div className="text-xs text-gray-400">New Indexed</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-blue-400">{scanResult.totalInDatabase}</div>
                  <div className="text-xs text-gray-400">Total in DB</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-yellow-400">{scanResult.needsReview}</div>
                  <div className="text-xs text-gray-400">Needs Review</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-orange-400">{scanResult.duplicates}</div>
                  <div className="text-xs text-gray-400">Duplicates</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-red-400">{scanResult.deleted}</div>
                  <div className="text-xs text-gray-400">Removed</div>
                </div>
              </div>
              {scanResult.indexed > 0 && (
                <p className="text-emerald-400 text-xs">
                  ✓ {scanResult.indexed} new audio file(s) indexed successfully.
                </p>
              )}
              {scanResult.needsReview > 0 && (
                <p className="text-yellow-400 text-xs mt-1">
                  ⚠ {scanResult.needsReview} file(s) could not be auto-detected. Check filenames in your Google Drive folder.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          FOLDER BROWSER MODAL
          ═══════════════════════════════════════════════════════════ */}
      {showFolderBrowser && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 rounded-xl border border-white/10 w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-white font-semibold">{t("quran_drive_select_folder")}</h3>
              <button onClick={() => setShowFolderBrowser(false)} className="text-gray-400 hover:text-white">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 border-b border-white/10">
              <div className="flex gap-2">
                <input type="text" value={folderSearch} onChange={(e) => setFolderSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleFolderSearch()}
                  placeholder={t("quran_drive_search_folders")}
                  className="flex-1 bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-emerald-500 focus:outline-none" />
                <button onClick={handleFolderSearch} className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded-lg text-sm">Search</button>
              </div>
            </div>
            <div className="px-4 py-2 border-b border-white/10 text-xs text-gray-400 flex items-center gap-1">
              <button onClick={() => { setFolderSearchMode(false); setFolderSearch(""); loadFolders("root"); }} className="hover:text-emerald-400">
                {t("quran_drive_my_drive")}
              </button>
              {currentParentPath && currentParentPath !== "My Drive" && (<><span>/</span><span className="text-emerald-400">{currentParentPath}</span></>)}
            </div>
            <div className="flex-1 overflow-y-auto p-4 min-h-[200px]">
              {folderBrowsing ? (
                <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>
              ) : driveFolders.length === 0 ? (
                <div className="text-center py-8"><p className="text-gray-400 text-sm">{folderSearchMode ? "No folders found matching your search." : "No folders in this location."}</p></div>
              ) : (
                <div className="space-y-1">
                  {driveFolders.map((folder) => (
                    <button key={folder.id}
                      onClick={() => { setTempSelectedFolderId(folder.id); setTempSelectedFolderName(folder.name); }}
                      onDoubleClick={() => navigateIntoFolder(folder.id)}
                      className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${tempSelectedFolderId === folder.id ? "bg-emerald-600/20 border border-emerald-500/50" : "hover:bg-white/5 border border-transparent"}`}>
                      <svg className="w-5 h-5 text-yellow-400 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                      </svg>
                      <span className="min-w-0 flex-1 text-white text-sm truncate">{folder.name}</span>
                      <button onClick={(e) => { e.stopPropagation(); navigateIntoFolder(folder.id); }} className="text-gray-400 hover:text-white text-xs shrink-0">Open →</button>
                    </button>
                  ))}
                </div>
              )}
              {folderPageToken && !folderBrowsing && (
                <div className="flex justify-center mt-3">
                  <button onClick={() => loadFolders(folderSearchMode ? "root" : currentParentId, folderSearchMode ? folderSearch : undefined, folderPageToken)} className="text-emerald-400 hover:text-emerald-300 text-sm">Load more...</button>
                </div>
              )}
            </div>
            <div className="p-4 border-t border-white/10">
              {tempSelectedFolderId && (
                <div className="bg-gray-800 rounded-lg p-3 mb-3">
                  <p className="text-gray-400 text-xs">{t("quran_drive_selected_folder")}</p>
                  <p className="text-white text-sm font-medium">{tempSelectedFolderName || tempSelectedFolderId}</p>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowFolderBrowser(false)} className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm">Cancel</button>
                <button onClick={handleConfirmFolder} disabled={!tempSelectedFolderId}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                  {t("quran_drive_confirm_folder")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          SECTION 3: INDEXED AUDIO ENTRIES
          ═══════════════════════════════════════════════════════════ */}
      <div className="bg-gray-900 rounded-xl border border-white/10 overflow-hidden">
        <div className="p-4 border-b border-white/10 flex flex-wrap gap-3">
          <select value={filterSurah} onChange={(e) => setFilterSurah(e.target.value ? parseInt(e.target.value, 10) : "")}
            className="bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-emerald-500 focus:outline-none">
            <option value="">All Surahs</option>
            {SURAH_LIST.map((s) => (<option key={s.number} value={s.number}>{s.number}. {s.name}</option>))}
          </select>
          <select value={filterReciter} onChange={(e) => setFilterReciter(e.target.value)}
            className="bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-emerald-500 focus:outline-none">
            <option value="">All Reciters</option>
            {existingReciters.map((r) => (<option key={r} value={r}>{r}</option>))}
          </select>
          <span className="text-gray-500 text-sm self-center">{entries.length} audio file{entries.length !== 1 ? "s" : ""}</span>
        </div>
        {loadingEntries && (<div className="flex justify-center py-12"><div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>)}
        {!loadingEntries && entries.length === 0 && (
          <div className="text-center py-12">
            <svg className="w-12 h-12 text-gray-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
            <p className="text-gray-400">
              {isConfigured
                ? "No audio files indexed yet. Click \"Scan Google Drive\" above to index your files."
                : "Configure your Google Drive source and save to get started."
              }
            </p>
          </div>
        )}
        {!loadingEntries && entries.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 text-xs uppercase tracking-wider border-b border-white/10">
                  <th className="px-4 py-3">Surah</th>
                  <th className="px-4 py-3">Ayah</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Reciter</th>
                  <th className="px-4 py-3">File</th>
                  <th className="px-4 py-3">Size</th>
                  <th className="px-4 py-3">Drive</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3 text-white">
                      <div className="font-medium">{entry.surahName}</div>
                      <div className="text-gray-500 text-xs">#{entry.surahNumber}</div>
                    </td>
                    <td className="px-4 py-3 text-white">{entry.ayahNumber}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${entry.audioType === "full_surah" ? "bg-purple-500/10 text-purple-400" : "bg-blue-500/10 text-blue-400"}`}>
                        {entry.audioType === "full_surah" ? "Full Surah" : "Ayah"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-300">{entry.reciterName}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs max-w-[150px] truncate" title={entry.fileName}>{entry.fileName}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{formatFileSize(entry.fileSize)}</td>
                    <td className="px-4 py-3">
                      {entry.googleDriveUrl ? (
                        <a href={entry.googleDriveUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300 text-xs">View</a>
                      ) : (<span className="text-gray-600 text-xs">—</span>)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${entry.status === "active" ? "bg-emerald-500/10 text-emerald-400" : "bg-gray-500/10 text-gray-400"}`}>{entry.status}</span>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => handleDelete(entry.id)} disabled={deleting === entry.id}
                        className="text-red-400 hover:text-red-300 text-xs font-medium disabled:opacity-50">
                        {deleting === entry.id ? "Deleting..." : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delete Options */}
      <div className="mt-4 flex items-center gap-3 text-sm">
        <label className="flex items-center gap-2 text-gray-400 cursor-pointer">
          <input type="checkbox" checked={deleteFromDrive} onChange={(e) => setDeleteFromDrive(e.target.checked)}
            className="rounded border-gray-600 bg-gray-800 text-emerald-500 focus:ring-emerald-500" />
          Also delete files from Google Drive when deleting entries
        </label>
      </div>
    </div>
  );
}
