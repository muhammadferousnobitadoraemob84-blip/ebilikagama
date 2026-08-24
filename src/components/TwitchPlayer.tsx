"use client";

import { useEffect, useRef, useState } from "react";

interface TwitchPlayerProps {
  channel: string;
  width?: string;
  height?: string;
}

export default function TwitchPlayer({
  channel,
  width = "100%",
  height = "100%",
}: TwitchPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [hasError, setHasError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const currentChannelRef = useRef<string | null>(null);

  useEffect(() => {
    if (!channel || !containerRef.current) return;

    // Don't recreate iframe if channel hasn't changed
    if (currentChannelRef.current === channel && iframeRef.current) {
      return;
    }

    // Store current channel
    currentChannelRef.current = channel;

    // Clear previous embed
    if (containerRef.current) {
      containerRef.current.innerHTML = "";
    }
    iframeRef.current = null;
    setHasError(false);
    setIsLoaded(false);

    try {
      const iframe = document.createElement("iframe");
      iframe.src = `https://player.twitch.tv/?channel=${channel}&parent=${window.location.hostname}&muted=false`;
      iframe.allowFullscreen = true;
      iframe.allow =
        "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
      iframe.style.width = width;
      iframe.style.height = height;
      iframe.style.border = "none";
      iframe.style.borderRadius = "0.75rem";

      iframe.onload = () => setIsLoaded(true);
      iframe.onerror = () => setHasError(true);

      containerRef.current.appendChild(iframe);
      iframeRef.current = iframe;
    } catch {
      setHasError(true);
    }

    // Cleanup function - remove iframe immediately without blocking
    return () => {
      // Mark as unmounted first
      currentChannelRef.current = null;
      
      // Remove iframe synchronously - don't await anything
      if (iframeRef.current && containerRef.current) {
        try {
          containerRef.current.removeChild(iframeRef.current);
        } catch {
          // Ignore if already removed
        }
        iframeRef.current = null;
      }
    };
  }, [channel, width, height]);

  if (hasError) {
    return (
      <div className="w-full aspect-video bg-gray-900 rounded-xl flex flex-col items-center justify-center border border-white/10">
        <svg
          className="w-16 h-16 text-gray-600 mb-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
        <p className="text-gray-400 text-lg font-medium mb-2">
          Siaran tidak tersedia
        </p>
        <p className="text-gray-500 text-sm text-center max-w-md px-4">
          Saluran ini mungkin sedang tidak bersiaran atau mengalami gangguan.
          Sila cuba lagi sebentar lagi.
        </p>
      </div>
    );
  }

  return (
    <div className="relative w-full aspect-video">
      {!isLoaded && (
        <div className="absolute inset-0 bg-gray-900 rounded-xl flex items-center justify-center z-10">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-400 text-sm">Memuatkan siaran...</p>
          </div>
        </div>
      )}
      <div ref={containerRef} className="w-full h-full rounded-xl overflow-hidden" />
    </div>
  );
}
