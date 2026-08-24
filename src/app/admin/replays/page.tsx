"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Replay {
  id: string;
  title: string;
  description: string | null;
  videoUrl: string | null;
  googleDriveId: string | null;
  googleDriveUrl: string | null;
  thumbnail: string | null;
  duration: number | null;
  fileSize: bigint | null;
  date: string;
  published: boolean;
  createdAt: string;
}

export default function AdminReplaysPage() {
  const [replays, setReplays] = useState<Replay[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingReplay, setEditingReplay] = useState<Replay | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [googleDriveLink, setGoogleDriveLink] = useState("");
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  // Validation state
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    fileId?: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    fetchReplays();
  }, []);

  const fetchReplays = async () => {
    try {
      const res = await fetch("/api/replays?all=true");
      if (res.ok) {
        const data = await res.json();
        setReplays(data);
      }
    } catch {
      // Ignore error
    } finally {
      setLoading(false);
    }
  };

  // Extract Google Drive file ID from URL
  const extractGoogleDriveFileId = (url: string): string | null => {
    // Format: https://drive.google.com/file/d/FILE_ID/view
    const match1 = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (match1) return match1[1];

    // Format: https://drive.google.com/open?id=FILE_ID
    const match2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (match2) return match2[1];

    // Format: https://drive.google.com/uc?id=FILE_ID
    const match3 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (match3) return match3[1];

    return null;
  };

  // Validate Google Drive link
  const handleValidateLink = async () => {
    if (!googleDriveLink.trim()) {
      setValidationResult({
        valid: false,
        message: "Sila masukkan Google Drive link.",
      });
      return;
    }

    const fileId = extractGoogleDriveFileId(googleDriveLink);

    if (!fileId) {
      setValidationResult({
        valid: false,
        message: "Google Drive link tidak sah. Format yang betul: https://drive.google.com/file/d/FILE_ID/view",
      });
      return;
    }

    setValidating(true);
    setValidationResult(null);

    try {
      const res = await fetch("/api/google-drive/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ link: googleDriveLink, fileId }),
      });

      const data = await res.json();

      setValidationResult({
        valid: data.valid,
        fileId,
        message: data.message,
      });
    } catch {
      setValidationResult({
        valid: false,
        fileId,
        message: "Gagal menyemak video. Sila cuba lagi.",
      });
    } finally {
      setValidating(false);
    }
  };

  // Handle thumbnail change
  const handleThumbnailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      setError("Gambar terlalu besar. Saiz maksimum ialah 5 MB.");
      return;
    }

    setThumbnailFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      setThumbnailPreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  // Upload thumbnail
  const uploadThumbnail = async (): Promise<string | null> => {
    if (!thumbnailFile) return thumbnailUrl;

    const formData = new FormData();
    formData.append("thumbnail", thumbnailFile);

    const res = await fetch("/api/upload/thumbnail", {
      method: "POST",
      body: formData,
    });

    if (res.ok) {
      const data = await res.json();
      return data.thumbnailUrl;
    }

    return null;
  };

  // Save replay
  const handleSave = async (publish: boolean) => {
    if (!title.trim()) {
      setError("Sila masukkan tajuk.");
      return;
    }

    if (!googleDriveLink.trim()) {
      setError("Sila masukkan Google Drive link.");
      return;
    }

    const fileId = extractGoogleDriveFileId(googleDriveLink);
    if (!fileId) {
      setError("Google Drive link tidak sah.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      // Upload thumbnail if exists
      let finalThumbnailUrl = thumbnailUrl;
      if (thumbnailFile) {
        finalThumbnailUrl = await uploadThumbnail();
      }

      // Create or update replay
      const replayData = {
        title: title.trim(),
        description: description.trim() || null,
        date,
        googleDriveId: fileId,
        googleDriveUrl: googleDriveLink,
        thumbnail: finalThumbnailUrl,
        published: publish,
      };

      let res;
      if (editingReplay) {
        res = await fetch(`/api/replays/${editingReplay.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(replayData),
        });
      } else {
        res = await fetch("/api/replays", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(replayData),
        });
      }

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Gagal menyimpan rakaman");
      }

      // Reset form
      resetForm();
      setShowAdd(false);
      setEditingReplay(null);
      setSuccess(editingReplay ? "Rakaman berjaya dikemas kini!" : "Rakaman berjaya ditambah!");

      // Refresh list
      fetchReplays();
    } catch (err: any) {
      setError(err?.message || "Gagal menyimpan rakaman.");
    } finally {
      setSaving(false);
    }
  };

  // Reset form
  const resetForm = () => {
    setTitle("");
    setDescription("");
    setDate(new Date().toISOString().split("T")[0]);
    setGoogleDriveLink("");
    setThumbnailFile(null);
    setThumbnailPreview(null);
    setThumbnailUrl(null);
    setValidationResult(null);
    setError("");
    setSuccess("");
  };

  // Edit replay
  const handleEdit = (replay: Replay) => {
    setEditingReplay(replay);
    setTitle(replay.title);
    setDescription(replay.description || "");
    setDate(replay.date);
    setGoogleDriveLink(replay.googleDriveUrl || "");
    setThumbnailPreview(replay.thumbnail);
    setThumbnailUrl(replay.thumbnail);
    setValidationResult({
      valid: true,
      fileId: replay.googleDriveId || undefined,
      message: "Video sedia ada.",
    });
    setShowAdd(true);
  };

  // Delete replay
  const handleDelete = async (id: string) => {
    if (!confirm("Padam rakaman ini? Tindakan ini tidak boleh dibatalkan.")) {
      return;
    }

    try {
      const res = await fetch(`/api/replays/${id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        fetchReplays();
        setSuccess("Rakaman berjaya dipadam.");
      }
    } catch {
      // Ignore error
    }
  };

  // Toggle publish
  const handleTogglePublish = async (id: string, published: boolean) => {
    try {
      const res = await fetch(`/api/replays/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ published: !published }),
      });

      if (res.ok) {
        fetchReplays();
      }
    } catch {
      // Ignore error
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold mb-2">Live Replay</h1>
            <p className="text-gray-400">Urus rakaman siaran langsung</p>
          </div>
          <button
            onClick={() => {
              resetForm();
              setEditingReplay(null);
              setShowAdd(true);
            }}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Tambah Live Replay
          </button>
        </div>

        {/* Success/Error Messages */}
        {success && (
          <div className="bg-green-500/20 border border-green-500 text-green-400 px-4 py-3 rounded-lg mb-4">
            {success}
          </div>
        )}

        {error && (
          <div className="bg-red-500/20 border border-red-500 text-red-400 px-4 py-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        {/* Add/Edit Modal */}
        {showAdd && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-900 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold">
                  {editingReplay ? "Edit Live Replay" : "Tambah Live Replay"}
                </h2>
                <button
                  onClick={() => {
                    setShowAdd(false);
                    setEditingReplay(null);
                    resetForm();
                  }}
                  className="text-gray-400 hover:text-white"
                  disabled={saving}
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {error && (
                <div className="bg-red-500/20 border border-red-500 text-red-400 px-4 py-3 rounded-lg mb-4">
                  {error}
                </div>
              )}

              <div className="space-y-4">
                {/* Title */}
                <div>
                  <label className="block text-sm font-medium mb-2">Tajuk *</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 focus:outline-none focus:border-red-500"
                    placeholder="Ceramah Perdana 2026"
                    disabled={saving}
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium mb-2">Penerangan</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 focus:outline-none focus:border-red-500 h-24 resize-none"
                    placeholder="Penerangan ringkas tentang siaran..."
                    disabled={saving}
                  />
                </div>

                {/* Date */}
                <div>
                  <label className="block text-sm font-medium mb-2">Tarikh Siaran *</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 focus:outline-none focus:border-red-500"
                    disabled={saving}
                  />
                </div>

                {/* Google Drive Link */}
                <div>
                  <label className="block text-sm font-medium mb-2">Google Drive Video Link *</label>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={googleDriveLink}
                      onChange={(e) => {
                        setGoogleDriveLink(e.target.value);
                        setValidationResult(null);
                      }}
                      className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 focus:outline-none focus:border-red-500"
                      placeholder="https://drive.google.com/file/d/FILE_ID/view"
                      disabled={saving}
                    />
                    <button
                      onClick={handleValidateLink}
                      disabled={saving || validating || !googleDriveLink.trim()}
                      className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-medium text-sm whitespace-nowrap"
                    >
                      {validating ? "Menyemak..." : "Semak Video"}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Paste Google Drive sharing link di sini. Pastikan video ditetapkan sebagai &quot;Anyone with the link&quot;.
                  </p>

                  {/* Validation Result */}
                  {validationResult && (
                    <div className={`mt-2 px-3 py-2 rounded-lg text-sm ${
                      validationResult.valid
                        ? "bg-green-500/20 border border-green-500 text-green-400"
                        : "bg-red-500/20 border border-red-500 text-red-400"
                    }`}>
                      {validationResult.valid ? "✓" : "✕"} {validationResult.message}
                    </div>
                  )}
                </div>

                {/* Thumbnail */}
                <div>
                  <label className="block text-sm font-medium mb-2">Thumbnail (pilihan)</label>
                  <div className="border-2 border-dashed border-gray-700 rounded-lg p-4 text-center hover:border-red-500 transition-colors">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleThumbnailChange}
                      className="hidden"
                      id="thumbnail-upload"
                      disabled={saving}
                    />
                    <label htmlFor="thumbnail-upload" className={`cursor-pointer ${saving ? "pointer-events-none opacity-50" : ""}`}>
                      {thumbnailPreview ? (
                        <img src={thumbnailPreview} alt="Thumbnail" className="max-h-32 mx-auto rounded-lg" />
                      ) : (
                        <div>
                          <svg className="w-8 h-8 text-gray-500 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <p className="text-gray-400 text-sm">Pilih thumbnail</p>
                        </div>
                      )}
                    </label>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => handleSave(true)}
                    disabled={saving || !title.trim() || !googleDriveLink.trim()}
                    className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-3 rounded-lg font-medium transition-colors"
                  >
                    {saving ? "Menyimpan..." : "Save & Publish"}
                  </button>
                  <button
                    onClick={() => handleSave(false)}
                    disabled={saving || !title.trim() || !googleDriveLink.trim()}
                    className="flex-1 bg-gray-600 hover:bg-gray-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-3 rounded-lg font-medium transition-colors"
                  >
                    {saving ? "Menyimpan..." : "Save as Draft"}
                  </button>
                  <button
                    onClick={() => {
                      setShowAdd(false);
                      setEditingReplay(null);
                      resetForm();
                    }}
                    disabled={saving}
                    className="px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium transition-colors"
                  >
                    Batal
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Replays List */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : replays.length === 0 ? (
          <div className="text-center py-12 bg-gray-900 rounded-xl">
            <svg className="w-16 h-16 text-gray-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-gray-400">Tiada rakaman lagi. Klik &quot;Tambah Live Replay&quot; untuk memulakan.</p>
          </div>
        ) : (
          <div className="bg-gray-900 rounded-xl overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-800">
                <tr>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-400">Video</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-400">Tarikh</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-400">Status</th>
                  <th className="text-right px-6 py-4 text-sm font-medium text-gray-400">Tindakan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {replays.map((replay) => (
                  <tr key={replay.id} className="hover:bg-gray-800/50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-4">
                        {replay.thumbnail ? (
                          <img src={replay.thumbnail} alt="" className="w-20 h-12 object-cover rounded" />
                        ) : (
                          <div className="w-20 h-12 bg-gray-800 rounded flex items-center justify-center">
                            <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                            </svg>
                          </div>
                        )}
                        <div>
                          <p className="font-medium">{replay.title}</p>
                          {replay.description && (
                            <p className="text-gray-400 text-sm truncate max-w-xs">{replay.description}</p>
                          )}
                          {replay.googleDriveUrl && (
                            <p className="text-gray-500 text-xs truncate max-w-xs mt-1">
                              🔗 {replay.googleDriveUrl}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-400">{replay.date}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${replay.published ? "bg-green-500/20 text-green-400" : "bg-yellow-500/20 text-yellow-400"}`}>
                        {replay.published ? "Published" : "Draft"}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleTogglePublish(replay.id, replay.published)}
                          className="px-3 py-1 text-sm rounded hover:bg-gray-700 transition-colors"
                        >
                          {replay.published ? "Unpublish" : "Publish"}
                        </button>
                        <button
                          onClick={() => handleEdit(replay)}
                          className="px-3 py-1 text-sm rounded hover:bg-gray-700 transition-colors"
                        >
                          Edit
                        </button>
                        <Link
                          href={`/replay/${replay.id}`}
                          className="px-3 py-1 text-sm rounded hover:bg-gray-700 transition-colors"
                          target="_blank"
                        >
                          Lihat
                        </Link>
                        <button
                          onClick={() => handleDelete(replay.id)}
                          className="px-3 py-1 text-sm text-red-400 rounded hover:bg-red-500/20 transition-colors"
                        >
                          Padam
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
