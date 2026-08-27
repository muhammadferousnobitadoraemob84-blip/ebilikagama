"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import TwitchVerifyPreview from "@/components/TwitchVerifyPreview";
import { uploadImage, validateImageFile } from "@/lib/upload";

type Step = 1 | 2 | 3;

const STEPS = [
  { num: 1, label: "Butiran Saluran" },
  { num: 2, label: "Gambar Saluran" },
  { num: 3, label: "Semak & Sahkan" },
];

export default function NewChannel() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Wizard state
  const [step, setStep] = useState<Step>(1);

  // Form data — persists across all steps
  const [form, setForm] = useState({
    name: "",
    category: "saluran-tv",
    twitchUsername: "",
    description: "",
    displayOrder: 0,
    active: true,
    liveStatus: "automatic",
  });

  // Thumbnail — stored as File object + local preview URL
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [thumbnailPreview, setThumbnailPreview] = useState("");
  const [uploadError, setUploadError] = useState("");

  // Verification state
  const [verified, setVerified] = useState(false);
  const [verifiedUsername, setVerifiedUsername] = useState<string | null>(null);
  const [ownerConfirmed, setOwnerConfirmed] = useState(false);

  // Save state
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [error, setError] = useState("");

  const isVerified =
    verified && verifiedUsername === form.twitchUsername.trim().toLowerCase();
  const canProceedStep1 = form.name.trim() && form.twitchUsername.trim();

  // --- Twitch Verification ---
  const getVerificationStatus = () => {
    if (isVerified) {
      return { color: "green", label: "Siaran disahkan", icon: "🟢" };
    }
    if (!form.twitchUsername.trim()) {
      return { color: "gray", label: "Belum disahan", icon: "🔴" };
    }
    return { color: "gray", label: "Belum disahan", icon: "🔴" };
  };

  const verificationStatus = getVerificationStatus();

  const handleVerified = useCallback(
    (result: boolean) => {
      setVerified(result);
      if (result) {
        setVerifiedUsername(form.twitchUsername.trim().toLowerCase());
      } else {
        setVerifiedUsername(null);
      }
      setOwnerConfirmed(false);
    },
    [form.twitchUsername]
  );

  const handleTwitchUsernameChange = (value: string) => {
    setForm({ ...form, twitchUsername: value });
    if (verifiedUsername && value.trim().toLowerCase() !== verifiedUsername) {
      setVerified(false);
      setVerifiedUsername(null);
      setOwnerConfirmed(false);
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

    // Store the File object and create a local preview URL
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
      setError("Nama saluran diperlukan");
      return false;
    }
    if (!form.twitchUsername.trim()) {
      setError("Username Twitch diperlukan");
      return false;
    }
    if (!isVerified) {
      setError("Sila sahkan saluran Twitch terlebih dahulu");
      return false;
    }
    if (!ownerConfirmed) {
      setError("Sila sahkan sebagai pemilik saluran");
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
    setSaveStatus("Mencipta saluran...");

    try {
      // 1. Create the channel record (no thumbnail yet)
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, thumbnail: null }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Gagal mencipta saluran");
        setSaving(false);
        setSaveStatus("");
        return;
      }

      const channel = await res.json();
      const channelId = channel.id;

      // 2. If a thumbnail was selected, upload it now using the real channelId
      if (thumbnailFile && channelId) {
        setSaveStatus("Memuat naik gambar saluran...");

        try {
          await uploadImage(thumbnailFile, "channel_thumbnail", channelId);
        } catch {
          // Thumbnail upload failed, but channel was created — show partial success
          setSaveStatus("");
          setSaving(false);
          alert(
            "Saluran berjaya dicipta, tetapi muat naik gambar gagal. Anda boleh muat naik gambar kemudian dari halaman Sunting Saluran."
          );
          router.push("/admin/channels");
          return;
        }
      }

      setSaveStatus("Selesai!");
      router.push("/admin/channels");
    } catch {
      setError("Gagal mencipta saluran");
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
        <h1 className="text-white text-2xl font-bold">Tambah Saluran Baru</h1>
        <p className="text-gray-400 mt-1">Cipta saluran baru untuk laman</p>
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
        {/* ===== STEP 1: Channel Details ===== */}
        {step === 1 && (
          <div className="space-y-6">
            {/* Channel Name */}
            <div className="admin-card">
              <h2 className="text-white font-semibold text-lg mb-4">Butiran Saluran</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-gray-300 text-sm font-medium mb-2">
                    Nama Saluran *
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="admin-input"
                    placeholder="Contoh: Bilik Agama TV"
                    required
                  />
                </div>

                <div>
                  <label className="block text-gray-300 text-sm font-medium mb-2">
                    Kategori *
                  </label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="admin-input"
                  >
                    <option value="saluran-tv">Saluran TV</option>
                    <option value="saluran-khas">Saluran Khas</option>
                  </select>
                </div>

                <div>
                  <label className="block text-gray-300 text-sm font-medium mb-2">
                    Username Twitch *
                  </label>
                  <input
                    type="text"
                    value={form.twitchUsername}
                    onChange={(e) => handleTwitchUsernameChange(e.target.value)}
                    className="admin-input"
                    placeholder="Contoh: nama_channel_twitch"
                    required
                  />
                  <p className="text-gray-500 text-xs mt-1">
                    Masukkan username saluran Twitch yang ingin ditambah.
                  </p>
                </div>
              </div>
            </div>

            {/* Twitch Verification */}
            <div className="admin-card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-white font-semibold text-lg">Semakan Siaran</h2>
                <span
                  className={`text-xs font-medium px-3 py-1 rounded-full flex items-center gap-1.5 ${
                    verificationStatus.color === "green"
                      ? "bg-green-600/10 border border-green-600/30 text-green-400"
                      : "bg-gray-600/10 border border-gray-600/30 text-gray-400"
                  }`}
                >
                  {verificationStatus.icon} {verificationStatus.label}
                </span>
              </div>
              <TwitchVerifyPreview
                username={form.twitchUsername}
                onVerified={handleVerified}
                verifiedUsername={verifiedUsername}
              />
            </div>

            {/* Owner Confirmation */}
            {isVerified && (
              <div className="admin-card border-green-600/30">
                <h2 className="text-white font-semibold text-lg mb-3">Pengesahan Pemilik</h2>
                <p className="text-gray-400 text-sm mb-4">
                  Adakah anda pasti ini ialah saluran rasmi Bilik Agama?
                </p>
                <label className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={ownerConfirmed}
                    onChange={(e) => setOwnerConfirmed(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-gray-600 bg-gray-800 text-red-600 focus:ring-red-500 focus:ring-offset-0 cursor-pointer"
                  />
                  <span className="text-gray-300 text-sm group-hover:text-white transition-colors">
                    Saya mengesahkan bahawa Twitch channel ini ialah saluran yang ingin saya tambah ke website Bilik Agama.
                  </span>
                </label>
              </div>
            )}

            {/* Additional Details */}
            <div className="admin-card">
              <h2 className="text-white font-semibold text-lg mb-4">Butiran Tambahan</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-gray-300 text-sm font-medium mb-2">
                    Penerangan
                  </label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="admin-input min-h-[100px] resize-y"
                    placeholder="Penerangan ringkas tentang saluran ini..."
                    rows={3}
                  />
                </div>

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

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-gray-300 text-sm font-medium mb-2">
                      Status
                    </label>
                    <select
                      value={form.active ? "active" : "inactive"}
                      onChange={(e) =>
                        setForm({ ...form, active: e.target.value === "active" })
                      }
                      className="admin-input"
                    >
                      <option value="active">Aktif</option>
                      <option value="inactive">Tidak Aktif</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-gray-300 text-sm font-medium mb-2">
                      Status Siaran
                    </label>
                    <select
                      value={form.liveStatus}
                      onChange={(e) =>
                        setForm({ ...form, liveStatus: e.target.value })
                      }
                      className="admin-input"
                    >
                      <option value="automatic">Automatik</option>
                      <option value="live">LIVE</option>
                      <option value="offline">OFFLINE</option>
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
                disabled={!canProceedStep1 || !isVerified || !ownerConfirmed}
                className={`admin-btn flex items-center gap-2 ml-auto ${
                  canProceedStep1 && isVerified && ownerConfirmed
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

        {/* ===== STEP 2: Channel Thumbnail ===== */}
        {step === 2 && (
          <div className="space-y-6">
            <div className="admin-card">
              <h2 className="text-white font-semibold text-lg mb-2">Gambar Saluran</h2>
              <p className="text-gray-400 text-sm mb-4">
                Pilih gambar untuk saluran ini. Anda boleh melangkau langkah ini.
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
            {/* Channel Details Summary */}
            <div className="admin-card">
              <h2 className="text-white font-semibold text-lg mb-4">Butiran Saluran</h2>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-400 text-sm">Nama Saluran</span>
                  <span className="text-white text-sm font-medium">{form.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400 text-sm">Kategori</span>
                  <span className="text-white text-sm font-medium">
                    {form.category === "saluran-tv" ? "Saluran TV" : "Saluran Khas"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400 text-sm">Username Twitch</span>
                  <span className="text-white text-sm font-medium">{form.twitchUsername}</span>
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
                    {form.active ? "Aktif" : "Tidak Aktif"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400 text-sm">Status Siaran</span>
                  <span className="text-white text-sm font-medium">
                    {form.liveStatus === "automatic"
                      ? "Automatik"
                      : form.liveStatus === "live"
                      ? "LIVE"
                      : "OFFLINE"}
                  </span>
                </div>
              </div>
            </div>

            {/* Thumbnail Summary */}
            <div className="admin-card">
              <h2 className="text-white font-semibold text-lg mb-4">Gambar Saluran</h2>
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
                    Simpan Saluran
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
