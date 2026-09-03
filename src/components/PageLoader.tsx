"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";

// Critical resources to track — weighted by importance
const CRITICAL_RESOURCES = [
  { pattern: "/api/settings", weight: 20 },
  { pattern: "/api/channels", weight: 25 },
  { pattern: "/api/channels/status", weight: 10 },
  { pattern: "/api/images/", weight: 15 },
  { pattern: "static", weight: 10 },
] as const;

// Fallback timeout — if progress stalls, allow page through after this
const GLOBAL_TIMEOUT_MS = 12000;

// Minimum display time so the animation is visible
const MIN_DISPLAY_MS = 400;

export default function PageLoader() {
  const pathname = usePathname();
  // Only show loader on homepage for first load
  const isHomePage = pathname === "/";
  const [visible, setVisible] = useState(isHomePage);
  const [percent, setPercent] = useState(0);
  const [phase, setPhase] = useState<"starting" | "loading" | "finishing">("starting");
  const startTimeRef = useRef<number>(Date.now());
  const dismissedRef = useRef(false);

  const dismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;

    // Ensure minimum display time
    const elapsed = Date.now() - startTimeRef.current;
    const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);

    setTimeout(() => {
      setPhase("finishing");
      // Fade out
      setTimeout(() => {
        setVisible(false);
      }, 300);
    }, remaining);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    startTimeRef.current = Date.now();
    setPhase("loading");

    // ── Method 1: Track PerformanceObserver resource entries ──
    const resourceTimings: PerformanceResourceTiming[] = [];
    let observer: PerformanceObserver | null = null;

    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name.includes(window.location.origin) || entry.name.startsWith("/")) {
            resourceTimings.push(entry as PerformanceResourceTiming);
          }
        }
      });
      observer.observe({ type: "resource", buffered: true });
    } catch {
      // PerformanceObserver not fully supported
    }

    // ── Method 2: Track fetch/XHR requests ──
    const originalFetch = window.fetch;
    const pendingRequests = new Set<string>();
    const completedRequests = new Set<string>();

    // Count initial critical resources
    const updateProgress = () => {
      if (dismissedRef.current) return;

      let weightedComplete = 0;
      let weightedTotal = 0;

      // Score based on known critical API calls
      for (const resource of CRITICAL_RESOURCES) {
        weightedTotal += resource.weight;
        const found = [...completedRequests].some((url) =>
          url.includes(resource.pattern)
        );
        const pending = [...pendingRequests].some((url) =>
          url.includes(resource.pattern)
        );

        if (found) {
          weightedComplete += resource.weight;
        } else if (!pending) {
          // Not started and not pending — might have completed before tracking started
          // Give partial credit if DOM is partially loaded
          weightedComplete += resource.weight * 0.3;
        }
      }

      // Factor in image loading progress
      const images = document.querySelectorAll("img");
      let imagesLoaded = 0;
      images.forEach((img) => {
        if (img.complete && img.naturalWidth > 0) imagesLoaded++;
      });
      const imageProgress = images.length > 0 ? (imagesLoaded / images.length) : 1;

      // Factor in document readyState
      let domProgress = 0;
      if (document.readyState === "loading") domProgress = 0;
      else if (document.readyState === "interactive") domProgress = 70;
      else domProgress = 100;

      // Weighted combination
      const apiProgress = weightedTotal > 0 ? (weightedComplete / weightedTotal) * 100 : 100;
      const rawPercent = apiProgress * 0.5 + imageProgress * 0.25 + domProgress * 0.25;

      setPercent(Math.min(Math.round(rawPercent), 99));

      // Auto-dismiss when DOM ready AND critical resources loaded
      if (domProgress >= 100 && apiProgress >= 80) {
        dismiss();
      }
    };

    window.fetch = function (...args: Parameters<typeof originalFetch>) {
      let url = "";
      if (typeof args[0] === "string") {
        url = args[0];
      } else if (args[0] instanceof Request) {
        url = args[0].url;
      } else if (args[0] instanceof URL) {
        url = args[0].href;
      }
      pendingRequests.add(url);

      return originalFetch.apply(this, args).then(
        (response) => {
          completedRequests.add(url);
          pendingRequests.delete(url);
          updateProgress();
          return response;
        },
        (error) => {
          completedRequests.add(url);
          pendingRequests.delete(url);
          updateProgress();
          throw error;
        }
      );
    };

    // ── Poll progress during loading ──
    const pollInterval = setInterval(() => {
      if (dismissedRef.current) {
        clearInterval(pollInterval);
        return;
      }
      updateProgress();
    }, 150);

    // ── Handle DOM ready ──
    const onReady = () => {
      updateProgress();
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", onReady);
    }

    // ── Handle window load ──
    const onLoad = () => {
      updateProgress();
      // Force dismiss shortly after window load
      setTimeout(() => {
        if (!dismissedRef.current) {
          setPercent(100);
          dismiss();
        }
      }, 500);
    };
    window.addEventListener("load", onLoad);

    // ── Global timeout safety ──
    const timeout = setTimeout(() => {
      if (!dismissedRef.current) {
        setPercent(100);
        dismiss();
      }
    }, GLOBAL_TIMEOUT_MS);

    // ── Handle visibility change (returning visitors with cache) ──
    const handleVisibility = () => {
      if (!document.hidden && !dismissedRef.current) {
        // Page became visible — check if content is already loaded
        if (document.readyState === "complete") {
          setPercent(100);
          dismiss();
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(pollInterval);
      clearTimeout(timeout);
      window.fetch = originalFetch;
      document.removeEventListener("DOMContentLoaded", onReady);
      window.removeEventListener("load", onLoad);
      document.removeEventListener("visibilitychange", handleVisibility);
      observer?.disconnect();
    };
  }, [dismiss]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center transition-opacity duration-300"
      style={{
        opacity: phase === "finishing" ? 0 : 1,
        pointerEvents: phase === "finishing" ? "none" : "auto",
      }}
    >
      {/* Background with blur */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-xl" />

      {/* Glassmorphic card */}
      <div className="relative z-10 flex flex-col items-center gap-5 px-10 py-10 sm:px-14 sm:py-12 rounded-3xl border border-white/10 bg-white/5 backdrop-blur-2xl shadow-2xl shadow-black/40 max-w-xs sm:max-w-sm w-[85vw]">
        {/* Animated ring */}
        <div className="relative w-16 h-16 sm:w-20 sm:h-20">
          {/* Outer glow ring */}
          <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80">
            <circle
              cx="40"
              cy="40"
              r="36"
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="4"
            />
            <circle
              cx="40"
              cy="40"
              r="36"
              fill="none"
              stroke="url(#loader-gradient)"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 36}`}
              strokeDashoffset={`${2 * Math.PI * 36 * (1 - percent / 100)}`}
              className="transition-all duration-300 ease-out"
            />
            <defs>
              <linearGradient id="loader-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ef4444" />
                <stop offset="100%" stopColor="#dc2626" />
              </linearGradient>
            </defs>
          </svg>
          {/* Center percentage */}
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-white text-base sm:text-lg font-bold tabular-nums">
              {percent}%
            </span>
          </div>
        </div>

        {/* Loading text */}
        <div className="text-center">
          <p className="text-white/90 text-sm sm:text-base font-semibold tracking-wide">
            Loading...
          </p>
        </div>

        {/* Subtle progress bar */}
        <div className="w-full h-1 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-red-500 to-red-600 transition-all duration-300 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    </div>
  );
}
