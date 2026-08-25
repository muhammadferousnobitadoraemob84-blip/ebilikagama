import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

    let base64Data: string | null = null;

    if (type === "channel") {
      const channel = await prisma.channel.findUnique({
        where: { id },
        select: { thumbnail: true },
      });
      base64Data = channel?.thumbnail || null;
    } else if (type === "radio") {
      const radio = await prisma.radio.findUnique({
        where: { id },
        select: { thumbnail: true },
      });
      base64Data = radio?.thumbnail || null;
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
    // Use indexOf for large strings instead of regex to avoid memory issues
    const dataPrefix = ";base64,";
    const prefixEnd = base64Data.indexOf(dataPrefix);
    if (prefixEnd === -1) {
      return NextResponse.json({ error: "Invalid image data format" }, { status: 500 });
    }
    const contentType = base64Data.substring(5, prefixEnd); // Skip "data:"
    const base64 = base64Data.substring(prefixEnd + dataPrefix.length);
    
    if (!contentType.startsWith("image/")) {
      return NextResponse.json({ error: "Invalid image content type" }, { status: 500 });
    }
    
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
