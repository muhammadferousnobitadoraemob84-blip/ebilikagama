"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import TwitchVerifyPreview from "@/components/TwitchVerifyPreview";

export default function NewChannel() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    name: "",
    category: "saluran-tv",
    twitchUsername: "",
    description: "",
    displayOrder: 0,
    active: true,
    liveStatus: "automatic",
  });
  const [thumbnail, setThumbnail] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Verification state
  const [verified, setVerified] = useState(false);
  const [verifiedUsername, setVerifiedUsername] = useState<string | null>(null);
  const [ownerConfirmed, setOwnerConfirmed] = useState(false);

  // Get verification status indicator
  const getVerificationStatus = () => {
    if (verified && verifiedUsername === form.twitchUsername.trim().toLowerCase()) {
      return { color: "green", label: "Siaran disahkan", icon: "🟢" };
    }
    if (!form.twitchUsername.trim()) {
      return { color: "gray", label: "Belum disahan", icon: "🔴" };
    }
    return { color: "gray", label: "Belum disahan", icon: "🔴" };
  };

  const verificationStatus = getVerificationStatus();
  const isVerified =
    verified && verifiedUsername === form.twitchUsername.trim().toLowerCase();
  const canSave = isVerified && ownerConfirmed && !saving;

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
    // Invalidate verification if username changes
    if (verifiedUsername && value.trim().toLowerCase() !== verifiedUsername) {
      setVerified(false);
      setVerifiedUsername(null);
      setOwnerConfirmed(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError("");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("purpose", "channel_thumbnail");

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      // Safely parse JSON — server may return non-JSON on error
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        if (res.status === 413) {
          setError("Fail terlalu besar. Saiz maksimum ialah 3.5MB.");
        } else {
          setError("Pelayan mengembalikan ralat (HTTP " + res.status + ").");
        }
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Gagal memuat naik fail");
      } else {
        // For new channels, save the data URL locally since we don't have a channel ID yet
        setThumbnail(data.url);
      }
    } catch {
      setError("Gagal memuat naik fail");
    } finally {
      setUploading(false);
      if (e.target) e.target.value = "";
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!canSave) {
      setError("Sila sahkan saluran Twitch terlebih dahulu.");
      return;
    }

    setSaving(true);

    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, thumbnail: thumbnail || null }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Gagal mencipta saluran");
        setSaving(false);
        return;
      }

      router.push("/admin/channels");
    } catch {
      setError("Gagal mencipta saluran");
      setSaving(false);
    }
  };

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

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
        {error && (
          <div className="bg-red-600/10 border border-red-600/30 text-red-400 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            {error}
          </div>
        )}

        {/* === CHANNEL INFORMATION SECTION === */}
        <div className="admin-card">
          <h2 className="text-white font-semibold text-lg mb-4">Maklumat Saluran</h2>
          <div className="space-y-4">
            {/* Channel Name */}
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

            {/* Category */}
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

            {/* Twitch Username */}
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

        {/* === TWITCH VERIFICATION SECTION === */}
        <div className="admin-card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-semibold text-lg">Semakan Siaran</h2>
            {/* Verification Status */}
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

        {/* === OWNER CONFIRMATION SECTION === */}
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

        {/* === ADDITIONAL DETAILS === */}
        <div className="admin-card">
          <h2 className="text-white font-semibold text-lg mb-4">Butiran Tambahan</h2>
          <div className="space-y-4">
            {/* Thumbnail */}
            <div>
              <label className="block text-gray-300 text-sm font-medium mb-2">
                Gambar Saluran
              </label>
              <div className="flex items-start gap-4">
                <div className="flex-1">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="w-full border-2 border-dashed border-white/10 hover:border-red-500/50 rounded-xl p-6 text-center transition-colors"
                  >
                    {uploading ? (
                      <div className="flex flex-col items-center gap-2">
                        <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                        <p className="text-gray-400 text-sm">Memuat naik...</p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <p className="text-gray-400 text-sm">Klik untuk memuat naik gambar</p>
                        <p className="text-gray-600 text-xs">JPG, PNG, atau WebP (Maks 3.5MB)</p>
                      </div>
                    )}
                  </button>
                </div>

                {thumbnail && (
                  <div className="w-32 flex-shrink-0">
                    <img
                      src={thumbnail}
                      alt="Preview"
                      className="w-full aspect-video object-cover rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() => setThumbnail("")}
                      className="w-full mt-2 text-red-400 hover:text-red-300 text-xs"
                    >
                      Padam
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Description */}
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

            {/* Display Order */}
            <div>
              <label className="block text-gray-300 text-sm font-medium mb-2">
                Susunan Paparan
              </label>
              <input
                type="number"
                value={form.displayOrder}
                onChange={(e) => setForm({ ...form, displayOrder: parseInt(e.target.value) || 0 })}
                className="admin-input"
                min="0"
              />
              <p className="text-gray-500 text-xs mt-1">
                Nombor yang lebih rendah akan dipaparkan terlebih dahulu.
              </p>
            </div>

            {/* Status */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-gray-300 text-sm font-medium mb-2">
                  Status
                </label>
                <select
                  value={form.active ? "active" : "inactive"}
                  onChange={(e) => setForm({ ...form, active: e.target.value === "active" })}
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
                  onChange={(e) => setForm({ ...form, liveStatus: e.target.value })}
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

        {/* === SUBMIT === */}
        <div className="flex gap-4 pt-4">
          <button
            type="submit"
            disabled={!canSave}
            className={`admin-btn flex items-center gap-2 ${
              canSave
                ? "admin-btn-primary"
                : "bg-gray-700 text-gray-500 cursor-not-allowed"
            }`}
          >
            {saving ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Menyimpan...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Sahkan & Simpan
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="admin-btn admin-btn-secondary"
          >
            Batal
          </button>
        </div>

        {!isVerified && form.twitchUsername.trim() && (
          <p className="text-gray-500 text-xs text-center">
            Simpan akan aktif selepas saluran Twitch berjaya disahkan dan disahkan oleh pemilik.
          </p>
        )}
      </form>
    </div>
  );
}
