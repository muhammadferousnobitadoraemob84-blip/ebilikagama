"use client";

/**
 * Connection Recovery (spec §18).
 *
 * - `useConnectionStatus` exposes online/offline via browser events (no
 *   polling storms) with a gentle "reconnecting" grace period.
 * - `fetchWithRetry` retries idempotent GETs with exponential backoff +
 *   jitter, capped; POSTs are never auto-retried (safe-by-default).
 */

import { useEffect, useState } from "react";

export type ConnectionStatus = "online" | "reconnecting" | "offline";

export function useConnectionStatus(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>(
    typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "online"
  );

  useEffect(() => {
    let timer: number | null = null;
    const goOnline = () => {
      if (timer) window.clearTimeout(timer);
      // Brief reconnecting state so the UI can flash "restored" honestly.
      setStatus("reconnecting");
      timer = window.setTimeout(() => setStatus("online"), 1500);
    };
    const goOffline = () => {
      if (timer) window.clearTimeout(timer);
      setStatus("offline");
    };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    // Reconcile with the real state once listeners are attached: the
    // `online` event can fire between first render (which captured a
    // transient offline state) and effect attach, leaving the banner
    // stuck on "offline" forever. Heal by consulting navigator.onLine.
    if (navigator.onLine) {
      setStatus((s) => (s === "online" ? s : "reconnecting"));
      timer = window.setTimeout(() => setStatus("online"), 1500);
    }
    // Backstop: some embedded webviews change navigator.onLine WITHOUT
    // firing online/offline events. Re-check periodically so the banner
    // can never get stuck; in normal browsers this is a no-op pass.
    const reconcile = () => {
      if (!navigator.onLine) return;
      setStatus((s) => (s === "online" ? s : "reconnecting"));
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setStatus("online"), 1500);
    };
    const poll = window.setInterval(reconcile, 8000);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.clearInterval(poll);
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  return status;
}

const RETRYABLE_STATUS = new Set([502, 503, 504]);

/** Retry a GET with exponential backoff + jitter. Never retries 4xx. */
export async function fetchWithRetry(
  input: string,
  init?: RequestInit,
  opts?: { retries?: number; baseMs?: number }
): Promise<Response> {
  const retries = opts?.retries ?? 3;
  const base = opts?.baseMs ?? 800;
  const method = (init?.method ?? "GET").toUpperCase();

  let lastRes: Response | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(input, { ...init, cache: init?.cache ?? "no-store" });
      if (res.ok || !RETRYABLE_STATUS.has(res.status) || method !== "GET" || attempt === retries) {
        return res;
      }
      lastRes = res;
    } catch (err) {
      if (method !== "GET" || attempt === retries) throw err;
      lastRes = null;
    }
    const wait = base * Math.pow(2, attempt) + Math.random() * 400;
    await new Promise((r) => setTimeout(r, wait));
  }
  return lastRes as Response;
}
