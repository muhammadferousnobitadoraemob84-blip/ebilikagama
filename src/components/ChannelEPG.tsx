"use client";

import { useEffect, useState, useCallback } from "react";
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

interface ChannelEPGProps {
  currentChannelId: string;
}

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

function calcDurationMinutes(start: string, end: string): number {
  let diff = timeToMinutes(end) - timeToMinutes(start);
  if (diff < 0) diff += 24 * 60;
  return diff;
}

function formatDuration(start: string, end: string): string {
  const diff = calcDurationMinutes(start, end);
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function getNowMinutes(): number {
  const now = new Date();
  const kl = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" }));
  return kl.getHours() * 60 + kl.getMinutes();
}

function getTodayStr(): string {
  const now = new Date();
  const kl = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" }));
  return `${kl.getFullYear()}-${String(kl.getMonth() + 1).padStart(2, "0")}-${String(kl.getDate()).padStart(2, "0")}`;
}

/* ── main component ── */
export default function ChannelEPG({ currentChannelId }: ChannelEPGProps) {
  const { t, locale } = useLanguage();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState(currentChannelId);
  const [selectedDate, setSelectedDate] = useState(getTodayStr());
  const [loading, setLoading] = useState(false);
  const [nowMinutes, setNowMinutes] = useState(getNowMinutes());

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
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setSelectedChannelId(currentChannelId);
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

  const selectedChannel = channels.find((c) => c.id === selectedChannelId);

  // Determine current program
  const getCurrentProgram = (): Program | null => {
    if (selectedDate !== today) return null;
    for (const p of programs) {
      const s = timeToMinutes(p.startTime);
      let e = timeToMinutes(p.endTime);
      if (e <= s) e += 24 * 60;
      if (nowMinutes >= s && nowMinutes < e) return p;
    }
    return null;
  };

  const currentProgram = getCurrentProgram();

  return (
    <div className="bg-gray-900/50 border border-white/10 rounded-xl sm:rounded-2xl overflow-hidden">
      {/* ── Controls ── */}
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
                  onClick={() => setSelectedDate(date)}
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
        {channels.length > 1 && (
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

      {/* ── Program List ── */}
      <div className="px-3 sm:px-4 pb-4 sm:pb-6">
        {loading ? (
          <div className="py-12 text-center">
            <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-gray-400 text-sm">{t("loading_schedule")}</p>
          </div>
        ) : programs.length === 0 ? (
          <div className="py-12 text-center">
            <svg className="w-10 h-10 sm:w-12 sm:h-12 text-gray-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-gray-400 text-sm font-medium">{t("no_programs")}</p>
            <p className="text-gray-600 text-xs sm:text-sm mt-1">{formatFullDate(selectedDate)}</p>
          </div>
        ) : (
          <div className="space-y-0">
            {programs.map((program) => {
              const s = timeToMinutes(program.startTime);
              let e = timeToMinutes(program.endTime);
              if (e <= s) e += 24 * 60;
              const isCurrent = selectedDate === today && nowMinutes >= s && nowMinutes < e;
              const isPast = selectedDate < today || (selectedDate === today && nowMinutes >= e);
              const isFuture = selectedDate > today || (selectedDate === today && nowMinutes < s);

              return (
                <div
                  key={program.id}
                  className={`flex gap-3 sm:gap-4 py-3 sm:py-4 border-b border-white/5 last:border-b-0 ${
                    isCurrent ? "bg-green-900/10 -mx-3 sm:-mx-4 px-3 sm:px-4 rounded-lg" : ""
                  }`}
                >
                  {/* Time column */}
                  <div className="flex-shrink-0 w-16 sm:w-20 text-right">
                    <p className={`text-xs sm:text-sm font-mono font-semibold ${
                      isCurrent ? "text-green-400" : isPast ? "text-gray-600" : "text-gray-300"
                    }`}>
                      {formatTime12h(program.startTime)}
                    </p>
                  </div>

                  {/* Program details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {isCurrent && (
                        <span className="inline-flex items-center gap-1 bg-green-600 text-white text-[9px] sm:text-[10px] font-bold px-1.5 py-[1px] rounded uppercase flex-shrink-0">
                          <span className="w-1 h-1 bg-white rounded-full animate-pulse" />
                          {t("on_air")}
                        </span>
                      )}
                      {isFuture && (
                        <span className="inline-flex items-center bg-zinc-700 text-gray-300 text-[9px] sm:text-[10px] font-bold px-1.5 py-[1px] rounded uppercase flex-shrink-0">
                          {t("upcoming")}
                        </span>
                      )}
                    </div>

                    <p className={`text-sm sm:text-base font-semibold leading-snug ${
                      isCurrent ? "text-green-300" : isPast ? "text-gray-500" : "text-white"
                    }`}>
                      {program.title}
                    </p>

                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[11px] sm:text-xs ${
                        isPast ? "text-gray-600" : "text-gray-400"
                      }`}>
                        {formatTime12h(program.startTime)} – {formatTime12h(program.endTime)}
                      </span>
                      <span className={`text-[11px] sm:text-xs ${
                        isPast ? "text-gray-700" : "text-gray-500"
                      }`}>
                        {formatDuration(program.startTime, program.endTime)}
                      </span>
                    </div>

                    {program.description && (
                      <p className={`text-xs sm:text-sm mt-1.5 leading-relaxed line-clamp-2 ${
                        isPast ? "text-gray-600" : "text-gray-400"
                      }`}>
                        {program.description}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
