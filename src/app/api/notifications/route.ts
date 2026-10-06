import { NextRequest, NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";
import { getAdminSession, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const MAX_PER_DAY = 20; // anti-spam guard (spec §12 "do not spam users")

/**
 * GET /api/notifications?scope=mine|admin —
 *   mine  (any authenticated user): active announcements targeted at them +
 *         read state. Server derives the user; userId is never client-supplied.
 *   admin (admin/owner): management list incl. read counts.
 */
export async function GET(request: NextRequest) {
  const scope = request.nextUrl.searchParams.get("scope") ?? "mine";
  await ensureDatabase();

  if (scope === "admin") {
    const admin = await getAdminSession();
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    try {
      const rows = await withRetry(() =>
        prisma.notification.findMany({
          orderBy: { createdAt: "desc" },
          take: 100,
          include: { reads: { select: { id: true } } },
        })
      );
      return NextResponse.json({
        rows: rows.map((n) => ({
          id: n.id,
          title: n.title,
          message: n.message,
          targetAll: n.targetAll,
          targetRole: n.targetRole,
          feature: n.feature,
          createdBy: n.createdByName ?? n.createdBy,
          createdAt: n.createdAt,
          expiresAt: n.expiresAt,
          active: n.active,
          readCount: n.reads.length,
        })),
      });
    } catch (e) {
      console.error("[NOTIF] admin list failed:", e instanceof Error ? e.message : e);
      return NextResponse.json({ error: "Failed to load notifications" }, { status: 500 });
    }
  }

  // scope=mine — targeted at the verified user only.
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const now = new Date();
    const rows = await withRetry(() =>
      prisma.notification.findMany({
        where: {
          active: true,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        orderBy: { createdAt: "desc" },
        take: 30,
        include: { reads: { where: { userId: session.userId }, select: { readAt: true } } },
      })
    );
    // Targeting filter in JS (targeted lists are small, stored as id arrays).
    const mine = rows.filter((n) => {
      if (n.targetAll) return true;
      if (n.targetRole && n.targetRole === session.role) return true;
      if (n.userIds) {
        try {
          const ids = JSON.parse(n.userIds) as string[];
          return Array.isArray(ids) && ids.includes(session.userId);
        } catch {
          return false;
        }
      }
      return false;
    });
    return NextResponse.json({
      rows: mine.map((n) => ({
        id: n.id,
        title: n.title,
        message: n.message,
        feature: n.feature,
        createdAt: n.createdAt,
        expiresAt: n.expiresAt,
        readAt: n.reads[0]?.readAt ?? null,
      })),
    });
  } catch (e) {
    console.error("[NOTIF] list failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Failed to load notifications" }, { status: 500 });
  }
}

/** POST /api/notifications — ADMIN: create an announcement (audited, rate-limited). */
export async function POST(request: NextRequest) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as {
    title?: string;
    message?: string;
    targetAll?: boolean;
    targetRole?: string | null;
    userIds?: string[] | null;
    feature?: string | null;
    expiresAt?: string | null;
  } | null;

  const title = body?.title?.trim();
  const message = body?.message?.trim();
  if (!title || !message) return NextResponse.json({ error: "Title and message are required" }, { status: 400 });
  if (title.length > 150 || message.length > 2000) return NextResponse.json({ error: "Title or message too long" }, { status: 400 });

  try {
    // Rate limit: max 20 announcements per rolling day (anti-spam).
    const dayAgo = new Date(Date.now() - 86_400_000);
    const recent = await withRetry(() => prisma.notification.count({ where: { createdAt: { gte: dayAgo } } }));
    if (recent >= MAX_PER_DAY) {
      return NextResponse.json({ error: "Daily announcement limit reached (anti-spam)" }, { status: 429 });
    }

    const created = await withRetry(() =>
      prisma.notification.create({
        data: {
          title,
          message,
          targetAll: body?.targetAll !== false,
          targetRole: body?.targetAll === false && body?.targetRole ? body.targetRole : null,
          userIds: body?.targetAll === false && Array.isArray(body?.userIds) && body.userIds.length > 0 ? JSON.stringify(body.userIds.slice(0, 200)) : null,
          feature: body?.feature?.slice(0, 40) ?? null,
          createdBy: admin.userId,
          createdByName: admin.username,
          expiresAt: body?.expiresAt ? new Date(body.expiresAt) : null,
        },
      })
    );
    await audit({ actor: admin, action: "notification.created", targetType: "notification", targetId: created.id, metadata: { title: created.title, targetAll: created.targetAll } });
    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch (e) {
    console.error("[NOTIF] create failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Failed to create notification" }, { status: 500 });
  }
}

/** PATCH — actions: mark-read (self) | deactivate (admin). */
export async function PATCH(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { action?: string; id?: string } | null;

  if (body?.action === "mark-read") {
    const session = await getSession();
    if (!session || !body.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
      await withRetry(() =>
        prisma.notificationRead.upsert({
          where: { notificationId_userId: { notificationId: body.id!, userId: session.userId } },
          update: {},
          create: { notificationId: body.id!, userId: session.userId },
        })
      );
      return NextResponse.json({ ok: true });
    } catch {
      return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
  }

  const admin = await getAdminSession();
  if (!admin || !body?.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    await withRetry(() => prisma.notification.update({ where: { id: body.id }, data: { active: false } }));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Notification not found" }, { status: 404 });
  }
}
