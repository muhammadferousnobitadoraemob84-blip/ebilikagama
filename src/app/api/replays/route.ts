import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";
import { verifyToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET - List published replays (public) or all replays (admin)
export async function GET(request: NextRequest) {
  try {
    await ensureDatabase();

    const { searchParams } = new URL(request.url);
    const all = searchParams.get("all") === "true";

    // Check if admin is authenticated
    let isAdmin = false;
    const token = request.cookies.get("admin-token")?.value;
    if (token) {
      try {
        await verifyToken(token);
        isAdmin = true;
      } catch {
        // Not authenticated
      }
    }

    // Public users only see published replays, admins see all
    const where = all && isAdmin ? {} : { published: true };

    const replays = await prisma.replay.findMany({
      where,
      orderBy: { date: "desc" },
      select: {
        id: true,
        title: true,
        description: true,
        thumbnail: true,
        duration: true,
        fileSize: true,
        date: true,
        published: true,
        createdAt: true,
      },
    });

    return NextResponse.json(replays);
  } catch (error) {
    console.error("[REPLAYS] GET error:", error);
    return NextResponse.json([], { status: 500 });
  }
}

// POST - Create replay (admin only)
export async function POST(request: NextRequest) {
  try {
    await ensureDatabase();

    // Verify admin authentication
    const token = request.cookies.get("admin-token")?.value;
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      await verifyToken(token);
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { title, description, videoUrl, thumbnail, duration, fileSize, date, published } = body;

    if (!title || !videoUrl || !date) {
      return NextResponse.json(
        { error: "Title, video URL, and date are required" },
        { status: 400 }
      );
    }

    const replay = await prisma.replay.create({
      data: {
        title,
        description: description || null,
        videoUrl,
        thumbnail: thumbnail || null,
        duration: duration || null,
        fileSize: fileSize ? BigInt(fileSize) : null,
        date,
        published: published ?? false,
      },
    });

    return NextResponse.json(replay);
  } catch (error) {
    console.error("[REPLAYS] POST error:", error);
    return NextResponse.json(
      { error: "Failed to create replay" },
      { status: 500 }
    );
  }
}
