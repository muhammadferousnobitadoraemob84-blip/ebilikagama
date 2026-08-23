import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";

export const dynamic = "force-dynamic";

// Serve base64 images from the database with proper caching
// This prevents megabytes of base64 data from being included in every API response
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params;
    const [type, id] = path;

    if (!type || !id) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    await ensureDatabase();

    let base64Data: string | null = null;

    if (type === "channel") {
      const channel = await prisma.channel.findUnique({
        where: { id },
        select: { thumbnail: true },
      });
      base64Data = channel?.thumbnail || null;
    } else if (type === "setting") {
      const setting = await prisma.setting.findUnique({
        where: { key: id },
        select: { value: true },
      });
      base64Data = setting?.value || null;
    } else if (type === "program") {
      const program = await prisma.program.findUnique({
        where: { id },
        select: { thumbnail: true },
      });
      base64Data = program?.thumbnail || null;
    }

    if (!base64Data) {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }

    // Parse the data URI to get content type and binary data
    const match = base64Data.match(/^data:(image\/[a-z]+);base64,(.+)$/);
    if (!match) {
      return NextResponse.json({ error: "Invalid image data" }, { status: 500 });
    }

    const [, contentType, base64] = match;
    const buffer = Buffer.from(base64, "base64");

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to load image" },
      { status: 500 }
    );
  }
}
