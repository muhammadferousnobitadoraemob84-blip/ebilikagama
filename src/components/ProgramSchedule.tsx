"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { getLocaleCode } from "@/lib/i18n";

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

export default function ProgramSchedule({ currentChannelId }: ProgramScheduleProps) {
  const { t, locale, language } = useLanguage();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState(currentChannelId || "");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [loading, setLoading] = useState(false);
  const scheduleRef = useRef<HTMLDivElement>(null);
  const currentProgramRef = useRef<HTMLDivElement>(null);

  const [dates] = useState(() => {
    const arr: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      arr.push(d.toISOString().split("T")[0]);
    }
    return arr;
  });

  // Fetch channels
  useEffect(() => {
    fetch("/api/channels")
      .then((r) => r.json())
      .then((data) => {
        setChannels(data.filter((c: Channel) => c.active));
        if (!currentChannelId && data.length > 0) {
          setSelectedChannelId(data[0].id);
        }
      })
      .catch(() => {});
  }, [currentChannelId]);

  useEffect(() => {
    if (currentChannelId) {
      setSelectedChannelId(currentChannelId);
    }
  }, [currentChannelId]);

  const fetchPrograms = useCallback(async () => {
    if (!selectedChannelId || !selectedDate) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/programs?channelId=${selectedChannelId}&date=${selectedDate}`);
      if (res.ok) {
        const data = await res.json();
        setPrograms(data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [selectedChannelId, selectedDate]);

  useEffect(() => {
    fetchPrograms();
  }, [fetchPrograms]);

  // SSE for real-time updates
  useEffect(() => {
    if (!selectedChannelId || !selectedDate) return;
    const evtSource = new EventSource(`/api/programs/events?channelId=${selectedChannelId}&date=${selectedDate}`);
    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setPrograms(data);
      } catch {
        // ignore
      }
    };
    evtSource.onerror = () => evtSource.close();
    return () => evtSource.close();
  }, [selectedChannelId, selectedDate]);

  // Auto-scroll to current program
  useEffect(() => {
    if (currentProgramRef.current) {
      currentProgramRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [programs]);

  const now = getCurrentTimeStr();
  const today = new Date().toISOString().split("T")[0];

  const formatDateShort = (dateStr: string): string => {
    try {
      const d = new Date(dateStr + "T00:00:00");
      const day = d.getDate();
      const month = d.toLocaleDateString(locale, { month: "short" });
      return `${day} ${month}`;
    } catch {
      return dateStr;
    }
  };

  const formatFullDate = (dateStr: string): string => {
    try {
      const d = new Date(dateStr + "T00:00:00");
      return d.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="bg-gray-900/50 border border-white/10 rounded-xl sm:rounded-2xl overflow-hidden">
      {/* Channel Tabs */}
      <div className="border-b border-white/10 px-3 sm:px-4 pt-3 sm:pt-4">
        <div className="flex gap-1.5 sm:gap-2 overflow-x-auto pb-2.5 sm:pb-3 scrollbar-hide">
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

      {/* Date Selector */}
      <div className="border-b border-white/10 px-3 sm:px-4 pt-2.5 sm:pt-3 pb-2.5 sm:pb-3">
        <div className="flex gap-1.5 sm:gap-2 overflow-x-auto scrollbar-hide">
          {dates.map((date) => {
            const isSelected = date === selectedDate;
            const isToday = date === today;
            return (
              <button
                key={date}
                onClick={() => setSelectedDate(date)}
                className={`flex-shrink-0 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap ${
                  isSelected
                    ? "bg-white text-gray-900"
                    : isToday
                    ? "bg-gray-800 text-white border border-white/20"
                    : "bg-gray-800/50 text-gray-400 hover:text-white"
                }`}
              >
                {formatDateShort(date)}
                {isToday && !isSelected && (
                  <span className="ml-1 sm:ml-1.5 text-[10px] sm:text-xs text-red-400">{t("today")}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Programs */}
      <div ref={scheduleRef} className="max-h-[500px] sm:max-h-[600px] overflow-y-auto">
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
            <p className="text-gray-400 text-sm">{t("no_programs")}</p>
            <p className="text-gray-500 text-xs sm:text-sm mt-1">{formatFullDate(selectedDate)}</p>
          </div>
        ) : (
          <div className="p-3 sm:p-4 space-y-1">
            <div className="px-1 sm:px-2 py-2 sm:py-3 mb-1 sm:mb-2">
              <h3 className="text-white font-semibold text-sm sm:text-base">{formatFullDate(selectedDate)}</h3>
            </div>

            {programs.map((program, index) => {
              const isCurrent =
                program.date === today &&
                program.startTime <= now &&
                program.endTime > now;

              const isFinished =
                program.date < today ||
                (program.date === today && program.endTime <= now);

              const isPast = isFinished;

              return (
                <div
                  key={program.id}
                  ref={isCurrent ? currentProgramRef : undefined}
                  className={`rounded-lg sm:rounded-xl p-3 sm:p-4 transition-all ${
                    isCurrent
                      ? "bg-green-600/15 border border-green-500/30 shadow-lg shadow-green-900/20"
                      : isPast
                      ? "bg-gray-800/30 opacity-50"
                      : "bg-gray-800/60 hover:bg-gray-800"
                  } ${index < programs.length - 1 ? "border-b border-white/5" : ""}`}
                >
                  {/* Desktop layout */}
                  <div className="hidden sm:flex items-start gap-4">
                    <div className="flex-shrink-0 w-24">
                      <div className={`text-lg font-bold ${
                        isCurrent ? "text-green-400" : isPast ? "text-gray-500" : "text-white"
                      }`}>
                        {formatTime12h(program.startTime)}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {formatTime12h(program.endTime)}
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {isCurrent && (
                          <span className="inline-flex items-center gap-1 bg-green-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider">
                            <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                            {t("now_playing")}
                          </span>
                        )}
                        {program.status === "live" && !isCurrent && (
                          <span className="inline-flex items-center gap-1 bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider">
                            LIVE
                          </span>
                        )}
                      </div>
                      <h4 className={`font-semibold text-base ${
                        isCurrent ? "text-green-300" : isPast ? "text-gray-400" : "text-white"
                      }`}>
                        {program.title}
                      </h4>
                      <div className="flex items-center gap-3 mt-1">
                        <span className={`text-xs ${isPast ? "text-gray-600" : "text-gray-400"}`}>
                          {calcDuration(program.startTime, program.endTime)}
                        </span>
                        {program.channel && (
                          <span className={`text-xs ${isPast ? "text-gray-600" : "text-gray-500"}`}>
                            {program.channel.name}
                          </span>
                        )}
                      </div>
                      {program.description && (
                        <p className={`text-sm mt-2 leading-relaxed ${isPast ? "text-gray-600" : "text-gray-400"}`}>
                          {program.description}
                        </p>
                      )}
                    </div>

                    {program.thumbnail && (
                      <div className="flex-shrink-0 w-20 h-14 rounded-lg overflow-hidden">
                        <img
                          src={program.thumbnail}
                          alt={program.title}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                  </div>

                  {/* Mobile layout */}
                  <div className="sm:hidden">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        {isCurrent && (
                          <span className="inline-flex items-center gap-1 bg-green-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider">
                            <span className="w-1 h-1 bg-white rounded-full animate-pulse" />
                            {t("live")}
                          </span>
                        )}
                        {program.status === "live" && !isCurrent && (
                          <span className="inline-flex items-center gap-1 bg-red-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider">
                            LIVE
                          </span>
                        )}
                      </div>
                      <span className={`text-xs font-medium ${
                        isCurrent ? "text-green-400" : isPast ? "text-gray-600" : "text-gray-400"
                      }`}>
                        {formatTime12h(program.startTime)}
                      </span>
                    </div>
                    <h4 className={`font-semibold text-sm ${
                      isCurrent ? "text-green-300" : isPast ? "text-gray-400" : "text-white"
                    }`}>
                      {program.title}
                    </h4>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[11px] ${isPast ? "text-gray-600" : "text-gray-500"}`}>
                        {calcDuration(program.startTime, program.endTime)}
                      </span>
                      {program.channel && (
                        <>
                          <span className="text-gray-700">·</span>
                          <span className={`text-[11px] ${isPast ? "text-gray-600" : "text-gray-500"}`}>
                            {program.channel.name}
                          </span>
                        </>
                      )}
                    </div>
                    {program.description && (
                      <p className={`text-xs mt-1.5 leading-relaxed line-clamp-2 ${isPast ? "text-gray-600" : "text-gray-400"}`}>
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

function calcDuration(start: string, end: string): string {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff < 0) diff += 24 * 60;
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function formatTime12h(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function getCurrentTimeStr(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}
