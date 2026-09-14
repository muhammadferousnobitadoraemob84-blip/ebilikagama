import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";
import { replayThumbUrl } from "@/lib/image-url";

export const dynamic = "force-dynamic";

// GET - List replays
export async function GET(request: NextRequest) {
  try {
    await ensureDatabase();

    const { searchParams } = new URL(request.url);
    const all = searchParams.get("all") === "true";

    let replays;
    if (all) {
      // Admin view - get all replays
      replays = await prisma.replay.findMany({
        orderBy: { date: "desc" },
      });
    } else {
      // Public view - get only published replays
      replays = await prisma.replay.findMany({
        where: { published: true },
        orderBy: { date: "desc" },
      });
    }

    // Rewrite base64 thumbnails to lightweight, epoch-versioned image URLs.
    // The epoch (VERCEL_DEPLOYMENT_ID) changes every deploy, so caches that
    // stored a broken response for a previous URL can never be replayed.
    const optimized = replays.map((r) => ({
      ...r,
      thumbnail:
        r.thumbnail && r.thumbnail.startsWith("data:")
          ? replayThumbUrl(r.id, r.updatedAt)
          : r.thumbnail,
    }));

    return NextResponse.json(optimized);
  } catch (error) {
    console.error("[REPLAYS] Error:", error);
    return NextResponse.json(
      { error: "Gagal memuatkan rakaman" },
      { status: 500 }
    );
  }
}

// POST - Create replay
export async function POST(request: NextRequest) {
  try {
    await ensureDatabase();

    const body = await request.json();
    const { title, description, date, googleDriveId, googleDriveUrl, thumbnail, published } = body;

    if (!title || !googleDriveId) {
      return NextResponse.json(
        { error: "Tajuk dan Google Drive ID diperlukan" },
        { status: 400 }
      );
    }

    const replay = await prisma.replay.create({
      data: {
        title,
        description: description || null,
        date: date || new Date().toISOString().split("T")[0],
        googleDriveId,
        googleDriveUrl: googleDriveUrl || null,
        videoUrl: `https://drive.google.com/file/d/${googleDriveId}/preview`,
        thumbnail: thumbnail || null,
        published: published || false,
      },
    });

    return NextResponse.json(replay, { status: 201 });
  } catch (error) {
    console.error("[REPLAYS] Create error:", error);
    return NextResponse.json(
      { error: "Gagal mencipta rakaman" },
      { status: 500 }
    );
  }
}
