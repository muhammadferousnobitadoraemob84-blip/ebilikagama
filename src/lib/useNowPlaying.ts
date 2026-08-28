"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export interface NowPlayingData {
  song: string | null;
  artist: string | null;
  game: string | null;
  streamTitle: string | null;
  available: boolean;
}

/**
 * Polls /api/radios/now-playing every 3 seconds while online + playing.
 * Returns null when not active.
 */
export function useNowPlaying(
  twitchUsername: string | null | undefined,
  isOnline: boolean,
  isPlaying: boolean
): NowPlayingData | null {
  const [nowPlaying, setNowPlaying] = useState<NowPlayingData | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  const fetchNowPlaying = useCallback(async () => {
    if (!twitchUsername) {
      setNowPlaying(null);
      return;
    }

    try {
      const res = await fetch(
        `/api/radios/now-playing?username=${encodeURIComponent(twitchUsername)}`
      );
      if (!mountedRef.current) return;
      const data = await res.json();
      setNowPlaying(data);
    } catch {
      if (!mountedRef.current) return;
      setNowPlaying(null);
    }
  }, [twitchUsername]);

  useEffect(() => {
    mountedRef.current = true;

    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    if (isOnline && isPlaying && twitchUsername) {
      // Immediate first fetch
      fetchNowPlaying();

      // Poll every 3 seconds
      pollingRef.current = setInterval(() => {
        fetchNowPlaying();
      }, 3000);
    } else {
      setNowPlaying(null);
    }

    return () => {
      mountedRef.current = false;
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [isOnline, isPlaying, twitchUsername, fetchNowPlaying]);

  return nowPlaying;
}
