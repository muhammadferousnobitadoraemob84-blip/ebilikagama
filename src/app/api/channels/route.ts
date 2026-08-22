import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { notifyChannelChange } from "@/lib/channel-events";

export const dynamic = "force-dynamic";

// GET all channels (public — only active)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category");
    const all = searchParams.get("all");

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
    });

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
