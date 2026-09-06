import { NextRequest, NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/prisma";
import { getValidDriveToken } from "@/lib/google-drive";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET — Stream audio file from Google Drive for visitors
// GET /api/quran-audio/stream?id=<quranAudioId>
// Proxies the file without exposing Google Drive credentials
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Missing id parameter" }, { status: 400 });
    }

    // Look up the audio entry
    const entry = await withRetry(() =>
      prisma.quranAudio.findUnique({ where: { id } })
    );

    if (!entry || !entry.googleDriveId) {
      return NextResponse.json({ error: "Audio not found" }, { status: 404 });
    }

    // Get valid Google Drive token
    const token = await getValidDriveToken();
    if (!token) {
      return NextResponse.json({ error: "Google Drive not connected" }, { status: 503 });
    }

    // Fetch the file from Google Drive using the content download URL
    const driveUrl = `https://www.googleapis.com/drive/v3/files/${entry.googleDriveId}?alt=media`;

    const driveResponse = await fetch(driveUrl, {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
      },
    });

    if (!driveResponse.ok) {
      console.error(`[QURAN-STREAM] Google Drive error: ${driveResponse.status}`);
      return NextResponse.json({ error: "Failed to fetch audio from storage" }, { status: 502 });
    }

    // Stream the response to the client
    const contentType = driveResponse.headers.get("Content-Type") || "audio/mpeg";
    const contentLength = driveResponse.headers.get("Content-Length");

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
      "Access-Control-Allow-Origin": "*",
    };
    if (contentLength) {
      headers["Content-Length"] = contentLength;
    }

    // Stream the response body
    if (driveResponse.body) {
      return new NextResponse(driveResponse.body, {
        status: 200,
        headers,
      });
    }

    // Fallback: buffer the response
    const buffer = await driveResponse.arrayBuffer();
    return new NextResponse(Buffer.from(buffer), {
      status: 200,
      headers,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[QURAN-STREAM] Error:", msg);
    return NextResponse.json({ error: "Failed to stream audio" }, { status: 500 });
  }
}

// Handle CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Range",
      "Access-Control-Max-Age": "86400",
    },
  });
}
