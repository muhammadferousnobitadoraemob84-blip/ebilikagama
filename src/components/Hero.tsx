"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";

interface Settings {
  hero_title?: string;
  hero_description?: string;
  hero_image?: string;
}

interface HeroProps {
  settings?: Settings;
  translations?: {
    hero_badge: string;
    hero_cta: string;
    hero_title_fallback: string;
    hero_desc_fallback: string;
  };
}

// One greeting animation per login per browser tab. The marker stores the
// userId it was shown for: refreshing the homepage stays silent, but a
// different account signing in on the same tab always gets its own greeting
// (no stale User A name for User B).
const GREETING_SHOWN_KEY = "ebilikagama-greeting-shown";

// IN 0.6s → hold ~0.7s → OUT 0.9s ≈ 2.2s total (within the 1.5–3s target).
const GREETING_OUT_AT_MS = 1300;
const GREETING_DONE_AT_MS = 2300;

interface GreetingProfile {
  userId: string;
  fullName: string;
}

export default function Hero({ settings = {}, translations }: HeroProps) {
  const tr = translations || {
    hero_badge: "Live Broadcast",
    hero_cta: "Start Watching",
    hero_title_fallback: "eBilikAgamaTV",
    hero_desc_fallback: "Islamic media platform developed by the Islamic Affairs Unit of SMJK Chung Hwa Tenom to expand Islamic dakwah among students and parents.",
  };
  const { t } = useLanguage();

  const [greeting, setGreeting] = useState<GreetingProfile | null>(null);
  const [greetingLeaving, setGreetingLeaving] = useState(false);
  const [greetingDone, setGreetingDone] = useState(true);
  // True only when the greeting text wraps taller than the brand title box
  // (long names on narrow screens). The brand box keeps its exact height —
  // instead the badge/description fade out briefly so the extra lines are
  // never clipped or overlapped. Restore is automatic when the greeting ends.
  const [greetingOverflow, setGreetingOverflow] = useState(false);
  const timersRef = useRef<number[]>([]);
  const brandTitleRef = useRef<HTMLHeadingElement>(null);
  const greetingSpanRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Same session-verified endpoint the Header uses — the name comes
        // from the server-side session, never from client-provided data.
        const res = await fetch("/api/auth/admin-profile", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!data?.loggedIn || !data.fullName || cancelled) return;

        const userId = String(data.userId ?? "");
        try {
          if (userId && sessionStorage.getItem(GREETING_SHOWN_KEY) === userId) {
            return; // already greeted for this account in this tab
          }
        } catch {
          // sessionStorage unavailable — fall through and show the greeting
        }

        if (cancelled) return;
        try {
          sessionStorage.setItem(GREETING_SHOWN_KEY, userId);
        } catch {
          // ignore — worst case the greeting replays on refresh
        }

        setGreetingDone(false);
        setGreeting({ userId, fullName: data.fullName });

        // After the greeting paints, check whether it wrapped taller than the
        // brand title (multi-line long names on mobile). If so, fade the
        // neighbouring rows for the duration of the greeting so nothing
        // overlaps. No layout properties change — zero shift.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (cancelled) return;
            const brandH = brandTitleRef.current?.offsetHeight ?? 0;
            const spanH = greetingSpanRef.current?.offsetHeight ?? 0;
            if (spanH > brandH + 4) setGreetingOverflow(true);
          }),
        );

        timersRef.current.push(
          window.setTimeout(() => {
            if (!cancelled) setGreetingLeaving(true);
          }, GREETING_OUT_AT_MS),
          window.setTimeout(() => {
            if (!cancelled) {
              setGreetingDone(true);
              setGreetingOverflow(false); // restore badge/description
            }
          }, GREETING_DONE_AT_MS),
        );
      } catch {
        // Profile check failed (offline / 5xx): skip the greeting silently —
        // the default branding is already in place either way.
      }
    })();

    return () => {
      cancelled = true;
      for (const id of timersRef.current) window.clearTimeout(id);
      timersRef.current = [];
    };
  }, []);

  const greetingActive = !greetingDone && greeting !== null;
  const brandTitle = settings.hero_title || tr.hero_title_fallback;

  return (
    <section className="relative h-[40vh] sm:h-[50vh] md:h-[60vh] min-h-[280px] sm:min-h-[350px] md:min-h-[400px] flex items-center justify-center overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0">
        {settings.hero_image ? (
          <img
            src={settings.hero_image}
            alt=""
            className="w-full h-full object-cover"
            fetchPriority="high"
            decoding="async"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-gray-950 via-gray-900 to-red-950/30" />
        )}
        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/70 to-transparent" />
      </div>

      {/* Animated Background Dots */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-red-500/5 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-red-500/5 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      {/* Content */}
      <div className="relative z-10 text-center max-w-4xl mx-auto px-4 sm:px-6">
        <div
          className={`inline-flex items-center gap-1.5 sm:gap-2 bg-red-600/20 border border-red-500/30 text-red-400 text-xs sm:text-sm font-medium px-3 sm:px-4 py-1.5 sm:py-2 rounded-full mb-4 sm:mb-6 backdrop-blur-sm transition-opacity duration-500 ${
            greetingOverflow ? "opacity-0" : "opacity-100"
          }`}
        >
          <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-red-500 rounded-full animate-pulse" />
          {tr.hero_badge}
        </div>

        {/* Title box. The brand <h1> keeps its exact place in the layout; a
            greeting overlay is absolutely stacked over the identical box and
            the brand text is merely faded out while the greeting shows, so
            nothing shifts, scrolls, or overflows. */}
        <div className="relative mb-3 sm:mb-6">
          <h1
            ref={brandTitleRef}
            aria-hidden={greetingActive}
            className={`text-2xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold text-white tracking-tight leading-tight transition-opacity duration-500 ${
              greetingActive ? "opacity-0" : "opacity-100"
            }`}
          >
            {brandTitle}
          </h1>

          {greetingActive && greeting && (
            <h1
              aria-live="polite"
              className={`absolute inset-0 flex items-center justify-center text-center text-2xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold text-white tracking-tight leading-tight ${
                greetingLeaving ? "animate-greeting-out" : "animate-greeting-in"
              }`}
            >
              <span ref={greetingSpanRef}>
                {t("greeting_assalamualaikum")}, {greeting.fullName}.
              </span>
            </h1>
          )}
        </div>

        <p
          className={`text-sm sm:text-lg md:text-xl text-gray-300 max-w-2xl mx-auto mb-5 sm:mb-8 leading-relaxed transition-opacity duration-500 ${
            greetingOverflow ? "opacity-0" : "opacity-100"
          }`}
        >
          {settings.hero_description || tr.hero_desc_fallback}
        </p>

        <a
          href="#saluran-tv"
          className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white font-semibold text-sm sm:text-base px-6 sm:px-8 py-3 sm:py-3.5 rounded-xl transition-all duration-300 hover:shadow-lg hover:shadow-red-600/25 transform hover:-translate-y-0.5"
        >
          <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
          {tr.hero_cta}
        </a>
      </div>
    </section>
  );
}
