import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import {
  getRecordingFolderId,
  saveRecordingFolderId,
  getRecordingState,
  beginUpload,
  updateUploadProgress,
  archiveRecording,
  failRecording,
} from "@/lib/recording-store";
import {
  ensureRecordingsFolder,
  initRecordingUpload,
  putRecordingChunk,
  queryRecordingUploadStatus,
  SessionExpiredError,
  RECORDING_CHUNK_SIZE,
} from "@/lib/recording-drive";
import { getValidDriveToken } from "@/lib/google-drive";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // each request = ONE bounded 4 MiB chunk, not the whole file

function forbidden() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

/**
 * GET /api/radio-recording/upload — ADMIN.
 * Returns the configured destination folder id (lazily creating the
 * "eBilikAgama Radio Recordings" Drive folder when ?ensure=1) plus the
 * chunk size the client must use.
 */
export async function GET(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) return forbidden();

  try {
    let folderId = await getRecordingFolderId();
    if (!folderId && request.nextUrl.searchParams.get("ensure") === "1") {
      const token = await getValidDriveToken();
      if (!token) {
        return NextResponse.json({ error: "Google Drive not connected" }, { status: 502 });
      }
      folderId = await ensureRecordingsFolder(token.accessToken);
      await saveRecordingFolderId(folderId);
    }
    return NextResponse.json({ folderId, chunkSize: RECORDING_CHUNK_SIZE });
  } catch (err) {
    console.error("[REC-UPLOAD-GET] error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to resolve recording folder" }, { status: 500 });
  }
}

/**
 * POST /api/radio-recording/upload — ADMIN.
 *
 * JSON actions:
 *   set-folder { folderId }                 → destination override
 *   init       { id, fileName, totalBytes } → open Drive resumable session server-side
 *   status     { id }                       → bytes acknowledged by Drive (resume path)
 *   finalize   { id, driveFileId?, fileName? } → mark archived
 *   fail       { id, error }                → record failure (client may retry)
 *
 * Multipart (Content-Type: multipart/form-data):
 *   fields: id, chunkStart, totalBytes, isFinal, file (the 4 MiB blob)
 *   → forwards the chunk to Drive with the correct Content-Range.
 *
 * The Drive resumable URL and the OAuth token NEVER reach the browser —
 * the client uploads chunks to this API and this API alone.
 */
export async function POST(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) return forbidden();

  try {
    const contentType = request.headers.get("content-type") ?? "";

    // ── Multipart chunk forwarding ──
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const id = String(form.get("id") ?? "");
      const chunkStart = Number(form.get("chunkStart") ?? "-1");
      const totalBytes = Number(form.get("totalBytes") ?? "0");
      const isFinal = String(form.get("isFinal") ?? "false") === "true";
      const file = form.get("file");

      if (!id || !(file instanceof File) || chunkStart < 0 || totalBytes <= 0) {
        return NextResponse.json({ error: "Invalid chunk payload" }, { status: 400 });
      }

      const buf = Buffer.from(await file.arrayBuffer());
      try {
        const result = await putRecordingChunk({
          recordingId: id,
          chunkStart,
          totalBytes,
          chunk: buf,
          isFinal,
        });

        if (result.done && result.file) {
          const archived = await archiveRecording(id, null, result.file.id);
          if (!archived) {
            return NextResponse.json({ error: "Upload complete but session missing" }, { status: 409 });
          }
          return NextResponse.json({
            done: true,
            file: { id: result.file.id, name: result.file.name, size: result.file.size },
          });
        }

        await updateUploadProgress(id, chunkStart + buf.length);
        return NextResponse.json({ done: false, uploadedBytes: chunkStart + buf.length });
      } catch (err) {
        if (err instanceof SessionExpiredError) {
          return NextResponse.json(
            { error: "Upload session expired — re-init required", sessionExpired: true },
            { status: 409 }
          );
        }
        throw err;
      }
    }

    // ── JSON actions ──
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.action !== "string") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const action = body.action;
    const id = typeof body.id === "string" ? body.id : null;

    if (action === "set-folder") {
      if (typeof body.folderId !== "string" || !body.folderId.trim()) {
        return NextResponse.json({ error: "Missing folderId" }, { status: 400 });
      }
      const folderId = body.folderId.trim();
      // Validate the folder exists & is reachable before saving.
      const token = await getValidDriveToken();
      if (!token) return NextResponse.json({ error: "Google Drive not connected" }, { status: 502 });
      const check = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,mimeType,name`,
        { headers: { Authorization: `Bearer ${token.accessToken}` } }
      );
      if (!check.ok) {
        return NextResponse.json(
          { error: "Folder not accessible with the connected Google account" },
          { status: 400 }
        );
      }
      await saveRecordingFolderId(folderId);
      return NextResponse.json({ success: true, folderId });
    }

    if (action === "init") {
      if (!id || typeof body.fileName !== "string" || typeof body.totalBytes !== "number" || body.totalBytes <= 0) {
        return NextResponse.json({ error: "Missing init fields" }, { status: 400 });
      }
      const token = await getValidDriveToken();
      if (!token) return NextResponse.json({ error: "Google Drive not connected" }, { status: 502 });

      let folderId = await getRecordingFolderId();
      if (!folderId) folderId = await ensureRecordingsFolder(token.accessToken);

      await initRecordingUpload({
        accessToken: token.accessToken,
        recordingId: id,
        fileName: body.fileName,
        totalBytes: body.totalBytes,
        folderId,
      });
      // driveFileId is assigned by Drive only on completion; record folder + size now.
      await beginUpload(id, folderId, body.totalBytes);
      return NextResponse.json({ success: true, folderId, chunkSize: RECORDING_CHUNK_SIZE });
    }

    if (action === "status") {
      if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
      try {
        const st = await queryRecordingUploadStatus(id);
        await updateUploadProgress(id, st.uploadedBytes);
        return NextResponse.json({ done: st.done, uploadedBytes: st.uploadedBytes });
      } catch (err) {
        if (err instanceof SessionExpiredError) {
          return NextResponse.json(
            { error: "Upload session expired — re-init required", sessionExpired: true },
            { status: 409 }
          );
        }
        throw err;
      }
    }

    if (action === "finalize") {
      if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
      // driveFileId from the client (e.g. its own completed resumable session)
      // wins when provided; otherwise keep the stored value.
      const archived = await archiveRecording(
        id,
        null,
        typeof body.driveFileId === "string" && body.driveFileId ? body.driveFileId : null
      );
      if (!archived) return NextResponse.json({ error: "Session missing" }, { status: 409 });
      return NextResponse.json({ success: true, recording: archived });
    }

    if (action === "fail") {
      if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
      const failed = await failRecording(id, String(body.error ?? "Upload failed"));
      if (!failed) return NextResponse.json({ error: "Session missing" }, { status: 409 });
      return NextResponse.json({ success: true, recording: failed });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[REC-UPLOAD-POST] error:", msg);
    return NextResponse.json({ error: `Upload failed: ${msg}` }, { status: 500 });
  }
}
