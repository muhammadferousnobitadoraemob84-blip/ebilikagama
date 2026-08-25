"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useLanguage } from "@/components/LanguageProvider";

export interface RadioStation {
  id: string;
  name: string;
  description: string | null;
  streamUrl: string;
  thumbnail: string | null;
  category: string;
  enabled: boolean;
  [key: string]: unknown;
}

interface RadioPlayerProps {
  station: RadioStation;
  isPlaying: boolean;
  onPlay: (station: RadioStation) => void;
  onStop: () => void;
}

export default function RadioPlayer({ station, isPlaying, onPlay, onStop }: RadioPlayerProps) {
  const { t } = useLanguage();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleError = useCallback(() => {
    setError(true);
    setLoading(false);
  }, []);

  const handleCanPlay = useCallback(() => {
    setError(false);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = muted ? 0 : volume;
  }, [volume, muted]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      setLoading(true);
      setError(false);
      audio.src = station.streamUrl;
      audio.load();
      audio.play().catch(() => {
        setError(true);
        setLoading(false);
      });
    } else {
      audio.pause();
      audio.src = "";
    }

    return () => {
      audio.pause();
      audio.src = "";
    };
  }, [isPlaying, station.streamUrl]);

  return (
    <div className="bg-gray-900 border border-white/10 rounded-xl overflow-hidden">
      {/* Thumbnail + Info */}
      <div className="flex flex-col sm:flex-row gap-4 p-4 sm:p-6">
        {station.thumbnail ? (
          <img
            src={station.thumbnail}
            alt={station.name}
            className="w-full sm:w-40 h-40 object-cover rounded-lg"
          />
        ) : (
          <div className="w-full sm:w-40 h-40 bg-gradient-to-br from-red-900 to-gray-900 rounded-lg flex items-center justify-center">
            <svg className="w-12 h-12 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
          </div>
        )}

        <div className="flex-1 flex flex-col justify-center">
          <h2 className="text-white text-xl sm:text-2xl font-bold">{station.name}</h2>
          {station.description && (
            <p className="text-gray-400 mt-1 text-sm">{station.description}</p>
          )}
          <span className="text-gray-500 text-xs mt-2">{station.category}</span>

          {/* Status */}
          <div className="flex items-center gap-2 mt-3">
            {isPlaying && !error && (
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span className="text-green-400 text-xs font-medium">{t("radio_playing")}</span>
              </span>
            )}
            {error && (
              <span className="text-red-400 text-xs">{t("radio_unavailable")}</span>
            )}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-gray-800/50 px-4 sm:px-6 py-4 flex items-center gap-4">
        <button
          onClick={() => {
            if (error) {
              setError(false);
              setLoading(true);
              const audio = audioRef.current;
              if (audio) {
                audio.src = station.streamUrl;
                audio.load();
                audio.play().catch(handleError);
              }
              return;
            }
            if (isPlaying) {
              onStop();
            } else {
              onPlay(station);
            }
          }}
          className="w-12 h-12 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center transition-colors flex-shrink-0"
        >
          {isPlaying && !error ? (
            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {loading && (
          <div className="w-5 h-5 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
        )}

        {error && (
          <button
            onClick={() => {
              setError(false);
              setLoading(true);
              const audio = audioRef.current;
              if (audio) {
                audio.src = station.streamUrl;
                audio.load();
                audio.play().catch(handleError);
              }
            }}
            className="text-red-400 hover:text-red-300 text-sm underline"
          >
            {t("radio_try_again")}
          </button>
        )}

        {/* Volume */}
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={() => setMuted(!muted)}
            className="text-gray-400 hover:text-white transition-colors"
          >
            {muted || volume === 0 ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              </svg>
            )}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={muted ? 0 : volume}
            onChange={(e) => {
              setVolume(parseFloat(e.target.value));
              setMuted(false);
            }}
            className="w-20 sm:w-24 accent-red-500 h-1"
          />
        </div>
      </div>

      {/* Hidden audio element */}
      <audio ref={audioRef} onError={handleError} onCanPlay={handleCanPlay} preload="none" />
    </div>
  );
}
