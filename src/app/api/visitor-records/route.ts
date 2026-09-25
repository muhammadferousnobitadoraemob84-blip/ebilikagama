import { NextRequest, NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";
import { getAdminSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/visitor-records — ADMIN ONLY.
 * Server-side filters + search + pagination over VisitorActivity, plus the
 * summary dashboard numbers and most-recently-active users. Never exposed to
 * normal users (403), never leaks credentials of any kind.
 */
export async function GET(request: NextRequest) {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await ensureDatabase();

  const sp = request.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(10, Number(sp.get("pageSize") ?? "50") || 50));
  const from = sp.get("from"); // YYYY-MM-DD (inclusive)
  const to = sp.get("to"); // YYYY-MM-DD (inclusive)
  const userId = sp.get("userId") ?? "";
  const role = sp.get("role") ?? "";
  const feature = sp.get("feature") ?? "";
  const action = sp.get("action") ?? "";
  const sessionId = sp.get("sessionId") ?? "";
  const search = (sp.get("search") ?? "").trim();
  const sort = sp.get("sort") === "oldest" ? "oldest" : "newest";

  // ── Build the where clause ────────────────────────────────────────────────
  const activityWhere: Record<string, unknown> = {};
  if (from || to) {
    activityWhere.createdAt = {
      ...(from ? { gte: new Date(`${from}T00:00:00`) } : {}),
      ...(to ? { lte: new Date(`${to}T23:59:59.999`) } : {}),
    };
  }
  if (feature) activityWhere.feature = feature;
  if (action) activityWhere.action = action;
  if (sessionId) activityWhere.sessionId = sessionId;

  const userWhere: Record<string, unknown> = {};
  if (userId) userWhere.id = userId;
  if (role) userWhere.role = role;
  if (Object.keys(userWhere).length > 0) activityWhere.user = userWhere;
  if (search) {
    // Free-text across user fields AND record fields — all inside ONE OR so
    // any single hit matches (spec §8).
    activityWhere.OR = [
      { user: { id: { contains: search, mode: "insensitive" } } },
      { user: { fullName: { contains: search, mode: "insensitive" } } },
      { user: { username: { contains: search, mode: "insensitive" } } },
      { sessionId: { contains: search, mode: "insensitive" } },
      { feature: { contains: search, mode: "insensitive" } },
      { action: { contains: search, mode: "insensitive" } },
    ];
  }

  try {
    const [total, rows, users] = await Promise.all([
      withRetry(() => prisma.visitorActivity.count({ where: activityWhere })),
      withRetry(() =>
        prisma.visitorActivity.findMany({
          where: activityWhere,
          include: {
            user: { select: { id: true, username: true, fullName: true, role: true } },
          },
          orderBy: { createdAt: sort === "newest" ? "desc" : "asc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        })
      ),
      // User filter dropdown options (small, admin-only)
      withRetry(() =>
        prisma.user.findMany({
          select: { id: true, username: true, fullName: true, role: true },
          orderBy: { username: "asc" },
        })
      ),
    ]);

    // ── Summary dashboard (spec §10) — from actual records ─────────────────
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);

    const [totalVisits, activeSessions, uniqueUsers, todayActivities, recentSessions] =
      await Promise.all([
        withRetry(() => prisma.visitorSession.count()),
        withRetry(() =>
          prisma.visitorSession.count({
            where: {
              status: "active",
              lastActivityAt: { gte: new Date(now.getTime() - 30 * 60_000) },
            },
          })
        ),
        withRetry(() =>
          prisma.visitorSession.groupBy({ by: ["userId"], _count: { _all: true } })
        ),
        withRetry(() =>
          prisma.visitorActivity.count({ where: { createdAt: { gte: dayStart } } })
        ),
        withRetry(() =>
          prisma.visitorSession.findMany({
            orderBy: { lastActivityAt: "desc" },
            take: 8,
            include: {
              user: { select: { username: true, fullName: true, role: true } },
            },
          })
        ),
      ]);

    // Last feature per recent session (one grouped query)
    const recentIds = recentSessions.map((s) => s.id);
    const lastActivities =
      recentIds.length > 0
        ? await withRetry(() =>
            prisma.visitorActivity.findMany({
              where: { sessionId: { in: recentIds } },
              orderBy: { createdAt: "desc" },
              select: { sessionId: true, feature: true, action: true },
            })
          )
        : [];
    const lastBySession = new Map<string, { feature: string; action: string }>();
    for (const a of lastActivities) {
      if (!lastBySession.has(a.sessionId)) {
        lastBySession.set(a.sessionId, { feature: a.feature, action: a.action });
      }
    }

    const thirtyMinAgo = now.getTime() - 30 * 60_000;
    const recentUsers = recentSessions.map((s) => ({
      sessionId: s.id,
      userId: s.userId,
      fullName: s.user.fullName,
      username: s.user.username,
      role: s.user.role,
      lastActivityAt: s.lastActivityAt,
      lastFeature: lastBySession.get(s.id)?.feature ?? null,
      lastAction: lastBySession.get(s.id)?.action ?? null,
      sessionStatus:
        s.status === "active" && s.lastActivityAt.getTime() >= thirtyMinAgo
          ? "active"
          : "inactive",
    }));

    return NextResponse.json({
      rows: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        userId: r.user.id,
        fullName: r.user.fullName,
        username: r.user.username,
        role: r.user.role,
        feature: r.feature,
        action: r.action,
        page: r.page,
        sessionId: r.sessionId,
        metadata: r.metadata,
      })),
      total,
      page,
      pageSize,
      users,
      summary: {
        totalVisits,
        activeSessions,
        uniqueUsers: uniqueUsers.length,
        todayActivities,
      },
      recentUsers,
    });
  } catch (e) {
    console.error(
      "[VISITOR-API] list failed:",
      e instanceof Error ? e.message : e
    );
    return NextResponse.json(
      { error: "Failed to load visitor records" },
      { status: 500 }
    );
  }
}
