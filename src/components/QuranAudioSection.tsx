"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useLanguage } from "@/components/LanguageProvider";

// ── Types ──
interface Surah {
  id: number;
  name_simple: string;
  name_arabic: string;
  verses_count: number;
  transliteration?: string;
}

interface Reciter {
  id: number;
  name: string;
  style?: string;
  language_name?: string;
}

interface Verse {
  id: number;
  verse_key: string;
  text_uthmani?: string;
  text_imlaei_simple?: string;
}

interface UploadedAudio {
  id: string;
  surahName: string;
  surahNumber: number;
  ayahNumber: number;
  reciterName: string;
  duration: number | null;
}

// ── API helpers ──
const QURAN_API = "https://api.quran.com/api/v4";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Audio source helpers ──
function getSurahPad(n: number): string {
  return String(n).padStart(3, "0");
}

function getAudioUrlExternal(reciterId: number, verseKey: string): string {
  const [surahStr, ayahStr] = verseKey.split(":");
  const surah = parseInt(surahStr, 10);
  const ayah = parseInt(ayahStr, 10);
  const surahPad = getSurahPad(surah);
  const ayahPad = String(ayah).padStart(3, "0");

  // Use qdc (Quran Development Center) CDN — reliable per-ayah audio
  return `https://download.quran.com.au/audio/ayah/${reciterId}/${surahPad}${ayahPad}.mp3`;
}

// ── Component ──
export default function QuranAudioSection() {
  const { t, language } = useLanguage();

  // Data
  const [surahs, setSurahs] = useState<Surah[]>([]);
  const [reciters, setReciters] = useState<Reciter[]>([]);
  const [verses, setVerses] = useState<Verse[]>([]);

  // Selections
  const [selectedSurah, setSelectedSurah] = useState<number>(1);
  const [selectedReciter, setSelectedReciter] = useState<number>(1);
  const [currentAyah, setCurrentAyah] = useState<number>(1);

  // Player state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);

  // Uploaded audio entries from database
  const [uploadedAudios, setUploadedAudios] = useState<UploadedAudio[]>([]);
  const uploadedMapRef = useRef<Map<string, string>>(new Map()); // key: "surah:ayah:reciter" → entryId

  // Refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autoPlayRef = useRef(false);
  const loadingDataRef = useRef(false);
  const surahCacheRef = useRef<Map<number, Surah[]>>(new Map());
  const sessionReciterRef = useRef<number>(1);

  // ── Load surahs + reciters + uploaded audio entries once ──
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const [chapterRes, reciterRes, uploadedRes] = await Promise.all([
          fetchJson<{ chapters: Surah[] }>(`${QURAN_API}/chapters?language=en`),
          fetchJson<{ recitations: Reciter[] }>(
            `${QURAN_API}/resources/recitations?language=en`
          ),
          fetch("/api/quran-audio/public").then((r) => r.ok ? r.json() : []),
        ]);
        if (!cancelled) {
          setSurahs(chapterRes.chapters || []);
          // Filter to only common reciters with audio
          const availableReciters = (reciterRes.recitations || []).filter(
            (r) =>
              r.id >= 1 &&
              r.id <= 20 &&
              r.language_name?.toLowerCase() === "arabic"
          );
          if (availableReciters.length === 0) {
            setReciters((reciterRes.recitations || []).slice(0, 20));
          } else {
            setReciters(availableReciters);
          }
          // Load uploaded audio entries
          const uploaded: UploadedAudio[] = uploadedRes || [];
          setUploadedAudios(uploaded);
          // Build lookup map: key = "surah:ayah:reciterName" → entryId
          const map = new Map<string, string>();
          for (const entry of uploaded) {
            const key = `${entry.surahNumber}:${entry.ayahNumber}:${entry.reciterName}`;
            map.set(key, entry.id);
          }
          uploadedMapRef.current = map;
        }
      } catch {
        if (!cancelled) setError("quran_error");
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Load verses when surah changes ──
  useEffect(() => {
    if (loadingDataRef.current) return;
    loadingDataRef.current = true;

    let cancelled = false;
    async function loadVerses() {
      try {
        // Check cache
        const cached = surahCacheRef.current.get(selectedSurah);
        if (cached) {
          // Already loaded, just set verses for display
          setVerses([
            {
              id: 0,
              verse_key: "",
              text_uthmani: "",
            },
          ]);
          loadingDataRef.current = false;
          return;
        }

        const data = await fetchJson<{ verses: Verse[] }>(
          `${QURAN_API}/verses/by_chapter/${selectedSurah}?language=en&fields=text_uthmani,text_imlaei_simple&per_page=300`
        );
        if (!cancelled) {
          setVerses(data.verses || []);
          setCurrentAyah(1);
          setIsPlaying(false);
          setCurrentTime(0);
          setDuration(0);
          setError("");
        }
      } catch {
        if (!cancelled) setError("quran_error");
      } finally {
        loadingDataRef.current = false;
      }
    }
    loadVerses();
    return () => {
      cancelled = true;
    };
  }, [selectedSurah]);

  // ── Save session preferences ──
  useEffect(() => {
    try {
      sessionStorage.setItem("quran_reciter", String(selectedReciter));
    } catch {
      // Ignore
    }
  }, [selectedReciter]);

  // ── Restore session reciter on mount ──
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("quran_reciter");
      if (saved) {
        const id = parseInt(saved, 10);
        if (!isNaN(id) && id > 0) {
          setSelectedReciter(id);
          sessionReciterRef.current = id;
        }
      }
    } catch {
      // Ignore
    }
  }, []);

  // ── Create / get audio element ──
  const getAudio = useCallback(() => {
    if (!audioRef.current) {
      const audio = new Audio();
      audio.preload = "auto";
      audio.addEventListener("timeupdate", () => {
        setCurrentTime(audio.currentTime);
      });
      audio.addEventListener("loadedmetadata", () => {
        setDuration(audio.duration);
      });
      audio.addEventListener("error", () => {
        if (autoPlayRef.current) {
          setError("quran_audio_error");
          setIsPlaying(false);
          setIsLoading(false);
        }
      });
      audio.addEventListener("ended", () => {
        // Auto next ayah
        autoPlayRef.current = true;
        setCurrentAyah((prev) => {
          const total = surahs.find((s) => s.id === selectedSurah)?.verses_count || 0;
          if (prev < total) return prev + 1;
          return prev;
        });
      });
      audioRef.current = audio;
    }
    return audioRef.current;
  }, [surahs, selectedSurah]);

  // ── Get audio URL (prefer uploaded files, fallback to external) ──
  const getAudioUrlForVerse = useCallback(
    (surahId: number, ayah: number, reciterId: number): string => {
      // Check if we have an uploaded file for this verse
      const reciterName = reciters.find((r) => r.id === reciterId)?.name || "";
      if (reciterName) {
        // Try exact match first
        const key = `${surahId}:${ayah}:${reciterName}`;
        const entryId = uploadedMapRef.current.get(key);
        if (entryId) {
          return `/api/quran-audio/stream?id=${entryId}`;
        }
        // Try case-insensitive match
        const lowerName = reciterName.toLowerCase().trim();
        for (const [mapKey, mapEntryId] of uploadedMapRef.current.entries()) {
          if (mapKey.startsWith(`${surahId}:${ayah}:`)) {
            const mapReciter = mapKey.split(":").slice(2).join(":").toLowerCase().trim();
            if (mapReciter === lowerName) {
              return `/api/quran-audio/stream?id=${mapEntryId}`;
            }
          }
        }
      }
      // Fallback to external CDN
      return getAudioUrlExternal(reciterId, `${surahId}:${ayah}`);
    },
    [reciters]
  );

  // ── Play a verse ──
  const playVerse = useCallback(
    async (surahId: number, ayah: number, reciterId: number) => {
      const audio = getAudio();
      const url = getAudioUrlForVerse(surahId, ayah, reciterId);

      setIsLoading(true);
      setError("");
      autoPlayRef.current = true;

      try {
        audio.src = url;
        audio.load();
        await audio.play();
        setIsPlaying(true);
      } catch {
        // Autoplay blocked — show prompt
        setIsPlaying(false);
        setIsLoading(false);
      }
    },
    [getAudio, getAudioUrlForVerse]
  );

  // ── Handle ayah change ──
  useEffect(() => {
    if (autoPlayRef.current && isPlaying) {
      const audio = getAudio();
      const url = getAudioUrlForVerse(selectedSurah, currentAyah, selectedReciter);

      setIsLoading(true);
      autoPlayRef.current = true;

      audio.src = url;
      audio.load();
      audio.play().then(() => {
        setIsPlaying(true);
        setIsLoading(false);
      }).catch(() => {
        setIsPlaying(false);
        setIsLoading(false);
      });
    } else {
      // Just prepare the URL
      autoPlayRef.current = false;
    }
  }, [currentAyah, isPlaying, getAudio, selectedReciter, selectedSurah, getAudioUrlForVerse]);

  // ── Play/Pause toggle ──
  const togglePlayPause = useCallback(async () => {
    const audio = getAudio();
    const url = getAudioUrlForVerse(selectedSurah, currentAyah, selectedReciter);

    if (audio.src !== url && !isPlaying) {
      // New verse — start playing
      await playVerse(selectedSurah, currentAyah, selectedReciter);
      return;
    }

    if (audio.paused) {
      try {
        await audio.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }, [getAudio, selectedSurah, currentAyah, selectedReciter, isPlaying, playVerse, getAudioUrlForVerse]);

  // ── Previous / Next ayah ──
  const goPrev = useCallback(() => {
    if (currentAyah > 1) {
      autoPlayRef.current = isPlaying;
      setCurrentAyah((prev) => prev - 1);
    }
  }, [currentAyah, isPlaying]);

  const goNext = useCallback(() => {
    const total = surahs.find((s) => s.id === selectedSurah)?.verses_count || 0;
    if (currentAyah < total) {
      autoPlayRef.current = isPlaying;
      setCurrentAyah((prev) => prev + 1);
    }
  }, [currentAyah, isPlaying, surahs, selectedSurah]);

  // ── Seek ──
  const handleSeek = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const audio = getAudio();
      const time = parseFloat(e.target.value);
      audio.currentTime = time;
      setCurrentTime(time);
    },
    [getAudio]
  );

  // ── Volume ──
  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const audio = getAudio();
      const vol = parseFloat(e.target.value);
      audio.volume = vol;
      setVolume(vol);
      if (vol === 0) setIsMuted(true);
      else setIsMuted(false);
    },
    [getAudio]
  );

  const toggleMute = useCallback(() => {
    const audio = getAudio();
    if (isMuted) {
      audio.volume = volume > 0 ? volume : 0.5;
      setIsMuted(false);
      if (volume === 0) setVolume(0.5);
    } else {
      audio.volume = 0;
      setIsMuted(true);
    }
  }, [getAudio, isMuted, volume]);

  // ── Surah change handler ──
  const handleSurahChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const id = parseInt(e.target.value, 10);
      setSelectedSurah(id);
      autoPlayRef.current = false;
      setIsPlaying(false);
      setError("");
      // Stop audio
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      setCurrentTime(0);
      setDuration(0);
    },
    []
  );

  // ── Ayah change handler ──
  const handleAyahChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const ayah = parseInt(e.target.value, 10);
      autoPlayRef.current = false;
      setCurrentAyah(ayah);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      setCurrentTime(0);
      setDuration(0);
      setError("");
    },
    []
  );

  // ── Reciter change handler ──
  const handleReciterChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const id = parseInt(e.target.value, 10);
      setSelectedReciter(id);
      sessionReciterRef.current = id;
      // Stop and reset
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      setError("");
    },
    []
  );

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
    };
  }, []);

  // ── Format time ──
  function formatTime(sec: number): string {
    if (!sec || !isFinite(sec)) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  const totalAyahs =
    surahs.find((s) => s.id === selectedSurah)?.verses_count || 0;
  const currentSurah = surahs.find((s) => s.id === selectedSurah);

  if (error === "quran_error") {
    return (
      <section className="py-12 sm:py-16 bg-black">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <h2 className="text-white text-xl sm:text-2xl font-bold">
                {t("quran_title")}
              </h2>
            </div>
          </div>
          <div className="bg-gray-900 rounded-xl border border-white/10 p-8 text-center">
            <svg className="w-12 h-12 text-red-500/50 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-gray-400">{t("quran_error")}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm transition-colors"
            >
              {t("try_again")}
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="py-12 sm:py-16 bg-black">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <h2 className="text-white text-xl sm:text-2xl font-bold">
              {t("quran_title")}
            </h2>
          </div>
          <p className="text-gray-400 text-sm sm:text-base">
            {t("quran_description")}
          </p>
        </div>

        {/* Player Card */}
        <div className="bg-gray-900 rounded-xl border border-white/10 overflow-hidden">
          {/* Bismillah Header */}
          <div className="text-center py-5 border-b border-white/10">
            <p className="text-emerald-400 text-lg sm:text-xl font-arabic leading-relaxed">
              {t("quran_arabic_bismillah")}
            </p>
            {currentSurah && (
              <p className="text-gray-400 text-sm mt-1">
                {currentSurah.name_simple} {currentSurah.name_arabic} —{" "}
                {t("quran_ayah")} {currentAyah} {t("quran_of")} {totalAyahs}
              </p>
            )}
          </div>

          {/* Selectors */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 sm:p-5 border-b border-white/10">
            {/* Surah Select */}
            <div>
              <label className="block text-gray-400 text-xs mb-1.5 font-medium uppercase tracking-wider">
                {t("quran_select_surah")}
              </label>
              <select
                value={selectedSurah}
                onChange={handleSurahChange}
                className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:border-emerald-500 focus:outline-none appearance-none cursor-pointer"
              >
                {surahs.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id}. {s.name_simple} ({s.verses_count})
                  </option>
                ))}
              </select>
            </div>

            {/* Ayah Select */}
            <div>
              <label className="block text-gray-400 text-xs mb-1.5 font-medium uppercase tracking-wider">
                {t("quran_select_ayah")}
              </label>
              <select
                value={currentAyah}
                onChange={handleAyahChange}
                className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:border-emerald-500 focus:outline-none appearance-none cursor-pointer"
              >
                {Array.from({ length: totalAyahs }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {t("quran_ayah")} {i + 1}
                  </option>
                ))}
              </select>
            </div>

            {/* Reciter Select */}
            <div>
              <label className="block text-gray-400 text-xs mb-1.5 font-medium uppercase tracking-wider">
                {t("quran_select_reciter")}
              </label>
              <select
                value={selectedReciter}
                onChange={handleReciterChange}
                className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:border-emerald-500 focus:outline-none appearance-none cursor-pointer"
              >
                {reciters.length === 0 && (
                  <option>{t("quran_no_reciters")}</option>
                )}
                {reciters.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Playback Controls */}
          <div className="p-4 sm:p-5">
            {/* Progress Bar */}
            <div className="flex items-center gap-3 mb-4">
              <span className="text-gray-500 text-xs font-mono w-10 text-right shrink-0">
                {formatTime(currentTime)}
              </span>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={currentTime}
                onChange={handleSeek}
                className="quran-progress flex-1"
              />
              <span className="text-gray-500 text-xs font-mono w-10 shrink-0">
                {formatTime(duration)}
              </span>
            </div>

            {/* Controls Row */}
            <div className="flex items-center justify-between">
              {/* Volume */}
              <div className="relative">
                <button
                  onClick={toggleMute}
                  className="text-gray-400 hover:text-white transition-colors p-2"
                  aria-label={isMuted ? t("quran_unmute") : t("quran_mute")}
                >
                  {isMuted || volume === 0 ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                    </svg>
                  ) : volume < 0.5 ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    </svg>
                  )}
                </button>
                <div
                  className="absolute bottom-full left-0 mb-2 bg-gray-800 rounded-lg p-2 opacity-0 pointer-events-none transition-opacity"
                  style={{
                    opacity: showVolumeSlider ? 1 : undefined,
                    pointerEvents: showVolumeSlider ? "auto" : undefined,
                  }}
                >
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={isMuted ? 0 : volume}
                    onChange={handleVolumeChange}
                    className="w-24 accent-emerald-500"
                    style={{ writingMode: "horizontal-tb" as const }}
                  />
                </div>
              </div>

              {/* Center Controls */}
              <div className="flex items-center gap-2 sm:gap-4">
                {/* Previous */}
                <button
                  onClick={goPrev}
                  disabled={currentAyah <= 1}
                  className="text-gray-400 hover:text-white disabled:text-gray-700 disabled:cursor-not-allowed transition-colors p-2"
                  aria-label={t("quran_previous")}
                >
                  <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z" />
                  </svg>
                </button>

                {/* Play/Pause */}
                <button
                  onClick={togglePlayPause}
                  disabled={isLoading && !isPlaying}
                  className="w-12 h-12 sm:w-14 sm:h-14 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-800 rounded-full flex items-center justify-center transition-colors"
                  aria-label={isPlaying ? "Pause" : "Play"}
                >
                  {isLoading && !isPlaying ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : isPlaying ? (
                    <svg className="w-5 h-5 sm:w-6 sm:h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 sm:w-6 sm:h-6 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>

                {/* Next */}
                <button
                  onClick={goNext}
                  disabled={currentAyah >= totalAyahs}
                  className="text-gray-400 hover:text-white disabled:text-gray-700 disabled:cursor-not-allowed transition-colors p-2"
                  aria-label={t("quran_next")}
                >
                  <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z" />
                  </svg>
                </button>
              </div>

              {/* Volume on larger screens */}
              <div className="hidden sm:flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-24 accent-emerald-500"
                />
              </div>
            </div>

            {/* Loading indicator */}
            {isLoading && (
              <div className="flex items-center justify-center gap-2 mt-3 text-gray-400 text-sm">
                <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                {t("quran_loading")}
              </div>
            )}

            {/* Error message */}
            {error === "quran_audio_error" && (
              <div className="mt-3 text-center">
                <p className="text-red-400 text-sm">{t("quran_audio_error")}</p>
                <button
                  onClick={() => {
                    setError("");
                    autoPlayRef.current = false;
                  }}
                  className="mt-2 text-emerald-400 hover:text-emerald-300 text-sm underline"
                >
                  {t("try_again")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
