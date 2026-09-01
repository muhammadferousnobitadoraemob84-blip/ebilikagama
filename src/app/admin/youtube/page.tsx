"use client";

import { useEffect, useState, useCallback } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import Link from "next/link";

// ─── Types ───────────────────────────────────────────────────────────

interface YouTubeStream {
  id: string;
  title: string;
  description: string;
  scheduledStartTime: string | null;
  thumbnail: string | null;
  channelId: string;
  status: string;
  youtubeUrl: string;
  alreadyImported: boolean;
}

interface Channel {
  id: string;
  name: string;
  category: string;
  active: boolean;
}

interface YouTubeStatus {
  connected: boolean;
  channelName: string | null;
  channelId: string | null;
  error?: string | null;
  errorDetails?: string | null;
  verified?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function formatMalaysiaDateTime(isoTimestamp: string): { date: string; time: string } {
  try {
    const date = new Date(isoTimestamp);
    const malaysiaTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);

    const dateStr = malaysiaTime.toLocaleDateString("en-MY", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Kuala_Lumpur",
    });
    const timeStr = malaysiaTime.toLocaleTimeString("en-MY", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZone: "Asia/Kuala_Lumpur",
    });

    return { date: dateStr, time: timeStr };
  } catch {
    return { date: "Unknown date", time: "Unknown time" };
  }
}

function getStatusBadge(status: string) {
  const s = status.toLowerCase();
  if (s.includes("ready") || s.includes("live")) {
    return { text: "LIVE", color: "bg-green-600 text-white" };
  }
  if (s.includes("revoked") || s.includes("deleted")) {
    return { text: "Revoked", color: "bg-red-600/80 text-white" };
  }
  return { text: status, color: "bg-blue-600/80 text-blue-200" };
}

// ─── Page Component ──────────────────────────────────────────────────

export default function YouTubeScheduledStreamsPage() {
  const { t } = useLanguage();

  // State
  const [ytStatus, setYtStatus] = useState<YouTubeStatus | null>(null);
  const [streams, setStreams] = useState<YouTubeStream[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchingStreams, setFetchingStreams] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // Import flow state
  const [selectedStream, setSelectedStream] = useState<YouTubeStream | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [importing, setImporting] = useState(false);

  // Toast
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 5000);
  };

  // ─── Data Fetching ───────────────────────────────────────────────

  const fetchYouTubeStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/youtube/status");
      if (res.ok) {
        const data = await res.json();
        setYtStatus(data);
        return data;
      }
    } catch {
      // ignore
    }
    return { connected: false };
  }, []);

  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch("/api/channels?all=true");
      if (res.ok) {
        const data = await res.json();
        setChannels(data.filter((c: Channel) => c.active));
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchStreams = useCallback(async () => {
    setFetchingStreams(true);
    try {
      const res = await fetch("/api/youtube/streams");
      const data = await res.json();

      if (!res.ok || data.error) {
        showToast("error", data.error || "Failed to fetch streams");
        setStreams([]);
      } else {
        setStreams(data.streams || []);
      }
    } catch {
      showToast("error", "Network error while fetching streams");
      setStreams([]);
    } finally {
      setFetchingStreams(false);
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    (async () => {
      const status = await fetchYouTubeStatus();
      await fetchChannels();
      if (status.connected) {
        await fetchStreams();
      } else {
        setLoading(false);
      }
    })();
  }, []);

  // Handle OAuth callback results
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ytResult = params.get("yt");
    if (ytResult === "success") {
      showToast("success", "YouTube account connected successfully!");
      fetchYouTubeStatus().then((status) => {
        if (status.connected) fetchStreams();
      });
      window.history.replaceState({}, "", "/admin/youtube");
    } else if (ytResult === "error") {
      const message = params.get("message") || "Authorization failed";
      const details = params.get("details") || "";
      showToast("error", decodeURIComponent(message));
      // Store the detailed error in state so the UI can display it
      setYtStatus({
        connected: false,
        channelName: null,
        channelId: null,
        error: decodeURIComponent(message),
        errorDetails: details ? decodeURIComponent(details) : null,
      });
      window.history.replaceState({}, "", "/admin/youtube");
    }
  }, [fetchYouTubeStatus, fetchStreams]);

  // ─── Actions ─────────────────────────────────────────────────────

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const res = await fetch("/api/youtube/auth");
      const data = await res.json();
      if (data.authUrl) {
        window.location.href = data.authUrl;
      } else {
        showToast("error", "Failed to generate authorization URL");
      }
    } catch {
      showToast("error", "Failed to initiate YouTube connection");
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Are you sure you want to disconnect your YouTube account?")) return;
    setDisconnecting(true);
    try {
      const res = await fetch("/api/youtube/disconnect", { method: "POST" });
      if (res.ok) {
        setYtStatus({ connected: false, channelName: null, channelId: null });
        setStreams([]);
        showToast("success", "YouTube account disconnected");
      } else {
        showToast("error", "Failed to disconnect");
      }
    } catch {
      showToast("error", "Failed to disconnect");
    } finally {
      setDisconnecting(false);
    }
  };

  const handleRefreshStreams = () => {
    fetchStreams();
  };

  const handleSelectStream = (stream: YouTubeStream) => {
    if (stream.alreadyImported) return;
    setSelectedStream(stream);
    setSelectedChannelId("");
    setShowConfirmModal(true);
  };

  const handleConfirmImport = async () => {
    if (!selectedStream || !selectedChannelId) return;

    setImporting(true);
    try {
      const res = await fetch("/api/youtube/streams/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: selectedChannelId,
          broadcastId: selectedStream.id,
          title: selectedStream.title,
          description: selectedStream.description,
          scheduledStartTime: selectedStream.scheduledStartTime,
          thumbnail: selectedStream.thumbnail,
          youtubeUrl: selectedStream.youtubeUrl,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        showToast("success", data.message || "Stream imported successfully!");
        setShowConfirmModal(false);
        setSelectedStream(null);
        fetchStreams(); // Refresh to show "Already Added" status
      } else {
        if (res.status === 409 && data.conflict) {
          showToast("error", data.error);
        } else {
          showToast("error", data.error || "Failed to import stream");
        }
      }
    } catch {
      showToast("error", "Network error while importing stream");
    } finally {
      setImporting(false);
    }
  };

  // ─── Render ──────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-2xl text-sm font-medium flex items-center gap-2 ${
          toast.type === "success" ? "bg-green-600 text-white" : "bg-red-600 text-white"
        }`}>
          {toast.type === "success" ? "✓" : "✕"} {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">YouTube Scheduled Streams</h1>
          <p className="text-gray-400 text-sm mt-1">
            Connect your YouTube account to import scheduled livestreams into the EPG.
          </p>
        </div>
        {ytStatus?.connected && (
          <button
            onClick={handleRefreshStreams}
            disabled={fetchingStreams}
            className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
          >
            <svg className={`w-4 h-4 ${fetchingStreams ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {fetchingStreams ? "Loading..." : "Refresh"}
          </button>
        )}
      </div>

      {/* Connection Status */}
      <div className="bg-gray-900/50 border border-white/10 rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            {/* YouTube Icon */}
            <div className="w-12 h-12 bg-red-600/20 rounded-xl flex items-center justify-center flex-shrink-0">
              <svg className="w-7 h-7 text-red-400" viewBox="0 0 24 24" fill="currentColor">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
              </svg>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-white font-semibold">YouTube Account</h3>
                {ytStatus?.connected ? (
                  <span className="inline-flex items-center gap-1 bg-green-600/20 text-green-400 text-xs font-medium px-2 py-0.5 rounded-full border border-green-600/30">
                    <span className="w-1.5 h-1.5 bg-green-400 rounded-full" />
                    Connected
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 bg-gray-600/20 text-gray-400 text-xs font-medium px-2 py-0.5 rounded-full border border-gray-600/30">
                    Not Connected
                  </span>
                )}
              </div>
              {ytStatus?.connected && ytStatus.channelName && (
                <p className="text-gray-400 text-sm mt-0.5">{ytStatus.channelName}</p>
              )}
              {!ytStatus?.connected && !ytStatus?.error && (
                <p className="text-gray-500 text-sm mt-0.5">Connect to import your scheduled livestreams</p>
              )}
              {!ytStatus?.connected && ytStatus?.error && (
                <div className="mt-2">
                  <p className="text-red-400 text-sm font-medium">⚠ {ytStatus.error}</p>
                  {ytStatus.errorDetails && (
                    <details className="mt-1">
                      <summary className="text-gray-500 text-xs cursor-pointer hover:text-gray-400">Technical details</summary>
                      <pre className="text-gray-500 text-xs mt-1 whitespace-pre-wrap break-words bg-gray-800/50 rounded-lg p-2 max-h-32 overflow-y-auto">{ytStatus.errorDetails}</pre>
                    </details>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {ytStatus?.connected ? (
              <>
                <button
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {disconnecting ? "Disconnecting..." : "Disconnect"}
                </button>
              </>
            ) : (
              <button
                onClick={handleConnect}
                disabled={connecting}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                </svg>
                {connecting ? "Connecting..." : "Connect YouTube Account"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Scheduled Streams */}
      {ytStatus?.connected && (
        <div className="bg-gray-900/50 border border-white/10 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-white/10 flex items-center justify-between">
            <div>
              <h3 className="text-white font-semibold">Scheduled Livestreams</h3>
              <p className="text-gray-400 text-xs mt-0.5">
                {streams.length} stream{streams.length !== 1 ? "s" : ""} found
              </p>
            </div>
          </div>

          {loading || fetchingStreams ? (
            <div className="p-12 text-center">
              <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-gray-400 text-sm">Fetching scheduled streams from YouTube...</p>
            </div>
          ) : streams.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-gray-400">No scheduled livestreams found.</p>
              <p className="text-gray-500 text-sm mt-1">Schedule a livestream on YouTube to see it here.</p>
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {streams.map((stream) => {
                const { date, time } = stream.scheduledStartTime
                  ? formatMalaysiaDateTime(stream.scheduledStartTime)
                  : { date: "TBD", time: "TBD" };
                const badge = getStatusBadge(stream.status);

                return (
                  <div key={stream.id} className="p-4 hover:bg-white/5 transition-colors">
                    <div className="flex flex-col sm:flex-row gap-4">
                      {/* Thumbnail */}
                      <div className="w-full sm:w-48 h-28 bg-gray-800 rounded-lg overflow-hidden flex-shrink-0">
                        {stream.thumbnail ? (
                          <img src={stream.thumbnail} alt={stream.title} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                            </svg>
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-white font-medium text-sm truncate">{stream.title}</h4>
                          <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-md flex-shrink-0 ${badge.color}`}>
                            {badge.text}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-gray-400">
                          <span className="inline-flex items-center gap-1">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            {date}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            {time}
                          </span>
                          {stream.youtubeUrl && (
                            <a
                              href={stream.youtubeUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-red-400 hover:text-red-300"
                            >
                              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                              </svg>
                              YouTube
                            </a>
                          )}
                        </div>

                        {stream.description && (
                          <p className="text-gray-500 text-xs mt-2 line-clamp-2">{stream.description}</p>
                        )}
                      </div>

                      {/* Action */}
                      <div className="flex items-center sm:ml-4 flex-shrink-0">
                        {stream.alreadyImported ? (
                          <span className="inline-flex items-center gap-1.5 bg-green-600/10 text-green-400 text-xs font-medium px-3 py-2 rounded-lg border border-green-600/20">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            Already Added
                          </span>
                        ) : (
                          <button
                            onClick={() => handleSelectStream(stream)}
                            className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            Assign to Channel
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── Confirm Import Modal ──────────────────────────────────── */}
      {showConfirmModal && selectedStream && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-white/10 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="p-6 border-b border-white/10">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Confirm Scheduled Stream</h2>
                <button
                  onClick={() => { setShowConfirmModal(false); setSelectedStream(null); }}
                  className="text-gray-400 hover:text-white p-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="p-6 space-y-5">
              {/* Stream Info */}
              <div className="bg-gray-800/50 rounded-xl p-4">
                <h4 className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-2">YouTube Stream</h4>
                <div className="space-y-2">
                  <div>
                    <span className="text-gray-500 text-xs">Title</span>
                    <p className="text-white text-sm font-medium">{selectedStream.title}</p>
                  </div>
                  {selectedStream.scheduledStartTime && (
                    <div className="flex gap-6">
                      <div>
                        <span className="text-gray-500 text-xs">Date</span>
                        <p className="text-white text-sm">
                          {formatMalaysiaDateTime(selectedStream.scheduledStartTime).date}
                        </p>
                      </div>
                      <div>
                        <span className="text-gray-500 text-xs">Time</span>
                        <p className="text-white text-sm">
                          {formatMalaysiaDateTime(selectedStream.scheduledStartTime).time}
                        </p>
                      </div>
                    </div>
                  )}
                  {selectedStream.youtubeUrl && (
                    <div>
                      <span className="text-gray-500 text-xs">YouTube URL</span>
                      <a href={selectedStream.youtubeUrl} target="_blank" rel="noopener noreferrer"
                        className="text-red-400 text-sm hover:underline block truncate">
                        {selectedStream.youtubeUrl}
                      </a>
                    </div>
                  )}
                </div>
              </div>

              {/* Channel Selection */}
              <div>
                <label className="block text-sm text-gray-300 mb-1.5">Assign to Channel *</label>
                <select
                  value={selectedChannelId}
                  onChange={(e) => setSelectedChannelId(e.target.value)}
                  className="w-full bg-gray-800 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-red-500"
                >
                  <option value="">Select a channel...</option>
                  {channels.map((ch) => (
                    <option key={ch.id} value={ch.id}>{ch.name}</option>
                  ))}
                </select>
              </div>

              {/* Summary */}
              {selectedChannelId && (
                <div className="bg-blue-600/10 border border-blue-600/20 rounded-xl p-4">
                  <h4 className="text-xs text-blue-400 font-medium uppercase tracking-wide mb-2">Summary</h4>
                  <div className="space-y-1 text-sm">
                    <p className="text-gray-300">
                      <span className="text-gray-500">Stream: </span>
                      <span className="text-white">{selectedStream.title}</span>
                    </p>
                    {selectedStream.scheduledStartTime && (
                      <p className="text-gray-300">
                        <span className="text-gray-500">Date: </span>
                        <span className="text-white">
                          {formatMalaysiaDateTime(selectedStream.scheduledStartTime).date} at{" "}
                          {formatMalaysiaDateTime(selectedStream.scheduledStartTime).time}
                        </span>
                      </p>
                    )}
                    <p className="text-gray-300">
                      <span className="text-gray-500">Channel: </span>
                      <span className="text-white font-medium">
                        {channels.find((c) => c.id === selectedChannelId)?.name || "—"}
                      </span>
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="p-6 border-t border-white/10 flex items-center justify-end gap-3">
              <button
                onClick={() => { setShowConfirmModal(false); setSelectedStream(null); }}
                className="px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm font-medium transition-colors"
              >
                Back / Cancel
              </button>
              <button
                onClick={handleConfirmImport}
                disabled={importing || !selectedChannelId}
                className="px-6 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-medium transition-colors"
              >
                {importing ? "Importing..." : "Confirm & Add to Schedule"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
