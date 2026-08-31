"use client";

import { useState, useEffect } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import Link from "next/link";

interface Replay {
  id: string;
  title: string;
  description: string | null;
  thumbnail: string | null;
  duration: number | null;
  date: string;
  published: boolean;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes} min`;
}

function formatDate(dateStr: string, language: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString(
      language === "bm" ? "ms-MY" : language === "zh" ? "zh-CN" : "en-US",
      { year: "numeric", month: "short", day: "numeric" }
    );
  } catch {
    return dateStr;
  }
}

export default function ReplaysPage() {
  const { t, language } = useLanguage();
  const [replays, setReplays] = useState<Replay[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchReplays();
  }, []);

  const fetchReplays = async () => {
    try {
      const res = await fetch("/api/replays");
      if (res.ok) {
        const data = await res.json();
        const sorted = [...data].sort((a: Replay, b: Replay) => {
          const dateA = new Date(a.date || 0).getTime();
          const dateB = new Date(b.date || 0).getTime();
          return dateB - dateA;
        });
        setReplays(sorted);
      }
    } catch {
      // Ignore error
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 sm:py-4 flex items-center gap-3 sm:gap-4">
          <Link
            href="/"
            className="text-gray-400 hover:text-white transition-colors flex-shrink-0"
          >
            <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg sm:text-xl font-bold">{t("live_replay_title")}</h1>
            <p className="text-gray-400 text-xs sm:text-sm">{t("live_replay_description")}</p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8">
        {/* Loading */}
        {loading && (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Empty State */}
        {!loading && replays.length === 0 && (
          <div className="text-center py-16">
            <p className="text-gray-500 text-lg">{t("replay_not_found")}</p>
          </div>
        )}

        {/* Replays Grid */}
        {!loading && replays.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {replays.map((replay) => (
              <Link
                key={replay.id}
                href={`/replay/${replay.id}`}
                className="group bg-gray-900 rounded-xl overflow-hidden border border-white/10 hover:border-red-500/50 transition-all"
              >
                {/* Thumbnail */}
                <div className="relative aspect-video bg-gray-800">
                  {replay.thumbnail ? (
                    <img
                      src={replay.thumbnail}
                      alt={replay.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <svg className="w-12 h-12 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                  )}

                  {/* Play Button Overlay */}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="w-14 h-14 bg-red-600 rounded-full flex items-center justify-center">
                      <svg className="w-6 h-6 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  </div>

                  {/* Duration Badge */}
                  {replay.duration && (
                    <div className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-2 py-1 rounded">
                      {formatDuration(replay.duration)}
                    </div>
                  )}

                  {/* Live Replay Badge */}
                  <div className="absolute top-2 left-2 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded">
                    LIVE REPLAY
                  </div>
                </div>

                {/* Info */}
                <div className="p-4">
                  <h3 className="text-white font-semibold mb-1 group-hover:text-red-400 transition-colors line-clamp-2">
                    {replay.title}
                  </h3>
                  <p className="text-gray-400 text-sm">
                    {formatDate(replay.date, language)}
                  </p>
                  {replay.description && (
                    <p className="text-gray-500 text-sm mt-2 line-clamp-2">
                      {replay.description}
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
