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

  // Generate Google Drive direct view URL
  const getGoogleDriveViewUrl = (fileId: string): string => {
    return `https://drive.google.com/file/d/${fileId}/view`;
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
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Rakaman Tidak Ditemui</h1>
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
      <div className="bg-gray-900 border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            href="/"
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-xl font-bold">{replay.title}</h1>
            <p className="text-gray-400 text-sm">{replay.date}</p>
          </div>
        </div>
      </div>

      {/* Video Player */}
      <div className="max-w-6xl mx-auto px-4 py-6">
        {replay.googleDriveId ? (
          <div className="relative w-full aspect-video bg-gray-900 rounded-xl overflow-hidden">
            <iframe
              src={getGoogleDriveEmbedUrl(replay.googleDriveId)}
              className="absolute inset-0 w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              title={replay.title}
            />
          </div>
        ) : (
          <div className="relative w-full aspect-video bg-gray-900 rounded-xl overflow-hidden flex items-center justify-center">
            <div className="text-center">
              <svg className="w-16 h-16 text-gray-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-gray-400">Video tidak tersedia</p>
            </div>
          </div>
        )}

        {/* Video Info */}
        <div className="mt-6">
          <h2 className="text-2xl font-bold mb-2">{replay.title}</h2>
          <p className="text-gray-400 mb-4">{replay.date}</p>
          
          {replay.description && (
            <div className="bg-gray-900 rounded-xl p-4">
              <h3 className="font-medium mb-2">Penerangan</h3>
              <p className="text-gray-400">{replay.description}</p>
            </div>
          )}

          {/* Open in Google Drive button */}
          {replay.googleDriveId && (
            <div className="mt-4">
              <a
                href={getGoogleDriveViewUrl(replay.googleDriveId)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-lg font-medium text-sm transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                Buka di Google Drive
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
