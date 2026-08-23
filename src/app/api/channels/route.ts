import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { notifyChannelChange } from "@/lib/channel-events";
import { ensureDatabase } from "@/lib/db-init";

export const dynamic = "force-dynamic";

// Helper: convert base64 data URI to an API image URL
function toImageUrl(base64Data: string | null, type: string, id: string): string | null {
  if (!base64Data || !base64Data.startsWith("data:")) return null;
  return `/api/images/${type}/${id}`;
}

// GET all channels (public — only active)
export async function GET(request: NextRequest) {
  try {
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

    const channels = await prisma.channel.findMany({
      where,
      orderBy: { displayOrder: "asc" },
      select: {
        id: true,
        name: true,
        category: true,
        twitchUsername: true,
        thumbnail: true,
        description: true,
        liveStatus: true,
        displayOrder: true,
        active: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // For public API: replace base64 thumbnails with lightweight URLs
    if (raw !== "true") {
      const optimized = channels.map((ch) => ({
        ...ch,
        thumbnail: toImageUrl(ch.thumbnail, "channel", ch.id),
      }));
      return NextResponse.json(optimized);
    }

    // Admin API: return full data including base64
    return NextResponse.json(channels);
  } catch {
    return NextResponse.json(
      { error: "Gagal memuatkan saluran" },
      { status: 500 }
    );
  }
}

// POST create new channel (admin only)
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Tidak dibenarkan" }, { status: 401 });
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
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Tidak dibenarkan" }, { status: 401 });
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
