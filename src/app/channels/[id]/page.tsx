"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import TwitchPlayer from "@/components/TwitchPlayer";
import ChannelEPG from "@/components/ChannelEPG";
import { useLanguage } from "@/components/LanguageProvider";

interface Channel {
  id: string;
  name: string;
  category: string;
  twitchUsername: string;
  thumbnail: string | null;
  description: string | null;
  liveStatus: string;
}

export default function ChannelPage() {
  const params = useParams();
  const { t } = useLanguage();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [liveStatus, setLiveStatus] = useState<"checking" | "live" | "offline">("checking");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const channelRef = useRef<Channel | null>(null);
  const mountedRef = useRef(true);

  // Fetch channel data
  useEffect(() => {
    if (!params.id) return;

    fetch(`/api/channels/${params.id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((data) => {
        if (mountedRef.current) {
          setChannel(data);
          channelRef.current = data;
          setLoading(false);
        }
      })
      .catch(() => {
        if (mountedRef.current) {
          setError(true);
          setLoading(false);
        }
      });
  }, [params.id]);

  // Fetch real-time Twitch status for THIS channel
  const fetchStatus = useCallback(async () => {
    if (!mountedRef.current) return;
    const ch = channelRef.current;
    if (!ch) return;

    try {
      const res = await fetch("/api/channels/status", { cache: "no-store" });
      if (!res.ok) return;

      const data = await res.json();
      if (!data.channels || !Array.isArray(data.channels)) return;

      const match = data.channels.find((c: { id: string; status: string }) => c.id === ch.id);
      if (!match) return;

      if (mountedRef.current) {
        if (match.status === "online") {
          setLiveStatus("live");
        } else if (match.status === "offline") {
          setLiveStatus("offline");
        }
      }
    } catch {
      // keep previous status
    }
  }, []);

  // Start polling once channel is loaded
  useEffect(() => {
    mountedRef.current = true;
    
    if (!channel) return;

    // Set initial status from DB
    if (channel.liveStatus === "live") {
      setLiveStatus("live");
    } else {
      fetchStatus();
    }

    // Poll every 2 seconds
    intervalRef.current = setInterval(fetchStatus, 2000);

    // Also check on visibility change
    const handleVisibility = () => {
      if (!document.hidden && mountedRef.current) {
        fetchStatus();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      // Mark as unmounted immediately - don't wait for cleanup
      mountedRef.current = false;
      
      // Clear interval asynchronously - don't block navigation
      requestAnimationFrame(() => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        document.removeEventListener("visibilitychange", handleVisibility);
      });
    };
  }, [channel, fetchStatus]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">{t("loading_channel")}</p>
        </div>
      </div>
    );
  }

  if (error || !channel) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <h2 className="text-white text-lg sm:text-2xl font-bold mb-4">
            {t("channel_not_found")}
          </h2>
          <p className="text-gray-400 text-sm sm:text-base mb-6">
            {t("channel_not_found_desc")}
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-5 py-3 rounded-xl transition-colors text-sm"
            prefetch={true}
          >
            {t("back_to_channels")}
          </Link>
        </div>
      </div>
    );
  }

  const isLive = liveStatus === "live";
  const isChecking = liveStatus === "checking";

  return (
    <div className="min-h-screen bg-black">
      {/* Back Button */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pt-3 sm:pt-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 sm:gap-2 text-gray-400 hover:text-white transition-colors text-xs sm:text-sm font-medium"
          prefetch={true}
        >
          <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          {t("back")}
        </Link>
      </div>

      {/* Player */}
      <div className="max-w-7xl mx-auto px-0 sm:px-6 lg:px-8 pt-2 sm:pt-4">
        <div className="sm:px-0">
          <TwitchPlayer channel={channel.twitchUsername} />
        </div>
      </div>

      {/* Channel Info */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8">
        <div className="flex flex-col md:flex-row gap-4 sm:gap-6">
          {channel.thumbnail && (
            <div className="hidden md:block w-48 flex-shrink-0">
              <img
                src={channel.thumbnail}
                alt={channel.name}
                className="w-full aspect-video object-cover rounded-xl"
              />
            </div>
          )}

          <div className="flex-1">
            <div className="flex items-center gap-2.5 sm:gap-3 mb-2 sm:mb-3">
              <h1 className="text-white text-lg sm:text-2xl md:text-3xl font-bold">
                {channel.name}
              </h1>
              {isChecking ? (
                <span className="bg-gray-700 text-gray-300 text-[10px] sm:text-xs font-medium px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-md flex items-center gap-1 sm:gap-1.5">
                  <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-gray-400 rounded-full animate-pulse" />
                  {t("checking_status")}
                </span>
              ) : isLive ? (
                <span className="bg-green-600 text-white text-[10px] sm:text-xs font-bold px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-md flex items-center gap-1 sm:gap-1.5">
                  <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-white rounded-full animate-pulse" />
                  {t("status_online")}
                </span>
              ) : (
                <span className="bg-red-600 text-white text-[10px] sm:text-xs font-bold px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-md">
                  {t("status_offline")}
                </span>
              )}
            </div>

            {channel.description && (
              <p className="text-gray-400 text-sm sm:text-base leading-relaxed mb-3 sm:mb-4">
                {channel.description}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-xs sm:text-sm text-gray-500">
              <span className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
                {channel.category === "saluran-tv" ? t("saluran_tv_title") : t("saluran_khas_title")}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Vertical EPG / Program Guide */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pb-8 sm:pb-12">
        <div className="mb-4 sm:mb-6">
          <h2 className="text-white text-base sm:text-xl font-bold flex items-center gap-2">
            <svg className="w-4 h-4 sm:w-5 sm:h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {t("program_guide")}
          </h2>
        </div>
        <ChannelEPG currentChannelId={channel.id} />
      </div>
    </div>
  );
}
