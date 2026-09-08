"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLanguage } from "@/components/LanguageProvider";

// ── Types ──
interface Surah {
  id: number;
  name_simple: string;
  name_arabic: string;
  verses_count: number;
}

interface IndexedAyah {
  id: string;
  surahName: string;
  surahNumber: number;
  ayahNumber: number;
  audioType: string;
  reciterName: string;
  fileName: string;
  duration: number | null;
}

interface VerseText {
  verse_key: string;
  text_uthmani: string;
}

// ── API helpers ──
const QURAN_API = "https://api.quran.com/api/v4";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Component ──
export default function QuranAudioSection() {
  const { t } = useLanguage();

  // Reference data (surah list + Arabic verse text)
  const [surahs, setSurahs] = useState<Surah[]>([]);
  const [verses, setVerses] = useState<VerseText[]>([]);

  // Indexed audio library (Google Drive files indexed into the database)
  const [reciters, setReciters] = useState<string[]>([]);
  const [libraryLoaded, setLibraryLoaded] = useState(false);

  // Selections
  const [selectedSurah, setSelectedSurah] = useState<number>(1);
  const [selectedQari, setSelectedQari] = useState<string>("");
  const [activeAyah, setActiveAyah] = useState<number | null>(null);
  const [fullSurah, setFullSurah] = useState<IndexedAyah | null>(null);
  const [playingFull, setPlayingFull] = useState(false);

  // Player state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [missingAudio, setMissingAudio] = useState(false);
  const [error, setError] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);

  // Refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const indexedMapRef = useRef<Map<number, IndexedAyah>>(new Map()); // ayahNumber → entry
  const versesCacheRef = useRef<Map<number, VerseText[]>>(new Map());
  const ayahRefs = useRef<Map<number, HTMLDivElement | null>>(new Map());
  const lastLoadedUrlRef = useRef<string>("");

  // ── Load surah list + indexed reciters once ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [chapterRes, recitersRes] = await Promise.all([
          fetchJson<{ chapters: Surah[] }>(`${QURAN_API}/chapters?language=en`),
          fetch("/api/quran-audio/public?reciters=1")
            .then((r) => (r.ok ? r.json() : []))
            .catch(() => [] as { name: string; count: number }[]),
        ]);
        if (cancelled) return;
        setSurahs(chapterRes.chapters || []);
        const names = ((recitersRes as { name: string; count: number }[]) || [])
          .map((r) => r?.name)
          .filter(Boolean);
        setReciters(names);
        setLibraryLoaded(true);
        if (names.length > 0) setSelectedQari(names[0]);
      } catch {
        if (!cancelled) setError("quran_error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Load Arabic verse text for the selected surah (cached) ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = versesCacheRef.current.get(selectedSurah);
      if (cached) {
        setVerses(cached);
        return;
      }
      try {
        const data = await fetchJson<{ verses: VerseText[] }>(
          `${QURAN_API}/verses/by_chapter/${selectedSurah}?fields=text_uthmani&per_page=300`
        );
        if (cancelled) return;
        const list = data.verses || [];
        versesCacheRef.current.set(selectedSurah, list);
        setVerses(list);
      } catch {
        if (!cancelled) setError("quran_error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSurah]);

  // ── Load indexed audio entries for current surah + qari ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!selectedQari) {
        indexedMapRef.current = new Map();
        return;
      }
      try {
        const data = await fetchJson<IndexedAyah[]>(
          `/api/quran-audio/public?surah=${selectedSurah}&reciter=${encodeURIComponent(selectedQari)}`
        );
        if (cancelled) return;
        // Per-ayah records drive the highlighted verse list; full-surah recordings
        // (audioType "full_surah") are played as a single track without fake per-ayah timing.
        const perAyah = new Map<number, IndexedAyah>();
        let fsEntry: IndexedAyah | null = null;
        for (const e of data || []) {
          if (e.audioType === "full_surah") {
            if (!fsEntry) fsEntry = e;
          } else if (!perAyah.has(e.ayahNumber)) {
            perAyah.set(e.ayahNumber, e); // first record wins
          }
        }
        indexedMapRef.current = perAyah;
        setFullSurah(fsEntry);
        setMissingAudio(false);
      } catch {
        if (!cancelled) {
          indexedMapRef.current = new Map();
          setFullSurah(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSurah, selectedQari]);

  // ── Audio element lifecycle ──
  const getAudio = useCallback(() => {
    if (!audioRef.current) {
      const audio = new Audio();
      audio.preload = "auto";
      audio.addEventListener("timeupdate", () => setCurrentTime(audio.currentTime));
      audio.addEventListener("durationchange", () => setDuration(audio.duration));
      audio.addEventListener("loadedmetadata", () => setDuration(audio.duration));
      audio.addEventListener("playing", () => {
        setIsPlaying(true);
        setIsBuffering(false);
      });
      audio.addEventListener("pause", () => setIsPlaying(false));
      audio.addEventListener("waiting", () => setIsBuffering(true));
      audio.addEventListener("ended", () => {
        if (audio.dataset.mode === "full") {
          // Full-surah track finished — no per-ayah advance possible
          setIsPlaying(false);
          setIsBuffering(false);
          return;
        }
        const map = indexedMapRef.current;
        const current = Number(audio.dataset.ayah || "0");
        // Auto-advance to the next ayah that HAS audio (skip unavailable ones)
        let next = current + 1;
        while (next <= 300 && !map.has(next)) next++;
        if (map.has(next)) {
          setActiveAyah(next);
        } else {
          setIsPlaying(false);
          setIsBuffering(false);
          setMissingAudio(false);
        }
      });
      audioRef.current = audio;
    }
    return audioRef.current;
  }, []);

  // ── When activeAyah changes, load its audio and play ──
  useEffect(() => {
    if (activeAyah === null) return;
    const entry = indexedMapRef.current.get(activeAyah);
    if (!entry) {
      setMissingAudio(true);
      return;
    }
    setMissingAudio(false);
    const url = `/api/quran-audio/stream?id=${encodeURIComponent(entry.id)}&t=${entry.id}`;
    const audio = getAudio();
    if (lastLoadedUrlRef.current === url) return; // already loaded
    audio.pause();
    audio.src = url;
    audio.dataset.ayah = String(activeAyah);
    audio.dataset.mode = "ayah";
    lastLoadedUrlRef.current = url;
    audio.load();
    setIsBuffering(true);
    audio
      .play()
      .then(() => setIsPlaying(true))
      .catch(() => {
        // Autoplay policy blocked — not an error; user presses Play
        setIsPlaying(false);
        setIsBuffering(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAyah]);

  // ── Full-surah single-track playback (no per-ayah timing is claimed) ──
  const playFullSurah = useCallback(async () => {
    if (!fullSurah) return;
    const audio = getAudio();
    const url = `/api/quran-audio/stream?id=${encodeURIComponent(fullSurah.id)}&t=${fullSurah.id}`;
    if (lastLoadedUrlRef.current !== url) {
      audio.pause();
      audio.src = url;
      audio.dataset.ayah = "0";
      audio.dataset.mode = "full";
      lastLoadedUrlRef.current = url;
      audio.load();
    }
    setPlayingFull(true);
    setIsBuffering(true);
    setMissingAudio(false);
    try {
      await audio.play();
    } catch {
      setIsBuffering(false);
    }
  }, [fullSurah, getAudio]);

  // ── Play/pause toggle ──
  const togglePlayPause = useCallback(async () => {
    const audio = getAudio();
    if (playingFull) {
      if (audio.paused) {
        try {
          await audio.play();
        } catch {
          setIsPlaying(false);
        }
      } else {
        audio.pause();
      }
      return;
    }
    if (activeAyah === null) {
      // Nothing selected yet: start from the first indexed ayah
      const first = indexedMapRef.current.size
        ? Math.min(...indexedMapRef.current.keys())
        : null;
      if (first !== null) {
        setActiveAyah(first);
      } else if (fullSurah) {
        await playFullSurah();
      } else {
        setMissingAudio(true);
      }
      return;
    }
    if (audio.paused) {
      if (!audio.src) {
        // Force load of the current ayah
        lastLoadedUrlRef.current = "";
        setActiveAyah(activeAyah);
        return;
      }
      try {
        await audio.play();
      } catch {
        setIsPlaying(false);
      }
    } else {
      audio.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getAudio, activeAyah, playingFull, fullSurah, playFullSurah]);

  // ── Previous / next (skip ayahs without audio) ──
  const skipWithAudio = useCallback((from: number, dir: 1 | -1): number | null => {
    let n = from + dir;
    while (n >= 1 && n <= 300 && !indexedMapRef.current.has(n)) n += dir;
    if (n < 1 || n > 300 || !indexedMapRef.current.has(n)) return null;
    return n;
  }, []);

  const goPrev = useCallback(() => {
    if (activeAyah === null) return;
    const prev = skipWithAudio(activeAyah, -1);
    if (prev !== null) setActiveAyah(prev);
  }, [activeAyah, skipWithAudio]);

  const goNext = useCallback(() => {
    if (activeAyah === null) return;
    const next = skipWithAudio(activeAyah, 1);
    if (next !== null) setActiveAyah(next);
  }, [activeAyah, skipWithAudio]);

  // ── Seek + volume ──
  const handleSeek = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const audio = getAudio();
      audio.currentTime = parseFloat(e.target.value);
      setCurrentTime(audio.currentTime);
    },
    [getAudio]
  );

  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const vol = parseFloat(e.target.value);
      const audio = getAudio();
      audio.volume = vol;
      audio.muted = vol === 0;
      setVolume(vol);
    },
    [getAudio]
  );

  const toggleMute = useCallback(() => {
    const audio = getAudio();
    audio.muted = !audio.muted;
    setVolume(audio.muted ? 0 : volume || 0.8);
  }, [getAudio, volume]);

  // ── Change surah: stop playback, reset position ──
  const handleSurahChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = parseInt(e.target.value, 10);
    audioRef.current?.pause();
    lastLoadedUrlRef.current = "";
    setSelectedSurah(id);
    setActiveAyah(null);
    setPlayingFull(false);
    setCurrentTime(0);
    setDuration(0);
    setMissingAudio(false);
    setError("");
  }, []);

  // ── Change qari: stop playback, reload indexed entries ──
  const handleQariChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    audioRef.current?.pause();
    lastLoadedUrlRef.current = "";
    setSelectedQari(e.target.value);
    setActiveAyah(null);
    setPlayingFull(false);
    setCurrentTime(0);
    setDuration(0);
    setMissingAudio(false);
    setError("");
  }, []);

  // ── Click an ayah card to play it (leaves full-surah mode) ──
  const handleAyahClick = useCallback(
    (ayah: number) => {
      setPlayingFull(false);
      setMissingAudio(false);
      setActiveAyah(ayah);
    },
    []
  );

  // ── Cleanup ──
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
    };
  }, []);

  // ── Smooth-scroll active ayah into view ──
  useEffect(() => {
    if (activeAyah === null) return;
    const el = ayahRefs.current.get(activeAyah);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeAyah, verses]);

  function formatTime(sec: number): string {
    if (!sec || !isFinite(sec)) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  const currentSurah = useMemo(
    () => surahs.find((s) => s.id === selectedSurah),
    [surahs, selectedSurah]
  );
  const availableCount = indexedMapRef.current.size;
  const progressMax = duration || 0;
  const activeIsFull = playingFull && !!fullSurah;

  // ── Error state ──
  if (error === "quran_error") {
    return (
      <section className="py-12 sm:py-16 bg-black">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader t={t} />
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
        <SectionHeader t={t} />

        {/* Selectors */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          <div>
            <label className="block text-gray-400 text-xs mb-1.5 font-medium uppercase tracking-wider">
              {t("quran_select_surah")}
            </label>
            <select
              value={selectedSurah}
              onChange={handleSurahChange}
              className="w-full bg-gray-900 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:border-emerald-500 focus:outline-none cursor-pointer"
            >
              {surahs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id}. {s.name_simple} — {s.name_arabic} ({s.verses_count})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-gray-400 text-xs mb-1.5 font-medium uppercase tracking-wider">
              {t("quran_select_reciter")}
            </label>
            <select
              value={selectedQari}
              onChange={handleQariChange}
              className="w-full bg-gray-900 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:border-emerald-500 focus:outline-none cursor-pointer"
              disabled={reciters.length === 0}
            >
              {reciters.length === 0 ? (
                <option value="">{t("quran_no_reciters")}</option>
              ) : (
                reciters.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        {/* Player card */}
        <div className="bg-gray-900 rounded-xl border border-white/10 overflow-hidden">
          {/* Status bar */}
          <div className="px-4 sm:px-5 py-4 border-b border-white/10">
            <p className="text-emerald-400 text-lg sm:text-xl font-arabic leading-relaxed text-center">
              {t("quran_arabic_bismillah")}
            </p>
            <p className="text-gray-400 text-xs sm:text-sm mt-2 text-center">
              {currentSurah ? `${currentSurah.name_simple} — ${currentSurah.name_arabic}` : ""}
              {" · "}
              {activeIsFull
                ? t("quran_full_surah_playing")
                : `${t("quran_ayah")} ${activeAyah ?? "—"} ${t("quran_of")} ${currentSurah?.verses_count ?? "—"}`}
              {" · "}
              {t("quran_reciter")}: {selectedQari || "—"}
            </p>
          </div>

          {/* Playback controls */}
          <div className="p-4 sm:p-5 border-b border-white/10">
            {/* Progress */}
            <div className="flex items-center gap-3 mb-4">
              <span className="text-gray-500 text-xs font-mono w-10 text-right shrink-0">
                {formatTime(currentTime)}
              </span>
              <input
                type="range"
                min={0}
                max={progressMax}
                step={0.1}
                value={currentTime}
                onChange={handleSeek}
                className="quran-progress flex-1"
                aria-label="Seek"
              />
              <span className="text-gray-500 text-xs font-mono w-10 shrink-0">
                {formatTime(duration)}
              </span>
            </div>

            <div className="flex items-center justify-between">
              {/* Volume */}
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleMute}
                  className="text-gray-400 hover:text-white transition-colors p-2"
                  aria-label={t("quran_mute")}
                >
                  {volume === 0 ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    </svg>
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={volume}
                  onChange={handleVolumeChange}
                  className="w-16 sm:w-24 accent-emerald-500"
                  aria-label={t("quran_volume")}
                />
              </div>

              {/* Transport */}
              <div className="flex items-center gap-2 sm:gap-4">
                <button
                  onClick={goPrev}
                  disabled={playingFull || activeAyah === null || skipWithAudio(activeAyah, -1) === null}
                  className="text-gray-400 hover:text-white disabled:text-gray-700 disabled:cursor-not-allowed transition-colors p-2"
                  aria-label={t("quran_previous")}
                >
                  <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z" />
                  </svg>
                </button>

                <button
                  onClick={togglePlayPause}
                  disabled={isBuffering}
                  className="w-12 h-12 sm:w-14 sm:h-14 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-800 rounded-full flex items-center justify-center transition-colors"
                  aria-label={isPlaying ? t("quran_pause") : t("quran_play")}
                >
                  {isBuffering ? (
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

                <button
                  onClick={goNext}
                  disabled={playingFull || activeAyah === null || skipWithAudio(activeAyah, 1) === null}
                  className="text-gray-400 hover:text-white disabled:text-gray-700 disabled:cursor-not-allowed transition-colors p-2"
                  aria-label={t("quran_next")}
                >
                  <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z" />
                  </svg>
                </button>
              </div>

              {/* Ayah availability indicator */}
              <div className="hidden sm:block text-right">
                <p className="text-gray-500 text-xs">
                  {availableCount} / {currentSurah?.verses_count ?? 0} {t("quran_ayah")}
                </p>
              </div>
            </div>

            {/* Missing audio notice */}
            {missingAudio && (
              <div className="mt-3 text-center">
                <p className="text-amber-400 text-sm">{t("quran_missing_audio")}</p>
              </div>
            )}

            {/* Full-surah single-track notice + play button */}
            {fullSurah && !playingFull && (
              <div className="mt-3 flex flex-col sm:flex-row items-center justify-center gap-2">
                <p className="text-gray-400 text-xs text-center">
                  {t("quran_full_surah_available")}
                </p>
                <button
                  onClick={playFullSurah}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-3 py-1.5 rounded-full transition-colors shrink-0"
                >
                  {t("quran_play_full_surah")}
                </button>
              </div>
            )}

            {/* Library empty notice */}
            {libraryLoaded && reciters.length === 0 && (
              <div className="mt-3 text-center">
                <p className="text-gray-400 text-sm">{t("quran_no_library")}</p>
              </div>
            )}
          </div>

          {/* Verse list */}
          <div className="divide-y divide-white/5">
            {verses.length === 0 && (
              <div className="p-8 text-center text-gray-500 text-sm">{t("quran_loading")}</div>
            )}
            {verses.map((v) => {
              const ayahNum = parseInt(v.verse_key.split(":")[1] || "0", 10);
              const isActive = ayahNum === activeAyah;
              const hasAudio = indexedMapRef.current.has(ayahNum);
              return (
                <div
                  key={v.verse_key}
                  ref={(el) => {
                    ayahRefs.current.set(ayahNum, el);
                  }}
                  onClick={() => hasAudio && handleAyahClick(ayahNum)}
                  className={`px-4 sm:px-6 py-4 transition-colors duration-300 border-l-4 ${
                    isActive
                      ? "bg-emerald-500/10 border-emerald-400"
                      : "border-transparent"
                  } ${hasAudio ? "cursor-pointer hover:bg-white/5" : "opacity-60"}`}
                >
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <span
                      className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold transition-colors ${
                        isActive
                          ? "bg-emerald-500 text-white"
                          : hasAudio
                          ? "bg-white/10 text-gray-300"
                          : "bg-white/5 text-gray-600"
                      }`}
                    >
                      {ayahNum}
                    </span>
                    {isActive ? (
                      <span className="text-[11px] text-emerald-400 flex items-center gap-1.5">
                        <span className="inline-block w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                        {isPlaying ? t("quran_now_playing") : t("quran_paused")}
                      </span>
                    ) : !hasAudio ? (
                      <span className="text-[11px] text-gray-600">{t("quran_unavailable")}</span>
                    ) : null}
                  </div>
                  <p
                    dir="rtl"
                    className={`font-arabic text-right leading-loose transition-colors duration-300 ${
                      isActive ? "text-white text-xl sm:text-2xl" : "text-gray-200 text-lg sm:text-xl"
                    }`}
                  >
                    {v.text_uthmani}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Section header ──
function SectionHeader({ t }: { t: (key: never) => string }) {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center">
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
        </div>
        <h2 className="text-white text-xl sm:text-2xl font-bold">{t("quran_title" as never)}</h2>
      </div>
      <p className="text-gray-400 text-sm sm:text-base">{t("quran_description" as never)}</p>
    </div>
  );
}
