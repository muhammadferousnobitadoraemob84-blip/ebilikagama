"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import RadioPlayer, { type RadioStation } from "@/components/RadioPlayer";
import RadioMiniPlayer from "@/components/RadioMiniPlayer";

export default function RadioPage() {
  const { t } = useLanguage();
  const [radios, setRadios] = useState<RadioStation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [activeStation, setActiveStation] = useState<RadioStation | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [miniVolume, setMiniVolume] = useState(0.8);

  // ONLINE/OFFLINE status for each radio
  const [onlineStatus, setOnlineStatus] = useState<Record<string, boolean>>({});
  const statusIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    fetch("/api/radios")
      .then((r) => r.json())
      .then((data) => {
        setRadios(data);
        setLoading(false);
      })
      .catch(() => {
        setError("Gagal memuatkan radio");
        setLoading(false);
      });
  }, []);

  // Check stream reachability for each radio
  const checkRadioStatus = useCallback(async (radio: RadioStation): Promise<boolean> => {
    // If there's a twitchUsername, we could check Twitch API status
    // For now, test stream URL reachability via a simple fetch
    try {
      // Try to check if the audio stream is reachable
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      await fetch(radio.streamUrl, {
        method: "HEAD",
        mode: "no-cors",
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return true;
    } catch {
      // If fetch fails, try loading via Audio element
      try {
        const audio = new Audio();
        audio.src = radio.streamUrl;
        return await new Promise<boolean>((resolve) => {
          const timeout = setTimeout(() => {
            audio.src = "";
            resolve(false);
          }, 5000);
          audio.oncanplay = () => {
            clearTimeout(timeout);
            audio.src = "";
            resolve(true);
          };
          audio.onerror = () => {
            clearTimeout(timeout);
            resolve(false);
          };
          audio.load();
        });
      } catch {
        return false;
      }
    }
  }, []);

  // Periodically check online status
  useEffect(() => {
    if (radios.length === 0) return;

    const checkAll = async () => {
      const results: Record<string, boolean> = {};
      await Promise.all(
        radios.map(async (radio) => {
          results[radio.id] = await checkRadioStatus(radio);
        })
      );
      setOnlineStatus(results);
    };

    // Initial check
    checkAll();

    // Check every 30 seconds
    statusIntervalRef.current = setInterval(checkAll, 30000);

    return () => {
      if (statusIntervalRef.current) clearInterval(statusIntervalRef.current);
    };
  }, [radios, checkRadioStatus]);

  // Get unique categories
  const categories = ["all", ...new Set(radios.map((r) => r.category))];

  // Filter radios
  const filtered = radios.filter((r) => {
    const matchSearch =
      !search ||
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      (r.description && r.description.toLowerCase().includes(search.toLowerCase()));
    const matchCategory = selectedCategory === "all" || r.category === selectedCategory;
    return matchSearch && matchCategory;
  });

  const handlePlay = useCallback((station: RadioStation) => {
    setActiveStation(station);
    setIsPlaying(true);
  }, []);

  const handleStop = useCallback(() => {
    setIsPlaying(false);
    setActiveStation(null);
  }, []);

  const handleMiniPlay = useCallback(() => {
    setIsPlaying(true);
  }, []);

  const handleMiniPause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  return (
    <div className="min-h-screen bg-black">
      {/* Hero */}
      <div className="relative py-12 sm:py-16 px-4 text-center bg-gradient-to-b from-red-900/20 to-black">
        <h1 className="text-white text-2xl sm:text-4xl font-bold">{t("radio_title")}</h1>
        <p className="text-gray-400 mt-2 text-sm sm:text-base">{t("radio_subtitle")}</p>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-24">
        {/* Active Player */}
        {activeStation && (
          <div className="mb-8">
            <RadioPlayer
              station={activeStation}
              isPlaying={isPlaying}
              isOnline={onlineStatus[activeStation.id] ?? false}
              onPlay={handlePlay}
              onPause={handleMiniPause}
              onStop={handleStop}
            />
          </div>
        )}

        {/* Search + Filter */}
        {radios.length > 0 && (
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <div className="relative flex-1">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("radio_search")}
                className="w-full bg-gray-900 border border-white/10 rounded-lg pl-10 pr-4 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-red-500/50"
              />
            </div>
            {categories.length > 2 && (
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="bg-gray-900 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-red-500/50"
              >
                <option value="all">{t("radio_all_categories")}</option>
                {categories.filter((c) => c !== "all").map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            )}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex justify-center py-20">
            <div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="text-center py-20">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {/* Empty */}
        {!loading && !error && radios.length === 0 && (
          <div className="text-center py-20">
            <svg className="w-16 h-16 mx-auto text-gray-700 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" />
            </svg>
            <p className="text-gray-500">{t("radio_no_stations")}</p>
          </div>
        )}

        {/* No results */}
        {!loading && !error && radios.length > 0 && filtered.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500">{t("radio_no_stations")}</p>
          </div>
        )}

        {/* Radio Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {filtered.map((radio) => {
            const isOnline = onlineStatus[radio.id] ?? false;
            const isActive = activeStation?.id === radio.id && isPlaying;

            return (
              <div
                key={radio.id}
                className={`bg-gray-900 border rounded-xl overflow-hidden transition-all cursor-pointer group ${
                  isActive
                    ? "border-red-500/50 ring-1 ring-red-500/20"
                    : "border-white/5 hover:border-white/20"
                }`}
                onClick={() => handlePlay(radio)}
              >
                {/* Thumbnail / Vinyl Visual */}
                <div className="relative aspect-video overflow-hidden">
                  {radio.thumbnail ? (
                    <img
                      src={radio.thumbnail}
                      alt={radio.name}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-red-900/30 to-gray-900 flex items-center justify-center">
                      {/* Mini vinyl record */}
                      <div className="relative w-20 h-20">
                        <div className={`w-20 h-20 rounded-full bg-gradient-to-br from-gray-800 to-black border border-gray-700 ${
                          isActive && isOnline ? "animate-spin-slow" : ""
                        }`} style={{ animationDuration: "4s", animationTimingFunction: "linear", animationIterationCount: "infinite" }}>
                          <div className="absolute inset-2 rounded-full border border-gray-700/30" />
                          <div className="absolute inset-4 rounded-full border border-gray-700/20" />
                        </div>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className={`w-8 h-8 rounded-full bg-gradient-to-br from-red-700 to-red-900 flex items-center justify-center ${
                            isActive && isOnline ? "animate-spin-slow" : ""
                          }`} style={{ animationDuration: "4s", animationTimingFunction: "linear", animationIterationCount: "infinite", animationDirection: "reverse" }}>
                            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                            </svg>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Play overlay */}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="w-14 h-14 rounded-full bg-red-600 flex items-center justify-center shadow-lg">
                      <svg className="w-6 h-6 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  </div>

                  {/* Status badge */}
                  <div className="absolute top-2 left-2">
                    {isActive ? (
                      <span className="bg-green-600 text-white text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                        {t("radio_playing")}
                      </span>
                    ) : isOnline ? (
                      <span className="bg-green-600/80 text-white text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-white rounded-full" />
                        ONLINE
                      </span>
                    ) : (
                      <span className="bg-red-600/80 text-white text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-white rounded-full" />
                        OFFLINE
                      </span>
                    )}
                  </div>
                </div>

                {/* Info */}
                <div className="p-3">
                  <h3 className="text-white font-semibold text-sm truncate group-hover:text-red-400 transition-colors">
                    {radio.name}
                  </h3>
                  {radio.description && (
                    <p className="text-gray-500 text-xs mt-0.5 line-clamp-1">{radio.description}</p>
                  )}
                  <p className="text-red-400 text-xs mt-2 font-medium">
                    {isActive ? `● ${t("radio_playing")}` : `▶ ${t("radio_listen")}`}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mini Player */}
      {activeStation && (
        <RadioMiniPlayer
          station={activeStation}
          isPlaying={isPlaying}
          isOnline={onlineStatus[activeStation.id] ?? false}
          onPlay={handleMiniPlay}
          onPause={handleMiniPause}
          onStop={handleStop}
          volume={miniVolume}
          onVolumeChange={setMiniVolume}
        />
      )}
    </div>
  );
}
