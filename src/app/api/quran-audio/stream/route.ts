import { NextRequest, NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/prisma";
import { getValidDriveToken } from "@/lib/google-drive";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET — Stream audio file from Google Drive for visitors
// GET /api/quran-audio/stream?id=<quranAudioId>
// Supports Range requests for HTML5 audio seeking
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return new NextResponse(JSON.stringify({ error: "Missing id parameter" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Look up the audio entry
    const entry = await withRetry(() =>
      prisma.quranAudio.findUnique({ where: { id } })
    );

    if (!entry || !entry.googleDriveId) {
      return new NextResponse(JSON.stringify({ error: "Audio not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get valid Google Drive token (with refresh if expired)
    const token = await getValidDriveToken();
    if (!token) {
      console.error("[QURAN-STREAM] No valid Google Drive token available");
      return new NextResponse(JSON.stringify({ error: "Google Drive not connected" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get the Range header for partial content support
    const rangeHeader = request.headers.get("range");

    // Build Google Drive URL
    const driveUrl = `https://www.googleapis.com/drive/v3/files/${entry.googleDriveId}?alt=media`;

    // Build fetch headers for Google Drive
    const driveHeaders: Record<string, string> = {
      Authorization: `Bearer ${token.accessToken}`,
    };

    // Forward Range header if present (for seeking support)
    if (rangeHeader) {
      driveHeaders["Range"] = rangeHeader;
    }

    const driveResponse = await fetch(driveUrl, {
      headers: driveHeaders,
    });

    if (!driveResponse.ok) {
      const errorText = await driveResponse.text().catch(() => "unknown");
      // 403 with "insufficientPermissions"/"The user is not authorized" typically means the
      // stored OAuth token lacks the drive.readonly scope (reconnect required).
      // 404 means the file was moved/deleted from Drive.
      console.error(
        `[QURAN-STREAM] Google Drive error: ${driveResponse.status} for file ${entry.googleDriveId}:`,
        errorText.substring(0, 300)
      );

      // Return a proper audio-compatible error (not JSON, so audio element doesn't crash)
      return new NextResponse(null, {
        status: driveResponse.status === 404 ? 404 : 502,
        headers: {
          "Content-Type": "text/plain",
          "X-Error":
            driveResponse.status === 403
              ? "drive-scope-reconnect-required"
              : "Audio not available from storage",
        },
      });
    }

    // Build response headers
    const contentType = driveResponse.headers.get("Content-Type") || detectMimeType(entry.fileName);
    const contentLength = driveResponse.headers.get("Content-Length");
    const isPartial = driveResponse.status === 206;

    const responseHeaders: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
      "Access-Control-Allow-Origin": "*",
      "Accept-Ranges": "bytes",
    };

    if (contentLength) {
      responseHeaders["Content-Length"] = contentLength;
    }

    // Forward Content-Range for partial responses
    if (isPartial) {
      const contentRange = driveResponse.headers.get("Content-Range");
      if (contentRange) {
        responseHeaders["Content-Range"] = contentRange;
      }
    }

    // Stream the response body
    if (driveResponse.body) {
      return new NextResponse(driveResponse.body, {
        status: isPartial ? 206 : 200,
        headers: responseHeaders,
      });
    }

    // Fallback: buffer the response
    const buffer = await driveResponse.arrayBuffer();
    return new NextResponse(Buffer.from(buffer), {
      status: isPartial ? 206 : 200,
      headers: responseHeaders,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[QURAN-STREAM] Error:", msg);
    return new NextResponse(null, {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
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

/**
 * Detect MIME type from filename extension
 */
function detectMimeType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "mp3":
      return "audio/mpeg";
    case "m4a":
    case "mp4":
      return "audio/mp4";
    case "ogg":
      return "audio/ogg";
    case "wav":
      return "audio/wav";
    case "webm":
      return "audio/webm";
    case "flac":
      return "audio/flac";
    case "aac":
      return "audio/aac";
    default:
      return "audio/mpeg";
  }
}
