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
  const eventSourceRef = useRef<EventSource | null>(null);

  // Load settings once
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => setSettings(data))
      .catch(() => {});
  }, []);

  // SSE for real-time channel updates
  const connectSSE = useCallback(() => {
    const es = new EventSource("/api/channels/events");

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (Array.isArray(data)) {
          setChannels(data);
          setLoading(false);
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      es.close();
      // Reconnect after 3 seconds
      setTimeout(() => {
        if (eventSourceRef.current === es) {
          connectSSE();
        }
      }, 3000);
    };

    eventSourceRef.current = es;
  }, []);

  useEffect(() => {
    connectSSE();
    return () => {
      eventSourceRef.current?.close();
    };
  }, [connectSSE]);

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
