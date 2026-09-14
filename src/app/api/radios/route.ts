import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession, getAdminSession } from "@/lib/auth";
import { getThumbnailMeta, dataThumbUrl } from "@/lib/thumb-meta";
import { isDbUnavailableError, serviceUnavailable } from "@/lib/api-errors";

export const dynamic = "force-dynamic";

// GET - List radios (public sees only enabled, admin sees all)
export async function GET(request: NextRequest) {
  try {
    const session = await getAdminSession();
    const isAdmin = !!session;

    // Select everything EXCEPT the base64 thumbnail column (transferring
    // blobs from the DB on every request exhausts the transfer quota).
    const radios = await prisma.radio.findMany({
      where: isAdmin ? {} : { enabled: true },
      orderBy: { displayOrder: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        twitchUsername: true,
        category: true,
        enabled: true,
        displayOrder: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const meta = await getThumbnailMeta(
      "Radio",
      isAdmin ? Prisma.sql`true` : Prisma.sql`"enabled" = true`
    );

    // Public sees only enabled radios; thumbnails served via /api/images/...
    const optimized = radios.map((radio) => {
      const m = meta.get(radio.id);
      return {
        ...radio,
        thumbnail:
          m?.kind === "data"
            ? dataThumbUrl("radio", radio.id, radio.updatedAt)
            : m?.kind === "url"
              ? m.url
              : null,
      };
    });

    return NextResponse.json(optimized);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[RADIOS] GET error:", msg);
    if (isDbUnavailableError(error)) {
      return serviceUnavailable({ error: "Gagal memuatkan radio" });
    }
    return NextResponse.json(
      { error: "Gagal memuatkan radio" },
      { status: 500 }
    );
  }
}

// POST - Create radio (admin only)
export async function POST(request: NextRequest) {
  try {
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ error: "Tidak dibenarkan" }, { status: 403 });
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
