"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { uploadImage, validateImageFile } from "@/lib/upload";

type Step = 1 | 2 | 3;

const STEPS = [
  { num: 1, label: "Butiran Radio" },
  { num: 2, label: "Gambar Radio" },
  { num: 3, label: "Semak & Sahkan" },
];

export default function NewRadio() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Wizard state
  const [step, setStep] = useState<Step>(1);

  // Form data — persists across all steps
  const [form, setForm] = useState({
    name: "",
    streamUrl: "",
    description: "",
    category: "Radio Islamik",
    enabled: true,
    displayOrder: 0,
  });

  // Thumbnail — stored as File object + local preview URL
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [thumbnailPreview, setThumbnailPreview] = useState("");
  const [uploadError, setUploadError] = useState("");

  // Stream test state
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);

  // Save state
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [error, setError] = useState("");

  const canProceedStep1 = form.name.trim() && form.streamUrl.trim();

  // --- Stream Test ---
  const handleTestStream = async () => {
    if (!form.streamUrl) return;
    setTesting(true);
    setTestResult(null);
    try {
      new URL(form.streamUrl);
      const audio = new Audio();
      audio.src = form.streamUrl;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          audio.src = "";
          reject(new Error("timeout"));
        }, 10000);
        audio.oncanplay = () => {
          clearTimeout(timeout);
          audio.src = "";
          resolve();
        };
        audio.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("Cannot play"));
        };
        audio.load();
      });
      setTestResult("ok");
    } catch {
      setTestResult("fail");
    } finally {
      setTesting(false);
    }
  };

  // --- Thumbnail Selection (local only — no API call) ---
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError("");

    const validationError = validateImageFile(file, 20);
    if (validationError) {
      setUploadError(validationError);
      if (e.target) e.target.value = "";
      return;
    }

    setThumbnailFile(file);
    const previewUrl = URL.createObjectURL(file);
    setThumbnailPreview(previewUrl);
    if (e.target) e.target.value = "";
  };

  const handleRemoveThumbnail = () => {
    if (thumbnailPreview) URL.revokeObjectURL(thumbnailPreview);
    setThumbnailFile(null);
    setThumbnailPreview("");
    setUploadError("");
  };

  // --- Step Navigation ---
  const validateStep1 = (): boolean => {
    if (!form.name.trim()) {
      setError("Nama radio diperlukan");
      return false;
    }
    if (!form.streamUrl.trim()) {
      setError("URL Siaran diperlukan");
      return false;
    }
    try {
      new URL(form.streamUrl);
    } catch {
      setError("URL Siaran tidak sah. Sila masukkan URL yang lengkap.");
      return false;
    }
    setError("");
    return true;
  };

  const handleNext = () => {
    if (step === 1 && !validateStep1()) return;
    setError("");
    setUploadError("");
    setStep((step + 1) as Step);
  };

  const handleBack = () => {
    setError("");
    setUploadError("");
    setStep((step - 1) as Step);
  };

  // --- Final Save ---
  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    setUploadError("");
    setSaveStatus("Mencipta radio...");

    try {
      // 1. Create the radio record (no thumbnail yet)
      const res = await fetch("/api/radios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, thumbnail: null }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Gagal mencipta radio");
        setSaving(false);
        setSaveStatus("");
        return;
      }

      const radio = await res.json();
      const radioId = radio.id;

      // 2. If a thumbnail was selected, upload it now using the real radioId
      if (thumbnailFile && radioId) {
        setSaveStatus("Memuat naik gambar radio...");

        try {
          await uploadImage(thumbnailFile, "radio_thumbnail", radioId);
        } catch {
          // Thumbnail upload failed, but radio was created — show partial success
          setSaveStatus("");
          setSaving(false);
          alert(
            "Radio berjaya dicipta, tetapi muat naik gambar gagal. Anda boleh muat naik gambar kemudian dari halaman Sunting Radio."
          );
          router.push("/admin/radios");
          return;
        }
      }

      setSaveStatus("Selesai!");
      router.push("/admin/radios");
    } catch {
      setError("Gagal mencipta radio");
      setSaving(false);
      setSaveStatus("");
    }
  };

  // --- Progress Indicator ---
  const ProgressIndicator = () => (
    <div className="flex items-center justify-center gap-2 sm:gap-3 mb-8">
      {STEPS.map((s, idx) => (
        <div key={s.num} className="flex items-center gap-2 sm:gap-3">
          {idx > 0 && (
            <div
              className={`h-px w-6 sm:w-10 ${
                step > s.num ? "bg-red-500" : "bg-white/10"
              }`}
            />
          )}
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div
              className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                step > s.num
                  ? "bg-red-600 text-white"
                  : step === s.num
                  ? "bg-red-600/20 border-2 border-red-500 text-red-400"
                  : "bg-white/5 border border-white/10 text-gray-500"
              }`}
            >
              {step > s.num ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                s.num
              )}
            </div>
            <span
              className={`text-xs sm:text-sm font-medium hidden sm:inline ${
                step >= s.num ? "text-gray-300" : "text-gray-600"
              }`}
            >
              {s.label}
            </span>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div>
      <div className="mb-8">
        <button
          onClick={() => router.back()}
          className="text-gray-400 hover:text-white text-sm mb-4 flex items-center gap-2 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Kembali
        </button>
        <h1 className="text-white text-2xl font-bold">Tambah Radio Baru</h1>
        <p className="text-gray-400 mt-1">Cipta stesen radio baru untuk laman</p>
      </div>

      <ProgressIndicator />

      {/* Error / Status Messages */}
      {error && (
        <div className="bg-red-600/10 border border-red-600/30 text-red-400 px-4 py-3 rounded-xl text-sm mb-6">
          {error}
        </div>
      )}
      {uploadError && (
        <div className="bg-red-600/10 border border-red-600/30 text-red-400 px-4 py-3 rounded-xl text-sm mb-6">
          {uploadError}
        </div>
      )}
      {saveStatus && (
        <div className="bg-blue-600/10 border border-blue-600/30 text-blue-400 px-4 py-3 rounded-xl text-sm mb-6 flex items-center gap-2">
          <span className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          {saveStatus}
        </div>
      )}

      <div className="max-w-2xl mx-auto">
        {/* ===== STEP 1: Radio Details ===== */}
        {step === 1 && (
          <div className="space-y-6">
            {/* Basic Info */}
            <div className="admin-card">
              <h2 className="text-white font-semibold text-lg mb-4">Butiran Radio</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-gray-300 text-sm font-medium mb-2">
                    Nama Radio *
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="admin-input"
                    placeholder="Contoh: Radio Bilik Agama"
                    required
                  />
                </div>

                <div>
                  <label className="block text-gray-300 text-sm font-medium mb-2">
                    URL Siaran *
                  </label>
                  <input
                    type="url"
                    value={form.streamUrl}
                    onChange={(e) => setForm({ ...form, streamUrl: e.target.value })}
                    className="admin-input"
                    placeholder="https://example.com/stream.mp3"
                    required
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      onClick={handleTestStream}
                      disabled={testing || !form.streamUrl}
                      className="admin-btn admin-btn-secondary text-xs flex items-center gap-1"
                    >
                      {testing ? (
                        <>
                          <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          Menyemak...
                        </>
                      ) : (
                        "Semak Siaran"
                      )}
                    </button>
                    {testResult === "ok" && (
                      <span className="text-green-400 text-xs flex items-center gap-1">✓ Siaran boleh dimainkan</span>
                    )}
                    {testResult === "fail" && (
                      <span className="text-red-400 text-xs flex items-center gap-1">✕ Siaran tidak dapat dicapai</span>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-gray-300 text-sm font-medium mb-2">
                    Penerangan
                  </label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="admin-input min-h-[100px] resize-y"
                    placeholder="Penerangan ringkas tentang radio ini..."
                    rows={3}
                  />
                </div>
              </div>
            </div>

            {/* Additional Settings */}
            <div className="admin-card">
              <h2 className="text-white font-semibold text-lg mb-4">Tetapan Tambahan</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-gray-300 text-sm font-medium mb-2">
                    Kategori
                  </label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="admin-input"
                  >
                    <option value="Radio Islamik">Radio Islamik</option>
                    <option value="Radio Nasyid">Radio Nasyid</option>
                    <option value="Radio Dakwah">Radio Dakwah</option>
                    <option value="Radio Pendidikan">Radio Pendidikan</option>
                    <option value="general">Lain-lain</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-gray-300 text-sm font-medium mb-2">
                      Susunan Paparan
                    </label>
                    <input
                      type="number"
                      value={form.displayOrder}
                      onChange={(e) =>
                        setForm({ ...form, displayOrder: parseInt(e.target.value) || 0 })
                      }
                      className="admin-input"
                      min="0"
                    />
                    <p className="text-gray-500 text-xs mt-1">
                      Nombor yang lebih rendah akan dipaparkan terlebih dahulu.
                    </p>
                  </div>
                  <div>
                    <label className="block text-gray-300 text-sm font-medium mb-2">
                      Status
                    </label>
                    <select
                      value={form.enabled ? "enabled" : "disabled"}
                      onChange={(e) =>
                        setForm({ ...form, enabled: e.target.value === "enabled" })
                      }
                      className="admin-input"
                    >
                      <option value="enabled">Diaktifkan</option>
                      <option value="disabled">Dinyahaktifkan</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* Next Button */}
            <div className="flex gap-4 pt-2">
              <button
                type="button"
                onClick={handleNext}
                disabled={!canProceedStep1}
                className={`admin-btn flex items-center gap-2 ml-auto ${
                  canProceedStep1
                    ? "admin-btn-primary"
                    : "bg-gray-700 text-gray-500 cursor-not-allowed"
                }`}
              >
                Seterusnya
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* ===== STEP 2: Radio Thumbnail ===== */}
        {step === 2 && (
          <div className="space-y-6">
            <div className="admin-card">
              <h2 className="text-white font-semibold text-lg mb-2">Gambar Radio</h2>
              <p className="text-gray-400 text-sm mb-4">
                Pilih gambar untuk stesen radio ini. Anda boleh melangkau langkah ini.
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFileSelect}
                className="hidden"
              />

              <div className="flex items-start gap-4">
                <div className="flex-1">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full border-2 border-dashed border-white/10 hover:border-red-500/50 rounded-xl p-8 text-center transition-colors"
                  >
                    <div className="flex flex-col items-center gap-3">
                      <svg className="w-10 h-10 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <div>
                        <p className="text-gray-400 text-sm font-medium">
                          {thumbnailFile ? "Tukar gambar" : "Klik untuk memilih gambar"}
                        </p>
                        <p className="text-gray-600 text-xs mt-1">
                          JPG, PNG, atau WebP (Maks 20MB)
                        </p>
                      </div>
                    </div>
                  </button>
                </div>

                {thumbnailPreview && (
                  <div className="w-40 flex-shrink-0">
                    <img
                      src={thumbnailPreview}
                      alt="Preview"
                      className="w-full aspect-video object-cover rounded-lg border border-white/10"
                    />
                    <div className="mt-2 space-y-1">
                      <p className="text-gray-300 text-xs truncate" title={thumbnailFile?.name}>
                        {thumbnailFile?.name}
                      </p>
                      <p className="text-gray-500 text-xs">
                        {thumbnailFile ? `${(thumbnailFile.size / (1024 * 1024)).toFixed(2)} MB` : ""}
                      </p>
                      <button
                        type="button"
                        onClick={handleRemoveThumbnail}
                        className="w-full text-red-400 hover:text-red-300 text-xs"
                      >
                        Padam
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Navigation */}
            <div className="flex gap-4 pt-2">
              <button
                type="button"
                onClick={handleBack}
                className="admin-btn admin-btn-secondary flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Kembali
              </button>
              <button
                type="button"
                onClick={handleNext}
                className="admin-btn admin-btn-primary flex items-center gap-2 ml-auto"
              >
                Seterusnya
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* ===== STEP 3: Review & Confirm ===== */}
        {step === 3 && (
          <div className="space-y-6">
            {/* Radio Details Summary */}
            <div className="admin-card">
              <h2 className="text-white font-semibold text-lg mb-4">Butiran Radio</h2>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-400 text-sm">Nama Radio</span>
                  <span className="text-white text-sm font-medium">{form.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400 text-sm">URL Siaran</span>
                  <span className="text-white text-sm font-medium break-all text-right max-w-[60%]">
                    {form.streamUrl}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400 text-sm">Kategori</span>
                  <span className="text-white text-sm font-medium">{form.category}</span>
                </div>
                {form.description && (
                  <div className="flex justify-between">
                    <span className="text-gray-400 text-sm">Penerangan</span>
                    <span className="text-white text-sm font-medium text-right max-w-[60%]">
                      {form.description}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-400 text-sm">Susunan Paparan</span>
                  <span className="text-white text-sm font-medium">{form.displayOrder}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400 text-sm">Status</span>
                  <span className="text-white text-sm font-medium">
                    {form.enabled ? "Diaktifkan" : "Dinyahaktifkan"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400 text-sm">Semakan Siaran</span>
                  <span className="text-sm font-medium">
                    {testResult === "ok" ? (
                      <span className="text-green-400">✓ Boleh dimainkan</span>
                    ) : testResult === "fail" ? (
                      <span className="text-red-400">✕ Tidak dapat dicapai</span>
                    ) : (
                      <span className="text-gray-500">Belum disemak</span>
                    )}
                  </span>
                </div>
              </div>
            </div>

            {/* Thumbnail Summary */}
            <div className="admin-card">
              <h2 className="text-white font-semibold text-lg mb-4">Gambar Radio</h2>
              {thumbnailPreview ? (
                <div className="flex items-start gap-4">
                  <img
                    src={thumbnailPreview}
                    alt="Thumbnail"
                    className="w-40 aspect-video object-cover rounded-lg border border-white/10"
                  />
                  <div>
                    <span className="inline-flex items-center gap-1.5 text-green-400 text-sm">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Gambar dipilih
                    </span>
                    <p className="text-gray-400 text-xs mt-1">{thumbnailFile?.name}</p>
                  </div>
                </div>
              ) : (
                <p className="text-gray-500 text-sm">Tiada gambar dipilih</p>
              )}
            </div>

            {/* Navigation */}
            <div className="flex gap-4 pt-2">
              <button
                type="button"
                onClick={handleBack}
                disabled={saving}
                className="admin-btn admin-btn-secondary flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Kembali
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="admin-btn admin-btn-primary flex items-center gap-2 ml-auto disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    {saveStatus || "Menyimpan..."}
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Simpan Radio
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
