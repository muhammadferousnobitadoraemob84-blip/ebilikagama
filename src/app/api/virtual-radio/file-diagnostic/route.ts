import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { getVirtualRadioState } from "@/lib/virtual-radio-store";
import { getValidDriveToken } from "@/lib/google-drive";
import { parseMp3HeadFromBuffer } from "@/lib/audio-duration";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/virtual-radio/file-diagnostic?id=<driveFileId>  (ADMIN ONLY)
 *
 * Per-file diagnostic for duration-detection troubleshooting. Reports the
 * HTTP/access characteristics of the Drive file and what the server-side
 * parser sees, WITHOUT exposing any credentials. Read-only against Drive.
 *
 * The browser runs the HTML5 Audio metadata check separately (client-side)
 * and posts the measured duration to /verify-durations.
 */
export async function GET(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const state = await getVirtualRadioState();
  const track =
    state.tracks.find((t) => t.driveId === id) ||
    (state.pending ? state.pending.find((t) => t.driveId === id) : undefined);
  if (!track) {
    return NextResponse.json({ error: "File is not in the radio playlist or pending list" }, { status: 404 });
  }

  const diag: Record<string, unknown> = {
    fileName: track.fileName,
    driveId: id,
    mimeType: track.mimeType,
    size: track.size,
    extension: track.fileName.split(".").pop()?.toLowerCase() ?? null,
    proxyPath: `/api/virtual-radio/stream?id=${encodeURIComponent(id)}`,
  };

  try {
    const token = await getValidDriveToken();

    // ── Attempt 1: authenticated Drive API (mirrors the stream proxy) ──
    let status: number | null = null;
    let contentType: string | null = null;
    let contentLength: string | null = null;
    let acceptRanges: string | null = null;
    let via: string | null = null;
    let headBuf: ArrayBuffer | null = null;
    let rangeWorks: boolean | null = null;

    if (token) {
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`,
        { headers: { Authorization: `Bearer ${token.accessToken}`, Range: "bytes=0-65535" } }
      );
      status = res.status;
      contentType = res.headers.get("Content-Type");
      contentLength = res.headers.get("Content-Length");
      acceptRanges = res.headers.get("Accept-Ranges");
      via = "drive-api";
      rangeWorks = res.status === 206;
      if (res.ok || res.status === 206) {
        try {
          headBuf = await res.arrayBuffer();
        } catch {
          headBuf = null;
        }
      } else {
        await res.text().catch(() => "");
      }
    }

    // ── Attempt 2: anonymous download URL ──
    if (!headBuf) {
      try {
        const anon = await fetch(
          `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`,
          { headers: { Range: "bytes=0-65535" }, redirect: "follow" }
        );
        status = anon.status;
        contentType = anon.headers.get("Content-Type");
        contentLength = anon.headers.get("Content-Length");
        acceptRanges = anon.headers.get("Accept-Ranges");
        via = "anonymous";
        rangeWorks = anon.status === 206;
        if ((anon.ok || anon.status === 206) && !(anon.headers.get("Content-Type") || "").includes("text/html")) {
          headBuf = await anon.arrayBuffer();
        }
      } catch {
        // keep nulls
      }
    }

    diag.httpStatus = status;
    diag.contentType = contentType;
    diag.contentLength = contentLength;
    diag.acceptRanges = acceptRanges;
    diag.rangeWorks = rangeWorks;
    diag.servedVia = via;
    diag.bytesReceived = headBuf?.byteLength ?? 0;

    // ── Server-side parse result on what we received ──
    if (headBuf) {
      const ct = (contentType || "").toLowerCase();
      if (ct.includes("text/html")) {
        diag.serverDuration = null;
        diag.serverParse = "HTML interstitial received instead of audio";
      } else {
        const meta = parseMp3HeadFromBuffer(headBuf);
        diag.serverDuration = meta.duration;
        diag.serverBitrate = meta.bitrate;
        diag.serverSampleRate = meta.sampleRate;
        diag.serverParse = meta.detected;
        diag.serverTagBytes = meta.tagBytes ?? 0;
      }
    } else {
      diag.serverParse = "no bytes received";
    }

    diag.finalClassification =
      typeof diag.serverDuration === "number" && (diag.serverDuration as number) > 0
        ? "PLAYABLE + DURATION VERIFIED (server)"
        : diag.bytesReceived
          ? "PLAYABLE — duration pending (server); browser metadata fallback available"
          : "NOT ACCESSIBLE via server";

    return NextResponse.json(diag, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    diag.error = err instanceof Error ? err.message : "Diagnostic failed";
    return NextResponse.json(diag, { status: 500 });
  }
}
