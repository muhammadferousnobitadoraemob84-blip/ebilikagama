import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ─── Edge Proxy (Next.js 16): Geoblocking + Authentication Gate ──────
//
// Request pipeline:
//   1. Static/exempt paths pass through.
//   2. GEO-BLOCK: Malaysia-only access (Vercel geo header). Exemptions:
//      /admin, /api, /blocked, static assets. No geo data → allow.
//   3. AUTH GATE: unauthenticated visitors are redirected to /sign-in for
//      every page except the public allowlist. Authenticated users pass
//      through; role authorization (admin vs user) is enforced server-side
//      in each API route via getSession() — never in the browser.
// ─────────────────────────────────────────────────────────────────────

// Publicly reachable paths without a session
const PUBLIC_PATHS = [
  "/sign-in",
  "/admin/login",
  "/blocked",
  "/api/users", // role-checked inside the route (admins only)
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
  "/api/auth/admin-profile",
  "/api/auth/account",
  "/api/auth/profile-photo",
  "/api/health",
  "/api/keepalive",
  "/api/cron/keep-alive",
  "/api/images",
  "/api/subscribe",
  "/api/settings",
  "/api/channels",
  "/api/replays",
  "/api/radios",
  "/api/programs",
  "/api/quran-audio/public",
  "/api/quran-audio/stream",
  "/api/setup",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
];

// Geo-block exemptions (checked before the auth gate; admin has its own auth)
const GEO_EXEMPT_PREFIXES = [
  "/admin",
  "/api",
  "/blocked",
  "/sign-in",
  "/_next",
  "/favicon",
  "/images",
];

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // ── Static-ish assets: never blocked ────────────────────────────────
  if (
    path.startsWith("/_next") ||
    /\.(png|jpg|jpeg|svg|ico|webp|txt|xml|json|woff2?|css|js)$/.test(path)
  ) {
    return NextResponse.next();
  }

  // ── 1. GEO-BLOCK (Malaysia only) ────────────────────────────────────
  const isGeoExempt = GEO_EXEMPT_PREFIXES.some(
    (p) => path === p || path.startsWith(p + "/")
  );
  if (!isGeoExempt) {
    const country =
      request.headers.get("x-vercel-ip-country") ||
      request.headers.get("cf-ipcountry") ||
      undefined;

    // No geo data → allow (prevents locking out users on infra failures)
    if (country && country.toUpperCase() !== "MY") {
      const blockedUrl = request.nextUrl.clone();
      blockedUrl.pathname = "/blocked";
      return NextResponse.redirect(blockedUrl);
    }
  }

  // ── 2. AUTH GATE ────────────────────────────────────────────────────
  const isPublic = PUBLIC_PATHS.some(
    (a) => path === a || path.startsWith(a + "/")
  );

  const token = request.cookies.get("admin-token")?.value;
  if (token) {
    // Session present: role authorization happens server-side per route.
    return NextResponse.next();
  }

  if (!isPublic) {
    const loginUrl = new URL("/sign-in", request.url);
    loginUrl.searchParams.set("redirect", path);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all paths except static files and Next.js internals
    "/((?!_next/static|_next/image|favicon\\.ico).*)",
  ],
};
