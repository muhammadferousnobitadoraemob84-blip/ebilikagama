"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useLanguage } from "@/components/LanguageProvider";

/* ── interfaces ── */
interface Channel {
  id: string;
  name: string;
  category: string;
  active: boolean;
}

interface Program {
  id: string;
  channelId: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  description: string | null;
  thumbnail: string | null;
  status: string;
  channel: { id: string; name: string };
}

interface ProgramScheduleProps {
  currentChannelId?: string;
}

/* ── constants ── */
const MINUTES_PER_PX = 2.5; // 1 minute = 2.5 px → 1 hour = 150 px
const HOUR_WIDTH = 60 * MINUTES_PER_PX; // 150 px per hour
const ROW_HEIGHT = 72;
const HEADER_HEIGHT = 40;
const TIMELINE_START_HOUR = 6; // 6 AM
const TIMELINE_END_HOUR = 28; // 4 AM next day (28 = 24+4)
const TOTAL_HOURS = TIMELINE_END_HOUR - TIMELINE_START_HOUR; // 22 hours
const TOTAL_WIDTH = TOTAL_HOURS * HOUR_WIDTH;

/* ── helpers ── */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function formatTime12h(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function calcDuration(start: string, end: string): string {
  let diff = timeToMinutes(end) - timeToMinutes(start);
  if (diff < 0) diff += 24 * 60;
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function getNowMinutes(): number {
  const now = new Date();
  // Use Asia/Kuala_Lumpur timezone
  const kl = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" }));
  return kl.getHours() * 60 + kl.getMinutes();
}

function getTodayStr(): string {
  const now = new Date();
  const kl = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" }));
  return `${kl.getFullYear()}-${String(kl.getMonth() + 1).padStart(2, "0")}-${String(kl.getDate()).padStart(2, "0")}`;
}

function minutesToPixel(minutes: number): number {
  return ((minutes - TIMELINE_START_HOUR * 60) / 60) * HOUR_WIDTH;
}

function programLeftWidth(p: Program): { left: number; width: number } {
  const startMin = timeToMinutes(p.startTime);
  let endMin = timeToMinutes(p.endTime);
  if (endMin <= startMin) endMin += 24 * 60; // crosses midnight
  const left = minutesToPixel(startMin);
  const width = ((endMin - startMin) / 60) * HOUR_WIDTH;
  return { left: Math.max(0, left), width: Math.max(width, 30) };
}

/* ── time axis labels ── */
function getTimeAxisLabels(): { hour: number; label: string; px: number }[] {
  const labels: { hour: number; label: string; px: number }[] = [];
  for (let h = TIMELINE_START_HOUR; h <= TIMELINE_END_HOUR; h++) {
    const displayH = h >= 24 ? h - 24 : h;
    const period = displayH >= 12 ? "PM" : "AM";
    const h12 = displayH === 0 ? 12 : displayH > 12 ? displayH - 12 : displayH;
    labels.push({
      hour: h,
      label: `${h12} ${period}`,
      px: ((h - TIMELINE_START_HOUR) * HOUR_WIDTH),
    });
  }
  return labels;
}

/* ── main component ── */
export default function ProgramSchedule({ currentChannelId }: ProgramScheduleProps) {
  const { t, locale } = useLanguage();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState(currentChannelId || "");
  const [selectedDate, setSelectedDate] = useState(getTodayStr());
  const [loading, setLoading] = useState(false);
  const [selectedProgram, setSelectedProgram] = useState<Program | null>(null);
  const [nowMinutes, setNowMinutes] = useState(getNowMinutes());
  const timelineRef = useRef<HTMLDivElement>(null);
  const [hasScrolledToNow, setHasScrolledToNow] = useState(false);

  const today = getTodayStr();

  // Generate 7 dates
  const [dates] = useState(() => {
    const arr: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      arr.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    }
    return arr;
  });

  // Update current time every 10s
  useEffect(() => {
    const iv = setInterval(() => setNowMinutes(getNowMinutes()), 10_000);
    return () => clearInterval(iv);
  }, []);

  // Fetch channels
  useEffect(() => {
    fetch("/api/channels")
      .then((r) => r.json())
      .then((data) => {
        const active = data.filter((c: Channel) => c.active);
        setChannels(active);
        if (!currentChannelId && active.length > 0 && !selectedChannelId) {
          setSelectedChannelId(active[0].id);
        }
      })
      .catch(() => {});
  }, [currentChannelId]);

  useEffect(() => {
    if (currentChannelId) setSelectedChannelId(currentChannelId);
  }, [currentChannelId]);

  // Fetch programs
  const fetchPrograms = useCallback(async () => {
    if (!selectedChannelId || !selectedDate) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/programs?channelId=${selectedChannelId}&date=${selectedDate}`);
      if (res.ok) setPrograms(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [selectedChannelId, selectedDate]);

  useEffect(() => { fetchPrograms(); }, [fetchPrograms]);

  // SSE real-time updates
  useEffect(() => {
    if (!selectedChannelId || !selectedDate) return;
    const es = new EventSource(`/api/programs/events?channelId=${selectedChannelId}&date=${selectedDate}`);
    es.onmessage = (e) => { try { setPrograms(JSON.parse(e.data)); } catch { /* */ } };
    es.onerror = () => es.close();
    return () => es.close();
  }, [selectedChannelId, selectedDate]);

  // Auto-scroll to current time on first load
  useEffect(() => {
    if (!timelineRef.current || hasScrolledToNow || loading) return;
    if (selectedDate !== today) { setHasScrolledToNow(true); return; }
    const nowPx = minutesToPixel(nowMinutes);
    const container = timelineRef.current;
    const scrollTarget = nowPx - container.clientWidth / 3;
    if (scrollTarget > 0) {
      container.scrollLeft = scrollTarget;
    }
    setHasScrolledToNow(true);
  }, [selectedDate, today, nowMinutes, loading, hasScrolledToNow]);

  const formatDateShort = (dateStr: string): string => {
    try {
      const d = new Date(dateStr + "T00:00:00");
      const day = d.getDate();
      const month = d.toLocaleDateString(locale, { month: "short" });
      return `${day} ${month}`;
    } catch { return dateStr; }
  };

  const formatFullDate = (dateStr: string): string => {
    try {
      const d = new Date(dateStr + "T00:00:00");
      return d.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    } catch { return dateStr; }
  };

  const timeAxis = getTimeAxisLabels();
  const nowLinePx = selectedDate === today ? minutesToPixel(nowMinutes) : -1;
  const selectedChannel = channels.find((c) => c.id === selectedChannelId);

  return (
    <div className="bg-gray-900/50 border border-white/10 rounded-xl sm:rounded-2xl overflow-hidden">
      {/* ── Controls: Channel + Date ── */}
      <div className="px-3 sm:px-4 pt-3 sm:pt-4 pb-3 sm:pb-4 space-y-3">
        {/* Date selector */}
        <div>
          <p className="text-gray-500 text-[11px] sm:text-xs font-medium uppercase tracking-wider mb-2">{t("epg_date")}</p>
          <div className="flex gap-1.5 sm:gap-2 overflow-x-auto scrollbar-hide pb-1">
            {dates.map((date) => {
              const isSelected = date === selectedDate;
              const isTodayDate = date === today;
              return (
                <button
                  key={date}
                  onClick={() => { setSelectedDate(date); setHasScrolledToNow(false); }}
                  className={`flex-shrink-0 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap ${
                    isSelected
                      ? "bg-white text-gray-900"
                      : isTodayDate
                      ? "bg-gray-800 text-white border border-white/20"
                      : "bg-gray-800/50 text-gray-400 hover:text-white"
                  }`}
                >
                  {formatDateShort(date)}
                  {isTodayDate && !isSelected && (
                    <span className="ml-1 text-[10px] sm:text-xs text-red-400">{t("today")}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Channel selector */}
        {channels.length > 1 && !currentChannelId && (
          <div>
            <p className="text-gray-500 text-[11px] sm:text-xs font-medium uppercase tracking-wider mb-2">{t("epg_channel")}</p>
            <div className="flex gap-1.5 sm:gap-2 overflow-x-auto scrollbar-hide pb-1">
              {channels.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => setSelectedChannelId(ch.id)}
                  className={`flex-shrink-0 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap ${
                    selectedChannelId === ch.id
                      ? "bg-red-600 text-white"
                      : "bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700"
                  }`}
                >
                  {ch.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Channel name + full date */}
        {selectedChannel && (
          <div className="flex items-center justify-between">
            <h3 className="text-white font-bold text-sm sm:text-base">{selectedChannel.name}</h3>
            <span className="text-gray-500 text-[11px] sm:text-xs">{formatFullDate(selectedDate)}</span>
          </div>
        )}
      </div>

      {/* ── Timeline ── */}
      <div className="relative">
        {loading ? (
          <div className="p-8 sm:p-12 text-center">
            <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-gray-400 text-sm">{t("loading_schedule")}</p>
          </div>
        ) : programs.length === 0 ? (
          <div className="p-8 sm:p-12 text-center">
            <svg className="w-10 h-10 sm:w-12 sm:h-12 text-gray-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-gray-400 text-sm font-medium">{t("no_programs")}</p>
            <p className="text-gray-600 text-xs sm:text-sm mt-1">{formatFullDate(selectedDate)}</p>
          </div>
        ) : (
          <>
            {/* Time axis header */}
            <div className="sticky top-0 z-20 bg-gray-900 border-b border-white/10">
              <div
                ref={timelineRef}
                className="overflow-x-auto scrollbar-hide"
                style={{ scrollBehavior: "smooth" }}
              >
                <div className="relative" style={{ width: TOTAL_WIDTH, minWidth: TOTAL_WIDTH }}>
                  {/* Hour labels */}
                  <div className="relative" style={{ height: HEADER_HEIGHT }}>
                    {timeAxis.map((label) => (
                      <div
                        key={label.hour}
                        className="absolute top-0 h-full border-l border-white/10"
                        style={{ left: label.px }}
                      >
                        <span className="absolute -left-5 top-2 text-[11px] sm:text-xs text-gray-400 font-medium whitespace-nowrap">
                          {label.label}
                        </span>
                      </div>
                    ))}
                    {/* Current time indicator on header */}
                    {nowLinePx >= 0 && (
                      <div
                        className="absolute top-0 h-full z-30 pointer-events-none"
                        style={{ left: nowLinePx }}
                      >
                        <div className="relative">
                          <div className="absolute -top-0.5 -left-[3px] w-[7px] h-[7px] bg-red-500 rounded-full" />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Program rows */}
            <div className="overflow-x-auto scrollbar-hide" onScroll={(e) => {
              // Sync header scroll
              const header = timelineRef.current;
              if (header) header.scrollLeft = (e.target as HTMLDivElement).scrollLeft;
            }}>
              <div className="relative" style={{ width: TOTAL_WIDTH, minWidth: TOTAL_WIDTH }}>
                {/* Hour grid lines */}
                <div className="absolute inset-0 pointer-events-none">
                  {timeAxis.map((label) => (
                    <div
                      key={label.hour}
                      className="absolute top-0 border-l border-white/5"
                      style={{ left: label.px, height: ROW_HEIGHT }}
                    />
                  ))}
                </div>

                {/* Current time line */}
                {nowLinePx >= 0 && (
                  <div
                    className="absolute top-0 bottom-0 z-20 pointer-events-none"
                    style={{ left: nowLinePx }}
                  >
                    <div className="w-px h-full bg-red-500" />
                  </div>
                )}

                {/* Program block */}
                <div className="relative" style={{ height: ROW_HEIGHT, padding: "8px 0" }}>
                  {programs.map((program) => {
                    const { left, width } = programLeftWidth(program);
                    const startMin = timeToMinutes(program.startTime);
                    const endMin = (() => {
                      let e = timeToMinutes(program.endTime);
                      if (e <= startMin) e += 24 * 60;
                      return e;
                    })();
                    const isCurrent = selectedDate === today && nowMinutes >= startMin && nowMinutes < endMin;
                    const isPast = selectedDate < today || (selectedDate === today && nowMinutes >= endMin);

                    return (
                      <button
                        key={program.id}
                        onClick={() => setSelectedProgram(program)}
                        className={`absolute top-2 bottom-2 rounded-lg border transition-all cursor-pointer flex flex-col justify-center px-2.5 sm:px-3 overflow-hidden group ${
                          isCurrent
                            ? "bg-green-600/20 border-green-500/40 shadow-lg shadow-green-900/30 z-10"
                            : isPast
                            ? "bg-gray-800/30 border-white/5 opacity-50 hover:opacity-70"
                            : "bg-gray-800/70 border-white/10 hover:border-white/25 hover:bg-gray-800"
                        }`}
                        style={{ left, width }}
                        aria-label={`${program.title}, ${formatTime12h(program.startTime)} to ${formatTime12h(program.endTime)}`}
                      >
                        {/* NOW badge */}
                        {isCurrent && (
                          <span className="inline-flex items-center gap-1 bg-green-600 text-white text-[8px] sm:text-[9px] font-bold px-1.5 py-[1px] rounded w-fit mb-0.5">
                            <span className="w-1 h-1 bg-white rounded-full animate-pulse" />
                            {t("now_playing")}
                          </span>
                        )}

                        {/* Title */}
                        <span className={`font-semibold text-[11px] sm:text-xs leading-tight truncate ${
                          isCurrent ? "text-green-300" : isPast ? "text-gray-500" : "text-white"
                        }`}>
                          {program.title}
                        </span>

                        {/* Time range */}
                        <span className={`text-[9px] sm:text-[10px] mt-0.5 truncate ${
                          isPast ? "text-gray-600" : "text-gray-400"
                        }`}>
                          {formatTime12h(program.startTime)} – {formatTime12h(program.endTime)}
                        </span>

                        {/* Duration for wider blocks */}
                        {width > 120 && (
                          <span className={`text-[9px] sm:text-[10px] mt-0.5 ${
                            isPast ? "text-gray-700" : "text-gray-500"
                          }`}>
                            {calcDuration(program.startTime, program.endTime)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Program Detail Modal ── */}
      {selectedProgram && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
          onClick={() => setSelectedProgram(null)}
        >
          <div
            className="bg-gray-900 border border-white/10 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 sm:px-5 pt-4 sm:pt-5 pb-3">
              <h3 className="text-white font-bold text-sm sm:text-base pr-4 leading-snug">{selectedProgram.title}</h3>
              <button
                onClick={() => setSelectedProgram(null)}
                className="text-gray-500 hover:text-white transition-colors flex-shrink-0"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-4 sm:px-5 pb-5 space-y-3">
              {/* Now playing */}
              {selectedProgram.date === today && (() => {
                const s = timeToMinutes(selectedProgram.startTime);
                let e = timeToMinutes(selectedProgram.endTime);
                if (e <= s) e += 24 * 60;
                return nowMinutes >= s && nowMinutes < e;
              })() && (
                <div className="inline-flex items-center gap-1.5 bg-green-600/20 border border-green-500/30 text-green-400 text-[11px] sm:text-xs font-bold px-2.5 py-1 rounded-lg">
                  <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                  {t("now_playing")}
                </div>
              )}

              {/* Time */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-800/50 rounded-lg px-3 py-2">
                  <p className="text-gray-500 text-[10px] sm:text-[11px] uppercase">{t("epg_start")}</p>
                  <p className="text-white text-xs sm:text-sm font-medium">{formatTime12h(selectedProgram.startTime)}</p>
                </div>
                <div className="bg-gray-800/50 rounded-lg px-3 py-2">
                  <p className="text-gray-500 text-[10px] sm:text-[11px] uppercase">{t("epg_end")}</p>
                  <p className="text-white text-xs sm:text-sm font-medium">{formatTime12h(selectedProgram.endTime)}</p>
                </div>
              </div>

              {/* Duration */}
              <div className="bg-gray-800/50 rounded-lg px-3 py-2">
                <p className="text-gray-500 text-[10px] sm:text-[11px] uppercase">{t("epg_duration")}</p>
                <p className="text-white text-xs sm:text-sm font-medium">{calcDuration(selectedProgram.startTime, selectedProgram.endTime)}</p>
              </div>

              {/* Channel */}
              {selectedProgram.channel && (
                <div className="bg-gray-800/50 rounded-lg px-3 py-2">
                  <p className="text-gray-500 text-[10px] sm:text-[11px] uppercase">{t("epg_channel")}</p>
                  <p className="text-white text-xs sm:text-sm font-medium">{selectedProgram.channel.name}</p>
                </div>
              )}

              {/* Description */}
              {selectedProgram.description && (
                <div className="bg-gray-800/50 rounded-lg px-3 py-2">
                  <p className="text-gray-500 text-[10px] sm:text-[11px] uppercase mb-1">{t("epg_description")}</p>
                  <p className="text-gray-300 text-xs sm:text-sm leading-relaxed">{selectedProgram.description}</p>
                </div>
              )}

              {/* Close button */}
              <button
                onClick={() => setSelectedProgram(null)}
                className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-xs sm:text-sm font-medium py-2.5 rounded-lg transition-colors"
              >
                {t("epg_close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
