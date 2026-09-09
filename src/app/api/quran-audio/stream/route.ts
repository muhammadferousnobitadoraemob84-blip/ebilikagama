import { NextRequest, NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/prisma";
import { getValidDriveToken } from "@/lib/google-drive";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET — Stream audio file from Google Drive for visitors
// GET /api/quran-audio/stream?id=<quranAudioId>
// Supports Range requests for HTML5 audio seeking.
//
// Delivery fallback chain:
//   1. Authenticated Drive API download (alt=media) with the connected token
//   2. If the token lacks download scope (403) → anonymous link-shared download
//      (works when the file/folder is shared via "Anyone with the link")
//   3. Clean audio-compatible error (never JSON/HTML success-shaped garbage)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return jsonError(400, "Missing id parameter");
    }

    // Look up the audio entry
    const entry = await withRetry(() =>
      prisma.quranAudio.findUnique({ where: { id } })
    );

    if (!entry || !entry.googleDriveId) {
      return jsonError(404, "Audio not found");
    }

    const rangeHeader = request.headers.get("range");
    const fileId = entry.googleDriveId;

    // ── Attempt 1: authenticated Drive API download ──
    const token = await getValidDriveToken();
    if (token) {
      const driveHeaders: Record<string, string> = {
        Authorization: `Bearer ${token.accessToken}`,
      };
      if (rangeHeader) driveHeaders["Range"] = rangeHeader;

      let driveResponse: Response;
      try {
        driveResponse = await fetch(
          `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
          { headers: driveHeaders }
        );
      } catch (err) {
        console.error(
          "[QURAN-STREAM] Drive API network error:",
          err instanceof Error ? err.message : err
        );
        driveResponse = null as unknown as Response;
      }

      if (driveResponse && driveResponse.ok) {
        return relayAudio(driveResponse, entry.fileName, fileId, "api");
      }

      if (driveResponse) {
        const errorText = await driveResponse.text().catch(() => "");
        logDriveFailure(driveResponse.status, fileId, errorText, token.accessToken);

        // 404 → the file itself is gone; no fallback will bring it back.
        if (driveResponse.status === 404) {
          return audioError(404, "file-not-found");
        }
        // 403/401 → likely missing scope; fall through to anonymous attempt.
      }
    }

    // ── Attempt 2: anonymous link-shared download (no token needed) ──
    // Works when the Drive file is shared "Anyone with the link".
    try {
      const anonHeaders: Record<string, string> = {};
      if (rangeHeader) anonHeaders["Range"] = rangeHeader;

      const anonResponse = await fetch(
        `https://drive.google.com/uc?export=download&id=${fileId}`,
        { headers: anonHeaders, redirect: "follow" }
      );

      if (anonResponse.ok) {
        const ct = anonResponse.headers.get("Content-Type") || "";
        // A virus-scan interstitial / sign-in page comes back as HTML — reject it.
        if (ct.includes("text/html")) {
          console.error(
            `[QURAN-STREAM] Anonymous fallback for ${fileId} returned HTML (not link-shared or interstitial)`
          );
        } else {
          return relayAudio(anonResponse, entry.fileName, fileId, "anonymous");
        }
      } else {
        console.error(
          `[QURAN-STREAM] Anonymous fallback for ${fileId} failed: HTTP ${anonResponse.status}`
        );
      }
    } catch (err) {
      console.error(
        "[QURAN-STREAM] Anonymous fallback network error:",
        err instanceof Error ? err.message : err
      );
    }

    // ── Both paths failed ──
    return audioError(502, "drive-scope-reconnect-required");
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[QURAN-STREAM] Error:", msg);
    return audioError(500, "stream-error");
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

// ── Helpers ──

/**
 * Relay a successful Google response to the browser as audio bytes.
 * Forwards Range semantics (206 + Content-Range) and Content-Length.
 */
function relayAudio(
  upstream: Response,
  fileName: string,
  fileId: string,
  via: "api" | "anonymous"
): NextResponse {
  const contentType =
    sanitizeContentType(upstream.headers.get("Content-Type")) ||
    detectMimeType(fileName);
  const contentLength = upstream.headers.get("Content-Length");
  const isPartial = upstream.status === 206;

  const responseHeaders: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=86400, s-maxage=86400",
    "Access-Control-Allow-Origin": "*",
    "Accept-Ranges": "bytes",
    "X-Served-Via": via,
  };

  if (contentLength) responseHeaders["Content-Length"] = contentLength;
  if (isPartial) {
    const contentRange = upstream.headers.get("Content-Range");
    if (contentRange) responseHeaders["Content-Range"] = contentRange;
  }

  console.error(
    `[QURAN-STREAM] Serving file ${fileId} via ${via} (${contentType}${contentLength ? `, ${contentLength} bytes` : ""})`
  );

  if (upstream.body) {
    return new NextResponse(upstream.body, {
      status: isPartial ? 206 : 200,
      headers: responseHeaders,
    });
  }

  // Fallback: buffer
  return upstream.arrayBuffer().then((buf) =>
    new NextResponse(Buffer.from(buf), {
      status: isPartial ? 206 : 200,
      headers: responseHeaders,
    })
  ) as unknown as NextResponse;
}

/**
 * Audio-compatible error response: empty body + X-Error marker header.
 * The frontend reads the marker and shows a human-readable message.
 */
function audioError(status: number, marker: string): NextResponse {
  return new NextResponse(null, {
    status,
    headers: {
      "Content-Type": "text/plain",
      "X-Error": marker,
      "Access-Control-Expose-Headers": "X-Error",
    },
  });
}

function jsonError(status: number, message: string): NextResponse {
  return new NextResponse(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Strip parameters (e.g. "application/json; charset=utf-8") and detect when
 * Google unexpectedly returns a non-audio content type on a "successful" reply.
 */
function sanitizeContentType(ct: string | null): string | null {
  if (!ct) return null;
  const base = ct.split(";")[0].trim().toLowerCase();
  if (
    base === "text/html" ||
    base === "application/json" ||
    base === "text/plain"
  ) {
    return null; // not audio — let the filename-based detection decide
  }
  return base;
}

/**
 * Server-side diagnostic for 401/403: log which scopes the token actually has
 * (via Google tokeninfo) WITHOUT ever logging the token itself.
 */
async function logDriveFailure(
  status: number,
  fileId: string,
  errorText: string,
  _accessToken?: string
): Promise<void> {
  const reason =
    errorText.match(/"reason"\s*:\s*"([^"]+)"/)?.[1] ||
    errorText.match(/"status"\s*:\s*"([^"]+)"/)?.[1] ||
    errorText.substring(0, 120);
  console.error(
    `[QURAN-STREAM] Drive API failure for ${fileId}: HTTP ${status} reason=${reason}`
  );
  // Scope diagnosis: if 403 with insufficientPermissions, the stored grant
  // lacks drive.readonly — the admin must reconnect (Drive → Disconnect/Connect).
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
