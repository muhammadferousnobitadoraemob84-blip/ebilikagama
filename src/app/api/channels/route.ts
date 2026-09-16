import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma, withRetry } from "@/lib/prisma";
import { getAdminSession } from "@/lib/auth";
import { notifyChannelChange } from "@/lib/channel-events";
import { ensureDatabase, isDatabaseDown } from "@/lib/db-init";
import { getThumbnailMeta, dataThumbUrl } from "@/lib/thumb-meta";
import { isDbUnavailableError, serviceUnavailable } from "@/lib/api-errors";

export const dynamic = "force-dynamic";

// GET all channels (public — only active)
export async function GET(request: NextRequest) {
  try {
    if (isDatabaseDown()) return serviceUnavailable({ error: "Gagal memuatkan saluran" });
    await ensureDatabase();
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category");
    const all = searchParams.get("all");
    const raw = searchParams.get("raw"); // admin can request full base64

    const where: Record<string, unknown> = {};
    if (all !== "true") {
      where.active = true;
    }
    if (category) {
      where.category = category;
    }

    // Select everything EXCEPT the base64 thumbnail column. Transferring the
    // blobs from the database on every list request consumed the Neon free
    // tier's monthly transfer quota (5.5 GB), which took the whole site's
    // database layer down. Thumbnails are classified with a cheap projection
    // instead (see lib/thumb-meta.ts) and served via /api/images/... .
    const channels = await withRetry(() =>
      prisma.channel.findMany({
        where,
        orderBy: { displayOrder: "asc" },
        select: {
          id: true,
          name: true,
          category: true,
          twitchUsername: true,
          description: true,
          liveStatus: true,
          displayOrder: true,
          active: true,
          createdAt: true,
          updatedAt: true,
        },
      })
    );
    const meta = await getThumbnailMeta(
      "Channel",
      all === "true" ? Prisma.sql`true` : Prisma.sql`"active" = true`
    );

    // For public API: replace base64 thumbnails with lightweight URLs
    if (raw !== "true") {
      const optimized = channels.map((ch) => {
        const m = meta.get(ch.id);
        return {
          ...ch,
          thumbnail:
            m?.kind === "data"
              ? dataThumbUrl("channel", ch.id, ch.updatedAt)
              : m?.kind === "url"
                ? m.url
                : null,
        };
      });
      return NextResponse.json(optimized);
    }

    // Admin API (raw=true): metadata only — the base64 blob is no longer
    // transferred over the wire. Editors that need bytes fetch the single
    // record or the /api/images/... URL.
    const optimized = channels.map((ch) => {
      const m = meta.get(ch.id);
      return {
        ...ch,
        hasStoredThumbnail: m?.kind === "data",
        thumbnail:
          m?.kind === "data"
            ? dataThumbUrl("channel", ch.id, ch.updatedAt)
            : m?.kind === "url"
              ? m.url
              : null,
      };
    });
    return NextResponse.json(optimized);
  } catch (error) {
    if (isDbUnavailableError(error)) {
      return serviceUnavailable({ error: "Gagal memuatkan saluran" });
    }
    return NextResponse.json(
      { error: "Gagal memuatkan saluran" },
      { status: 500 }
    );
  }
}

// POST create new channel (admin only)
export async function POST(request: NextRequest) {
  try {
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ error: "Tidak dibenarkan" }, { status: 403 });
    }

    const body = await request.json();
    const { name, category, twitchUsername, thumbnail, description, displayOrder, active, liveStatus } = body;

    if (!name || !category || !twitchUsername) {
      return NextResponse.json(
        { error: "Nama, kategori, dan username Twitch diperlukan" },
        { status: 400 }
      );
    }

    const channel = await prisma.channel.create({
      data: {
        name,
        category,
        twitchUsername,
        thumbnail: thumbnail || null,
        description: description || null,
        displayOrder: displayOrder ?? 0,
        active: active !== undefined ? active : true,
        liveStatus: liveStatus || "automatic",
      },
    });

    notifyChannelChange();
    return NextResponse.json(channel, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Gagal mencipta saluran" },
      { status: 500 }
    );
  }
}

// PUT update all channels (for reordering)
export async function PUT(request: NextRequest) {
  try {
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ error: "Tidak dibenarkan" }, { status: 403 });
    }

    const body = await request.json();
    const { channels } = body;

    if (!Array.isArray(channels)) {
      return NextResponse.json(
        { error: "Data tidak sah" },
        { status: 400 }
      );
    }

    const updates = channels.map((ch: { id: string; displayOrder: number }) =>
      prisma.channel.update({
        where: { id: ch.id },
        data: { displayOrder: ch.displayOrder },
      })
    );

    await Promise.all(updates);

    notifyChannelChange();
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Gagal mengemas kini susunan" },
      { status: 500 }
    );
  }
}
