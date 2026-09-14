import { NextResponse } from "next/server";

/**
 * Classifies a caught error as "database currently unreachable" (provider
 * outage, transfer quota exhausted, connection refused, cold-start timeout).
 * These are transient service states, not client errors, so public GET
 * endpoints must answer 503 (retryable, never cached) instead of 500.
 */
export function isDbUnavailableError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /data transfer quota|quota exceeded|Can't reach database server|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET|connection (closed|refused|terminated)|timed out|unavailable/i.test(
    msg
  );
}

/** 503 JSON response that no CDN/browser may cache. */
export function serviceUnavailable(payload: unknown) {
  return NextResponse.json(payload, {
    status: 503,
    headers: { "Cache-Control": "no-store" },
  });
}
