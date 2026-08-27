"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

export default function NewRadio() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    name: "",
    streamUrl: "",
    description: "",
    category: "Radio Islamik",
    enabled: true,
    displayOrder: 0,
  });
  const [thumbnail, setThumbnail] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);

  // For new radio, thumbnail is stored as data URL until saved
  const [pendingThumbnail, setPendingThumbnail] = useState("");

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError("");
    setTestResult(null);

    // Store as local data URL for preview (will be saved with the radio)
    const reader = new FileReader();
    reader.onload = () => {
      setThumbnail(reader.result as string);
      setPendingThumbnail(reader.result as string);
      setUploading(false);
    };
    reader.onerror = () => {
      setUploadError("Gagal membaca fail");
      setUploading(false);
    };
    reader.readAsDataURL(file);

    if (e.target) e.target.value = "";
  };

  const handleTestStream = async () => {
    if (!form.streamUrl) return;
    setTesting(true);
    setTestResult(null);
    try {
      new URL(form.streamUrl);
      // Simple reachability test
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!form.name || !form.streamUrl) {
      setError("Nama dan URL Siaran diperlukan");
      return;
    }

    setSaving(true);

    try {
      const res = await fetch("/api/radios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          thumbnail: pendingThumbnail || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Gagal mencipta radio");
        setSaving(false);
        return;
      }

      const radio = await res.json();

      // If thumbnail was uploaded as data URL, save it via the upload endpoint
      if (pendingThumbnail && radio.id) {
        // Convert data URL to blob and upload
        try {
          const res2 = await fetch("/api/upload", {
            method: "POST",
            body: (() => {
              const fd = new FormData();
              // Convert data URL to blob
              const [header, data] = pendingThumbnail.split(",");
              const mime = header.match(/:(.*?);/)?.[1] || "image/png";
              const binary = atob(data);
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
              const blob = new Blob([bytes], { type: mime });
              fd.append("file", blob, "radio-thumb.jpg");
              fd.append("purpose", "radio_thumbnail");
              fd.append("targetId", radio.id);
              return fd;
            })(),
          });
          // If upload succeeds, radio already has thumbnail via DB update
          if (res2.ok) {
            const uploadData = await res2.json();
            if (uploadData.saved) {
              setThumbnail(uploadData.url + "?t=" + Date.now());
            }
          }
        } catch {
          // Thumbnail save failed but radio was created — continue
        }
      }

      router.push("/admin/radios");
    } catch {
      setError("Gagal mencipta radio");
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
        <h1 className="text-white text-2xl font-bold">Tambah Radio Baru</h1>
        <p className="text-gray-400 mt-1">Cipta stesen radio baru</p>
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

        {/* Name */}
        <div>
          <label className="block text-gray-300 text-sm font-medium mb-2">Nama Radio *</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="admin-input"
            placeholder="Contoh: Radio Bilik Agama"
            required
          />
        </div>

        {/* Stream URL */}
        <div>
          <label className="block text-gray-300 text-sm font-medium mb-2">URL Siaran *</label>
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

        {/* Description */}
        <div>
          <label className="block text-gray-300 text-sm font-medium mb-2">Penerangan</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="admin-input min-h-[80px] resize-y"
            placeholder="Penerangan ringkas tentang radio ini..."
            rows={3}
          />
        </div>

        {/* Thumbnail */}
        <div>
          <label className="block text-gray-300 text-sm font-medium mb-2">Gambar Radio</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFileUpload}
            className="hidden"
          />
          <div className="flex items-start gap-4">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex-1 border-2 border-dashed border-white/10 hover:border-red-500/50 rounded-xl p-6 text-center transition-colors disabled:opacity-50"
            >
              {uploading ? (
                <div className="flex items-center justify-center gap-2">
                  <div className="w-5 h-5 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-gray-400 text-sm">Memuat naik...</span>
                </div>
              ) : (
                <span className="text-gray-400 text-sm">Klik untuk memuat naik gambar (JPG, PNG, WebP - Maks 4MB)</span>
              )}
            </button>
            {thumbnail && (
              <div className="w-32 flex-shrink-0">
                <img src={thumbnail} alt="Preview" className="w-full aspect-video object-cover rounded-lg border border-white/10" />
                <button
                  type="button"
                  onClick={() => { setThumbnail(""); setPendingThumbnail(""); }}
                  className="w-full mt-2 text-red-400 hover:text-red-300 text-xs"
                >
                  Padam
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Category + Order */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-gray-300 text-sm font-medium mb-2">Kategori</label>
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
          <div>
            <label className="block text-gray-300 text-sm font-medium mb-2">Susunan Paparan</label>
            <input
              type="number"
              value={form.displayOrder}
              onChange={(e) => setForm({ ...form, displayOrder: parseInt(e.target.value) || 0 })}
              className="admin-input"
              min="0"
            />
          </div>
        </div>

        {/* Status */}
        <div>
          <label className="block text-gray-300 text-sm font-medium mb-2">Status</label>
          <select
            value={form.enabled ? "enabled" : "disabled"}
            onChange={(e) => setForm({ ...form, enabled: e.target.value === "enabled" })}
            className="admin-input"
          >
            <option value="enabled">Diaktifkan</option>
            <option value="disabled">Dinyahaktifkan</option>
          </select>
        </div>

        {/* Submit */}
        <div className="flex gap-4 pt-4">
          <button
            type="submit"
            disabled={saving || uploading}
            className="admin-btn admin-btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            {saving ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Menyimpan...
              </>
            ) : (
              "Simpan Radio"
            )}
          </button>
          <button type="button" onClick={() => router.back()} className="admin-btn admin-btn-secondary">
            Batal
          </button>
        </div>
      </form>
    </div>
  );
}
