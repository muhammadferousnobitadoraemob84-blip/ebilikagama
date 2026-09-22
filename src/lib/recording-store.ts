// Server-side persistence for Radio Recording metadata.
//
// Reuses the EXISTING Setting key/value table (same pattern as
// virtual-radio-store.ts / azan-store.ts) — ZERO schema changes. Only
// lightweight metadata is stored: recording id, Drive file id, times,
// duration, status, filename, azan event markers. Audio bytes NEVER touch
// Neon — recordings live in Google Drive only.
//
// There is at most ONE active recording session (a Setting row), so duplicate
// sessions are impossible even across multiple admins/browsers.

import { prisma, withRetry } from "@/lib/prisma";
import type { AzanPrayer } from "@/lib/azan";

// ─── Types ──────────────────────────────────────────────────────────

export type RecordingStatus =
  | "recording" // session live in the admin's browser
  | "finalizing" // audio captured, upload starting
  | "uploading"
  | "archived" // in Drive + listed
  | "failed"; // upload failed; client may retry

export interface AzanMarker {
  prayer: AzanPrayer;
  /** seconds into the recording when the azan actually began playing */
  offsetSeconds: number;
  /** unix ms (server time) when the azan actually began */
  actualStartAt: number;
}

export interface RecordingMeta {
  id: string;
  /** Google Drive file id (set once uploaded) */
  driveFileId: string | null;
  fileName: string;
  startedAt: number; // unix ms (server clock)
  endedAt: number | null;
  durationSeconds: number | null;
  status: RecordingStatus;
  /** number of bytes uploaded to Drive so far (progress reporting) */
  uploadedBytes: number | null;
  totalBytes: number | null;
  azanEvents: AzanMarker[];
  createdBy: string; // username
  createdAt: string; // ISO
  error: string | null;
}

interface RecordingState {
  /** the single in-progress-or-finalizing session, if any */
  active: RecordingMeta | null;
  /** finalized/failed recordings, newest first */
  archive: RecordingMeta[];
}

// ─── Setting keys ───────────────────────────────────────────────────

const K_ACTIVE = "radio_recording_active"; // JSON: RecordingMeta | null
const K_ARCHIVE = "radio_recording_archive"; // JSON: RecordingMeta[]
const K_FOLDER = "radio_recording_folder"; // Drive folder id for recordings

// ─── Short-TTL cache (mirrors azan-store) ───────────────────────────
// Held on globalThis so all Next.js serverless route modules share ONE cache
// (each route otherwise gets its own module instance and can serve a stale
// snapshot after another route has written — a 3s TTL hides, not fixes, that).

type RecCache = { at: number; state: RecordingState } | null;
const globalStore = globalThis as unknown as { __recCache?: RecCache };
const CACHE_TTL_MS = 3000;

export function invalidateRecordingCache() {
  globalStore.__recCache = null;
}

// ─── Low-level helpers ──────────────────────────────────────────────

async function readSetting(key: string): Promise<string | null> {
  const row = await withRetry(() =>
    prisma.setting.findUnique({ where: { key }, select: { value: true } })
  );
  return row?.value ?? null;
}

async function writeSetting(key: string, value: string): Promise<void> {
  await withRetry(() =>
    prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    })
  );
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function readState(): Promise<RecordingState> {
  const cached = globalStore.__recCache;
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.state;
  const [activeRaw, archiveRaw] = await Promise.all([
    readSetting(K_ACTIVE),
    readSetting(K_ARCHIVE),
  ]);
  const state: RecordingState = {
    active: parseJson<RecordingMeta | null>(activeRaw, null),
    archive: parseJson<RecordingMeta[]>(archiveRaw, []),
  };
  globalStore.__recCache = { at: Date.now(), state };
  return state;
}

async function writeState(state: RecordingState): Promise<void> {
  await Promise.all([
    writeSetting(K_ACTIVE, JSON.stringify(state.active)),
    writeSetting(K_ARCHIVE, JSON.stringify(state.archive)),
  ]);
  invalidateRecordingCache();
}

// ─── Folder configuration ───────────────────────────────────────────

export async function getRecordingFolderId(): Promise<string | null> {
  return readSetting(K_FOLDER);
}

export async function saveRecordingFolderId(folderId: string): Promise<void> {
  await writeSetting(K_FOLDER, folderId);
  invalidateRecordingCache();
}

// ─── Session lifecycle ──────────────────────────────────────────────

export async function getRecordingState(): Promise<RecordingState> {
  return readState();
}

/**
 * Start a new session. Refuses when another session is already active
 * (recording/finalizing/uploading) — this is the duplicate-session guard.
 */
export async function startRecordingSession(
  id: string,
  fileName: string,
  startedAt: number,
  createdBy: string
): Promise<{ ok: true; meta: RecordingMeta } | { ok: false; reason: string }> {
  const state = await readState();
  if (state.active && (state.active.status === "recording" || state.active.status === "finalizing" || state.active.status === "uploading")) {
    return { ok: false, reason: `A recording session is already active (started ${new Date(state.active.startedAt).toISOString()})` };
  }
  const meta: RecordingMeta = {
    id,
    driveFileId: null,
    fileName,
    startedAt,
    endedAt: null,
    durationSeconds: null,
    status: "recording",
    uploadedBytes: null,
    totalBytes: null,
    azanEvents: [],
    createdBy,
    createdAt: new Date().toISOString(),
    error: null,
  };
  state.active = meta;
  await writeState(state);
  return { ok: true, meta };
}

/**
 * Heartbeat: append azan markers as they ACTUALLY happen (driven by the
 * player's azan-start callback), or update duration while recording.
 * Returns the updated session, or null when the session was invalidated
 * elsewhere (e.g. another admin stopped it) — the client must then stop.
 */
export async function heartbeatRecording(
  id: string,
  patch: {
    elapsedSeconds?: number;
    azanEvent?: AzanMarker;
  }
): Promise<RecordingMeta | null> {
  const state = await readState();
  const active = state.active;
  if (!active || active.id !== id || active.status !== "recording") return null;

  if (typeof patch.elapsedSeconds === "number" && Number.isFinite(patch.elapsedSeconds)) {
    active.durationSeconds = Math.max(0, Math.round(patch.elapsedSeconds));
  }
  if (patch.azanEvent) {
    const ev = patch.azanEvent;
    // Dedupe by prayer+startedAt: network retries must not double-insert.
    const dup = active.azanEvents.some(
      (e) => e.prayer === ev.prayer && e.actualStartAt === ev.actualStartAt
    );
    if (!dup) active.azanEvents.push(ev);
  }
  await writeState(state);
  return active;
}

/**
 * Stop: move the session into `finalizing` (still occupies the active slot so
 * a second admin cannot start a colliding recording mid-upload), or straight
 * to failed/archived states via finalizeRecording/failRecording.
 */
export async function stopRecordingSession(
  id: string,
  endedAt: number,
  durationSeconds: number
): Promise<RecordingMeta | null> {
  const state = await readState();
  const active = state.active;
  if (!active || active.id !== id) return null;
  active.status = "finalizing";
  active.endedAt = endedAt;
  active.durationSeconds = Math.max(0, Math.round(durationSeconds));
  await writeState(state);
  return active;
}

/**
 * Mark the resumable upload as started. `folderId` is stored in driveFileId
 * temporarily (Drive assigns the real file id only when the LAST chunk lands);
 * archiveRecording() overwrites it with the actual file id.
 */
export async function beginUpload(
  id: string,
  folderId: string,
  totalBytes: number
): Promise<RecordingMeta | null> {
  const state = await readState();
  const active = state.active;
  if (!active || active.id !== id) return null;
  active.driveFileId = folderId;
  active.totalBytes = totalBytes;
  active.status = "uploading";
  await writeState(state);
  return active;
}

export async function updateUploadProgress(
  id: string,
  uploadedBytes: number
): Promise<void> {
  const state = await readState();
  const active = state.active;
  if (!active || active.id !== id) return;
  active.uploadedBytes = Math.max(0, Math.round(uploadedBytes));
  await writeState(state);
}

/**
 * Archive: move the session into the archive list with status `archived`.
 */
export async function archiveRecording(
  id: string,
  webViewLink: string | null,
  driveFileId?: string | null
): Promise<RecordingMeta | null> {
  const state = await readState();
  const active = state.active;
  if (!active || active.id !== id) return null;
  // Drive assigns the real file id when the last chunk lands — overwrite the
  // folder-id placeholder from beginUpload() so the archive streams the FILE.
  if (driveFileId) active.driveFileId = driveFileId;
  active.status = "archived";
  active.uploadedBytes = active.totalBytes;
  // webViewLink is derivable from driveFileId; keep meta minimal (no extra column).
  state.active = null;
  state.archive = [active, ...state.archive].slice(0, 200); // cap archive length
  await writeState(state);
  return active;
}

/** Upload failed: keep metadata with status `failed` + the error message. */
export async function failRecording(id: string, error: string): Promise<RecordingMeta | null> {
  const state = await readState();
  const active = state.active;
  if (!active || active.id !== id) return null;
  active.status = "failed";
  active.error = error.slice(0, 500);
  state.active = null;
  state.archive = [active, ...state.archive].slice(0, 200);
  await writeState(state);
  return active;
}

/**
 * Retry a failed upload: re-activate (the browser still holds the audio blob)
 * or discard entirely.
 */
export async function retryFailedRecording(
  id: string
): Promise<RecordingMeta | null> {
  const state = await readState();
  const entry = state.archive.find((r) => r.id === id && r.status === "failed");
  if (!entry) return null;
  // Only one active slot: require no other active session.
  if (state.active && ["recording", "finalizing", "uploading"].includes(state.active.status)) {
    return null;
  }
  state.archive = state.archive.filter((r) => r.id !== id);
  entry.status = "finalizing";
  entry.error = null;
  state.active = entry;
  await writeState(state);
  return entry;
}

export async function deleteRecordingMeta(id: string): Promise<boolean> {
  const state = await readState();
  const before = state.archive.length;
  state.archive = state.archive.filter((r) => r.id !== id);
  if (state.archive.length === before) return false;
  await writeState(state);
  return true;
}

/** Abort a stuck session (client crash / abandoned). Admin can force-clear. */
export async function abortRecordingSession(
  id: string,
  error: string
): Promise<RecordingMeta | null> {
  const state = await readState();
  const active = state.active;
  if (!active || active.id !== id) return null;
  active.status = "failed";
  active.endedAt = Date.now();
  active.error = error.slice(0, 500);
  state.active = null;
  state.archive = [active, ...state.archive].slice(0, 200);
  await writeState(state);
  return active;
}
