"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useLanguage } from "@/components/LanguageProvider";

interface Replay {
  id: string;
  title: string;
  description: string | null;
  videoUrl: string | null;
  googleDriveId: string | null;
  googleDriveUrl: string | null;
  thumbnail: string | null;
  duration: number | null;
  date: string;
  published: boolean;
}

export default function ReplayPage() {
  const params = useParams();
  const { t } = useLanguage();
  const [replay, setReplay] = useState<Replay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (params.id) {
      fetchReplay(params.id as string);
    }
  }, [params.id]);

  const fetchReplay = async (id: string) => {
    try {
      const res = await fetch(`/api/replays/${id}`);
      if (res.ok) {
        const data = await res.json();
        setReplay(data);
      } else {
        setError(t("replay_not_found"));
      }
    } catch {
      setError(t("replay_fetch_error"));
    } finally {
      setLoading(false);
    }
  };

  const getGoogleDriveEmbedUrl = (fileId: string): string => {
    return `https://drive.google.com/file/d/${fileId}/preview`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-12 h-12 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !replay) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-xl sm:text-2xl font-bold mb-4">{t("replay_not_found_title")}</h1>
          <p className="text-gray-400 mb-6">{error || t("replay_not_found_desc")}</p>
          <Link
            href="/"
            className="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg font-medium"
          >
            {t("replay_back_home")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Back Button — same as Channel page */}
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

      {/* Video Player — same sizing as Channel page */}
      <div className="max-w-7xl mx-auto px-0 sm:px-6 lg:px-8 pt-2 sm:pt-4">
        <div className="sm:px-0">
          {replay.googleDriveId ? (
            <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
              <iframe
                src={getGoogleDriveEmbedUrl(replay.googleDriveId)}
                className="absolute inset-0 w-full h-full border-0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                title={replay.title}
              />
            </div>
          ) : (
            <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
              <div className="absolute inset-0 bg-gray-900 flex items-center justify-center rounded-xl overflow-hidden">
                <div className="text-center px-4">
                  <svg className="w-12 h-12 sm:w-16 sm:h-16 text-gray-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-gray-400 text-sm sm:text-base">{t("replay_video_unavailable")}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Video Info */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8">
        <h2 className="text-xl sm:text-2xl font-bold mb-2">{replay.title}</h2>
        <p className="text-gray-400 text-sm sm:text-base mb-4">{replay.date}</p>
        
        {replay.description && (
          <div className="bg-gray-900 rounded-xl p-3 sm:p-4">
            <h3 className="font-medium mb-2 text-sm sm:text-base">{t("replay_description")}</h3>
            <p className="text-gray-400 text-sm sm:text-base">{replay.description}</p>
          </div>
        )}
      </div>
    </div>
  );
}
