// Google Drive helpers specific to Radio Recordings.
//
// Upload flow (all admin-authenticated; the browser never touches
// googleapis.com and never sees any Google URL or token):
//   1. POST /api/radio-recording/upload {action:"init"} → server opens a
//      resumable session with Drive and keeps the upload URL server-side.
//   2. Client PUTs 4 MiB chunks to the same API (multipart). The server
//      forwards each chunk with the correct Content-Range header.
//   3. Final chunk → Drive responds 200/201 with the new file metadata;
//      the server records the Drive file id on the recording meta.
//
// Chunk size is 4 MiB because Vercel caps serverless request bodies
// (~4.5 MB), so each request carries one bounded chunk — never the
// whole recording, and each function invocation stays well inside limits.
//
// Session URLs live in a per-instance in-memory registry with a TTL.
// If a serverless instance is recycled mid-upload, the client's next chunk
// gets 409 "session expired" and restarts from the persisted uploadedBytes
// offset via Drive's status query (queryRecordingUploadStatus) — no data
// corruption, just re-sent bytes from the last acknowledged offset.

import { getValidDriveToken } from "@/lib/google-drive";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const RESUMABLE_INIT = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size";

export const RECORDING_CHUNK_SIZE = 4 * 1024 * 1024; // 4 MiB — under Vercel's body cap
const SESSION_TTL_MS = 30 * 60 * 1000; // resumable sessions idle-expire after 30 min

/** Ensure the "eBilikAgama Radio Recordings" folder exists; return its id. */
export async function ensureRecordingsFolder(accessToken: string): Promise<string> {
  const query = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and name='eBilikAgama Radio Recordings' and trashed=false`
  );
  const listRes = await fetch(
    `${DRIVE_API}/files?q=${query}&fields=files(id,name)&pageSize=5`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (listRes.ok) {
    const data = (await listRes.json()) as { files?: { id: string; name: string }[] };
    const existing = data.files?.[0];
    if (existing) return existing.id;
  }

  const createRes = await fetch(`${DRIVE_API}/files?fields=id`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "eBilikAgama Radio Recordings",
      mimeType: "application/vnd.google-apps.folder",
    }),
  });
  if (!createRes.ok) {
    throw new Error(`Drive folder create failed: HTTP ${createRes.status}`);
  }
  const created = (await createRes.json()) as { id: string };
  return created.id;
}

// ─── Server-held resumable sessions ─────────────────────────────────

const sessions = new Map<string, { url: string; totalBytes: number; at: number }>();

function gcSessions() {
  const now = Date.now();
  for (const [k, v] of sessions) {
    if (now - v.at > SESSION_TTL_MS) sessions.delete(k);
  }
}

/** Open a resumable upload and hold its URL server-side. */
export async function initRecordingUpload(opts: {
  accessToken: string;
  recordingId: string;
  fileName: string;
  totalBytes: number;
  folderId: string;
}): Promise<void> {
  const res = await fetch(RESUMABLE_INIT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "audio/webm",
      "X-Upload-Content-Length": String(opts.totalBytes),
    },
    body: JSON.stringify({
      name: opts.fileName,
      parents: [opts.folderId],
      mimeType: "audio/webm",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Drive resumable init failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const uploadUrl = res.headers.get("Location");
  if (!uploadUrl) throw new Error("Drive did not return an upload URL");
  gcSessions();
  sessions.set(opts.recordingId, { url: uploadUrl, totalBytes: opts.totalBytes, at: Date.now() });
}

function getSession(recordingId: string): { url: string; totalBytes: number } | null {
  const s = sessions.get(recordingId);
  if (!s) return null;
  if (Date.now() - s.at > SESSION_TTL_MS) {
    sessions.delete(recordingId);
    return null;
  }
  return s;
}

export interface ChunkResult {
  done: boolean;
  file?: { id: string; name: string; size?: string };
}

/**
 * Forward one chunk to the resumable session.
 * `isFinal` must be true on the last chunk (explicit total size in Range).
 * Returns Drive's file metadata once the upload completes.
 */
export async function putRecordingChunk(opts: {
  recordingId: string;
  chunkStart: number;
  totalBytes: number;
  chunk: Buffer;
  isFinal: boolean;
}): Promise<ChunkResult> {
  const s = getSession(opts.recordingId);
  if (!s) throw new SessionExpiredError();

  const end = opts.chunkStart + opts.chunk.length - 1;
  const range = `bytes ${opts.chunkStart}-${end}/${opts.isFinal ? opts.totalBytes : "*"}`;
  const res = await fetch(s.url, {
    method: "PUT",
    headers: {
      "Content-Range": range,
      "Content-Length": String(opts.chunk.length),
    },
    body: new Uint8Array(opts.chunk),
  });

  if (res.status === 308) {
    sessions.set(opts.recordingId, { ...s, at: Date.now() }); // touch TTL
    return { done: false };
  }
  if (res.status === 200 || res.status === 201) {
    sessions.delete(opts.recordingId);
    const file = (await res.json()) as { id: string; name: string; size?: string };
    return { done: true, file };
  }
  const body = await res.text().catch(() => "");
  throw new Error(`Drive chunk upload failed: HTTP ${res.status} ${body.slice(0, 200)}`);
}

/** Ask Drive how many bytes were actually acknowledged (resume path). */
export async function queryRecordingUploadStatus(
  recordingId: string
): Promise<{ uploadedBytes: number; done: boolean }> {
  const s = getSession(recordingId);
  if (!s) throw new SessionExpiredError();

  const res = await fetch(s.url, {
    method: "PUT",
    headers: { "Content-Range": `bytes */${s.totalBytes}`, "Content-Length": "0" },
  });
  if (res.status === 200 || res.status === 201) {
    sessions.delete(recordingId);
    return { uploadedBytes: s.totalBytes, done: true };
  }
  if (res.status === 308) {
    sessions.set(recordingId, { ...s, at: Date.now() });
    const range = res.headers.get("Range"); // "bytes=0-N" (inclusive N)
    if (range) {
      const end = Number(range.split("-")[1]);
      return { uploadedBytes: end + 1, done: false };
    }
    return { uploadedBytes: 0, done: false };
  }
  throw new Error(`Drive upload status query failed: HTTP ${res.status}`);
}

/** Thrown when the server-side session is gone (instance recycle / TTL). */
export class SessionExpiredError extends Error {
  constructor() {
    super("Upload session expired");
    this.name = "SessionExpiredError";
  }
}

/** Resolve a drive file id → fetch context for admin-only streaming. */
export async function getRecordingFetchContext(): Promise<{
  accessToken: string;
} | null> {
  return getValidDriveToken();
}
