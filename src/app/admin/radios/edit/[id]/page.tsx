"use client";

import { useState, useRef, useEffect, use } from "react";
import { useRouter } from "next/navigation";

interface Radio {
  id: string;
  name: string;
  description: string | null;
  streamUrl: string;
  thumbnail: string | null;
  category: string;
  enabled: boolean;
  displayOrder: number;
}

export default function EditRadio({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [thumbnailSaved, setThumbnailSaved] = useState(false);
  const [thumbnailCleared, setThumbnailCleared] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);

  useEffect(() => {
    fetch(`/api/radios/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((radio: Radio) => {
        setForm({
          name: radio.name,
          streamUrl: radio.streamUrl,
          description: radio.description || "",
          category: radio.category,
          enabled: radio.enabled,
          displayOrder: radio.displayOrder,
        });
        setThumbnail(radio.thumbnail ? `/api/images/radio/${id}` : "");
        setLoading(false);
      })
      .catch(() => {
        setError("Radio tidak dijumpai");
        setLoading(false);
      });
  }, [id]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError("");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("purpose", "radio_thumbnail");
    formData.append("targetId", id);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        if (res.status === 413) {
          setUploadError("Fail terlalu besar. Saiz maksimum ialah 3.5MB.");
        } else {
          setUploadError("Pelayan mengembalikan ralat (HTTP " + res.status + ").");
        }
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error || "Gagal memuat naik gambar");
      } else if (!data.saved) {
        setUploadError("Gagal menyimpan gambar ke database.");
      } else {
        setThumbnail(data.url + "?t=" + Date.now());
        setThumbnailSaved(true);
        setThumbnailCleared(false);
      }
    } catch (err) {
      setUploadError("Gagal memuat naik: " + (err instanceof Error ? err.message : "Ralat"));
    } finally {
      setUploading(false);
      if (e.target) e.target.value = "";
    }
  };

  const handleTestStream = async () => {
    if (!form.streamUrl) return;
    setTesting(true);
    setTestResult(null);
    try {
      new URL(form.streamUrl);
      const audio = new Audio();
      audio.src = form.streamUrl;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { audio.src = ""; reject(new Error("timeout")); }, 10000);
        audio.oncanplay = () => { clearTimeout(timeout); audio.src = ""; resolve(); };
        audio.onerror = () => { clearTimeout(timeout); reject(new Error("Cannot play")); };
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
    setUploadError("");

    if (!form.name || !form.streamUrl) {
      setError("Nama dan URL Siaran diperlukan");
      return;
    }

    setSaving(true);

    try {
      const payload: Record<string, unknown> = { ...form };
      if (thumbnailCleared) {
        payload.thumbnail = null;
      } else if (!thumbnailSaved) {
        // Don't send thumbnail — already in DB
      }

      const res = await fetch(`/api/radios/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Gagal mengemas kini radio");
        setSaving(false);
        return;
      }

      router.push("/admin/radios");
    } catch {
      setError("Gagal mengemas kini radio");
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
        <h1 className="text-white text-2xl font-bold">Sunting Radio</h1>
        <p className="text-gray-400 mt-1">Kemas kini maklumat radio</p>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
        {error && (
          <div className="bg-red-600/10 border border-red-600/30 text-red-400 px-4 py-3 rounded-xl text-sm">{error}</div>
        )}
        {uploadError && (
          <div className="bg-red-600/10 border border-red-600/30 text-red-400 px-4 py-3 rounded-xl text-sm">{uploadError}</div>
        )}

        <div>
          <label className="block text-gray-300 text-sm font-medium mb-2">Nama Radio *</label>
          <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="admin-input" required />
        </div>

        <div>
          <label className="block text-gray-300 text-sm font-medium mb-2">URL Siaran *</label>
          <input type="url" value={form.streamUrl} onChange={(e) => setForm({ ...form, streamUrl: e.target.value })} className="admin-input" required />
          <div className="flex gap-2 mt-2">
            <button type="button" onClick={handleTestStream} disabled={testing || !form.streamUrl} className="admin-btn admin-btn-secondary text-xs flex items-center gap-1">
              {testing ? (<><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> Menyemak...</>) : "Semak Siaran"}
            </button>
            {testResult === "ok" && <span className="text-green-400 text-xs flex items-center">✓ Siaran boleh dimainkan</span>}
            {testResult === "fail" && <span className="text-red-400 text-xs flex items-center">✕ Siaran tidak dapat dicapai</span>}
          </div>
        </div>

        <div>
          <label className="block text-gray-300 text-sm font-medium mb-2">Penerangan</label>
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="admin-input min-h-[80px] resize-y" rows={3} />
        </div>

        {/* Thumbnail */}
        <div>
          <label className="block text-gray-300 text-sm font-medium mb-2">Gambar Radio</label>
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileUpload} className="hidden" />
          <div className="flex items-start gap-4">
            <button type="button" onClick={() => !uploading && fileInputRef.current?.click()} disabled={uploading} className="flex-1 border-2 border-dashed border-white/10 hover:border-red-500/50 rounded-xl p-6 text-center transition-colors disabled:opacity-50">
              {uploading ? (
                <div className="flex items-center justify-center gap-2">
                  <div className="w-5 h-5 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-gray-400 text-sm">Memuat naik...</span>
                </div>
              ) : (
                <span className="text-gray-400 text-sm">Klik untuk menukar gambar (JPG, PNG, WebP - Maks 3.5MB)</span>
              )}
            </button>
            {thumbnail && !thumbnailCleared && (
              <div className="w-32 flex-shrink-0">
                <img src={thumbnail} alt="Preview" className="w-full aspect-video object-cover rounded-lg border border-white/10" />
                <button type="button" onClick={() => { setThumbnail(""); setThumbnailCleared(true); setThumbnailSaved(false); }} className="w-full mt-2 text-red-400 hover:text-red-300 text-xs">Padam</button>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-gray-300 text-sm font-medium mb-2">Kategori</label>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="admin-input">
              <option value="Radio Islamik">Radio Islamik</option>
              <option value="Radio Nasyid">Radio Nasyid</option>
              <option value="Radio Dakwah">Radio Dakwah</option>
              <option value="Radio Pendidikan">Radio Pendidikan</option>
              <option value="general">Lain-lain</option>
            </select>
          </div>
          <div>
            <label className="block text-gray-300 text-sm font-medium mb-2">Susunan Paparan</label>
            <input type="number" value={form.displayOrder} onChange={(e) => setForm({ ...form, displayOrder: parseInt(e.target.value) || 0 })} className="admin-input" min="0" />
          </div>
        </div>

        <div>
          <label className="block text-gray-300 text-sm font-medium mb-2">Status</label>
          <select value={form.enabled ? "enabled" : "disabled"} onChange={(e) => setForm({ ...form, enabled: e.target.value === "enabled" })} className="admin-input">
            <option value="enabled">Diaktifkan</option>
            <option value="disabled">Dinyahaktifkan</option>
          </select>
        </div>

        <div className="flex gap-4 pt-4">
          <button type="submit" disabled={saving || uploading} className="admin-btn admin-btn-primary flex items-center gap-2 disabled:opacity-50">
            {saving ? (<><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Menyimpan...</>) : "Simpan Perubahan"}
          </button>
          <button type="button" onClick={() => router.back()} className="admin-btn admin-btn-secondary">Batal</button>
        </div>
      </form>
    </div>
  );
}
