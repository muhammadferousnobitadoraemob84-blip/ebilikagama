import { NextRequest, NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";
import { getAdminSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/analytics?range=today|7d|30d|90d|custom&from=&to= — ADMIN.
 * Aggregated statistics from REAL Visitor Records + RadioPlayback data.
 * No per-user rankings — aggregates only (spec §8).
 */
export async function GET(request: NextRequest) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sp = request.nextUrl.searchParams;
  const range = sp.get("range") ?? "7d";
  let from: Date;
  let to = new Date();
  if (range === "custom" && sp.get("from") && sp.get("to")) {
    from = new Date(`${sp.get("from")}T00:00:00`);
    to = new Date(`${sp.get("to")}T23:59:59.999`);
  } else {
    const days = range === "today" ? 1 : range === "30d" ? 30 : range === "90d" ? 90 : 7;
    from = new Date(Date.now() - days * 86_400_000);
    if (range === "today") from.setHours(0, 0, 0, 0);
  }

  const actWhere = { createdAt: { gte: from, lte: to } };
  const playWhere = { startedAt: { gte: from, lte: to } };

  try {
    await ensureDatabase();

    // Batch 1 — visitor aggregates (Promise.all tuple inference caps at 10).
    const [totalSessions, uniqueUsers, activeUsers, featureUsage, dailyRows] = await Promise.all([
      withRetry(() => prisma.visitorSession.count({ where: { loginAt: { gte: from, lte: to } } })),
      withRetry(() => prisma.visitorSession.groupBy({ by: ["userId"], _count: { _all: true }, where: { loginAt: { gte: from, lte: to } } })),
      withRetry(() => prisma.visitorSession.count({ where: { status: "active", lastActivityAt: { gte: new Date(Date.now() - 30 * 60_000) } } })),
      withRetry(() =>
        prisma.visitorActivity.groupBy({ by: ["feature", "action"], _count: { _all: true }, where: actWhere, orderBy: { _count: { feature: "desc" } } })
      ),
      withRetry(() =>
        prisma.$queryRaw<{ d: Date; count: bigint }[]>`
          SELECT date_trunc('day', "createdAt") AS d, COUNT(*) AS count
          FROM "VisitorActivity"
          WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
          GROUP BY d ORDER BY d ASC
        `
      ),
    ]);

    // Batch 2 — playback + per-feature counts.
    const [radioPlays, radioSessions, radioAirtime, azanCount, tvViews, replayViews, quranPlays, scheduleViews] =
      await Promise.all([
        withRetry(() => prisma.radioPlayback.count({ where: { ...playWhere, status: { in: ["completed", "interrupted", "azan_interrupted"] } } })),
        withRetry(() => prisma.visitorActivity.count({ where: { ...actWhere, feature: "radio", action: "radio_play" } })),
        withRetry(() => prisma.radioPlayback.aggregate({ _sum: { durationPlayed: true }, where: playWhere })),
        withRetry(() => prisma.visitorActivity.count({ where: { ...actWhere, action: "radio_azan_played" } })),
        withRetry(() => prisma.visitorActivity.count({ where: { ...actWhere, feature: "tv" } })),
        withRetry(() => prisma.visitorActivity.count({ where: { ...actWhere, feature: "replay" } })),
        withRetry(() => prisma.visitorActivity.count({ where: { ...actWhere, feature: "quran" } })),
        withRetry(() => prisma.visitorActivity.count({ where: { ...actWhere, feature: "schedule" } })),
      ]);

    // Batch 3 — average session duration + peak hours.
    const [avgSessionSeconds, peakHours] = await Promise.all([
      withRetry(async () => {
        // Average session duration: per-session (lastActivity − login).
        const rows = await prisma.visitorSession.findMany({
          where: { loginAt: { gte: from, lte: to } },
          select: { loginAt: true, lastActivityAt: true, logoutAt: true },
        });
        if (rows.length === 0) return 0;
        const total = rows.reduce((s, r) => s + Math.max(0, (r.logoutAt ?? r.lastActivityAt).getTime() - r.loginAt.getTime()), 0);
        return Math.round(total / rows.length / 1000);
      }),
      withRetry(() =>
        prisma.$queryRaw<{ hour: number; count: bigint }[]>`
          SELECT EXTRACT(HOUR FROM "createdAt") AS hour, COUNT(*) AS count
          FROM "VisitorActivity"
          WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
          GROUP BY hour ORDER BY count DESC LIMIT 6
        `
      ),
    ]);

    const daily = dailyRows.map((r) => ({ date: new Date(r.d).toISOString().slice(0, 10), count: Number(r.count) }));

    return NextResponse.json({
      range,
      from: from.toISOString(),
      to: to.toISOString(),
      totals: {
        sessions: totalSessions,
        uniqueUsers: uniqueUsers.length,
        activeUsers,
        radioPlays,
        radioSessions,
        radioAirtimeSeconds: Math.round(radioAirtime._sum.durationPlayed ?? 0),
        azanHeard: azanCount,
        tvViews,
        replayViews,
        quranPlays,
        scheduleViews,
        avgSessionSeconds,
      },
      featureUsage: featureUsage.map((f) => ({ feature: f.feature, action: f.action, count: f._count._all })),
      daily,
      peakHours: peakHours.map((p) => ({ hour: Number(p.hour), count: Number(p.count) })),
    });
  } catch (e) {
    console.error("[ANALYTICS] failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Failed to load analytics" }, { status: 500 });
  }
}
