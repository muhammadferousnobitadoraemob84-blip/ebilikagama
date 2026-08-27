"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useLanguage } from "@/components/LanguageProvider";

export interface RadioStation {
  id: string;
  name: string;
  description: string | null;
  streamUrl: string;
  thumbnail: string | null;
  twitchUsername?: string | null;
  category: string;
  enabled: boolean;
  [key: string]: unknown;
}

interface RadioPlayerProps {
  station: RadioStation;
  isPlaying: boolean;
  isOnline: boolean;
  onPlay: (station: RadioStation) => void;
  onPause: () => void;
  onStop: () => void;
}

export default function RadioPlayer({
  station,
  isPlaying,
  isOnline,
  onPlay,
  onPause,
  onStop,
}: RadioPlayerProps) {
  const { t } = useLanguage();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [userPaused, setUserPaused] = useState(false);

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

    if (isPlaying && isOnline) {
      setLoading(true);
      setError(false);
      setUserPaused(false);
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
  }, [isPlaying, isOnline, station.streamUrl]);

  const handlePlayPause = () => {
    if (error) {
      // Retry
      setError(false);
      setLoading(true);
      setUserPaused(false);
      const audio = audioRef.current;
      if (audio) {
        audio.src = station.streamUrl;
        audio.load();
        audio.play().catch(handleError);
      }
      return;
    }

    if (isPlaying) {
      setUserPaused(true);
      onPause();
    } else {
      setUserPaused(false);
      onPlay(station);
    }
  };

  // The record rotates when: online AND playing AND not user-paused
  const shouldRotate = isOnline && isPlaying && !userPaused && !error;

  return (
    <div className="bg-gray-900 border border-white/10 rounded-2xl overflow-hidden">
      <div className="flex flex-col items-center p-6 sm:p-8">
        {/* Vinyl Record Visual */}
        <div className="relative w-48 h-48 sm:w-64 sm:h-64 mb-6">
          {/* Outer ring / grooves */}
          <div
            className={`absolute inset-0 rounded-full bg-gradient-to-br from-gray-800 via-gray-900 to-black border-2 border-gray-700 shadow-2xl ${
              shouldRotate ? "animate-spin-slow" : ""
            }`}
            style={{
              animationDuration: "4s",
              animationTimingFunction: "linear",
              animationIterationCount: "infinite",
              animationPlayState: shouldRotate ? "running" : "paused",
            }}
          >
            {/* Groove rings */}
            <div className="absolute inset-3 rounded-full border border-gray-700/30" />
            <div className="absolute inset-6 rounded-full border border-gray-700/20" />
            <div className="absolute inset-9 rounded-full border border-gray-700/30" />
            <div className="absolute inset-12 rounded-full border border-gray-700/20" />
            <div className="absolute inset-15 rounded-full border border-gray-700/30" />

            {/* Sheen / light reflection */}
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-white/5 via-transparent to-transparent" />
          </div>

          {/* Center label */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className={`w-20 h-20 sm:w-28 sm:h-28 rounded-full bg-gradient-to-br from-red-700 via-red-800 to-red-900 border-2 border-red-600/50 flex items-center justify-center shadow-lg ${
                shouldRotate ? "animate-spin-slow" : ""
              }`}
              style={{
                animationDuration: "4s",
                animationTimingFunction: "linear",
                animationIterationCount: "infinite",
                animationPlayState: shouldRotate ? "running" : "paused",
              }}
            >
              {/* Music note icon */}
              <svg
                className="w-8 h-8 sm:w-10 sm:h-10 text-white/90"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
            </div>
          </div>

          {/* Center spindle dot */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-3 h-3 rounded-full bg-gray-900 border border-gray-600" />
          </div>
        </div>

        {/* Station Info */}
        <h2 className="text-white text-xl sm:text-2xl font-bold text-center">{station.name}</h2>
        {station.description && (
          <p className="text-gray-400 mt-1 text-sm text-center max-w-md">{station.description}</p>
        )}
        <span className="text-gray-500 text-xs mt-1">{station.category}</span>

        {/* Status */}
        <div className="flex items-center gap-2 mt-4">
          {isOnline ? (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-green-400 text-sm font-medium">{t("radio_online")}</span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 bg-red-500 rounded-full" />
              <span className="text-red-400 text-sm font-medium">{t("radio_offline")}</span>
            </span>
          )}
        </div>

        {/* Offline message */}
        {!isOnline && (
          <p className="text-gray-400 text-sm text-center mt-4 uppercase font-semibold">
            RADIO IS OFFLINE RIGHT NOW. PLEASE COME BACK LATER.
          </p>
        )}

        {/* Error message */}
        {error && (
          <p className="text-red-400 text-sm text-center mt-4">
            {t("radio_unavailable")}
          </p>
        )}
      </div>

      {/* Controls */}
      <div className="bg-gray-800/50 px-6 py-4 flex items-center gap-4">
        {/* Play/Pause */}
        <button
          onClick={handlePlayPause}
          disabled={!isOnline && !error}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors flex-shrink-0 ${
            isOnline || error
              ? "bg-red-600 hover:bg-red-500"
              : "bg-gray-700 cursor-not-allowed"
          }`}
        >
          {isPlaying && !userPaused && !error ? (
            <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg className="w-6 h-6 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {loading && (
          <div className="w-5 h-5 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
        )}

        {error && (
          <button
            onClick={handlePlayPause}
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
