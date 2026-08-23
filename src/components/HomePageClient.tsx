"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useLanguage } from "@/components/LanguageProvider";
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
  hero_title?: string;
  hero_description?: string;
  hero_image?: string;
  saluran_tv_title?: string;
  saluran_khas_title?: string;
}

interface HomePageClientProps {
  initialChannels: Channel[];
  initialSettings: Settings;
}

export default function HomePageClient({
  initialChannels,
  initialSettings,
}: HomePageClientProps) {
  const { t } = useLanguage();
  const [channels, setChannels] = useState<Channel[]>(initialChannels);
  const [settings] = useState<Settings>(initialSettings);
  const [error, setError] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const statusIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const channelsRef = useRef<Channel[]>(initialChannels);

  // Keep ref in sync
  channelsRef.current = channels;

  // ── SSE for real-time channel add/edit/delete ──
  const connectSSE = useCallback(() => {
    try {
      const es = new EventSource("/api/channels/events");

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (Array.isArray(data)) {
            setChannels(data);
            channelsRef.current = data;
            setError(false);
          }
        } catch {
          // ignore
        }
      };

      es.onerror = () => {
        es.close();
        setTimeout(() => {
          if (eventSourceRef.current === es) {
            connectSSE();
          }
        }, 5000);
      };

      eventSourceRef.current = es;
    } catch {
      // SSE not supported
    }
  }, []);

  useEffect(() => {
    connectSSE();
    return () => {
      eventSourceRef.current?.close();
    };
  }, [connectSSE]);

  // ── Twitch live status polling (every 1 second) ──
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/channels/status", {
        cache: "no-store",
      });
      if (!res.ok) return;

      const data = await res.json();
      if (!data.channels || !Array.isArray(data.channels)) return;

      // Build a map: channelId → status
      const statusMap = new Map<string, string>();
      for (const ch of data.channels) {
        statusMap.set(ch.id, ch.status);
      }

      // Update channels with real-time status
      setChannels((prev) =>
        prev.map((ch) => {
          const liveStatus = statusMap.get(ch.id);
          if (!liveStatus || liveStatus === "unknown") return ch;
          const newLiveStatus = liveStatus === "online" ? "live" : "offline";
          if (ch.liveStatus === newLiveStatus) return ch;
          return { ...ch, liveStatus: newLiveStatus };
        })
      );
    } catch {
      // Status check failed — keep previous status
    }
  }, []);

  // Start/stop polling based on page visibility
  useEffect(() => {
    // Fetch immediately on mount
    fetchStatus();

    const startPolling = () => {
      if (statusIntervalRef.current) return;
      statusIntervalRef.current = setInterval(fetchStatus, 2000);
    };

    const stopPolling = () => {
      if (statusIntervalRef.current) {
        clearInterval(statusIntervalRef.current);
        statusIntervalRef.current = null;
      }
    };

    // Start polling
    startPolling();

    // Pause when tab is hidden, resume when visible
    const handleVisibility = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        fetchStatus(); // immediate check on return
        startPolling();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchStatus]);

  const saluranTV = channels.filter((c) => c.category === "saluran-tv");
  const saluranKhas = channels.filter((c) => c.category === "saluran-khas");

  const heroTranslations = {
    hero_badge: t("hero_badge"),
    hero_cta: t("hero_cta"),
    hero_title_fallback: t("hero_title_fallback"),
    hero_desc_fallback: t("hero_desc_fallback"),
  };

  if (error && channels.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center max-w-md px-4">
          <svg
            className="w-16 h-16 text-red-500/50 mx-auto mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <h2 className="text-white text-xl font-bold mb-2">
            {t("load_channels_error")}
          </h2>
          <p className="text-gray-400 mb-6">
            {t("load_channels_error_desc")}
          </p>
          <button
            onClick={() => {
              setError(false);
              window.location.reload();
            }}
            className="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-xl transition-colors font-medium"
          >
            {t("try_again")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Hero settings={settings} translations={heroTranslations} />

      {/* Saluran TV */}
      <ChannelSection
        id="saluran-tv"
        title={settings.saluran_tv_title || t("saluran_tv_title")}
        channels={saluranTV}
      />

      {/* Saluran Khas */}
      <ChannelSection
        id="saluran-khas"
        title={settings.saluran_khas_title || t("saluran_khas_title")}
        channels={saluranKhas}
      />

      {/* Empty State */}
      {channels.length === 0 && (
        <div className="text-center py-20">
          <p className="text-gray-500 text-lg">
            {t("no_channels")}
          </p>
        </div>
      )}
    </div>
  );
}
