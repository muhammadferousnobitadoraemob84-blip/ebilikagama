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

// 6 equalizer bars with staggered animation configs
const BARS = [
  { delay: "0ms", duration: "0.8s" },
  { delay: "0.15s", duration: "0.65s" },
  { delay: "0.05s", duration: "0.9s" },
  { delay: "0.2s", duration: "0.7s" },
  { delay: "0.1s", duration: "0.85s" },
  { delay: "0.25s", duration: "0.75s" },
];

function EqualizerBars() {
  return (
    <div className="flex items-end gap-[3px] h-[22px]">
      {BARS.map((bar, i) => (
        <div
          key={i}
          className="w-[3px] rounded-full eq-bar"
          style={{
            backgroundColor: [
              "#ffffff",
              "#d4d4d4",
              "#a3a3a3",
              "#d4d4d4",
              "#8a8a8a",
              "#ffffff",
            ][i],
            animationDelay: bar.delay,
            animationDuration: bar.duration,
          }}
        />
      ))}
    </div>
  );
}

export default function PageLoader() {
  const pathname = usePathname();
  const isHomePage = pathname === "/";
  const [visible, setVisible] = useState(isHomePage);
  const [phase, setPhase] = useState<"loading" | "finishing">("loading");
  const startTimeRef = useRef<number>(Date.now());
  const dismissedRef = useRef(false);

  const dismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;

    const elapsed = Date.now() - startTimeRef.current;
    const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);

    setTimeout(() => {
      setPhase("finishing");
      setTimeout(() => {
        setVisible(false);
      }, 400);
    }, remaining);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    startTimeRef.current = Date.now();

    const originalFetch = window.fetch;
    const pendingRequests = new Set<string>();
    const completedRequests = new Set<string>();

    const updateProgress = () => {
      if (dismissedRef.current) return;

      let weightedComplete = 0;
      let weightedTotal = 0;

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
          weightedComplete += resource.weight * 0.3;
        }
      }

      const apiProgress =
        weightedTotal > 0 ? (weightedComplete / weightedTotal) * 100 : 100;

      let domProgress = 0;
      if (document.readyState === "loading") domProgress = 0;
      else if (document.readyState === "interactive") domProgress = 70;
      else domProgress = 100;

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

    const pollInterval = setInterval(() => {
      if (dismissedRef.current) {
        clearInterval(pollInterval);
        return;
      }
      updateProgress();
    }, 200);

    const onReady = () => updateProgress();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", onReady);
    }

    const onLoad = () => {
      updateProgress();
      setTimeout(() => {
        if (!dismissedRef.current) dismiss();
      }, 500);
    };
    window.addEventListener("load", onLoad);

    const timeout = setTimeout(() => {
      if (!dismissedRef.current) dismiss();
    }, GLOBAL_TIMEOUT_MS);

    const handleVisibility = () => {
      if (!document.hidden && !dismissedRef.current) {
        if (document.readyState === "complete") dismiss();
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
    };
  }, [dismiss]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center transition-opacity duration-400"
      style={{
        opacity: phase === "finishing" ? 0 : 1,
        pointerEvents: phase === "finishing" ? "none" : "auto",
      }}
    >
      {/* Full-screen dark overlay */}
      <div className="absolute inset-0 bg-black" />

      {/* Pill-shaped loader container */}
      <div className="relative z-10 flex items-center gap-4 px-7 py-3.5 sm:px-9 sm:py-4 rounded-full bg-[#141414] border border-white/[0.06]">
        <EqualizerBars />
        <span className="text-[#b0b0b0] text-[13px] sm:text-sm font-medium tracking-wide select-none">
          Loading...
        </span>
      </div>
    </div>
  );
}
