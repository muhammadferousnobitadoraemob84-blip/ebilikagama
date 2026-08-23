"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import TwitchPlayer from "@/components/TwitchPlayer";
import ProgramSchedule from "@/components/ProgramSchedule";

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
  const [channel, setChannel] = useState<Channel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!params.id) return;

    fetch(`/api/channels/${params.id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((data) => {
        setChannel(data);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [params.id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Memuatkan saluran...</p>
        </div>
      </div>
    );
  }

  if (error || !channel) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <h2 className="text-white text-xl sm:text-2xl font-bold mb-4">
            Saluran tidak dijumpai
          </h2>
          <p className="text-gray-400 text-sm sm:text-base mb-6">
            Saluran yang anda cari tidak wujud atau telah dipadam.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-5 py-3 rounded-xl transition-colors text-sm"
          >
            ← Kembali ke Senarai Saluran
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black">
      {/* Back Button — compact on mobile */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pt-3 sm:pt-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 sm:gap-2 text-gray-400 hover:text-white transition-colors text-xs sm:text-sm font-medium"
        >
          <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Kembali
        </Link>
      </div>

      {/* Player — full width on mobile, constrained on desktop */}
      <div className="max-w-7xl mx-auto px-0 sm:px-6 lg:px-8 pt-2 sm:pt-4">
        <div className="sm:px-0">
          <TwitchPlayer channel={channel.twitchUsername} />
        </div>
      </div>

      {/* Channel Info — stacked on mobile */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8">
        <div className="flex flex-col md:flex-row gap-4 sm:gap-6">
          {/* Thumbnail — hidden on mobile (redundant with player), shown on desktop */}
          {channel.thumbnail && (
            <div className="hidden md:block w-48 flex-shrink-0">
              <img
                src={channel.thumbnail}
                alt={channel.name}
                className="w-full aspect-video object-cover rounded-xl"
              />
            </div>
          )}

          {/* Details */}
          <div className="flex-1">
            <div className="flex items-center gap-2.5 sm:gap-3 mb-2 sm:mb-3">
              <h1 className="text-white text-lg sm:text-2xl md:text-3xl font-bold">
                {channel.name}
              </h1>
              {channel.liveStatus === "live" ? (
                <span className="bg-red-600 text-white text-[10px] sm:text-xs font-bold px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-md flex items-center gap-1 sm:gap-1.5">
                  <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-white rounded-full animate-pulse" />
                  LIVE
                </span>
              ) : (
                <span className="bg-gray-600/80 text-gray-200 text-[10px] sm:text-xs font-medium px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-md">
                  OFFLINE
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
                <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
                </svg>
                Twitch: {channel.twitchUsername}
              </span>
              <span className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
                {channel.category === "saluran-tv" ? "Saluran TV" : "Saluran Khas"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* TV Program Schedule */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pb-8 sm:pb-12">
        <div className="mb-4 sm:mb-6">
          <h2 className="text-white text-base sm:text-xl font-bold flex items-center gap-2">
            <svg className="w-4 h-4 sm:w-5 sm:h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Jadual Siaran
          </h2>
        </div>
        <ProgramSchedule currentChannelId={channel.id} />
      </div>
    </div>
  );
}
