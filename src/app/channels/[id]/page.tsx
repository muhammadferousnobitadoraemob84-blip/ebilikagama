"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import TwitchPlayer from "@/components/TwitchPlayer";
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

interface Program {
  id: string;
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  channelId: string;
  thumbnail?: string;
}

export default function ChannelPage() {
  const params = useParams();
  const { t } = useLanguage();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [liveStatus, setLiveStatus] = useState<"checking" | "live" | "offline">("checking");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [currentProgram, setCurrentProgram] = useState<Program | null>(null);
  const [nextProgram, setNextProgram] = useState<Program | null>(null);
  const [loadingSchedule, setLoadingSchedule] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const channelRef = useRef<Channel | null>(null);

  // Fetch channel data
  useEffect(() => {
    if (!params.id) return;

    fetch(`/api/channels/${params.id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((data) => {
        setChannel(data);
        channelRef.current = data;
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [params.id]);

  // Fetch real-time Twitch status for THIS channel
  const fetchStatus = useCallback(async () => {
    const ch = channelRef.current;
    if (!ch) return;

    try {
      const res = await fetch("/api/channels/status", { cache: "no-store" });
      if (!res.ok) return;

      const data = await res.json();
      if (!data.channels || !Array.isArray(data.channels)) return;

      const match = data.channels.find((c: { id: string; status: string }) => c.id === ch.id);
      if (!match) return;

      if (match.status === "online") {
        setLiveStatus("live");
      } else if (match.status === "offline") {
        setLiveStatus("offline");
      }
    } catch {
      // keep previous status
    }
  }, []);

  // Fetch current/next program for this channel
  useEffect(() => {
    if (!params.id) return;

    const fetchCurrentProgram = async () => {
      try {
        // Get today's date in Malaysia timezone
        const now = new Date();
        const malaysiaTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" }));
        const dateStr = malaysiaTime.toISOString().split("T")[0];

        const res = await fetch(`/api/programs?channelId=${params.id}&date=${dateStr}`, { cache: "no-store" });
        if (!res.ok) return;

        const programs: Program[] = await res.json();
        
        // Get current time in Malaysia
        const currentTime = malaysiaTime.getHours() * 60 + malaysiaTime.getMinutes();
        
        let foundCurrent: Program | null = null;
        let foundNext: Program | null = null;

        for (const program of programs) {
          const start = new Date(program.startTime);
          const end = new Date(program.endTime);
          
          // Convert to Malaysia time
          const startMalaysia = new Date(start.toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" }));
          const endMalaysia = new Date(end.toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" }));
          
          const startMinutes = startMalaysia.getHours() * 60 + startMalaysia.getMinutes();
          const endMinutes = endMalaysia.getHours() * 60 + endMalaysia.getMinutes();

          if (currentTime >= startMinutes && currentTime < endMinutes) {
            foundCurrent = program;
          } else if (startMinutes > currentTime && !foundNext) {
            foundNext = program;
          }
        }

        setCurrentProgram(foundCurrent);
        setNextProgram(foundNext);
      } catch {
        // ignore
      } finally {
        setLoadingSchedule(false);
      }
    };

    fetchCurrentProgram();
  }, [params.id]);

  // Start polling once channel is loaded
  useEffect(() => {
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
      if (!document.hidden) {
        fetchStatus();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", handleVisibility);
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

      {/* Compact Current/Next Program */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pb-4 sm:pb-6">
        {loadingSchedule ? (
          <div className="bg-zinc-900/50 rounded-xl p-4 sm:p-5 border border-zinc-800">
            <div className="flex items-center gap-2 text-gray-400 text-sm">
              <div className="w-4 h-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
              {t("loading")}
            </div>
          </div>
        ) : (
          <div className="bg-zinc-900/50 rounded-xl p-4 sm:p-5 border border-zinc-800">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white text-sm sm:text-base font-semibold">{t("schedule_title")}</h3>
              <Link
                href="/schedule"
                className="text-red-400 hover:text-red-300 text-xs sm:text-sm font-medium flex items-center gap-1 transition-colors"
              >
                {t("view_full_schedule")}
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>

            {!currentProgram && !nextProgram ? (
              <p className="text-gray-500 text-xs sm:text-sm">{t("no_program_available")}</p>
            ) : (
              <div className="space-y-3">
                {/* Current Program */}
                {currentProgram && (
                  <div className="bg-green-900/20 border border-green-800/30 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="bg-green-600 text-white text-[9px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded uppercase">
                        {t("now_playing")}
                      </span>
                    </div>
                    <p className="text-white text-sm sm:text-base font-medium">{currentProgram.title}</p>
                    <p className="text-gray-400 text-xs sm:text-sm">
                      {new Date(currentProgram.startTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kuala_Lumpur" })} – {new Date(currentProgram.endTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kuala_Lumpur" })}
                    </p>
                  </div>
                )}

                {/* Next Program */}
                {nextProgram && (
                  <div className="bg-zinc-800/50 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="bg-zinc-700 text-gray-300 text-[9px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded uppercase">
                        {t("next")}
                      </span>
                    </div>
                    <p className="text-white text-sm sm:text-base font-medium">{nextProgram.title}</p>
                    <p className="text-gray-400 text-xs sm:text-sm">
                      {new Date(nextProgram.startTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kuala_Lumpur" })} – {new Date(nextProgram.endTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kuala_Lumpur" })}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
