"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface TwitchVerifyPreviewProps {
  username: string;
  onVerified: (verified: boolean) => void;
  verifiedUsername: string | null;
}

export default function TwitchVerifyPreview({
  username,
  onVerified,
  verifiedUsername,
}: TwitchVerifyPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{
    status: "found" | "not_found" | "error" | "live" | "offline";
    message: string;
    displayName?: string;
  } | null>(null);
  const [embedLoaded, setEmbedLoaded] = useState(false);
  const [embedError, setEmbedError] = useState(false);
  const [embedLoading, setEmbedLoading] = useState(false);
  const [pendingEmbed, setPendingEmbed] = useState<{
    username: string;
    displayName: string;
  } | null>(null);
  const lastCheckedUsername = useRef<string | null>(null);
  const verifiedCallbackRef = useRef(onVerified);
  verifiedCallbackRef.current = onVerified;

  // Reset verification when username changes
  useEffect(() => {
    if (username.trim().toLowerCase() !== lastCheckedUsername.current) {
      setVerifyResult(null);
      setEmbedLoaded(false);
      setEmbedError(false);
      setPendingEmbed(null);
      verifiedCallbackRef.current(false);
    }
  }, [username]);

  // Load embed when pendingEmbed changes and container ref is available
  useEffect(() => {
    if (!pendingEmbed || !containerRef.current) return;

    const container = containerRef.current;
    container.innerHTML = "";
    const iframe = document.createElement("iframe");
    iframe.src = `https://player.twitch.tv/?channel=${pendingEmbed.username}&parent=${window.location.hostname}&muted=false`;
    iframe.allowFullscreen = true;
    iframe.allow =
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "none";
    iframe.style.borderRadius = "0.75rem";

    let settled = false;

    iframe.onload = () => {
      if (settled) return;
      settled = true;
      setEmbedLoaded(true);
      setEmbedLoading(false);
      setVerifyResult({
        status: "found",
        message: "Siaran berjaya disahkan dan boleh dimainkan.",
        displayName: pendingEmbed.displayName,
      });
      verifiedCallbackRef.current(true);
    };

    iframe.onerror = () => {
      if (settled) return;
      settled = true;
      setEmbedError(true);
      setEmbedLoading(false);
      setVerifyResult({
        status: "error",
        message: "Saluran Twitch ditemui tetapi siaran tidak dapat dimuatkan.",
      });
      verifiedCallbackRef.current(true);
    };

    container.appendChild(iframe);

    // Timeout: if embed doesn't load in 10s, show offline but still verify
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        setEmbedLoading(false);
        setVerifyResult({
          status: "offline",
          message: "Saluran Twitch ditemui tetapi sedang OFFLINE.",
          displayName: pendingEmbed.displayName,
        });
        verifiedCallbackRef.current(true);
      }
    }, 10000);

    return () => {
      clearTimeout(timer);
      settled = true;
    };
  }, [pendingEmbed]);

  const handleVerify = useCallback(async () => {
    if (!username.trim()) return;

    setVerifying(true);
    setEmbedLoaded(false);
    setEmbedError(false);
    setEmbedLoading(true);
    setPendingEmbed(null);
    setVerifyResult(null);
    lastCheckedUsername.current = username.trim().toLowerCase();

    try {
      const res = await fetch("/api/twitch/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim() }),
      });

      const data = await res.json();

      if (!data.exists) {
        setVerifyResult({
          status: "not_found",
          message: data.message || "Saluran Twitch tidak ditemui.",
        });
        verifiedCallbackRef.current(false);
        setVerifying(false);
        setEmbedLoading(false);
        return;
      }

      // Mark as verifying — the useEffect will create the embed
      setVerifyResult({
        status: "found",
        message: "Saluran Twitch ditemui. Memuatkan paparan...",
        displayName: data.displayName || username.trim(),
      });
      setPendingEmbed({
        username: username.trim().toLowerCase(),
        displayName: data.displayName || username.trim(),
      });
    } catch {
      setVerifyResult({
        status: "error",
        message: "Ralat semasa menyemak saluran. Sila cuba lagi.",
      });
      verifiedCallbackRef.current(false);
    } finally {
      setVerifying(false);
    }
  }, [username]);

  const isVerified =
    verifiedUsername === username.trim().toLowerCase() && verifyResult?.status !== "not_found";

  return (
    <div className="space-y-4">
      {/* Verify Button */}
      <button
        type="button"
        onClick={handleVerify}
        disabled={!username.trim() || verifying}
        className="w-full admin-btn bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 border border-blue-600/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 py-3"
      >
        {verifying ? (
          <>
            <span className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            Menyemak saluran...
          </>
        ) : (
          <>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            Semak Siaran
          </>
        )}
      </button>

      {/* Verification Result */}
      {verifyResult && (
        <div className="space-y-4">
          {/* Status Banner */}
          <div
            className={`px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-2 ${
              verifyResult.status === "found"
                ? "bg-green-600/10 border border-green-600/30 text-green-400"
                : verifyResult.status === "offline"
                ? "bg-yellow-600/10 border border-yellow-600/30 text-yellow-400"
                : verifyResult.status === "error"
                ? "bg-yellow-600/10 border border-yellow-600/30 text-yellow-400"
                : "bg-red-600/10 border border-red-600/30 text-red-400"
            }`}
          >
            {verifyResult.status === "found" && <span className="text-lg">🟢</span>}
            {verifyResult.status === "offline" && <span className="text-lg">🟠</span>}
            {verifyResult.status === "error" && <span className="text-lg">⚠️</span>}
            {verifyResult.status === "not_found" && <span className="text-lg">🔴</span>}
            <span>{verifyResult.message}</span>
          </div>

          {/* Channel Info Card */}
          {verifyResult.status !== "not_found" && (
            <div className="admin-card">
              <div className="flex items-center gap-2 mb-3">
                {verifyResult.status === "found" && embedLoaded ? (
                  <span className="bg-red-600 text-white text-xs font-bold px-2 py-0.5 rounded flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                    LIVE
                  </span>
                ) : verifyResult.status === "offline" ? (
                  <span className="bg-yellow-600/80 text-white text-xs font-medium px-2 py-0.5 rounded">
                    OFFLINE
                  </span>
                ) : verifyResult.status === "error" ? (
                  <span className="bg-yellow-600/80 text-white text-xs font-medium px-2 py-0.5 rounded">
                    ⚠️ Ralat Embed
                  </span>
                ) : (
                  <span className="bg-green-600/80 text-white text-xs font-medium px-2 py-0.5 rounded">
                    DITEMUI
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-gray-500 text-xs">Twitch Channel</p>
                  <p className="text-white font-medium">
                    {verifyResult.displayName || username.trim()}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Username</p>
                  <p className="text-white font-medium">{username.trim().toLowerCase()}</p>
                </div>
              </div>
            </div>
          )}

          {/* Embed Preview */}
          {verifyResult.status !== "not_found" && (
            <div className="relative">
              <div className="aspect-video bg-gray-900 rounded-xl overflow-hidden border border-white/10">
                {embedLoading && (
                  <div className="absolute inset-0 bg-gray-900 rounded-xl flex items-center justify-center z-10">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      <p className="text-gray-400 text-sm">Memuatkan paparan semak...</p>
                    </div>
                  </div>
                )}
                {embedError && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-4">
                    <svg className="w-12 h-12 text-gray-600 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    <p className="text-gray-400 text-sm text-center">
                      Paparan embed tidak dapat dimuatkan.
                      <br />
                      Sila semak username dan sambungan internet.
                    </p>
                  </div>
                )}
                <div ref={containerRef} className="w-full h-full" />
              </div>
            </div>
          )}

          {/* Offline Warning */}
          {verifyResult.status === "offline" && (
            <div className="bg-yellow-600/5 border border-yellow-600/20 rounded-xl p-4 text-sm">
              <p className="text-yellow-400 font-medium mb-1">
                ⚠️ Saluran Twitch ditemui tetapi sedang OFFLINE.
              </p>
              <p className="text-gray-400 text-xs">
                Pastikan username Twitch ini ialah saluran rasmi Bilik Agama sebelum menyimpan.
              </p>
            </div>
          )}

          {/* Error Warning */}
          {verifyResult.status === "error" && (
            <div className="bg-yellow-600/5 border border-yellow-600/20 rounded-xl p-4 text-sm">
              <p className="text-yellow-400 font-medium mb-1">
                ⚠️ Saluran Twitch ditemui tetapi siaran tidak dapat dimuatkan.
              </p>
              <p className="text-gray-400 text-xs">
                Sila semak: username Twitch, ketersediaan strim, tetapan embed, dan sambungan internet.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
