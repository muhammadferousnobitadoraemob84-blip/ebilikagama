import { NextRequest, NextResponse } from "next/server";
import { getVirtualRadioState } from "@/lib/virtual-radio-store";
import { getAzanState } from "@/lib/azan-store";
import { getValidDriveToken } from "@/lib/google-drive";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // long-lived audio streams

// GET /api/virtual-radio/stream?id=<driveFileId>
//
// Range-capable proxy for playlist tracks AND azan audio. The driveId is
// validated against the configured playlist + the azan library — this
// endpoint can NEVER fetch arbitrary Drive files. Credentials stay
// server-side; the browser only ever sees this URL.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return jsonError(400, "Missing id parameter");

    // Validate: the file MUST be in the current playlist OR the azan library.
    const state = await getVirtualRadioState();
    let track = state.tracks.find((t) => t.driveId === id);
    if (!track) {
      const azan = await getAzanState();
      const azanFile = azan.files.find((f) => f.driveId === id && !f.unavailable);
      if (azanFile) {
        track = {
          driveId: azanFile.driveId,
          fileName: azanFile.fileName,
          duration: azanFile.duration,
          size: azanFile.size,
          mimeType: azanFile.mimeType,
        };
      }
    }
    if (!track) {
      return audioError(404, "not-in-playlist");
    }

    const rangeHeader = request.headers.get("range");

    // ── Attempt 1: authenticated Drive API download ──
    const token = await getValidDriveToken();
    if (token) {
      const headers: Record<string, string> = { Authorization: `Bearer ${token.accessToken}` };
      if (rangeHeader) headers.Range = rangeHeader;

      let driveRes: Response | null = null;
      try {
        driveRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`,
          { headers }
        );
      } catch (err) {
        console.error(
          "[VR-STREAM] Drive network error:",
          err instanceof Error ? err.message : err
        );
      }

      if (driveRes?.ok) return relayAudio(driveRes, track.fileName, "api");

      if (driveRes) {
        const errText = await driveRes.text().catch(() => "");
        const reason = errText.match(/"reason"\s*:\s*"([^"]+)"/)?.[1] || `HTTP ${driveRes.status}`;
        console.error(`[VR-STREAM] Drive API failure for ${id}: ${reason}`);
        if (driveRes.status === 404) return audioError(404, "file-not-found");
        // 401/403 → fall through to the anonymous attempt.
      }
    }

    // ── Attempt 2: anonymous link-shared download ──
    try {
      const anonHeaders: Record<string, string> = {};
      if (rangeHeader) anonHeaders.Range = rangeHeader;

      const anonRes = await fetch(
        `https://drive.google.com/uc?export=download&id=${id}`,
        { headers: anonHeaders, redirect: "follow" }
      );

      if (anonRes.ok) {
        const ct = anonRes.headers.get("Content-Type") || "";
        if (!ct.includes("text/html")) {
          return relayAudio(anonRes, track.fileName, "anonymous");
        }
        console.error(`[VR-STREAM] Anonymous fallback for ${id} returned HTML interstitial`);
      } else {
        console.error(`[VR-STREAM] Anonymous fallback for ${id}: HTTP ${anonRes.status}`);
      }
    } catch (err) {
      console.error(
        "[VR-STREAM] Anonymous fallback error:",
        err instanceof Error ? err.message : err
      );
    }

    return audioError(502, "drive-access-failed");
  } catch (err) {
    console.error(
      "[VR-STREAM] error:",
      err instanceof Error ? err.message : err
    );
    return audioError(500, "stream-error");
  }
}

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

function relayAudio(upstream: Response, fileName: string, via: string): NextResponse {
  const contentType =
    sanitizeContentType(upstream.headers.get("Content-Type")) || detectMimeType(fileName);
  const contentLength = upstream.headers.get("Content-Length");
  const isPartial = upstream.status === 206;

  const responseHeaders: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=86400, s-maxage=86400", // immutable Drive files cache fine
    "Access-Control-Allow-Origin": "*",
    "Accept-Ranges": "bytes",
    "X-Served-Via": via,
  };

  if (contentLength) responseHeaders["Content-Length"] = contentLength;
  if (isPartial) {
    const contentRange = upstream.headers.get("Content-Range");
    if (contentRange) responseHeaders["Content-Range"] = contentRange;
  }

  if (upstream.body) {
    return new NextResponse(upstream.body, {
      status: isPartial ? 206 : 200,
      headers: responseHeaders,
    });
  }
  return new NextResponse(null, { status: isPartial ? 206 : 200, headers: responseHeaders });
}

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

function sanitizeContentType(ct: string | null): string | null {
  if (!ct) return null;
  const base = ct.split(";")[0].trim().toLowerCase();
  if (base === "text/html" || base === "application/json" || base === "text/plain") return null;
  return base;
}

function detectMimeType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "mp3": return "audio/mpeg";
    case "m4a": case "mp4": return "audio/mp4";
    case "aac": return "audio/aac";
    case "ogg": return "audio/ogg";
    case "wav": return "audio/wav";
    case "flac": return "audio/flac";
    default: return "audio/mpeg";
  }
}
