"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useLanguage } from "@/components/LanguageProvider";

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
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

function formatDate(dateStr: string, language: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString(
      language === "bm" ? "ms-MY" : language === "zh" ? "zh-CN" : "en-US",
      { year: "numeric", month: "long", day: "numeric" }
    );
  } catch {
    return dateStr;
  }
}

function formatFileSize(bytes: bigint | null): string {
  if (!bytes) return "";
  const gb = Number(bytes) / (1024 * 1024 * 1024);
  if (gb >= 1) {
    return `${gb.toFixed(1)} GB`;
  }
  const mb = Number(bytes) / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

export default function ReplayPage() {
  const params = useParams();
  const { t, language } = useLanguage();
  const [replay, setReplay] = useState<Replay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!params.id) return;

    fetch(`/api/replays/${params.id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((data) => {
        setReplay(data);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [params.id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">{t("loading")}</p>
        </div>
      </div>
    );
  }

  if (error || !replay) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black px-4">
        <div className="text-center">
          <h2 className="text-white text-lg sm:text-2xl font-bold mb-4">
            {t("replay_not_found")}
          </h2>
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

      {/* Video Player */}
      <div className="max-w-7xl mx-auto px-0 sm:px-6 lg:px-8 pt-2 sm:pt-4">
        <div className="sm:px-0">
          <video
            ref={videoRef}
            className="w-full rounded-none sm:rounded-xl"
            controls
            playsInline
            poster={replay.thumbnail || undefined}
          >
            <source src={replay.videoUrl} />
            Your browser does not support the video tag.
          </video>
        </div>
      </div>

      {/* Replay Info */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8">
        <div className="flex items-start gap-3 mb-4">
          <div className="bg-red-600 text-white text-xs font-bold px-2 py-1 rounded">
            LIVE REPLAY
          </div>
        </div>

        <h1 className="text-white text-xl sm:text-2xl md:text-3xl font-bold mb-3">
          {replay.title}
        </h1>

        <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-xs sm:text-sm text-gray-400 mb-4">
          <span className="flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {formatDate(replay.date, language)}
          </span>
          {replay.duration && (
            <span className="flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {formatDuration(replay.duration)}
            </span>
          )}
          {replay.fileSize && (
            <span className="flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              {formatFileSize(replay.fileSize)}
            </span>
          )}
        </div>

        {replay.description && (
          <p className="text-gray-400 text-sm sm:text-base leading-relaxed max-w-3xl">
            {replay.description}
          </p>
        )}
      </div>
    </div>
  );
}
