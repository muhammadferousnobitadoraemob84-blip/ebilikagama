// Server-side persistence for Virtual Radio metadata.
//
// Uses the EXISTING Setting key/value table — zero schema changes.
// Only lightweight metadata is stored here:
//   - Google Drive folder ID/name
//   - per-track: Drive file ID, filename, duration, size, MIME, order
//   - timeline epoch (radio_started_at)
//   - scan timestamps
// NEVER audio bytes — the files themselves stay in Google Drive only.

import { prisma, withRetry } from "@/lib/prisma";
import {
  EMPTY_RADIO_STATE,
  type VirtualRadioState,
  type VirtualRadioTrack,
  type VirtualRadioPendingTrack,
} from "@/lib/virtual-radio";

// Setting keys (prefixed to avoid collisions with existing keys)
const K_ENABLED = "virtual_radio_enabled";
const K_FOLDER_ID = "virtual_radio_folder_id";
const K_FOLDER_NAME = "virtual_radio_folder_name";
const K_EPOCH = "virtual_radio_epoch";
const K_PLAYLIST = "virtual_radio_playlist"; // JSON: VirtualRadioTrack[]
const K_PENDING = "virtual_radio_pending"; // JSON: VirtualRadioPendingTrack[]
const K_LAST_SCAN = "virtual_radio_last_scan";

// Short-TTL cache: the public status endpoint may be hit by every visitor;
// a 5s cache keeps Neon reads negligible while staying fresh for scans.
let _cache: { state: VirtualRadioState; at: number } | null = null;
const CACHE_TTL_MS = 5000;

function invalidateCache() {
  _cache = null;
}

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

function parsePlaylist(raw: string | null): VirtualRadioTrack[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (t): t is VirtualRadioTrack =>
          t && typeof t.driveId === "string" && typeof t.fileName === "string"
      )
      .map((t) => ({
        driveId: t.driveId,
        fileName: t.fileName,
        duration: Number(t.duration) || 0,
        size: t.size == null ? null : Number(t.size),
        mimeType: typeof t.mimeType === "string" ? t.mimeType : "audio/mpeg",
      }));
  } catch {
    return [];
  }
}

function parsePending(raw: string | null): VirtualRadioPendingTrack[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (t): t is VirtualRadioPendingTrack =>
          t && typeof t.driveId === "string" && typeof t.fileName === "string"
      )
      .map((t) => ({
        driveId: t.driveId,
        fileName: t.fileName,
        size: t.size == null ? null : Number(t.size),
        mimeType: typeof t.mimeType === "string" ? t.mimeType : "audio/mpeg",
        reason: typeof t.reason === "string" ? t.reason : "Duration pending",
        addedAt: typeof t.addedAt === "string" ? t.addedAt : new Date(0).toISOString(),
      }));
  } catch {
    return [];
  }
}

/** Read the full radio state (cached ~5s). Cheap: a few KV reads. */
export async function getVirtualRadioState(): Promise<VirtualRadioState> {
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return _cache.state;

  try {
    const [enabledRaw, folderId, folderName, epochRaw, playlistRaw, pendingRaw, lastScan] =
      await Promise.all([
        readSetting(K_ENABLED),
        readSetting(K_FOLDER_ID),
        readSetting(K_FOLDER_NAME),
        readSetting(K_EPOCH),
        readSetting(K_PLAYLIST),
        readSetting(K_PENDING),
        readSetting(K_LAST_SCAN),
      ]);

    const tracks = parsePlaylist(playlistRaw);
    const totalDuration = tracks.reduce((sum, t) => sum + t.duration, 0);

    const state: VirtualRadioState = {
      enabled: enabledRaw === "true",
      folderId: folderId || null,
      folderName: folderName || null,
      epoch: epochRaw ? Number(epochRaw) || null : null,
      tracks,
      totalDuration,
      lastScanAt: lastScan || null,
      pending: parsePending(pendingRaw),
    };

    _cache = { state, at: Date.now() };
    return state;
  } catch (err) {
    console.error(
      "[VIRTUAL-RADIO-STORE] read failed:",
      err instanceof Error ? err.message : err
    );
    // Fail soft: radio appears offline rather than erroring pages.
    return EMPTY_RADIO_STATE;
  }
}

/** Save the configured folder (admin action). */
export async function saveRadioFolder(folderId: string, folderName: string | null): Promise<void> {
  await writeSetting(K_FOLDER_ID, folderId);
  if (folderName != null) await writeSetting(K_FOLDER_NAME, folderName);
  // New folder → previous playlist/pending list/epoch no longer applies.
  await writeSetting(K_PLAYLIST, "[]");
  await writeSetting(K_PENDING, "[]");
  invalidateCache();
}

/** Persist a freshly scanned playlist (deterministic order as given). */
export async function saveRadioPlaylist(tracks: VirtualRadioTrack[]): Promise<void> {
  await writeSetting(K_PLAYLIST, JSON.stringify(tracks));
  await writeSetting(K_LAST_SCAN, new Date().toISOString());
  invalidateCache();
}

/** Persist the duration-pending track list (accessible but unmeasured). */
export async function saveRadioPending(tracks: VirtualRadioPendingTrack[]): Promise<void> {
  await writeSetting(K_PENDING, JSON.stringify(tracks));
  invalidateCache();
}

/**
 * Get (or lazily create) the timeline epoch.
 * Created ONCE and never moved afterwards — moving it would desync
 * every listener. Call after the playlist exists.
 */
export async function ensureRadioEpoch(): Promise<number> {
  const existing = await readSetting(K_EPOCH);
  if (existing) {
    const n = Number(existing);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const now = Date.now();
  await writeSetting(K_EPOCH, String(now));
  invalidateCache();
  return now;
}

/** Enable/disable the radio (admin toggle). Does NOT touch the epoch. */
export async function setRadioEnabled(enabled: boolean): Promise<void> {
  await writeSetting(K_ENABLED, enabled ? "true" : "false");
  invalidateCache();
}
