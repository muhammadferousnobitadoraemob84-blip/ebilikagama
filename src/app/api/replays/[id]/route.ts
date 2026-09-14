import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";

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
      return NextResponse.json(
        { error: "Rakaman tidak ditemui" },
        { status: 404 }
      );
    }

    return NextResponse.json(replay);
  } catch (error) {
    console.error("[REPLAY] Error:", error);
    return NextResponse.json(
      { error: "Gagal memuatkan rakaman" },
      { status: 500 }
    );
  }
}

// PUT - Update replay
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureDatabase();
    const { id } = await params;

    const body = await request.json();
    const { title, description, date, googleDriveId, googleDriveUrl, thumbnail, published } = body;

    // Guard against data loss: the admin form prefills the thumbnail field
    // with the API's rewritten URL (/api/images/replay/{id}?v=...). Saving
    // without re-uploading used to overwrite the stored base64 image with
    // that URL string, corrupting the record. A same-record images URL is
    // never real thumbnail data — ignore it (undefined = don't touch).
    const isSelfReferenceUrl =
      typeof thumbnail === "string" &&
      thumbnail.startsWith(`/api/images/replay/${id}`);
    const thumbnailUpdate = isSelfReferenceUrl ? undefined : thumbnail;

    const replay = await prisma.replay.findUnique({
      where: { id },
    });

    if (!replay) {
      return NextResponse.json(
        { error: "Rakaman tidak ditemui" },
        { status: 404 }
      );
    }

    const updated = await prisma.replay.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(date !== undefined && { date }),
        ...(googleDriveId !== undefined && { 
          googleDriveId,
          videoUrl: `https://drive.google.com/file/d/${googleDriveId}/preview`,
        }),
        ...(googleDriveUrl !== undefined && { googleDriveUrl }),
        ...(thumbnailUpdate !== undefined && { thumbnail: thumbnailUpdate }),
        ...(published !== undefined && { published }),
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[REPLAY] Update error:", error);
    return NextResponse.json(
      { error: "Gagal mengemas kini rakaman" },
      { status: 500 }
    );
  }
}

// DELETE - Delete replay
export async function DELETE(
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
      return NextResponse.json(
        { error: "Rakaman tidak ditemui" },
        { status: 404 }
      );
    }

    // Delete from database (do NOT delete from Google Drive)
    await prisma.replay.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[REPLAY] Delete error:", error);
    return NextResponse.json(
      { error: "Gagal memadam rakaman" },
      { status: 500 }
    );
  }
}
