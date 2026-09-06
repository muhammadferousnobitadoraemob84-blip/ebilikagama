"use client";

import { useState, useEffect, useCallback } from "react";
import { useLanguage } from "@/components/LanguageProvider";

interface QuranAudioEntry {
  id: string;
  surahName: string;
  surahNumber: number;
  ayahNumber: number;
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
}

// Complete list of 114 Surahs
const SURAH_LIST = [
  { number: 1, name: "Al-Fatihah", arabic: "الفاتحة" },
  { number: 2, name: "Al-Baqarah", arabic: "البقرة" },
  { number: 3, name: "Ali 'Imran", arabic: "آل عمران" },
  { number: 4, name: "An-Nisa", arabic: "النساء" },
  { number: 5, name: "Al-Ma'idah", arabic: "المائدة" },
  { number: 6, name: "Al-An'am", arabic: "الأنعام" },
  { number: 7, name: "Al-A'raf", arabic: "الأعراف" },
  { number: 8, name: "Al-Anfal", arabic: "الأنفال" },
  { number: 9, name: "At-Tawbah", arabic: "التوبة" },
  { number: 10, name: "Yunus", arabic: "يونس" },
  { number: 11, name: "Hud", arabic: "هود" },
  { number: 12, name: "Yusuf", arabic: "يوسف" },
  { number: 13, name: "Ar-Ra'd", arabic: "الرعد" },
  { number: 14, name: "Ibrahim", arabic: "إبراهيم" },
  { number: 15, name: "Al-Hijr", arabic: "الحجر" },
  { number: 16, name: "An-Nahl", arabic: "النحل" },
  { number: 17, name: "Al-Isra", arabic: "الإسراء" },
  { number: 18, name: "Al-Kahf", arabic: "الكهف" },
  { number: 19, name: "Maryam", arabic: "مريم" },
  { number: 20, name: "Taha", arabic: "طه" },
  { number: 21, name: "Al-Anbiya", arabic: "الأنبياء" },
  { number: 22, name: "Al-Hajj", arabic: "الحج" },
  { number: 23, name: "Al-Mu'minun", arabic: "المؤمنون" },
  { number: 24, name: "An-Nur", arabic: "النور" },
  { number: 25, name: "Al-Furqan", arabic: "الفرقان" },
  { number: 26, name: "Ash-Shu'ara", arabic: "الشعراء" },
  { number: 27, name: "An-Naml", arabic: "النمل" },
  { number: 28, name: "Al-Qasas", arabic: "القصص" },
  { number: 29, name: "Al-Ankabut", arabic: "العنكبوت" },
  { number: 30, name: "Ar-Rum", arabic: "الروم" },
  { number: 31, name: "Luqman", arabic: "لقمان" },
  { number: 32, name: "As-Sajdah", arabic: "السجدة" },
  { number: 33, name: "Al-Ahzab", arabic: "الأحزاب" },
  { number: 34, name: "Saba", arabic: "سبأ" },
  { number: 35, name: "Fatir", arabic: "فاطر" },
  { number: 36, name: "Ya-Sin", arabic: "يس" },
  { number: 37, name: "As-Saffat", arabic: "الصافات" },
  { number: 38, name: "Sad", arabic: "ص" },
  { number: 39, name: "Az-Zumar", arabic: "الزمر" },
  { number: 40, name: "Ghafir", arabic: "غافر" },
  { number: 41, name: "Fussilat", arabic: "فصلت" },
  { number: 42, name: "Ash-Shura", arabic: "الشورى" },
  { number: 43, name: "Az-Zukhruf", arabic: "الزخرف" },
  { number: 44, name: "Ad-Dukhan", arabic: "الدخان" },
  { number: 45, name: "Al-Jathiyah", arabic: "الجاثية" },
  { number: 46, name: "Al-Ahqaf", arabic: "الأحقاف" },
  { number: 47, name: "Muhammad", arabic: "محمد" },
  { number: 48, name: "Al-Fath", arabic: "الفتح" },
  { number: 49, name: "Al-Hujurat", arabic: "الحجرات" },
  { number: 50, name: "Qaf", arabic: "ق" },
  { number: 51, name: "Adh-Dhariyat", arabic: "الذاريات" },
  { number: 52, name: "At-Tur", arabic: "الطور" },
  { number: 53, name: "An-Najm", arabic: "النجم" },
  { number: 54, name: "Al-Qamar", arabic: "القمر" },
  { number: 55, name: "Ar-Rahman", arabic: "الرحمن" },
  { number: 56, name: "Al-Waqi'ah", arabic: "الواقعة" },
  { number: 57, name: "Al-Hadid", arabic: "الحديد" },
  { number: 58, name: "Al-Mujadilah", arabic: "المجادلة" },
  { number: 59, name: "Al-Hashr", arabic: "الحشر" },
  { number: 60, name: "Al-Mumtahanah", arabic: "الممتحنة" },
  { number: 61, name: "As-Saf", arabic: "الصف" },
  { number: 62, name: "Al-Jumu'ah", arabic: "الجمعة" },
  { number: 63, name: "Al-Munafiqun", arabic: "المنافقون" },
  { number: 64, name: "At-Taghabun", arabic: "التغابن" },
  { number: 65, name: "At-Talaq", arabic: "الطلاق" },
  { number: 66, name: "At-Tahrim", arabic: "التحريم" },
  { number: 67, name: "Al-Mulk", arabic: "الملك" },
  { number: 68, name: "Al-Qalam", arabic: "القلم" },
  { number: 69, name: "Al-Haqqah", arabic: "الحاقة" },
  { number: 70, name: "Al-Ma'arij", arabic: "المعارج" },
  { number: 71, name: "Nuh", arabic: "نوح" },
  { number: 72, name: "Al-Jinn", arabic: "الجن" },
  { number: 73, name: "Al-Muzzammil", arabic: "المزمل" },
  { number: 74, name: "Al-Muddaththir", arabic: "المدثر" },
  { number: 75, name: "Al-Qiyamah", arabic: "القيامة" },
  { number: 76, name: "Al-Insan", arabic: "الإنسان" },
  { number: 77, name: "Al-Mursalat", arabic: "المرسلات" },
  { number: 78, name: "An-Naba", arabic: "النبأ" },
  { number: 79, name: "An-Nazi'at", arabic: "النازعات" },
  { number: 80, name: "Abasa", arabic: "عبس" },
  { number: 81, name: "At-Takwir", arabic: "التكوير" },
  { number: 82, name: "Al-Infitar", arabic: "الإنفطار" },
  { number: 83, name: "Al-Mutaffifin", arabic: "المطففين" },
  { number: 84, name: "Al-Inshiqaq", arabic: "الانشقاق" },
  { number: 85, name: "Al-Buruj", arabic: "البروج" },
  { number: 86, name: "At-Tariq", arabic: "الطارق" },
  { number: 87, name: "Al-A'la", arabic: "الأعلى" },
  { number: 88, name: "Al-Ghashiyah", arabic: "الغاشية" },
  { number: 89, name: "Al-Fajr", arabic: "الفجر" },
  { number: 90, name: "Al-Balad", arabic: "البلد" },
  { number: 91, name: "Ash-Shams", arabic: "الشمس" },
  { number: 92, name: "Al-Layl", arabic: "الليل" },
  { number: 93, name: "Ad-Duhaa", arabic: "الضحى" },
  { number: 94, name: "Ash-Sharh", arabic: "الشرح" },
  { number: 95, name: "At-Tin", arabic: "التين" },
  { number: 96, name: "Al-Alaq", arabic: "العلق" },
  { number: 97, name: "Al-Qadr", arabic: "القدر" },
  { number: 98, name: "Al-Bayyinah", arabic: "البينة" },
  { number: 99, name: "Az-Zalzalah", arabic: "الزلزلة" },
  { number: 100, name: "Al-Adiyat", arabic: "العاديات" },
  { number: 101, name: "Al-Qari'ah", arabic: "القارعة" },
  { number: 102, name: "At-Takathur", arabic: "التكاثر" },
  { number: 103, name: "Al-Asr", arabic: "العصر" },
  { number: 104, name: "Al-Humazah", arabic: "الهمزة" },
  { number: 105, name: "Al-Fil", arabic: "الفيل" },
  { number: 106, name: "Quraysh", arabic: "قريش" },
  { number: 107, name: "Al-Ma'un", arabic: "الماعون" },
  { number: 108, name: "Al-Kawthar", arabic: "الكوثر" },
  { number: 109, name: "Al-Kafirun", arabic: "الكافرون" },
  { number: 110, name: "An-Nasr", arabic: "النصر" },
  { number: 111, name: "Al-Masad", arabic: "المسد" },
  { number: 112, name: "Al-Ikhlas", arabic: "الإخلاص" },
  { number: 113, name: "Al-Falaq", arabic: "الفلق" },
  { number: 114, name: "An-Nas", arabic: "الناس" },
];

const COMMON_RECITERS = [
  "Mishary Rashid Alafasy",
  "Abdul Basit Abdul Samad",
  "Saud Al-Shuraim",
  "Maher Al Muaiqly",
  "Abdul Rahman Al-Sudais",
  "Sudais & Shuraim",
  "Abu Bakr Al Shatri",
  "Hani Ar-Rifai",
  "Ahmed Al Ajmi",
  "Muhammad Jibril",
  "Yasser Al-Dosari",
  "Nasser Al Qatami",
  "Ali Jaber",
  "Faisal Ghazzawi",
  "Tareq Al Ghalib",
  "Khalid Al-Qahtani",
  "Ayyub Al-Qushayri",
  "Husary (Mujawwad)",
  "Minshawi (Mujawwad)",
  "Minshawi",
];

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

export default function QuranAudioPage() {
  const { t } = useLanguage();

  // Google Drive state
  const [folderState, setFolderState] = useState<FolderState>({
    connected: false,
    email: null,
    folderId: null,
    folderName: "",
  });
  const [folderLoading, setFolderLoading] = useState(true);
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const [driveFolders, setDriveFolders] = useState<DriveFolder[]>([]);
  const [folderBrowsing, setFolderBrowsing] = useState(false);
  const [currentParentId, setCurrentParentId] = useState("root");
  const [currentParentPath, setCurrentParentPath] = useState("");
  const [folderPageToken, setFolderPageToken] = useState<string | null>(null);
  const [folderSearch, setFolderSearch] = useState("");
  const [folderSearchMode, setFolderSearchMode] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedFolderName, setSelectedFolderName] = useState("");
  const [savingFolder, setSavingFolder] = useState(false);
  const [folderMessage, setFolderMessage] = useState("");

  // Audio entries state
  const [entries, setEntries] = useState<QuranAudioEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Form state
  const [surahNumber, setSurahNumber] = useState(1);
  const [ayahNumber, setAyahNumber] = useState(1);
  const [reciterName, setReciterName] = useState(COMMON_RECITERS[0]);
  const [customReciter, setCustomReciter] = useState("");
  const [useCustomReciter, setUseCustomReciter] = useState(false);

  // Filter state
  const [filterSurah, setFilterSurah] = useState<number | "">("");
  const [filterReciter, setFilterReciter] = useState("");

  // Delete state
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteFromDrive, setDeleteFromDrive] = useState(false);

  // ── Load Google Drive folder state ──
  const fetchFolderState = useCallback(async () => {
    try {
      const res = await fetch("/api/quran-audio/folder");
      if (res.ok) {
        const data = await res.json();
        setFolderState(data);
      }
    } catch {
      // Error
    } finally {
      setFolderLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFolderState();
  }, [fetchFolderState]);

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
    } catch {
      // Error
    } finally {
      setLoading(false);
    }
  }, [filterSurah, filterReciter]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // ── Google Drive OAuth ──
  const handleConnectDrive = () => {
    window.location.href = "/api/google-drive/auth";
  };

  const handleDisconnectDrive = async () => {
    if (!confirm("Disconnect Google Drive? Existing audio files will not be deleted.")) return;
    try {
      await fetch("/api/quran-audio/folder", { method: "DELETE" });
      await fetch("/api/google-drive/disconnect", { method: "POST" });
      await fetchFolderState();
    } catch {
      // Error
    }
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
    } catch {
      // Error
    } finally {
      setFolderBrowsing(false);
    }
  }, []);

  const openFolderBrowser = () => {
    setShowFolderBrowser(true);
    setSelectedFolderId(folderState.folderId);
    setSelectedFolderName(folderState.folderName);
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

  const navigateUp = () => {
    // Navigate to parent of current
    // We'll just go to root for simplicity since we don't track full breadcrumb
    if (currentParentPath.includes("/")) {
      const parts = currentParentPath.split("/");
      parts.pop();
      if (parts.length > 0) {
        // We don't have the parent ID easily, so navigate to root
        loadFolders("root");
      } else {
        loadFolders("root");
      }
    } else {
      loadFolders("root");
    }
  };

  const handleSaveFolder = async () => {
    if (!selectedFolderId) return;
    setSavingFolder(true);
    try {
      const res = await fetch("/api/quran-audio/folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId: selectedFolderId, folderName: selectedFolderName }),
      });
      const data = await res.json();
      if (res.ok) {
        setFolderState((prev) => ({
          ...prev,
          folderId: selectedFolderId,
          folderName: selectedFolderName,
        }));
        setShowFolderBrowser(false);
        setFolderMessage(t("quran_drive_folder_saved"));
        setTimeout(() => setFolderMessage(""), 3000);
      } else {
        alert(data.error || "Failed to save folder");
      }
    } catch {
      alert("Failed to save folder");
    } finally {
      setSavingFolder(false);
    }
  };

  // ── File upload ──
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.match(/\.(mp3|m4a|ogg|wav|webm)$/i)) {
        alert("Invalid file type. Allowed: MP3, M4A, OGG, WAV, WebM");
        e.target.value = "";
        return;
      }
      if (file.size > 50 * 1024 * 1024) {
        alert("File too large. Maximum size: 50MB");
        e.target.value = "";
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleUpload = async () => {
    if (!folderState.folderId) {
      alert(t("quran_drive_no_folder"));
      return;
    }
    if (!selectedFile) {
      alert("Please select an audio file first.");
      return;
    }
    const finalReciter = useCustomReciter ? customReciter : reciterName;
    if (!finalReciter.trim()) {
      alert("Please enter or select a reciter name.");
      return;
    }
    const surah = SURAH_LIST.find((s) => s.number === surahNumber);
    if (!surah) {
      alert("Invalid surah number.");
      return;
    }

    setUploading(true);
    setUploadProgress("Preparing upload...");

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("surahName", surah.name);
      formData.append("surahNumber", String(surahNumber));
      formData.append("ayahNumber", String(ayahNumber));
      formData.append("reciterName", finalReciter.trim());

      setUploadProgress("Uploading to Google Drive...");

      const res = await fetch("/api/quran-audio", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Upload failed");
        return;
      }

      setUploadProgress("Upload successful!");
      setSelectedFile(null);
      setAyahNumber(1);
      const fileInput = document.getElementById("audio-file-input") as HTMLInputElement;
      if (fileInput) fileInput.value = "";
      await fetchEntries();
    } catch (error) {
      alert("Upload failed: " + (error instanceof Error ? error.message : "Unknown error"));
    } finally {
      setUploading(false);
      setUploadProgress("");
    }
  };

  // ── Delete ──
  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this audio entry?")) return;
    setDeleting(id);
    try {
      const params = new URLSearchParams({ id });
      if (deleteFromDrive) params.set("deleteFromDrive", "true");
      const res = await fetch(`/api/quran-audio?${params.toString()}`, { method: "DELETE" });
      if (res.ok) {
        await fetchEntries();
      } else {
        const data = await res.json();
        alert(data.error || "Delete failed");
      }
    } catch (error) {
      alert("Delete failed: " + (error instanceof Error ? error.message : "Unknown error"));
    } finally {
      setDeleting(null);
    }
  };

  const existingReciters = [...new Set(entries.map((e) => e.reciterName))];
  const selectedSurahInfo = SURAH_LIST.find((s) => s.number === surahNumber);
  const hasConnectedDrive = folderState.connected;
  const hasFolder = !!folderState.folderId;

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-white text-2xl font-bold mb-2">Quran Audio</h1>
        <p className="text-gray-400 text-sm">
          Manage Quran audio files stored in Google Drive.
        </p>
      </div>

      {/* Google Drive Connection */}
      <div className="bg-gray-900 rounded-xl border border-white/10 p-6 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              hasConnectedDrive ? "bg-emerald-600" : "bg-gray-700"
            }`}>
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <div>
              <h2 className="text-white font-semibold">Google Drive</h2>
              <p className="text-gray-400 text-xs">
                {hasConnectedDrive
                  ? `${t("quran_drive_connected")}: ${folderState.email}`
                  : t("quran_drive_not_connected")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!hasConnectedDrive ? (
              <button
                onClick={handleConnectDrive}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                {t("quran_drive_connect")}
              </button>
            ) : (
              <>
                <button
                  onClick={handleDisconnectDrive}
                  className="bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-2 rounded-lg text-xs transition-colors"
                >
                  {t("quran_drive_disconnect")}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Folder Selection (only when connected) */}
      {hasConnectedDrive && (
        <div className="bg-gray-900 rounded-xl border border-white/10 p-6 mb-6">
          <div className="flex items-center justify-between flex-wrap gap-4 mb-3">
            <div>
              <h3 className="text-white font-semibold text-sm">
                {t("quran_drive_select_folder")}
              </h3>
              <p className="text-gray-400 text-xs">
                {t("quran_drive_select_folder_desc")}
              </p>
            </div>
            <button
              onClick={openFolderBrowser}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {hasFolder ? t("quran_drive_change_folder") : t("quran_drive_select_folder")}
            </button>
          </div>
          {hasFolder && (
            <div className="bg-emerald-900/20 border border-emerald-500/30 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <span className="text-emerald-400 text-sm font-medium">
                  {t("quran_drive_selected_folder")}: {folderState.folderName || folderState.folderId}
                </span>
              </div>
            </div>
          )}
          {!hasFolder && (
            <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-3">
              <p className="text-yellow-400 text-sm">{t("quran_drive_no_folder")}</p>
            </div>
          )}
          {folderMessage && (
            <div className="mt-3 bg-emerald-900/20 border border-emerald-500/30 rounded-lg p-3">
              <p className="text-emerald-400 text-sm">{folderMessage}</p>
            </div>
          )}
        </div>
      )}

      {/* Folder Browser Modal */}
      {showFolderBrowser && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 rounded-xl border border-white/10 w-full max-w-2xl max-h-[80vh] flex flex-col">
            {/* Modal Header */}
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-white font-semibold">{t("quran_drive_select_folder")}</h3>
              <button
                onClick={() => setShowFolderBrowser(false)}
                className="text-gray-400 hover:text-white"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Search */}
            <div className="p-4 border-b border-white/10">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={folderSearch}
                  onChange={(e) => setFolderSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleFolderSearch()}
                  placeholder={t("quran_drive_search_folders")}
                  className="flex-1 bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-emerald-500 focus:outline-none"
                />
                <button
                  onClick={handleFolderSearch}
                  className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded-lg text-sm"
                >
                  Search
                </button>
              </div>
            </div>

            {/* Breadcrumb */}
            <div className="px-4 py-2 border-b border-white/10 text-xs text-gray-400 flex items-center gap-1">
              <button
                onClick={() => {
                  setFolderSearchMode(false);
                  setFolderSearch("");
                  loadFolders("root");
                }}
                className="hover:text-emerald-400"
              >
                {t("quran_drive_my_drive")}
              </button>
              {currentParentPath && currentParentPath !== "My Drive" && (
                <>
                  <span>/</span>
                  <span className="text-emerald-400">{currentParentPath}</span>
                </>
              )}
            </div>

            {/* Folder List */}
            <div className="flex-1 overflow-y-auto p-4 min-h-[200px]">
              {folderBrowsing ? (
                <div className="flex justify-center py-8">
                  <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : driveFolders.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-400 text-sm">
                    {folderSearchMode ? "No folders found matching your search." : "No folders in this location."}
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  {driveFolders.map((folder) => (
                    <button
                      key={folder.id}
                      onClick={() => {
                        setSelectedFolderId(folder.id);
                        setSelectedFolderName(folder.name);
                      }}
                      onDoubleClick={() => navigateIntoFolder(folder.id)}
                      className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                        selectedFolderId === folder.id
                          ? "bg-emerald-600/20 border border-emerald-500/50"
                          : "hover:bg-white/5 border border-transparent"
                      }`}
                    >
                      <svg className="w-5 h-5 text-yellow-400 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                      </svg>
                      <div className="min-w-0 flex-1">
                        <span className="text-white text-sm truncate block">{folder.name}</span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigateIntoFolder(folder.id);
                        }}
                        className="text-gray-400 hover:text-white text-xs shrink-0"
                      >
                        Open →
                      </button>
                    </button>
                  ))}
                </div>
              )}

              {/* Load more */}
              {folderPageToken && !folderBrowsing && (
                <div className="flex justify-center mt-3">
                  <button
                    onClick={() =>
                      loadFolders(
                        folderSearchMode ? "root" : currentParentId,
                        folderSearchMode ? folderSearch : undefined,
                        folderPageToken
                      )
                    }
                    className="text-emerald-400 hover:text-emerald-300 text-sm"
                  >
                    Load more...
                  </button>
                </div>
              )}
            </div>

            {/* Selected folder + Confirm */}
            <div className="p-4 border-t border-white/10">
              {selectedFolderId && (
                <div className="bg-gray-800 rounded-lg p-3 mb-3">
                  <p className="text-gray-400 text-xs">{t("quran_drive_selected_folder")}</p>
                  <p className="text-white text-sm font-medium">{selectedFolderName || selectedFolderId}</p>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowFolderBrowser(false)}
                  className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveFolder}
                  disabled={!selectedFolderId || savingFolder}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  {savingFolder ? "Saving..." : t("quran_drive_confirm_folder")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Upload Section (only when folder is selected) */}
      {hasFolder && (
        <div className="bg-gray-900 rounded-xl border border-white/10 p-6 mb-8">
          <h2 className="text-white text-lg font-semibold mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Upload New Audio
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-gray-400 text-xs mb-1.5 font-medium uppercase tracking-wider">Surah *</label>
              <select
                value={surahNumber}
                onChange={(e) => setSurahNumber(parseInt(e.target.value, 10))}
                className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:border-emerald-500 focus:outline-none"
              >
                {SURAH_LIST.map((s) => (
                  <option key={s.number} value={s.number}>{s.number}. {s.name} ({s.arabic})</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-gray-400 text-xs mb-1.5 font-medium uppercase tracking-wider">Ayah Number *</label>
              <input
                type="number"
                min={1}
                value={ayahNumber}
                onChange={(e) => setAyahNumber(parseInt(e.target.value, 10) || 1)}
                className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-gray-400 text-xs mb-1.5 font-medium uppercase tracking-wider">Reciter *</label>
              <div className="flex gap-2">
                <select
                  value={useCustomReciter ? "custom" : reciterName}
                  onChange={(e) => {
                    if (e.target.value === "custom") {
                      setUseCustomReciter(true);
                    } else {
                      setUseCustomReciter(false);
                      setReciterName(e.target.value);
                    }
                  }}
                  className="flex-1 bg-gray-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:border-emerald-500 focus:outline-none"
                >
                  {COMMON_RECITERS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                  <option value="custom">Custom...</option>
                </select>
              </div>
              {useCustomReciter && (
                <input
                  type="text"
                  value={customReciter}
                  onChange={(e) => setCustomReciter(e.target.value)}
                  placeholder="Enter reciter name"
                  className="mt-2 w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:border-emerald-500 focus:outline-none"
                />
              )}
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-gray-400 text-xs mb-1.5 font-medium uppercase tracking-wider">
              Audio File * (MP3, M4A, OGG, WAV, WebM — max 50MB)
            </label>
            <input
              id="audio-file-input"
              type="file"
              accept=".mp3,.m4a,.ogg,.wav,.webm,audio/*"
              onChange={handleFileSelect}
              className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-emerald-600 file:text-white file:font-medium file:text-sm file:cursor-pointer hover:file:bg-emerald-700"
            />
            {selectedFile && (
              <p className="text-gray-400 text-sm mt-1">Selected: {selectedFile.name} ({formatFileSize(selectedFile.size)})</p>
            )}
          </div>

          {selectedSurahInfo && (
            <div className="bg-gray-800/50 rounded-lg p-3 mb-4 text-sm">
              <span className="text-gray-400">Preview: </span>
              <span className="text-white font-medium">{selectedSurahInfo.name} — Ayah {ayahNumber}</span>
              <span className="text-gray-400"> by </span>
              <span className="text-emerald-400">{useCustomReciter ? customReciter : reciterName}</span>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={handleUpload}
              disabled={uploading || !selectedFile}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              {uploading ? "Uploading..." : "Upload to Google Drive"}
            </button>
            {uploadProgress && (
              <span className="text-gray-400 text-sm">{uploadProgress}</span>
            )}
          </div>
        </div>
      )}

      {/* Audio Entries List */}
      <div className="bg-gray-900 rounded-xl border border-white/10 overflow-hidden">
        <div className="p-4 border-b border-white/10 flex flex-wrap gap-3">
          <select
            value={filterSurah}
            onChange={(e) => setFilterSurah(e.target.value ? parseInt(e.target.value, 10) : "")}
            className="bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-emerald-500 focus:outline-none"
          >
            <option value="">All Surahs</option>
            {SURAH_LIST.map((s) => (
              <option key={s.number} value={s.number}>{s.number}. {s.name}</option>
            ))}
          </select>
          <select
            value={filterReciter}
            onChange={(e) => setFilterReciter(e.target.value)}
            className="bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-emerald-500 focus:outline-none"
          >
            <option value="">All Reciters</option>
            {existingReciters.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <span className="text-gray-500 text-sm self-center">
            {entries.length} audio file{entries.length !== 1 ? "s" : ""}
          </span>
        </div>

        {loading && (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && entries.length === 0 && (
          <div className="text-center py-12">
            <svg className="w-12 h-12 text-gray-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
            <p className="text-gray-400">No Quran audio files uploaded yet.</p>
          </div>
        )}

        {!loading && entries.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 text-xs uppercase tracking-wider border-b border-white/10">
                  <th className="px-4 py-3">Surah</th>
                  <th className="px-4 py-3">Ayah</th>
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
                    <td className="px-4 py-3 text-gray-300">{entry.reciterName}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs max-w-[150px] truncate" title={entry.fileName}>{entry.fileName}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{formatFileSize(entry.fileSize)}</td>
                    <td className="px-4 py-3">
                      {entry.googleDriveUrl ? (
                        <a href={entry.googleDriveUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300 text-xs">View</a>
                      ) : (
                        <span className="text-gray-600 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        entry.status === "active" ? "bg-emerald-500/10 text-emerald-400" : "bg-gray-500/10 text-gray-400"
                      }`}>{entry.status}</span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleDelete(entry.id)}
                        disabled={deleting === entry.id}
                        className="text-red-400 hover:text-red-300 text-xs font-medium disabled:opacity-50"
                      >
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
          <input
            type="checkbox"
            checked={deleteFromDrive}
            onChange={(e) => setDeleteFromDrive(e.target.checked)}
            className="rounded border-gray-600 bg-gray-800 text-emerald-500 focus:ring-emerald-500"
          />
          Also delete files from Google Drive when deleting entries
        </label>
      </div>
    </div>
  );
}
