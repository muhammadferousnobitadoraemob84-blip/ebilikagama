"use client";

import { useLanguage } from "@/components/LanguageProvider";

export interface RadioStation {
  id: string;
  name: string;
  description: string | null;
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

  // The record rotates when: online AND playing
  const shouldRotate = isOnline && isPlaying;

  const handlePlayPause = () => {
    if (isPlaying) {
      onPause();
    } else {
      onPlay(station);
    }
  };

  return (
    <div className="bg-gray-900 border border-white/10 rounded-2xl overflow-hidden">
      <div className="flex flex-col items-center p-6 sm:p-8">
        {/* Vinyl Record Visual */}
        <div className="relative w-48 h-48 sm:w-64 sm:h-64 mb-6">
          {/* Outer ring / grooves */}
          <div
            className={`absolute inset-0 rounded-full bg-gradient-to-br from-gray-800 via-gray-900 to-black border-2 border-gray-700 shadow-2xl`}
            style={{
              animation: shouldRotate
                ? "spin-slow 4s linear infinite"
                : "none",
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
              className={`w-20 h-20 sm:w-28 sm:h-28 rounded-full bg-gradient-to-br from-red-700 via-red-800 to-red-900 border-2 border-red-600/50 flex items-center justify-center shadow-lg`}
              style={{
                animation: shouldRotate
                  ? "spin-slow 4s linear infinite"
                  : "none",
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
        <h2 className="text-white text-xl sm:text-2xl font-bold text-center">
          {station.name}
        </h2>
        {station.description && (
          <p className="text-gray-400 mt-1 text-sm text-center max-w-md">
            {station.description}
          </p>
        )}
        <span className="text-gray-500 text-xs mt-1">{station.category}</span>

        {/* Status */}
        <div className="flex items-center gap-2 mt-4">
          {isOnline ? (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-green-400 text-sm font-medium">
                {t("radio_online")}
              </span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 bg-red-500 rounded-full" />
              <span className="text-red-400 text-sm font-medium">
                {t("radio_offline")}
              </span>
            </span>
          )}
        </div>

        {/* No Twitch username configured */}
        {!station.twitchUsername && (
          <p className="text-gray-400 text-sm text-center mt-4">
            Tiada username Twitch dikonfigurasikan untuk radio ini.
          </p>
        )}

        {/* Offline message */}
        {!isOnline && (
          <p className="text-gray-400 text-sm text-center mt-4 uppercase font-semibold">
            RADIO IS OFFLINE RIGHT NOW. PLEASE COME BACK LATER.
          </p>
        )}
      </div>

      {/* Controls */}
      <div className="bg-gray-800/50 px-6 py-4 flex items-center gap-4">
        {/* Play/Pause — controls vinyl animation */}
        <button
          onClick={handlePlayPause}
          disabled={!isOnline}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors flex-shrink-0 ${
            isOnline
              ? "bg-red-600 hover:bg-red-500"
              : "bg-gray-700 cursor-not-allowed"
          }`}
        >
          {isPlaying ? (
            <svg
              className="w-6 h-6 text-white"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg
              className="w-6 h-6 text-white ml-0.5"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Volume placeholder — no audio to control */}
        <div className="flex items-center gap-2 ml-auto text-gray-500 text-xs">
          {isPlaying && isOnline && (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              {t("radio_playing")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
