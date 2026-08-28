import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET - List radios (public sees only enabled, admin sees all)
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    const isAdmin = !!session;

    const radios = await prisma.radio.findMany({
      where: isAdmin ? {} : { enabled: true },
      orderBy: { displayOrder: "asc" },
    });

    // For public, strip stream URL to avoid exposure — actually keep it for the player
    // But strip thumbnail base64 to keep response small, serve via API
    const optimized = radios.map((radio) => ({
      ...radio,
      thumbnail:
        radio.thumbnail && radio.thumbnail.startsWith("data:")
          ? `/api/images/radio/${radio.id}`
          : radio.thumbnail,
    }));

    return NextResponse.json(optimized);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[RADIOS] GET error:", msg);
    return NextResponse.json(
      { error: "Gagal memuatkan radio" },
      { status: 500 }
    );
  }
}

// POST - Create radio (admin only)
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Tidak dibenarkan" }, { status: 401 });
    }

    const body = await request.json();
    const { name, description, thumbnail, twitchUsername, category, enabled, displayOrder } = body;

    if (!name) {
      return NextResponse.json(
        { error: "Nama radio diperlukan" },
        { status: 400 }
      );
    }

    const radio = await prisma.radio.create({
      data: {
        name,
        description: description || null,
        thumbnail: thumbnail || null,
        twitchUsername: twitchUsername || null,
        category: category || "general",
        enabled: enabled !== false,
        displayOrder: displayOrder || 0,
      },
    });

    return NextResponse.json(radio, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[RADIOS] POST error:", msg);
    return NextResponse.json(
      { error: "Gagal mencipta radio" },
      { status: 500 }
    );
  }
}
