"use client";

import { useState, useRef, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { uploadImage, validateImageFile, validateImageDimensions } from "@/lib/upload";

interface Channel {
  id: string;
  name: string;
  category: string;
  twitchUsername: string;
  thumbnail: string | null;
  description: string | null;
  liveStatus: string;
  displayOrder: number;
  active: boolean;
}

export default function EditChannel({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Store channel ID in state as backup — use it if use(params) is somehow empty
  const [channelId, setChannelId] = useState("");

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploadSuccess, setUploadSuccess] = useState("");
  // Track whether thumbnail was already saved to DB by upload endpoint
  const [thumbnailSaved, setThumbnailSaved] = useState(false);
  // Track if thumbnail was explicitly cleared
  const [thumbnailCleared, setThumbnailCleared] = useState(false);

  useEffect(() => {
    fetch(`/api/channels/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((channel: Channel) => {
        setForm({
          name: channel.name,
          category: channel.category,
          twitchUsername: channel.twitchUsername,
          description: channel.description || "",
          displayOrder: channel.displayOrder,
          active: channel.active,
          liveStatus: channel.liveStatus,
        });
        // Use API URL for display (not raw base64)
        setThumbnail(channel.thumbnail ? `/api/images/channel/${id}` : "");
        setChannelId(channel.id);
        setLoading(false);
      })
      .catch(() => {
        setError("Saluran tidak dijumpai");
        setLoading(false);
      });
  }, [id]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError("");
    setUploadSuccess("");

    // Validate file first
    const validationError = validateImageFile(file, 4);
    if (validationError) {
      setUploadError(validationError);
      setUploading(false);
      if (e.target) e.target.value = "";
      return;
    }

    // Validate image dimensions (must be at least 50x50 pixels)
    const dimError = await validateImageDimensions(file);
    if (dimError) {
      setUploadError(dimError);
      setUploading(false);
      if (e.target) e.target.value = "";
      return;
    }

    try {
      const effectiveId = channelId || id;
      if (!effectiveId) {
        setUploadError("ID saluran tidak ditemui. Sila muat semula halaman.");
        setUploading(false);
        if (e.target) e.target.value = "";
        return;
      }
      const result = await uploadImage(file, "channel_thumbnail", effectiveId);

      if (result.saved) {
        const imgUrl = result.url + "?t=" + Date.now();
        setThumbnail(imgUrl);
        setThumbnailSaved(true);
        setThumbnailCleared(false);
        setUploadSuccess("✓ Gambar saluran berjaya dimuat naik!");
        setTimeout(() => setUploadSuccess(""), 5000);
      } else {
        setUploadError("Gagal menyimpan gambar ke database. Sila cuba lagi.");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ralat tidak diketahui";
      setUploadError("Gagal memuat naik: " + msg);
    } finally {
      setUploading(false);
      if (e.target) e.target.value = "";
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setUploadError("");

    if (!form.name || !form.twitchUsername) {
      setError("Nama dan username Twitch diperlukan");
      return;
    }

    setSaving(true);

    try {
      // Build update payload — skip thumbnail if it was already saved by upload endpoint
      const payload: Record<string, unknown> = { ...form };
      if (thumbnailCleared) {
        payload.thumbnail = null;
      } else if (!thumbnailSaved) {
        // Thumbnail wasn't changed via upload — don't send it (already in DB)
        // Only send if user explicitly cleared it
      }
      // If thumbnailSaved, upload already saved it — don't include in PUT

      const res = await fetch(`/api/channels/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Gagal mengemas kini saluran");
        setSaving(false);
        return;
      }

      router.push("/admin/channels");
    } catch {
      setError("Gagal mengemas kini saluran");
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

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
        <h1 className="text-white text-2xl font-bold">Sunting Saluran</h1>
        <p className="text-gray-400 mt-1">Kemas kini maklumat saluran</p>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
        {error && (
          <div className="bg-red-600/10 border border-red-600/30 text-red-400 px-4 py-3 rounded-xl text-sm">
            {error}
          </div>
        )}

        {uploadError && (
          <div className="bg-red-600/10 border border-red-600/30 text-red-400 px-4 py-3 rounded-xl text-sm">
            {uploadError}
          </div>
        )}

        {uploadSuccess && (
          <div className="bg-green-600/10 border border-green-600/30 text-green-400 px-4 py-3 rounded-xl text-sm">
            {uploadSuccess}
          </div>
        )}

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
            placeholder="Contoh: TV1"
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
            onChange={(e) => setForm({ ...form, twitchUsername: e.target.value })}
            className="admin-input"
            placeholder="Contoh: nama_channel_twitch"
            required
          />
        </div>

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
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => !uploading && fileInputRef.current?.click()}
                disabled={uploading}
                className="w-full border-2 border-dashed border-white/10 hover:border-red-500/50 rounded-xl p-6 text-center transition-colors disabled:opacity-50"
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
                    <p className="text-gray-400 text-sm">Klik untuk menukar gambar</p>
                    <p className="text-gray-600 text-xs">JPG, PNG, atau WebP (Maks 4MB)</p>
                  </div>
                )}
              </button>
            </div>

            {thumbnail && !thumbnailCleared && (
              <div className="w-32 flex-shrink-0">
                <img
                  src={thumbnail}
                  alt="Preview"
                  className="w-full aspect-video object-cover rounded-lg border border-white/10"
                  onError={(e) => {
                    const img = e.currentTarget;
                    if (!img.dataset.retried) {
                      img.dataset.retried = "true";
                      img.src = `/api/images/channel/${id}?t=${Date.now()}`;
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    setThumbnail("");
                    setThumbnailCleared(true);
                    setThumbnailSaved(false);
                  }}
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

        {/* Submit */}
        <div className="flex gap-4 pt-4">
          <button
            type="submit"
            disabled={saving || uploading}
            className="admin-btn admin-btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Menyimpan...
              </>
            ) : (
              "Simpan Perubahan"
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
      </form>
    </div>
  );
}
