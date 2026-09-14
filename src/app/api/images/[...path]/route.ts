import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Small retry wrapper — Neon free tier can cold-start (2–5s) on first hit. */
async function dbRetry<T>(fn: () => Promise<T>, attempts = 2, delayMs = 800): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}

/** Load the stored base64 data URI for an image type + id. */
async function loadBase64Image(type: string, id: string): Promise<string | null> {
  if (type === "channel") {
    const row = await dbRetry(() =>
      prisma.channel.findUnique({ where: { id }, select: { thumbnail: true } })
    );
    return row?.thumbnail || null;
  }
  if (type === "radio") {
    const row = await dbRetry(() =>
      prisma.radio.findUnique({ where: { id }, select: { thumbnail: true } })
    );
    return row?.thumbnail || null;
  }
  if (type === "setting") {
    const row = await dbRetry(() =>
      prisma.setting.findUnique({ where: { key: id }, select: { value: true } })
    );
    return row?.value || null;
  }
  if (type === "program") {
    const row = await dbRetry(() =>
      prisma.program.findUnique({ where: { id }, select: { thumbnail: true } })
    );
    return row?.thumbnail || null;
  }
  if (type === "replay") {
    // Live Replay thumbnails are stored as base64 data URIs and served
    // through this endpoint (list APIs rewrite them to /api/images/replay/{id}).
    const row = await dbRetry(() =>
      prisma.replay.findUnique({ where: { id }, select: { thumbnail: true } })
    );
    return row?.thumbnail || null;
  }
  return null;
}

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
    try {
      base64Data = await loadBase64Image(type, id);
    } catch (dbError) {
      // DB unreachable (e.g. cold start). Must be no-store so the CDN and
      // browser never cache this transient failure.
      console.error("[IMAGES] DB error:", dbError instanceof Error ? dbError.message : dbError);
      return NextResponse.json(
        { error: "Image temporarily unavailable" },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (!base64Data) {
      // Genuinely missing reference — cacheable negative response.
      return NextResponse.json(
        { error: "Image not found" },
        { status: 404, headers: { "Cache-Control": "public, max-age=60" } }
      );
    }

    // Parse the data URI to get content type and binary data
    // Use indexOf for large strings instead of regex to avoid memory issues
    const dataPrefix = ";base64,";
    const prefixEnd = base64Data.indexOf(dataPrefix);
    if (prefixEnd === -1) {
      return NextResponse.json(
        { error: "Invalid image data format" },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }
    const contentType = base64Data.substring(5, prefixEnd); // Skip "data:"
    const base64 = base64Data.substring(prefixEnd + dataPrefix.length);

    if (!contentType.startsWith("image/")) {
      return NextResponse.json(
        { error: "Invalid image content type" },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
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
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
