"use client";

import { useState, useCallback } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { parseQuranFilename, getSurahList, type ParsedQuranFile } from "@/lib/quran-filename-parser";

interface BulkFile {
  file: File;
  parsed: ParsedQuranFile;
  manuallySurah?: number;
  manuallyAyah?: number;
  overrideSurah?: number;
  overrideAyah?: number;
}

interface BulkUploadResult {
  fileName: string;
  originalName: string;
  status: "pending" | "uploading" | "success" | "error" | "skipped";
  error?: string;
}

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

const SURAH_LIST = getSurahList();

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type UploadPhase = "select" | "review" | "uploading" | "complete";

export default function BulkQuranUpload({ onUploadComplete }: { onUploadComplete: () => void }) {
  const { t } = useLanguage();

  const [phase, setPhase] = useState<UploadPhase>("select");
  const [files, setFiles] = useState<BulkFile[]>([]);
  const [reciterName, setReciterName] = useState(COMMON_RECITERS[0]);
  const [customReciter, setCustomReciter] = useState("");
  const [useCustomReciter, setUseCustomReciter] = useState(false);
  const [duplicateAction, setDuplicateAction] = useState<"skip" | "replace">("skip");
  const [uploadResults, setUploadResults] = useState<BulkUploadResult[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showAddReciter, setShowAddReciter] = useState(false);
  const [newReciterName, setNewReciterName] = useState("");
  const [customReciters, setCustomReciters] = useState<string[]>([]);

  // Handle file selection
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const audioFiles: BulkFile[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      if (file.name.match(/\.(mp3|m4a|ogg|wav|webm)$/i)) {
        audioFiles.push({
          file,
          parsed: parseQuranFilename(file.name),
        });
      }
    }

    // Sort by surah number then ayah number
    audioFiles.sort((a, b) => {
      const aNum = a.parsed.surahNumber || 0;
      const bNum = b.parsed.surahNumber || 0;
      if (aNum !== bNum) return aNum - bNum;
      return (a.parsed.ayahNumber || 0) - (b.parsed.ayahNumber || 0);
    });

    setFiles(audioFiles);
    setPhase("review");
  }, []);

  // Update manual surah override for a file
  const updateFileSurah = (index: number, surahNumber: number) => {
    setFiles((prev) => {
      const updated = [...prev];
      const surah = SURAH_LIST.find((s) => s.number === surahNumber);
      updated[index] = {
        ...updated[index],
        overrideSurah: surahNumber,
        overrideAyah: updated[index].overrideAyah || 1,
        parsed: {
          ...updated[index].parsed,
          surahNumber,
          surahName: surah?.name || "Unknown",
          status: "detected",
        },
      };
      return updated;
    });
  };

  // Update manual ayah override
  const updateFileAyah = (index: number, ayah: number) => {
    setFiles((prev) => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        overrideAyah: ayah,
        parsed: {
          ...updated[index].parsed,
          ayahNumber: ayah,
          audioType: "ayah",
          status: "detected",
        },
      };
      return updated;
    });
  };

  // Add custom reciter
  const handleAddReciter = () => {
    if (newReciterName.trim()) {
      setCustomReciters((prev) => [...prev, newReciterName.trim()]);
      setReciterName(newReciterName.trim());
      setUseCustomReciter(true);
      setNewReciterName("");
      setShowAddReciter(false);
    }
  };

  // Start bulk upload
  const handleUpload = async () => {
    const finalReciter = useCustomReciter ? customReciter : reciterName;
    if (!finalReciter.trim()) return;

    setPhase("uploading");
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append("reciterName", finalReciter.trim());
      formData.append("duplicateAction", duplicateAction);

      for (const bf of files) {
        formData.append("files", bf.file);
      }

      setUploadProgress(10);

      const res = await fetch("/api/quran-audio/bulk", {
        method: "POST",
        body: formData,
      });

      setUploadProgress(90);

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Bulk upload failed");
        setPhase("review");
        return;
      }

      setUploadResults(data.files || []);
      setUploadProgress(100);
      setPhase("complete");
      onUploadComplete();
    } catch (error) {
      alert("Upload failed: " + (error instanceof Error ? error.message : "Unknown error"));
      setPhase("review");
    }
  };

  // Reset
  const handleReset = () => {
    setPhase("select");
    setFiles([]);
    setUploadResults([]);
    setUploadProgress(0);
  };

  // Compute stats
  const detectedCount = files.filter((f) => f.parsed.status === "detected").length;
  const needsReviewCount = files.filter((f) => f.parsed.status === "needs_review").length;
  const finalReciter = useCustomReciter ? customReciter : reciterName;

  // ── Phase: SELECT ──
  if (phase === "select") {
    return (
      <div className="bg-gray-900 rounded-xl border border-white/10 p-6 mb-6">
        <h2 className="text-white text-lg font-semibold mb-2 flex items-center gap-2">
          <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          {t("quran_bulk_title")}
        </h2>
        <p className="text-gray-400 text-sm mb-4">{t("quran_bulk_subtitle")}</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {/* Reciter Selection */}
          <div>
            <label className="block text-gray-400 text-xs mb-1.5 font-medium uppercase tracking-wider">
              {t("quran_bulk_select_reciter")}
            </label>
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
              className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:border-emerald-500 focus:outline-none"
            >
              {[...COMMON_RECITERS, ...customReciters].map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
              <option value="custom">{t("quran_bulk_add_reciter")}</option>
            </select>
            {useCustomReciter && (
              <input
                type="text"
                value={customReciter}
                onChange={(e) => setCustomReciter(e.target.value)}
                placeholder={t("quran_bulk_reciter_name")}
                className="mt-2 w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:border-emerald-500 focus:outline-none"
              />
            )}
          </div>

          {/* Duplicate Action */}
          <div>
            <label className="block text-gray-400 text-xs mb-1.5 font-medium uppercase tracking-wider">
              {t("quran_bulk_skip_duplicates")}
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setDuplicateAction("skip")}
                className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  duplicateAction === "skip"
                    ? "bg-emerald-600 text-white"
                    : "bg-gray-800 text-gray-400 border border-white/10"
                }`}
              >
                {t("quran_bulk_skip_duplicates")}
              </button>
              <button
                onClick={() => setDuplicateAction("replace")}
                className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  duplicateAction === "replace"
                    ? "bg-yellow-600 text-white"
                    : "bg-gray-800 text-gray-400 border border-white/10"
                }`}
              >
                {t("quran_bulk_replace_duplicates")}
              </button>
            </div>
          </div>
        </div>

        {/* File selection */}
        <div>
          <label className="block text-gray-400 text-xs mb-1.5 font-medium uppercase tracking-wider">
            {t("quran_bulk_select_files")}
          </label>
          <input
            type="file"
            multiple
            accept=".mp3,.m4a,.ogg,.wav,.webm,audio/*"
            onChange={handleFileSelect}
            className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-emerald-600 file:text-white file:font-medium file:text-sm file:cursor-pointer hover:file:bg-emerald-700"
          />
          <p className="text-gray-500 text-xs mt-1">Supports MP3, M4A, OGG, WAV, WebM. Max 50MB per file, 200 files total.</p>
        </div>
      </div>
    );
  }

  // ── Phase: REVIEW ──
  if (phase === "review") {
    return (
      <div className="bg-gray-900 rounded-xl border border-white/10 p-6 mb-6">
        <h2 className="text-white text-lg font-semibold mb-4 flex items-center gap-2">
          <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          {t("quran_bulk_review")}
        </h2>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="bg-gray-800 rounded-lg p-3 text-center">
            <div className="text-white text-xl font-bold">{files.length}</div>
            <div className="text-gray-400 text-xs">{t("quran_bulk_total_files")}</div>
          </div>
          <div className="bg-emerald-900/20 rounded-lg p-3 text-center">
            <div className="text-emerald-400 text-xl font-bold">{detectedCount}</div>
            <div className="text-gray-400 text-xs">{t("quran_bulk_detected")}</div>
          </div>
          <div className="bg-yellow-900/20 rounded-lg p-3 text-center">
            <div className="text-yellow-400 text-xl font-bold">{needsReviewCount}</div>
            <div className="text-gray-400 text-xs">{t("quran_bulk_needs_review")}</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-3 text-center">
            <div className="text-white text-sm font-medium">{finalReciter || "—"}</div>
            <div className="text-gray-400 text-xs">{t("quran_bulk_select_reciter")}</div>
          </div>
        </div>

        {/* File Table */}
        <div className="max-h-[400px] overflow-y-auto mb-4 border border-white/10 rounded-lg">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-800">
              <tr className="text-left text-gray-400 text-xs uppercase tracking-wider">
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">{t("quran_bulk_file")}</th>
                <th className="px-3 py-2">{t("quran_bulk_detected_surah")}</th>
                <th className="px-3 py-2">Ayah</th>
                <th className="px-3 py-2">{t("quran_bulk_status")}</th>
              </tr>
            </thead>
            <tbody>
              {files.map((bf, i) => {
                const needsReview = bf.parsed.status === "needs_review";
                return (
                  <tr key={i} className={`border-t border-white/5 ${needsReview ? "bg-yellow-900/10" : ""}`}>
                    <td className="px-3 py-2 text-gray-500 text-xs">{i + 1}</td>
                    <td className="px-3 py-2 text-white text-xs max-w-[200px] truncate" title={bf.file.name}>
                      {bf.file.name}
                      <span className="text-gray-500 ml-1">({formatFileSize(bf.file.size)})</span>
                    </td>
                    <td className="px-3 py-2">
                      {needsReview ? (
                        <select
                          value={bf.overrideSurah || bf.parsed.surahNumber || ""}
                          onChange={(e) => updateFileSurah(i, parseInt(e.target.value, 10))}
                          className="bg-gray-800 border border-yellow-500/30 rounded px-2 py-1 text-white text-xs w-full max-w-[200px]"
                        >
                          <option value="">Select...</option>
                          {SURAH_LIST.map((s) => (
                            <option key={s.number} value={s.number}>{s.number}. {s.name}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-white text-xs">
                          {bf.parsed.surahName || "Unknown"}
                          {bf.parsed.surahNumber && <span className="text-gray-500 ml-1">#{bf.parsed.surahNumber}</span>}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {needsReview || bf.parsed.audioType === "full_surah" ? (
                        <input
                          type="number"
                          min={1}
                          value={bf.overrideAyah || bf.parsed.ayahNumber || ""}
                          onChange={(e) => updateFileAyah(i, parseInt(e.target.value, 10) || 1)}
                          className="bg-gray-800 border border-white/10 rounded px-2 py-1 text-white text-xs w-16"
                          placeholder="Ayah"
                        />
                      ) : (
                        <span className="text-white text-xs">{bf.parsed.ayahNumber || "—"}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {needsReview ? (
                        <span className="text-yellow-400 text-xs font-medium">{t("quran_bulk_review_status")}</span>
                      ) : (
                        <span className="text-emerald-400 text-xs font-medium">{t("quran_bulk_detected_status")}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleUpload}
            disabled={!finalReciter?.trim() || files.length === 0}
            className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            {t("quran_bulk_confirm")} ({files.length} {files.length === 1 ? "file" : "files"})
          </button>
          <button
            onClick={handleReset}
            className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2.5 rounded-lg text-sm transition-colors"
          >
            {t("quran_bulk_cancel")}
          </button>
        </div>
      </div>
    );
  }

  // ── Phase: UPLOADING ──
  if (phase === "uploading") {
    return (
      <div className="bg-gray-900 rounded-xl border border-white/10 p-6 mb-6">
        <h2 className="text-white text-lg font-semibold mb-4">{t("quran_bulk_uploading")}</h2>
        <div className="w-full bg-gray-800 rounded-full h-3 mb-3">
          <div
            className="bg-emerald-500 h-3 rounded-full transition-all duration-300"
            style={{ width: `${uploadProgress}%` }}
          />
        </div>
        <p className="text-gray-400 text-sm">{uploadProgress}% — {t("quran_bulk_uploading")}</p>
      </div>
    );
  }

  // ── Phase: COMPLETE ──
  const successCount = uploadResults.filter((r) => r.status === "success").length;
  const skippedCount = uploadResults.filter((r) => r.status === "skipped").length;
  const errorCount = uploadResults.filter((r) => r.status === "error").length;

  return (
    <div className="bg-gray-900 rounded-xl border border-white/10 p-6 mb-6">
      <h2 className="text-white text-lg font-semibold mb-4 flex items-center gap-2">
        <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        {t("quran_bulk_complete")}
      </h2>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-emerald-900/20 rounded-lg p-3 text-center">
          <div className="text-emerald-400 text-xl font-bold">{successCount}</div>
          <div className="text-gray-400 text-xs">Uploaded</div>
        </div>
        <div className="bg-yellow-900/20 rounded-lg p-3 text-center">
          <div className="text-yellow-400 text-xl font-bold">{skippedCount}</div>
          <div className="text-gray-400 text-xs">Skipped</div>
        </div>
        <div className="bg-red-900/20 rounded-lg p-3 text-center">
          <div className="text-red-400 text-xl font-bold">{errorCount}</div>
          <div className="text-gray-400 text-xs">Errors</div>
        </div>
      </div>

      {/* Error details */}
      {errorCount > 0 && (
        <div className="mb-4 max-h-[200px] overflow-y-auto border border-white/10 rounded-lg">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-800">
              <tr className="text-left text-gray-400 text-xs">
                <th className="px-3 py-2">File</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {uploadResults
                .filter((r) => r.status === "error" || r.status === "skipped")
                .map((r, i) => (
                  <tr key={i} className="border-t border-white/5">
                    <td className="px-3 py-2 text-white text-xs max-w-[200px] truncate">{r.originalName}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs ${r.status === "error" ? "text-red-400" : "text-yellow-400"}`}>
                        {r.status === "error" ? "Error" : "Skipped"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-400 text-xs">{r.error || "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      <button
        onClick={handleReset}
        className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
      >
        Upload More
      </button>
    </div>
  );
}
