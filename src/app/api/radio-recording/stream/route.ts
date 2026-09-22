import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { getRecordingState } from "@/lib/recording-store";
import { getValidDriveToken } from "@/lib/google-drive";

export const dynamic = "force-dynamic";
// Streaming a recording can take a while (it proxies Drive bytes); allow the
// max serverless duration. Range requests keep individual invocations small.
export const maxDuration = 300;

function forbidden() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

/**
 * GET /api/radio-recording/stream?id=<recordingId> — ADMIN ONLY.
 *
 * Proxies the archived recording audio from Google Drive so the private
 * player never needs a public Drive URL. Supports HTTP Range requests so
 * seeking (and Jump-to-Azan) works without downloading the whole file.
 *
 * Every call re-verifies the admin session — normal users get 403, and the
 * recording id is validated against the store (never passed to Drive raw).
 */
export async function GET(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) return forbidden();

  const recordingId = request.nextUrl.searchParams.get("id");
  if (!recordingId) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  try {
    const state = await getRecordingState();
    const all = [...state.archive, ...(state.active ? [state.active] : [])];
    const rec = all.find((r) => r.id === recordingId && r.status === "archived" && r.driveFileId);
    if (!rec || !rec.driveFileId) {
      return NextResponse.json({ error: "Recording not found" }, { status: 404 });
    }

    const token = await getValidDriveToken();
    if (!token) {
      return NextResponse.json({ error: "Google Drive not connected" }, { status: 502 });
    }

    const range = request.headers.get("range");
    const upstream = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(rec.driveFileId)}?alt=media`,
      {
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          ...(range ? { Range: range } : {}),
        },
      }
    );

    if (!upstream.ok && upstream.status !== 206) {
      return NextResponse.json(
        { error: `Drive returned HTTP ${upstream.status}` },
        { status: 502 }
      );
    }

    const headers = new Headers();
    const pass = ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"];
    for (const h of pass) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }
    if (!headers.has("Content-Type")) headers.set("Content-Type", "audio/webm");
    headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", "private, no-store");

    return new NextResponse(upstream.body, {
      status: upstream.status === 206 ? 206 : 200,
      headers,
    });
  } catch (err) {
    console.error("[REC-STREAM] error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to stream recording" }, { status: 500 });
  }
}
