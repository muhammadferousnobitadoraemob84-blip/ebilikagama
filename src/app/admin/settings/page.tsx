"use client";

import { useEffect, useState, useRef, useCallback } from "react";

interface Settings {
  [key: string]: string;
}

// ImageUploadField defined OUTSIDE parent to prevent unmount/remount on every render
function ImageUploadField({
  field,
  label,
  description,
  value,
  uploadingField,
  onUpload,
  onClear,
}: {
  field: string;
  label: string;
  description?: string;
  value: string;
  uploadingField: string | null;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>, field: string) => void;
  onClear: (field: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isUploading = uploadingField === field;

  return (
    <div>
      <label className="block text-gray-300 text-sm font-medium mb-2">
        {label}
      </label>
      {description && (
        <p className="text-gray-500 text-xs mb-2">{description}</p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={(e) => onUpload(e, field)}
        className="hidden"
      />
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <button
            type="button"
            onClick={() => !isUploading && inputRef.current?.click()}
            disabled={isUploading}
            className="w-full border-2 border-dashed border-white/10 hover:border-red-500/50 rounded-xl p-4 text-center transition-colors disabled:opacity-50"
          >
            {isUploading ? (
              <div className="flex items-center justify-center gap-2">
                <div className="w-5 h-5 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-gray-400 text-sm">Memuat naik...</span>
              </div>
            ) : (
              <span className="text-gray-400 text-sm">
                Klik untuk memuat naik gambar
              </span>
            )}
          </button>
        </div>
        {value && (
          <div className="w-32 flex-shrink-0 relative">
            <img
              src={value}
              alt={label}
              className="w-full aspect-video object-cover rounded-lg border border-white/10"
              onError={(e) => {
                // If image fails to load, try with cache bust
                const img = e.currentTarget;
                if (!img.dataset.retried) {
                  img.dataset.retried = "true";
                  img.src = `${value}?t=${Date.now()}`;
                }
              }}
            />
            {!isUploading && (
              <button
                type="button"
                onClick={() => onClear(field)}
                className="absolute -top-2 -right-2 w-6 h-6 bg-red-600 rounded-full flex items-center justify-center text-white hover:bg-red-500 transition-colors"
              >
                <svg
                  className="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminSettings() {
  const [settings, setSettings] = useState<Settings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [uploadSuccess, setUploadSuccess] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setSettings(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleImageUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>, field: string) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setUploadingField(field);
      setUploadError("");
      setUploadSuccess("");

      const formData = new FormData();
      formData.append("file", file);
      formData.append("purpose", field);

      try {
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        const data = await res.json();

        if (res.ok && data.saved) {
          // Server saved directly to DB
          setSettings((prev) => ({ ...prev, [field]: data.url }));
          const fieldLabel = field === "site_logo" ? "Logo Laman" : "Gambar Hero";
          setUploadSuccess(`✓ ${fieldLabel} berjaya dimuat naik! Klik "Simpan Tetapan" untuk kekalkan.`);
          setTimeout(() => setUploadSuccess(""), 5000);
        } else {
          setUploadError(data.error || "Gagal memuat naik gambar");
        }
      } catch {
        setUploadError("Gagal memuat naik gambar. Sila cuba lagi.");
      } finally {
        setUploadingField(null);
        // Reset file input so same file can be re-selected
        if (e.target) e.target.value = "";
      }
    },
    []
  );

  const handleClearImage = useCallback((field: string) => {
    setSettings((prev) => ({ ...prev, [field]: "" }));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    setSaved(false);

    try {
      const textSettings: Record<string, string> = {};
      const IMAGE_FIELDS = new Set(["site_logo", "hero_image"]);
      for (const [key, value] of Object.entries(settings)) {
        if (IMAGE_FIELDS.has(key)) {
          if (value === "") {
            textSettings[key] = value;
          }
          continue;
        }
        textSettings[key] = value;
      }

      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(textSettings),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Gagal menyimpan tetapan");
      } else {
        setSaved(true);
        window.dispatchEvent(new Event("settings-changed"));
        setTimeout(() => setSaved(false), 3000);
      }
    } catch {
      setError("Gagal menyimpan tetapan");
    } finally {
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
        <h1 className="text-white text-2xl font-bold">Tetapan Laman</h1>
        <p className="text-gray-400 mt-1">Suaikan penampilan dan kandungan laman</p>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-8">
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

        {saved && (
          <div className="bg-green-600/10 border border-green-600/30 text-green-400 px-4 py-3 rounded-xl text-sm">
            ✓ Tetapan berjaya disimpan
          </div>
        )}

        {/* Site Identity */}
        <div className="admin-card">
          <h2 className="text-white font-semibold text-lg mb-4">Identiti Laman</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-gray-300 text-sm font-medium mb-2">
                Nama Laman
              </label>
              <input
                type="text"
                value={settings.site_name || ""}
                onChange={(e) => setSettings({ ...settings, site_name: e.target.value })}
                className="admin-input"
                placeholder="eBilikAgamaTV"
              />
            </div>

            <ImageUploadField
              field="site_logo"
              label="Logo Laman"
              description="Logo akan dipaparkan di bahagian header"
              value={settings.site_logo || ""}
              uploadingField={uploadingField}
              onUpload={handleImageUpload}
              onClear={handleClearImage}
            />
          </div>
        </div>

        {/* Hero Section */}
        <div className="admin-card">
          <h2 className="text-white font-semibold text-lg mb-4">Bahagian Hero</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-gray-300 text-sm font-medium mb-2">
                Tajuk Hero
              </label>
              <input
                type="text"
                value={settings.hero_title || ""}
                onChange={(e) => setSettings({ ...settings, hero_title: e.target.value })}
                className="admin-input"
                placeholder="Siaran Langsung Televisyen Malaysia"
              />
            </div>

            <div>
              <label className="block text-gray-300 text-sm font-medium mb-2">
                Penerangan Hero
              </label>
              <textarea
                value={settings.hero_description || ""}
                onChange={(e) => setSettings({ ...settings, hero_description: e.target.value })}
                className="admin-input min-h-[80px] resize-y"
                placeholder="Penerangan ringkas tentang laman ini..."
                rows={2}
              />
            </div>

            <ImageUploadField
              field="hero_image"
              label="Gambar Hero"
              description="Latar belakang bahagian hero"
              value={settings.hero_image || ""}
              uploadingField={uploadingField}
              onUpload={handleImageUpload}
              onClear={handleClearImage}
            />
          </div>
        </div>

        {/* Section Titles */}
        <div className="admin-card">
          <h2 className="text-white font-semibold text-lg mb-4">Tajuk Bahagian</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-gray-300 text-sm font-medium mb-2">
                Tajuk &quot;Saluran TV&quot;
              </label>
              <input
                type="text"
                value={settings.saluran_tv_title || ""}
                onChange={(e) => setSettings({ ...settings, saluran_tv_title: e.target.value })}
                className="admin-input"
                placeholder="Saluran TV"
              />
            </div>

            <div>
              <label className="block text-gray-300 text-sm font-medium mb-2">
                Tajuk &quot;Saluran Khas&quot;
              </label>
              <input
                type="text"
                value={settings.saluran_khas_title || ""}
                onChange={(e) => setSettings({ ...settings, saluran_khas_title: e.target.value })}
                className="admin-input"
                placeholder="Saluran Khas"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="admin-card">
          <h2 className="text-white font-semibold text-lg mb-4">Footer</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-gray-300 text-sm font-medium mb-2">
                Teks Footer
              </label>
              <input
                type="text"
                value={settings.footer_text || ""}
                onChange={(e) => setSettings({ ...settings, footer_text: e.target.value })}
                className="admin-input"
                placeholder="© 2026 eBilikAgamaTV. Hak cipta terpelihara."
              />
            </div>

            <div>
              <label className="block text-gray-300 text-sm font-medium mb-2">
                Email Hubungan
              </label>
              <input
                type="email"
                value={settings.contact_email || ""}
                onChange={(e) => setSettings({ ...settings, contact_email: e.target.value })}
                className="admin-input"
                placeholder="email@example.com"
              />
            </div>
          </div>
        </div>

        {/* Social Media */}
        <div className="admin-card">
          <h2 className="text-white font-semibold text-lg mb-4">Media Sosial</h2>
          <div className="space-y-4">
            {[
              { key: "social_facebook", label: "Facebook URL" },
              { key: "social_twitter", label: "Twitter / X URL" },
              { key: "social_youtube", label: "YouTube URL" },
              { key: "social_instagram", label: "Instagram URL" },
            ].map((social) => (
              <div key={social.key}>
                <label className="block text-gray-300 text-sm font-medium mb-2">
                  {social.label}
                </label>
                <input
                  type="url"
                  value={settings[social.key] || ""}
                  onChange={(e) => setSettings({ ...settings, [social.key]: e.target.value })}
                  className="admin-input"
                  placeholder={`https://www.${social.key.replace("social_", "")}.com/...`}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Submit */}
        <div className="flex gap-4">
          <button
            type="submit"
            disabled={saving}
            className="admin-btn admin-btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            {saving ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Menyimpan...
              </>
            ) : (
              "Simpan Tetapan"
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
