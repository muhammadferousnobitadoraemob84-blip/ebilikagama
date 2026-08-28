"use client";

import { useLanguage } from "@/components/LanguageProvider";

interface RadioStation {
  id: string;
  name: string;
  thumbnail: string | null;
}

interface RadioMiniPlayerProps {
  station: RadioStation;
  isPlaying: boolean;
  isOnline: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  volume: number;
  onVolumeChange: (v: number) => void;
}

export default function RadioMiniPlayer({
  station,
  isPlaying,
  isOnline,
  onPlay,
  onPause,
  onStop,
  volume,
  onVolumeChange,
}: RadioMiniPlayerProps) {
  const { t } = useLanguage();

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-gray-900/95 backdrop-blur-md border-t border-white/10 shadow-2xl">
      <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center gap-3">
        {/* Station icon / small vinyl */}
        <div className="relative w-8 h-8 flex-shrink-0">
          {station.thumbnail ? (
            <img
              src={station.thumbnail}
              alt={station.name}
              className="w-8 h-8 rounded-full object-cover"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-red-900 to-gray-800 flex items-center justify-center">
              <svg className="w-4 h-4 text-red-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
            </div>
          )}
          {/* Pulsing indicator for playing */}
          {isPlaying && (
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border border-gray-900 animate-pulse" />
          )}
        </div>

        {/* Station name + status */}
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-medium truncate">{station.name}</p>
          <div className="flex items-center gap-1.5">
            {isPlaying && isOnline ? (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                <span className="text-green-400 text-[10px] font-medium">{t("radio_playing")}</span>
              </span>
            ) : isOnline ? (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                <span className="text-green-400 text-[10px] font-medium">{t("radio_online")}</span>
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-red-500 rounded-full" />
                <span className="text-red-400 text-[10px] font-medium">{t("radio_offline")}</span>
              </span>
            )}
          </div>
        </div>

        {/* Play/Pause */}
        <button
          onClick={isPlaying ? onPause : onPlay}
          className="w-9 h-9 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center transition-colors flex-shrink-0"
        >
          {isPlaying ? (
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Volume (hidden on small screens) */}
        <div className="hidden sm:flex items-center gap-2">
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
          </svg>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
            className="w-20 accent-red-500 h-1"
          />
        </div>

        {/* Stop/Close */}
        <button
          onClick={onStop}
          className="text-gray-400 hover:text-red-400 transition-colors p-1 flex-shrink-0"
          title="Close player"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
