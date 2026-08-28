"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import type { NowPlayingData } from "@/lib/useNowPlaying";

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

interface TwitchPlayer {
  play: () => void;
  pause: () => void;
  getMuted: () => boolean;
  setMuted: (muted: boolean) => void;
  getVolume: () => number;
  setVolume: (volume: number) => void;
  removeNode: () => void;
  getStatus: () => string;
  addEventListener: (event: string, callback: () => void) => void;
  removeEventListener: (event: string, callback: () => void) => void;
}

declare global {
  interface Window {
    Twitch?: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Player: any;
    };
  }
}

interface RadioPlayerProps {
  station: RadioStation;
  isPlaying: boolean;
  isOnline: boolean;
  nowPlaying: NowPlayingData | null;
  onPlay: (station: RadioStation) => void;
  onPause: () => void;
  onStop: () => void;
}

export default function RadioPlayer({
  station,
  isPlaying,
  isOnline,
  nowPlaying,
  onPlay,
  onPause,
  onStop,
}: RadioPlayerProps) {
  const { t } = useLanguage();
  const twitchContainerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<TwitchPlayer | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  const shouldRotate = isOnline && isPlaying && playerReady && !playbackError;

  // Get the current domain for Twitch embed parent parameter
  const getParentDomain = useCallback(() => {
    if (typeof window === "undefined") return "localhost";
    return window.location.hostname;
  }, []);

  // Load Twitch Embed SDK
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.Twitch) return; // Already loaded

    const script = document.createElement("script");
    script.src = "https://player.twitch.tv/js/embed/v1.js";
    script.async = true;
    document.head.appendChild(script);

    return () => {
      // Don't remove the script — other components might use it
    };
  }, []);

  // Create/destroy Twitch embed when station changes or goes online
  useEffect(() => {
    // Cleanup previous player
    if (playerRef.current) {
      try {
        playerRef.current.removeNode();
      } catch {
        // ignore
      }
      playerRef.current = null;
      setPlayerReady(false);
      setPlaybackError(false);
    }

    if (!isOnline || !station.twitchUsername || !twitchContainerRef.current) {
      return;
    }

    // Wait for Twitch SDK to load
    const waitForSDK = setInterval(() => {
      if (window.Twitch?.Player) {
        clearInterval(waitForSDK);
        createPlayer();
      }
    }, 200);

    // Timeout after 10 seconds
    const timeout = setTimeout(() => {
      clearInterval(waitForSDK);
    }, 10000);

    function createPlayer() {
      if (!twitchContainerRef.current || playerRef.current) return;

      // Twitch Player expects a div ID string
      const containerId = `twitch-embed-${station.id}`;
      twitchContainerRef.current.id = containerId;

      try {
        const player = new window.Twitch!.Player(containerId, {
          channel: station.twitchUsername,
          parent: getParentDomain(),
          autoplay: false,
          muted: true, // Start muted — user unmutes via play button
          height: 1,
          width: 1,
        });

        player.addEventListener("ready", () => {
          setPlayerReady(true);
          setPlaybackError(false);
        });

        player.addEventListener("playing", () => {
          setPlaybackError(false);
        });

        player.addEventListener("ended", () => {
          setPlaybackError(false);
        });

        player.addEventListener("offline", () => {
          // Channel went offline
        });

        playerRef.current = player;
      } catch {
        setPlaybackError(true);
      }
    }

    return () => {
      clearInterval(waitForSDK);
      clearTimeout(timeout);
      if (playerRef.current) {
        try {
          playerRef.current.removeNode();
        } catch {
          // ignore
        }
        playerRef.current = null;
        setPlayerReady(false);
      }
    };
  }, [isOnline, station.twitchUsername, getParentDomain]);

  // Handle play/pause via Twitch player API
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !playerReady) return;

    try {
      if (isPlaying) {
        player.setMuted(false);
        player.play();
      } else {
        player.pause();
      }
    } catch {
      setPlaybackError(true);
    }
  }, [isPlaying, playerReady]);

  const handlePlayPause = () => {
    if (!isOnline) return;

    if (playbackError) {
      // Retry — recreate player
      setPlaybackError(false);
      return;
    }

    if (isPlaying) {
      onPause();
    } else {
      onPlay(station);
    }
  };

  return (
    <div className="bg-gray-900 border border-white/10 rounded-2xl overflow-hidden">
      {/* Hidden Twitch embed container — compliant with Twitch ToS */}
      <div className="relative w-0 h-0 overflow-hidden opacity-0 pointer-events-none">
        <div ref={twitchContainerRef} id={`twitch-embed-${station.id}`} />
      </div>

      <div className="flex flex-col items-center p-6 sm:p-8">
        {/* Vinyl Record Visual */}
        <div className="relative w-48 h-48 sm:w-64 sm:h-64 mb-6">
          <div
            className="absolute inset-0 rounded-full bg-gradient-to-br from-gray-800 via-gray-900 to-black border-2 border-gray-700 shadow-2xl"
            style={{
              animation: shouldRotate
                ? "spin-slow 4s linear infinite"
                : "none",
            }}
          >
            <div className="absolute inset-3 rounded-full border border-gray-700/30" />
            <div className="absolute inset-6 rounded-full border border-gray-700/20" />
            <div className="absolute inset-9 rounded-full border border-gray-700/30" />
            <div className="absolute inset-12 rounded-full border border-gray-700/20" />
            <div className="absolute inset-15 rounded-full border border-gray-700/30" />
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-white/5 via-transparent to-transparent" />
          </div>

          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className="w-20 h-20 sm:w-28 sm:h-28 rounded-full bg-gradient-to-br from-red-700 via-red-800 to-red-900 border-2 border-red-600/50 flex items-center justify-center shadow-lg"
              style={{
                animation: shouldRotate
                  ? "spin-slow 4s linear infinite"
                  : "none",
              }}
            >
              <svg
                className="w-8 h-8 sm:w-10 sm:h-10 text-white/90"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
            </div>
          </div>

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

        {/* No Twitch username */}
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

        {/* Playback blocked — show instruction */}
        {isOnline && !isPlaying && !playbackError && (
          <p className="text-gray-400 text-sm text-center mt-4 italic">
            Tekan Play untuk memulakan radio.
          </p>
        )}

        {/* Playback error */}
        {playbackError && isOnline && (
          <p className="text-red-400 text-sm text-center mt-4">
            Radio tidak dapat dimainkan buat masa ini.
            <button
              onClick={handlePlayPause}
              className="ml-2 underline hover:text-red-300"
            >
              Cuba lagi
            </button>
          </p>
        )}

        {/* Now Playing Section */}
        {isOnline && (
          <div className="mt-5 w-full max-w-sm text-center">
            <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1.5">
              Now Playing
            </p>
            {nowPlaying?.available && nowPlaying.song ? (
              <div className="transition-opacity duration-500">
                <p className="text-white text-base sm:text-lg font-semibold leading-tight">
                  {nowPlaying.song}
                </p>
                {nowPlaying.artist && (
                  <p className="text-gray-400 text-sm mt-0.5">
                    {nowPlaying.artist}
                  </p>
                )}
                {!nowPlaying.artist && nowPlaying.game && (
                  <p className="text-gray-500 text-xs mt-0.5">
                    {nowPlaying.game}
                  </p>
                )}
              </div>
            ) : nowPlaying === null ? (
              <p className="text-gray-400 text-sm italic">Detecting song...</p>
            ) : (
              <p className="text-gray-500 text-sm italic">
                Song information unavailable
              </p>
            )}
          </div>
        )}

        {/* Offline Now Playing */}
        {!isOnline && (
          <div className="mt-4 w-full max-w-sm text-center">
            <p className="text-[10px] uppercase tracking-widest text-gray-600 font-semibold mb-1">
              Now Playing
            </p>
            <p className="text-gray-600 text-sm italic">
              No song currently playing
            </p>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="bg-gray-800/50 px-6 py-4 flex items-center gap-4">
        {/* Play/Pause — controls Twitch player */}
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

        {/* Player status */}
        <div className="flex items-center gap-2 ml-auto text-gray-500 text-xs">
          {isPlaying && isOnline && playerReady && !playbackError && (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              {t("radio_playing")}
            </span>
          )}
          {isPlaying && isOnline && !playerReady && !playbackError && (
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-4 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
              Memuatkan...
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
