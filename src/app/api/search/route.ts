import { NextRequest, NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/prisma";
import { ensureDatabase, isDatabaseDown } from "@/lib/db-init";
import { getSession, isAdminRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/search?q=… — Global Search (spec §16).
 * Searches channels, programs, live replay, Quran and announcements.
 * Permission rule: content that requires an admin (nothing here is
 * admin-secret) is public-listing data, but unpublished replays and
 * inactive channels are hidden from non-admins, and user-targeted
 * announcements are only returned to their intended audience.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return NextResponse.json({ results: [] });

  const admin = isAdminRole(session.role);
  if (isDatabaseDown()) return NextResponse.json({ results: [] }, { status: 503 });

  await ensureDatabase();
  const like = { contains: q, mode: "insensitive" as const };

  try {
    const [channels, programs, replays, quran] = await Promise.all([
      withRetry(() =>
        prisma.channel.findMany({
          where: { OR: [{ name: like }, { description: like }], ...(admin ? {} : { active: true }) },
          select: { id: true, name: true, category: true, active: true },
          take: 6,
        })
      ),
      withRetry(() =>
        prisma.program.findMany({
          where: { OR: [{ title: like }, { description: like }] },
          select: { id: true, title: true, date: true, startTime: true, channelId: true, channel: { select: { name: true } } },
          orderBy: [{ date: "desc" }],
          take: 6,
        })
      ),
      withRetry(() =>
        prisma.replay.findMany({
          where: { OR: [{ title: like }, { description: like }], ...(admin ? {} : { published: true }) },
          select: { id: true, title: true, date: true, published: true },
          take: 6,
        })
      ),
      withRetry(() =>
        prisma.quranAudio.findMany({
          where: { OR: [{ surahName: like }, { reciterName: like }] },
          select: { id: true, surahName: true, surahNumber: true, ayahNumber: true, reciterName: true },
          take: 6,
        })
      ),
    ]);

    // Announcements: only ones targeted at THIS user (or global).
    const notifications = await withRetry(() =>
      prisma.notification.findMany({
        where: {
          active: true,
          OR: [{ title: like }, { message: like }],
        },
        select: { id: true, title: true, targetAll: true, targetRole: true, userIds: true },
        take: 20,
      })
    );
    const myNotifs = notifications
      .filter((n) => n.targetAll || n.targetRole === session.role || (n.userIds ? (JSON.parse(n.userIds) as string[]).includes(session.userId) : false))
      .slice(0, 4);

    const results = [
      ...channels.map((c) => ({ type: "channel", id: c.id, title: c.name, subtitle: c.category, href: `/channels/${c.id}` })),
      ...programs.map((p) => ({ type: "program", id: p.id, title: p.title, subtitle: `${p.channel.name} · ${p.date} ${p.startTime}`, href: `/schedule` })),
      ...replays.map((r) => ({ type: "replay", id: r.id, title: r.title, subtitle: r.date, href: `/replay/${r.id}` })),
      ...quran.map((s) => ({ type: "quran", id: s.id, title: `${s.surahName} ${s.surahNumber}:${s.ayahNumber}`, subtitle: s.reciterName, href: `/#quran` })),
      ...myNotifs.map((n) => ({ type: "announcement", id: n.id, title: n.title, subtitle: "Announcement", href: "/" })),
    ];

    return NextResponse.json({ results, query: q });
  } catch (e) {
    console.error("[SEARCH] failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
