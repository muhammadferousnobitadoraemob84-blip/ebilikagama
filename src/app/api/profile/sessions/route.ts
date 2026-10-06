import { NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/profile/sessions — MY PROFILE (spec §13/§14).
 * Returns ONLY the verified user's own visitor sessions with a coarse,
 * privacy-safe device label derived from the stored user-agent
 * (browser + OS family — no full UA strings, no IPs, no tokens).
 */

function deviceLabel(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) && /Version\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return [os, browser].filter(Boolean).join(" ");
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureDatabase();

  try {
    const rows = await withRetry(() =>
      prisma.visitorSession.findMany({
        where: { userId: session.userId },
        orderBy: { lastActivityAt: "desc" },
        take: 15,
        select: { id: true, loginAt: true, lastActivityAt: true, logoutAt: true, status: true, userAgent: true },
      })
    );
    const now = Date.now();
    return NextResponse.json({
      sessions: rows.map((s) => ({
        id: s.id,
        device: deviceLabel(s.userAgent),
        loginAt: s.loginAt,
        lastActivityAt: s.lastActivityAt,
        logoutAt: s.logoutAt,
        // "Active now" = session row still active AND activity within 15 min.
        activeNow: s.status === "active" && now - s.lastActivityAt.getTime() < 15 * 60_000,
      })),
    });
  } catch (e) {
    console.error("[PROFILE-SESSIONS] failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Failed to load sessions" }, { status: 500 });
  }
}
