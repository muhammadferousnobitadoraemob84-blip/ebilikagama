import { NextRequest, NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";
import { getAdminSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/radio-timeline?range=… — ADMIN: Broadcast Timeline / Black Box (§6).
 * Returns expected-vs-actual events merged with azan intervals for the range,
 * newest first. Purely read-only; immutable in the UI.
 */
export async function GET(request: NextRequest) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const range = request.nextUrl.searchParams.get("range") ?? "today";
  const days = range === "30d" ? 30 : range === "7d" ? 7 : 1;
  const from = new Date(Date.now() - days * 86_400_000);
  if (range === "today") from.setHours(0, 0, 0, 0);

  try {
    await ensureDatabase();
    const [events, azanStats] = await Promise.all([
      withRetry(() =>
        prisma.timelineEvent.findMany({
          where: { actualAt: { gte: from } },
          orderBy: { actualAt: "desc" },
          take: 400,
        })
      ),
      withRetry(() =>
        prisma.timelineEvent.groupBy({
          by: ["kind"],
          _count: { _all: true },
          _avg: { diffSeconds: true },
          where: { actualAt: { gte: from }, kind: { in: ["azan_start", "track_start", "radio_resume"] } },
        })
      ),
    ]);

    // Deviation buckets for the summary strip.
    const matched = events.filter((e) => e.diffSeconds != null && Math.abs(e.diffSeconds) <= 1.5).length;
    const minor = events.filter((e) => e.diffSeconds != null && Math.abs(e.diffSeconds) > 1.5 && Math.abs(e.diffSeconds) <= 30).length;
    const off = events.filter((e) => e.diffSeconds == null || Math.abs(e.diffSeconds) > 30).length;

    return NextResponse.json({
      range,
      events,
      stats: {
        matched,
        minor,
        off,
        avgAzanDiff: azanStats.find((s) => s.kind === "azan_start")?._avg.diffSeconds ?? null,
        avgStartDiff: azanStats.find((s) => s.kind === "track_start")?._avg.diffSeconds ?? null,
        avgResumeDiff: azanStats.find((s) => s.kind === "radio_resume")?._avg.diffSeconds ?? null,
      },
    });
  } catch (e) {
    console.error("[RADIO-TIMELINE] failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Failed to load timeline" }, { status: 500 });
  }
}
