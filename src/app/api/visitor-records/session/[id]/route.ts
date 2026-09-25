import { NextRequest, NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/prisma";
import { getAdminSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/visitor-records/session/[id] — ADMIN ONLY.
 * Detail view data for one visitor session: user info, session info and the
 * full activity timeline for that session (spec §6).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const session = await withRetry(() =>
      prisma.visitorSession.findUnique({
        where: { id },
        include: {
          user: { select: { id: true, username: true, fullName: true, role: true } },
        },
      })
    );
    if (!session) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const activities = await withRetry(() =>
      prisma.visitorActivity.findMany({
        where: { sessionId: id },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          feature: true,
          action: true,
          page: true,
          metadata: true,
          createdAt: true,
        },
      })
    );

    return NextResponse.json({
      user: session.user,
      session: {
        id: session.id,
        loginAt: session.loginAt,
        lastActivityAt: session.lastActivityAt,
        logoutAt: session.logoutAt, // null → "Session ended / inactive"
        status: session.status,
        userAgent: session.userAgent,
      },
      activities,
    });
  } catch (e) {
    console.error(
      "[VISITOR-API] session detail failed:",
      e instanceof Error ? e.message : e
    );
    return NextResponse.json(
      { error: "Failed to load session detail" },
      { status: 500 }
    );
  }
}
