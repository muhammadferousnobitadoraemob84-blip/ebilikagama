"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Replay {
  id: string;
  title: string;
  description: string | null;
  videoUrl: string;
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
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null);

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

  const handleVideoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file size (20GB max)
    const maxSize = 20 * 1024 * 1024 * 1024;
    if (file.size > maxSize) {
      setUploadError("Fail terlalu besar. Saiz maksimum ialah 20 GB.");
      return;
    }

    // Validate file type
    const allowedTypes = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"];
    if (!allowedTypes.includes(file.type)) {
      setUploadError("Format video tidak disokong. Gunakan: MP4, MOV, WebM, MKV");
      return;
    }

    setVideoFile(file);
    setUploadError("");
  };

  const handleThumbnailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file size (5MB max)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      setUploadError("Gambar terlalu besar. Saiz maksimum ialah 5 MB.");
      return;
    }

    setThumbnailFile(file);
    
    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setThumbnailPreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleUpload = async () => {
    if (!videoFile || !title || !date) {
      setUploadError("Sila isi semua medan yang diperlukan.");
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setUploadError("");

    try {
      // Upload thumbnail first if exists
      let thumbnailUrl = null;
      if (thumbnailFile) {
        const thumbFormData = new FormData();
        thumbFormData.append("thumbnail", thumbnailFile);
        
        const thumbRes = await fetch("/api/upload/thumbnail", {
          method: "POST",
          body: thumbFormData,
        });
        
        if (thumbRes.ok) {
          const thumbData = await thumbRes.json();
          thumbnailUrl = thumbData.thumbnailUrl;
        }
      }

      // Chunked video upload
      const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB chunks (smaller for reliability)
      const totalChunks = Math.ceil(videoFile.size / CHUNK_SIZE);
      
      setUploadProgress(0);

      // Step 1: Initialize upload
      console.log("[UPLOAD] Initializing...");
      const initRes = await fetch("/api/upload/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "init",
          filename: videoFile.name,
          fileSize: videoFile.size,
        }),
      });

      if (!initRes.ok) {
        const errData = await initRes.json();
        throw new Error(errData.error || "Failed to initialize upload");
      }

      const { uploadId } = await initRes.json();
      console.log("[UPLOAD] Upload ID:", uploadId, "Total chunks:", totalChunks);

      // Step 2: Upload chunks
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, videoFile.size);
        const chunk = videoFile.slice(start, end);
        
        // Convert chunk to base64 using FileReader for better memory handling
        const chunkBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            // Remove data:...;base64, prefix
            const base64 = result.split(",")[1];
            resolve(base64);
          };
          reader.onerror = reject;
          reader.readAsDataURL(chunk);
        });

        console.log(`[UPLOAD] Uploading chunk ${i + 1}/${totalChunks}...`);
        
        const chunkRes = await fetch("/api/upload/video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "chunk",
            uploadId,
            chunkIndex: i,
            chunkData: chunkBase64,
          }),
        });

        if (!chunkRes.ok) {
          const errText = await chunkRes.text();
          console.error("[UPLOAD] Chunk error:", errText);
          throw new Error(`Failed to upload chunk ${i + 1}/${totalChunks}: ${errText}`);
        }

        // Update progress
        const progress = Math.round(((i + 1) / totalChunks) * 100);
        setUploadProgress(progress);
        console.log(`[UPLOAD] Progress: ${progress}%`);
      }

      // Step 3: Complete upload
      console.log("[UPLOAD] Completing upload...");
      const completeRes = await fetch("/api/upload/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "complete",
          uploadId,
          filename: videoFile.name,
          totalChunks,
        }),
      });

      if (!completeRes.ok) {
        const errData = await completeRes.json();
        throw new Error(errData.error || "Failed to complete upload");
      }

      const videoResult = await completeRes.json();
      console.log("[UPLOAD] Upload complete:", videoResult);

      // Create replay record
      const replayRes = await fetch("/api/replays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: description || null,
          videoUrl: videoResult.videoUrl,
          thumbnail: thumbnailUrl,
          fileSize: videoResult.fileSize,
          date,
          published: false,
        }),
      });

      if (!replayRes.ok) {
        throw new Error("Failed to create replay record");
      }

      // Reset form
      setTitle("");
      setDescription("");
      setDate(new Date().toISOString().split("T")[0]);
      setVideoFile(null);
      setThumbnailFile(null);
      setThumbnailPreview(null);
      setShowUpload(false);
      setUploadProgress(0);

      // Refresh list
      fetchReplays();
    } catch (err: any) {
      console.error("Upload error:", err);
      const errorMsg = err?.message || "Gagal memuat naik video. Sila cuba lagi.";
      setUploadError(errorMsg);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Padam video ini? Tindakan ini tidak boleh dibatalkan.")) {
      return;
    }

    try {
      const res = await fetch(`/api/replays/${id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        fetchReplays();
      }
    } catch {
      // Ignore error
    }
  };

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

  const formatFileSize = (bytes: bigint | null): string => {
    if (!bytes) return "";
    const gb = Number(bytes) / (1024 * 1024 * 1024);
    if (gb >= 1) {
      return `${gb.toFixed(1)} GB`;
    }
    const mb = Number(bytes) / (1024 * 1024);
    return `${mb.toFixed(0)} MB`;
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
            onClick={() => setShowUpload(true)}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Upload Live Replay
          </button>
        </div>

        {/* Upload Modal */}
        {showUpload && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-900 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold">Upload Live Replay</h2>
                <button
                  onClick={() => {
                    setShowUpload(false);
                    setUploadError("");
                    setUploadProgress(0);
                  }}
                  className="text-gray-400 hover:text-white"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {uploadError && (
                <div className="bg-red-500/20 border border-red-500 text-red-400 px-4 py-3 rounded-lg mb-4">
                  {uploadError}
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
                  />
                </div>

                {/* Video Upload */}
                <div>
                  <label className="block text-sm font-medium mb-2">Video *</label>
                  <div className="border-2 border-dashed border-gray-700 rounded-lg p-6 text-center hover:border-red-500 transition-colors">
                    <input
                      type="file"
                      accept="video/mp4,video/quicktime,video/webm,video/x-matroska"
                      onChange={handleVideoChange}
                      className="hidden"
                      id="video-upload"
                    />
                    <label htmlFor="video-upload" className="cursor-pointer">
                      {videoFile ? (
                        <div>
                          <p className="text-green-400 font-medium">{videoFile.name}</p>
                          <p className="text-gray-400 text-sm mt-1">{formatFileSize(BigInt(videoFile.size))}</p>
                        </div>
                      ) : (
                        <div>
                          <svg className="w-12 h-12 text-gray-500 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                          </svg>
                          <p className="text-gray-400">Klik untuk pilih video</p>
                          <p className="text-gray-500 text-sm mt-1">Saiz maksimum: 20 GB</p>
                          <p className="text-gray-500 text-sm">Format: MP4, MOV, WebM, MKV</p>
                        </div>
                      )}
                    </label>
                  </div>
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
                    />
                    <label htmlFor="thumbnail-upload" className="cursor-pointer">
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

                {/* Upload Progress */}
                {uploading && (
                  <div className="bg-gray-800 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-400">Memuat naik video...</span>
                      <span className="text-sm font-medium">{uploadProgress}%</span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-2">
                      <div
                        className="bg-red-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-3 pt-4">
                  <button
                    onClick={handleUpload}
                    disabled={uploading || !videoFile || !title}
                    className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-3 rounded-lg font-medium transition-colors"
                  >
                    {uploading ? "Memuat naik..." : "Muat Naik"}
                  </button>
                  <button
                    onClick={() => {
                      setShowUpload(false);
                      setUploadError("");
                      setUploadProgress(0);
                    }}
                    disabled={uploading}
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
            <p className="text-gray-400">Tiada rakaman lagi. Klik &quot;Upload Live Replay&quot; untuk memulakan.</p>
          </div>
        ) : (
          <div className="bg-gray-900 rounded-xl overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-800">
                <tr>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-400">Video</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-400">Tarikh</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-400">Saiz</th>
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
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-400">{replay.date}</td>
                    <td className="px-6 py-4 text-gray-400">{formatFileSize(replay.fileSize)}</td>
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
