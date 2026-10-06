import { NextRequest, NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * User Favorites (spec §15) — channels / radio / replay / quran.
 * Identity is ALWAYS the verified session user; clients cannot favorite on
 * behalf of anyone else. Reads resolve display titles server-side so the
 * "My Favorites" view can render without N+1 lookups.
 */

const ITEM_TYPES = ["channel", "radio", "replay", "quran"] as const;

interface Resolved {
  id: string;
  itemType: string;
  itemId: string;
  title: string | null;
  href: string | null;
}

async function resolveItems(userId: string): Promise<Resolved[]> {
  const favs = await withRetry(() =>
    prisma.userFavorite.findMany({ where: { userId }, orderBy: { createdAt: "desc" } })
  );
  const byType: Record<string, string[]> = {};
  for (const f of favs) (byType[f.itemType] ??= []).push(f.itemId);

  const titles = new Map<string, string>();
  const typeHrefs: Record<string, string> = {
    channel: "/channels/",
    radio: "/radio",
    replay: "/replay/",
    quran: "/",
  };

  if (byType.channel?.length) {
    const rows = await withRetry(() =>
      prisma.channel.findMany({ where: { id: { in: byType.channel } }, select: { id: true, name: true } })
    );
    for (const r of rows) titles.set(`channel:${r.id}`, r.name);
  }
  if (byType.replay?.length) {
    const rows = await withRetry(() =>
      prisma.replay.findMany({ where: { id: { in: byType.replay } }, select: { id: true, title: true } })
    );
    for (const r of rows) titles.set(`replay:${r.id}`, r.title);
  }
  if (byType.quran?.length) {
    const rows = await withRetry(() =>
      prisma.quranAudio.findMany({ where: { id: { in: byType.quran } }, select: { id: true, surahName: true, surahNumber: true, ayahNumber: true } })
    );
    for (const r of rows) titles.set(`quran:${r.id}`, `${r.surahName} (${r.surahNumber}:${r.ayahNumber})`);
  }
  if (byType.radio?.length) {
    const rows = await withRetry(() =>
      prisma.radio.findMany({ where: { id: { in: byType.radio } }, select: { id: true, name: true } })
    );
    for (const r of rows) titles.set(`radio:${r.id}`, r.name);
  }

  return favs.map((f) => ({
    id: f.id,
    itemType: f.itemType,
    itemId: f.itemId,
    title: titles.get(`${f.itemType}:${f.itemId}`) ?? f.title,
    href: f.itemType === "radio" ? "/radio" : `${typeHrefs[f.itemType] ?? "/"}${f.itemId}`,
  }));
}

/** GET /api/favorites — the caller's favorites (resolved titles). */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureDatabase();
  try {
    const items = await resolveItems(session.userId);
    return NextResponse.json({ items });
  } catch (e) {
    console.error("[FAVORITES] list failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Failed to load favorites" }, { status: 500 });
  }
}

/** POST /api/favorites — toggle. Body: { itemType, itemId, title? } */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureDatabase();

  const body = (await request.json().catch(() => null)) as {
    itemType?: string;
    itemId?: string;
    title?: string;
  } | null;

  const itemType = body?.itemType ?? "";
  const itemId = body?.itemId?.trim();
  if (!(ITEM_TYPES as readonly string[]).includes(itemType) || !itemId || itemId.length > 120) {
    return NextResponse.json({ error: "Invalid item" }, { status: 400 });
  }

  try {
    const existing = await withRetry(() =>
      prisma.userFavorite.findUnique({
        where: { userId_itemType_itemId: { userId: session.userId, itemType, itemId } },
      })
    );
    if (existing) {
      await withRetry(() => prisma.userFavorite.delete({ where: { id: existing.id } }));
      return NextResponse.json({ ok: true, favorited: false });
    }
    await withRetry(() =>
      prisma.userFavorite.create({
        data: {
          userId: session.userId,
          itemType,
          itemId,
          title: typeof body?.title === "string" ? body.title.slice(0, 200) : null,
        },
      })
    );
    return NextResponse.json({ ok: true, favorited: true });
  } catch (e) {
    console.error("[FAVORITES] toggle failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Failed to update favorite" }, { status: 500 });
  }
}
