"use client";

import { useEffect, useRef } from "react";

/**
 * Client-side Visitor Records tracking helper.
 *
 * - Fire-and-forget: NEVER blocks or breaks the user's feature.
 * - Sends only { feature, action, page, tiny metadata } — no form contents,
 *   no credentials, no keystrokes.
 * - The server derives the user from the verified session; `vsid` is only a
 *   hint for session continuity and is re-validated server-side.
 */

const VSID_KEY = "ebilikagama-vsid";

/** Store the visitor-session id returned by the login response. */
export function setVisitorSessionId(id: string | null | undefined): void {
  try {
    if (id) sessionStorage.setItem(VSID_KEY, id);
    else sessionStorage.removeItem(VSID_KEY);
  } catch {
    // Private mode etc. — tracking still works without the hint.
  }
}

export function getVisitorSessionId(): string | null {
  try {
    return sessionStorage.getItem(VSID_KEY);
  } catch {
    return null;
  }
}

export function clearVisitorSessionId(): void {
  try {
    sessionStorage.removeItem(VSID_KEY);
  } catch {
    // ignore
  }
}

export interface TrackOptions {
  page?: string;
  metadata?: Record<string, string>;
}

/** Log ONE meaningful feature action. Anonymous users are ignored server-side. */
export function trackActivity(
  feature: string,
  action: string,
  opts?: TrackOptions
): void {
  if (typeof window === "undefined") return;
  try {
    const body = JSON.stringify({
      feature,
      action,
      page: opts?.page ?? window.location.pathname,
      metadata: opts?.metadata,
      vsid: getVisitorSessionId(),
    });
    void fetch("/api/visitor-records/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      // Never surface tracking failures.
    });    } catch {
    // ignore
  }
}


/**
 * Track a page/section open once per mount (strict-mode safe).
 * e.g. useOpenTracking("radio") → radio_opened at /radio
 */
export function useOpenTracking(feature: string, page?: string): void {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    trackActivity(feature, "page_opened", { page });
  }, [feature, page]);
}
