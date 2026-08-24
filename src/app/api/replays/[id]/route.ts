import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";
import { verifyToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET - Get single replay
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureDatabase();
    const { id } = await params;

    const replay = await prisma.replay.findUnique({
      where: { id },
    });

    if (!replay) {
      return NextResponse.json({ error: "Replay not found" }, { status: 404 });
    }

    return NextResponse.json(replay);
  } catch (error) {
    console.error("[REPLAY] GET error:", error);
    return NextResponse.json({ error: "Failed to fetch replay" }, { status: 500 });
  }
}

// PUT - Update replay (admin only)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureDatabase();
    const { id } = await params;

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

    const replay = await prisma.replay.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(videoUrl !== undefined && { videoUrl }),
        ...(thumbnail !== undefined && { thumbnail }),
        ...(duration !== undefined && { duration }),
        ...(fileSize !== undefined && { fileSize: fileSize ? BigInt(fileSize) : null }),
        ...(date !== undefined && { date }),
        ...(published !== undefined && { published }),
      },
    });

    return NextResponse.json(replay);
  } catch (error) {
    console.error("[REPLAY] PUT error:", error);
    return NextResponse.json(
      { error: "Failed to update replay" },
      { status: 500 }
    );
  }
}

// DELETE - Delete replay (admin only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureDatabase();
    const { id } = await params;

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

    // Get replay first to potentially delete from storage
    const replay = await prisma.replay.findUnique({
      where: { id },
    });

    if (!replay) {
      return NextResponse.json({ error: "Replay not found" }, { status: 404 });
    }

    // Delete from database
    await prisma.replay.delete({
      where: { id },
    });

    // TODO: If using external storage, delete the video file here
    // For now, we just delete the database record

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[REPLAY] DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to delete replay" },
      { status: 500 }
    );
  }
}
