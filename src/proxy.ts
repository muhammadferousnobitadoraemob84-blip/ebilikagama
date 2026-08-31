import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ─── Geoblocking Proxy (Next.js 16) ──────────────────────────────────
// Malaysia-only access: users with IP geolocated to MY are allowed.
// Everyone else is redirected to /blocked.
//
// Vercel automatically adds x-vercel-ip-country header from edge geo.
//
// Fallback: if geo data is unavailable, we ALLOW access to prevent
// accidentally blocking Malaysian users during API/infra failures.
//
// Exemptions:
//   /admin       — Admin Panel must remain accessible
//   /api         — API routes (admin auth-protected, no public content)
//   /blocked     — The blocked page itself (prevent redirect loop)
//   /_next       — Next.js static assets
//   /favicon     — Favicon
//   /images      — Public image assets
// ───────────────────────────────────────────────────────────────────────

const ALLOWED_PREFIXES = [
  "/admin",
  "/api",
  "/blocked",
  "/_next",
  "/favicon",
  "/images",
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow exempted paths through without any geo check
  for (const prefix of ALLOWED_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      return NextResponse.next();
    }
  }

  // ── Detect country from Vercel-provided header ──────────────────────
  // Vercel edge adds x-vercel-ip-country on every request.
  // No external API or API key needed.
  const country =
    request.headers.get("x-vercel-ip-country") ||
    request.headers.get("cf-ipcountry") ||
    undefined;

  // ── Fallback: if no geo data, ALLOW access ──────────────────────────
  // Prevents accidentally blocking Malaysian users during
  // temporary geo-service failures or non-Vercel environments.
  if (!country) {
    return NextResponse.next();
  }

  // ── Check if allowed (MY = Malaysia) ────────────────────────────────
  if (country.toUpperCase() === "MY") {
    return NextResponse.next();
  }

  // ── Block: redirect to /blocked ─────────────────────────────────────
  const blockedUrl = request.nextUrl.clone();
  blockedUrl.pathname = "/blocked";
  return NextResponse.redirect(blockedUrl);
}

export const config = {
  matcher: [
    // Match all paths except static files and Next.js internals
    "/((?!_next/static|_next/image|favicon\\.ico).*)",
  ],
};
