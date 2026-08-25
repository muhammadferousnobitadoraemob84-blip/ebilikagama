"use client";

import { useState, useRef, useEffect, useCallback } from "react";
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

  const audioRef = useRef<HTMLAudioElement | null>(null);

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
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
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
        {activeStation && isPlaying && (
          <div className="mb-8">
            <RadioPlayer
              station={activeStation}
              isPlaying={isPlaying}
              onPlay={handlePlay}
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
          {filtered.map((radio) => (
            <div
              key={radio.id}
              className={`bg-gray-900 border rounded-xl overflow-hidden transition-all cursor-pointer group ${
                activeStation?.id === radio.id && isPlaying
                  ? "border-red-500/50 ring-1 ring-red-500/20"
                  : "border-white/5 hover:border-white/20"
              }`}
              onClick={() => handlePlay(radio)}
            >
              {/* Thumbnail */}
              <div className="relative aspect-video overflow-hidden">
                {radio.thumbnail ? (
                  <img
                    src={radio.thumbnail}
                    alt={radio.name}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-red-900/30 to-gray-900 flex items-center justify-center">
                    <svg className="w-12 h-12 text-red-600/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" />
                    </svg>
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
                  {activeStation?.id === radio.id && isPlaying ? (
                    <span className="bg-green-600 text-white text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1">
                      <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                      {t("radio_playing")}
                    </span>
                  ) : (
                    <span className="bg-gray-600 text-white text-[10px] font-bold px-2 py-0.5 rounded">
                      {radio.category}
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
                  {activeStation?.id === radio.id && isPlaying ? `● ${t("radio_playing")}` : `▶ ${t("radio_listen")}`}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Mini Player */}
      {activeStation && (
        <RadioMiniPlayer
          station={activeStation}
          isPlaying={isPlaying}
          onPlay={handleMiniPlay}
          onPause={handleMiniPause}
          onStop={handleStop}
          volume={miniVolume}
          onVolumeChange={setMiniVolume}
        />
      )}

      {/* Hidden audio for mini player continuity */}
      <audio ref={audioRef} preload="none" />
    </div>
  );
}
