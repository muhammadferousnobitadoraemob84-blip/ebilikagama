"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

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
        setError("Rakaman tidak ditemui.");
      }
    } catch {
      setError("Gagal memuatkan rakaman.");
    } finally {
      setLoading(false);
    }
  };

  // Generate Google Drive embed URL
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
          <h1 className="text-xl sm:text-2xl font-bold mb-4">Rakaman Tidak Ditemui</h1>
          <p className="text-gray-400 mb-6">{error || "Rakaman ini tidak wujud."}</p>
          <Link
            href="/"
            className="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg font-medium"
          >
            Kembali ke Utama
          </Link>
        </div>
      </div>
    );
  }

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
            <h1 className="text-lg sm:text-xl font-bold truncate">{replay.title}</h1>
            <p className="text-gray-400 text-xs sm:text-sm">{replay.date}</p>
          </div>
        </div>
      </div>

      {/* Video Player - Full width on mobile */}
      <div className="w-full bg-black">
        {replay.googleDriveId ? (
          <div className="relative w-full aspect-video max-h-[50vh] sm:max-h-[70vh] bg-gray-900">
            <iframe
              src={getGoogleDriveEmbedUrl(replay.googleDriveId)}
              className="absolute inset-0 w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              title={replay.title}
            />
          </div>
        ) : (
          <div className="relative w-full aspect-video bg-gray-900 flex items-center justify-center">
            <div className="text-center px-4">
              <svg className="w-12 h-12 sm:w-16 sm:h-16 text-gray-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-gray-400 text-sm sm:text-base">Video tidak tersedia</p>
            </div>
          </div>
        )}
      </div>

      {/* Video Info - Compact on mobile */}
      <div className="max-w-6xl mx-auto px-4 py-4 sm:py-6">
        <h2 className="text-xl sm:text-2xl font-bold mb-2">{replay.title}</h2>
        <p className="text-gray-400 text-sm sm:text-base mb-4">{replay.date}</p>
        
        {replay.description && (
          <div className="bg-gray-900 rounded-xl p-3 sm:p-4">
            <h3 className="font-medium mb-2 text-sm sm:text-base">Penerangan</h3>
            <p className="text-gray-400 text-sm sm:text-base">{replay.description}</p>
          </div>
        )}
      </div>
    </div>
  );
}
