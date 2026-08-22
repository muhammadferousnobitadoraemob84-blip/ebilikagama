"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Hero from "@/components/Hero";
import ChannelSection from "@/components/ChannelSection";

interface Channel {
  id: string;
  name: string;
  category: string;
  twitchUsername: string;
  thumbnail: string | null;
  description: string | null;
  liveStatus: string;
  displayOrder: number;
}

interface Settings {
  saluran_tv_title?: string;
  saluran_khas_title?: string;
}

export default function HomePage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [settings, setSettings] = useState<Settings>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const dataLoadedRef = useRef(false);

  // Load settings once
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => setSettings(data))
      .catch(() => {});
  }, []);

  // Load channels via regular fetch FIRST (with timeout fallback)
  const fetchChannels = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

      const res = await fetch("/api/channels", { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) throw new Error("Failed to fetch channels");
      const data = await res.json();
      setChannels(data);
      setLoading(false);
      dataLoadedRef.current = true;
    } catch {
      if (!dataLoadedRef.current) {
        // Only show error if SSE hasn't loaded data yet
        setError(true);
        setLoading(false);
      }
    }
  }, []);

  // SSE for real-time channel updates (supplemental after initial load)
  const connectSSE = useCallback(() => {
    try {
      const es = new EventSource("/api/channels/events");

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (Array.isArray(data)) {
            setChannels(data);
            setLoading(false);
            setError(false);
            dataLoadedRef.current = true;
          }
        } catch {
          // ignore parse errors
        }
      };

      es.onerror = () => {
        es.close();
        // If we haven't loaded data yet via fetch, that's fine — fetch handles it
        // Reconnect after 5 seconds for real-time updates
        setTimeout(() => {
          if (eventSourceRef.current === es) {
            connectSSE();
          }
        }, 5000);
      };

      eventSourceRef.current = es;
    } catch {
      // SSE not supported or failed — fetch already handles data loading
    }
  }, []);

  useEffect(() => {
    // Start with a regular fetch (guaranteed to work)
    fetchChannels();
    // Also start SSE for real-time updates
    connectSSE();

    // Safety timeout: if neither fetch nor SSE has loaded data in 15s, stop loading
    const safetyTimeout = setTimeout(() => {
      if (!dataLoadedRef.current) {
        setLoading(false);
      }
    }, 15000);

    return () => {
      eventSourceRef.current?.close();
      clearTimeout(safetyTimeout);
    };
  }, [fetchChannels, connectSSE]);

  const saluranTV = channels.filter((c) => c.category === "saluran-tv");
  const saluranKhas = channels.filter((c) => c.category === "saluran-khas");

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400">Memuatkan...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center max-w-md px-4">
          <svg className="w-16 h-16 text-red-500/50 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h2 className="text-white text-xl font-bold mb-2">Gagal memuatkan saluran</h2>
          <p className="text-gray-400 mb-6">Sila semua sambungan internet anda dan cuba lagi.</p>
          <button
            onClick={() => {
              setError(false);
              setLoading(true);
              dataLoadedRef.current = false;
              fetchChannels();
            }}
            className="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-xl transition-colors font-medium"
          >
            Cuba Semula
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Hero />

      {/* Saluran TV */}
      <ChannelSection
        id="saluran-tv"
        title={settings.saluran_tv_title || "Saluran TV"}
        channels={saluranTV}
      />

      {/* Saluran Khas */}
      <ChannelSection
        id="saluran-khas"
        title={settings.saluran_khas_title || "Saluran Khas"}
        channels={saluranKhas}
      />

      {/* Empty State */}
      {channels.length === 0 && (
        <div className="text-center py-20">
          <p className="text-gray-500 text-lg">
            Tiada saluran tersedia buat masa ini.
          </p>
        </div>
      )}
    </div>
  );
}
