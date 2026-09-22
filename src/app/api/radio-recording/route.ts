import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import {
  getRecordingState,
  getRecordingFolderId,
  startRecordingSession,
  heartbeatRecording,
  stopRecordingSession,
  abortRecordingSession,
  retryFailedRecording,
  deleteRecordingMeta,
} from "@/lib/recording-store";

export const dynamic = "force-dynamic";

function forbidden() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

/**
 * GET /api/radio-recording — ADMIN.
 * Snapshot for the admin page: active session (if any), folder config,
 * archive list. Drive file IDs are returned ONLY here, to admins.
 */
export async function GET() {
  const session = await getAdminSession();
  if (!session) return forbidden();

  try {
    const [state, folderId] = await Promise.all([getRecordingState(), getRecordingFolderId()]);
    return NextResponse.json({
      active: state.active,
      archive: state.archive,
      folderId,
      folderName: folderId ? "Google Drive / eBilikAgama Radio Recordings" : null,
    });
  } catch (err) {
    console.error("[REC-GET] error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to load recordings" }, { status: 500 });
  }
}

/**
 * POST /api/radio-recording — ADMIN.
 * Body actions:
 *   start     { id, fileName, startedAt }        → opens the (single) session
 *   heartbeat { id, elapsedSeconds?, azanEvent? } → appends actual azan markers
 *   stop      { id, endedAt, durationSeconds }   → finalizing
 *   abort     { id, error }                      → crashed/abandoned session
 *   retry     { id }                             → re-activate a failed upload
 *   delete    { id }                             → remove archive metadata
 */
export async function POST(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) return forbidden();

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.action !== "string") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const action = body.action;
    const id = typeof body.id === "string" ? body.id : null;

    if (action === "start") {
      if (!id || typeof body.fileName !== "string" || typeof body.startedAt !== "number") {
        return NextResponse.json({ error: "Missing start fields" }, { status: 400 });
      }
      const createdBy = session.username ?? "admin";
      const result = await startRecordingSession(id, body.fileName, body.startedAt, createdBy);
      if (!result.ok) {
        return NextResponse.json({ error: result.reason }, { status: 409 });
      }
      return NextResponse.json({ success: true, session: result.meta });
    }

    if (action === "heartbeat") {
      if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
      const azanEvent =
        body.azanEvent && typeof body.azanEvent === "object"
          ? (body.azanEvent as { prayer: string; offsetSeconds: number; actualStartAt: number })
          : undefined;
      const updated = await heartbeatRecording(id, {
        elapsedSeconds: typeof body.elapsedSeconds === "number" ? body.elapsedSeconds : undefined,
        azanEvent: azanEvent
          ? {
              prayer: azanEvent.prayer as never,
              offsetSeconds: azanEvent.offsetSeconds,
              actualStartAt: azanEvent.actualStartAt,
            }
          : undefined,
      });
      if (!updated) {
        return NextResponse.json(
          { error: "Session not active — another admin may have stopped it" },
          { status: 409 }
        );
      }
      return NextResponse.json({ success: true, session: updated });
    }

    if (action === "stop") {
      if (!id || typeof body.endedAt !== "number" || typeof body.durationSeconds !== "number") {
        return NextResponse.json({ error: "Missing stop fields" }, { status: 400 });
      }
      const stopped = await stopRecordingSession(id, body.endedAt, body.durationSeconds);
      if (!stopped) {
        return NextResponse.json({ error: "No matching active session" }, { status: 409 });
      }
      return NextResponse.json({ success: true, session: stopped });
    }

    if (action === "abort") {
      if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
      const aborted = await abortRecordingSession(id, String(body.error ?? "abandoned by admin"));
      if (!aborted) return NextResponse.json({ error: "No matching active session" }, { status: 409 });
      return NextResponse.json({ success: true, session: aborted });
    }

    if (action === "retry") {
      if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
      const retried = await retryFailedRecording(id);
      if (!retried) {
        return NextResponse.json(
          { error: "Recording not retryable (missing or another session is active)" },
          { status: 409 }
        );
      }
      return NextResponse.json({ success: true, session: retried });
    }

    if (action === "delete") {
      if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
      const ok = await deleteRecordingMeta(id);
      if (!ok) return NextResponse.json({ error: "Recording not found in archive" }, { status: 404 });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    console.error("[REC-POST] error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Recording action failed" }, { status: 500 });
  }
}
