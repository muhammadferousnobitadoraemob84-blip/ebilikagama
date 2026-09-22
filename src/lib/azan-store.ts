// Server-side persistence for Azan & Prayer Times metadata.
//
// Reuses the EXISTING Setting key/value table (same pattern as
// virtual-radio-store.ts) — ZERO schema changes. Only lightweight
// metadata is stored: Drive file IDs, filenames, durations, role
// assignments, structured prayer times. Audio bytes NEVER leave Drive
// and no audio/blob/base64 is ever written here.

import { prisma, withRetry } from "@/lib/prisma";
import {
  EMPTY_AZAN_ASSIGNMENTS,
  emptyAzanTestMode,
  isTestModeActive,
  sanitizeOverrides,
  type AzanAssignments,
  type AzanFile,
  type AzanTestMode,
  type PrayerTimeSource,
  type PrayerTimesData,
} from "@/lib/azan";

// Setting keys (same virtual_radio_ prefix family as the radio store)
const K_AZAN_FILES = "virtual_radio_azan_files"; // JSON: AzanFile[]
const K_AZAN_ASSIGN = "virtual_radio_azan_assignments"; // JSON: AzanAssignments
const K_PRAYER_ZONE = "virtual_radio_prayer_zone"; // e.g. "SBH05"
const K_PRAYER_TIMES = "virtual_radio_prayer_times"; // JSON: PrayerTimesData
const K_TEST_MODE = "virtual_radio_prayer_test"; // JSON: AzanTestMode (admin-only, expiring)

// Short-TTL cache — the public status/now-playing endpoints consult this
// on every page load; 5s staleness is invisible for azan scheduling.
let _cache: {
  files: AzanFile[];
  assignments: AzanAssignments;
  prayerZone: string | null;
  prayerTimes: PrayerTimesData | null;
  testMode: AzanTestMode;
  at: number;
} | null = null;
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

function parseFiles(raw: string | null): AzanFile[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((f): f is AzanFile => f && typeof f.driveId === "string" && typeof f.fileName === "string")
      .map((f) => ({
        driveId: f.driveId,
        fileName: f.fileName,
        mimeType: typeof f.mimeType === "string" ? f.mimeType : "audio/mpeg",
        size: f.size == null ? null : Number(f.size),
        duration: Number(f.duration) || 0,
        durationPending: Boolean(f.durationPending),
        unavailable: Boolean(f.unavailable),
        addedAt: typeof f.addedAt === "string" ? f.addedAt : new Date(0).toISOString(),
        lastSeenAt: typeof f.lastSeenAt === "string" ? f.lastSeenAt : null,
      }));
  } catch {
    return [];
  }
}

function parseAssignments(raw: string | null): AzanAssignments {
  if (!raw) return { ...EMPTY_AZAN_ASSIGNMENTS };
  try {
    const parsed = JSON.parse(raw);
    const out = { ...EMPTY_AZAN_ASSIGNMENTS };
    for (const p of Object.keys(out) as (keyof AzanAssignments)[]) {
      const v = parsed?.[p];
      out[p] = typeof v === "string" && v.length > 0 ? v : null;
    }
    return out;
  } catch {
    return { ...EMPTY_AZAN_ASSIGNMENTS };
  }
}

function parsePrayerTimes(raw: string | null): PrayerTimesData | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || typeof parsed.days !== "object") return null;
    const days: Record<string, PrayerTimesData["days"][string]> = {};
    for (const [key, val] of Object.entries(parsed.days ?? {})) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !val || typeof val !== "object") continue;
      const day = val as Record<string, unknown>;
      const req = (k: string): string => (typeof day[k] === "string" ? (day[k] as string) : "");
      if (!req("subuh") || !req("zohor") || !req("asar") || !req("maghrib") || !req("isyak")) continue;
      days[key] = {
        imsak: typeof day.imsak === "string" ? day.imsak : null,
        subuh: req("subuh"),
        syuruk: req("syuruk"),
        zohor: req("zohor"),
        asar: req("asar"),
        maghrib: req("maghrib"),
        isyak: req("isyak"),
      };
    }
    return {
      zone: typeof parsed.zone === "string" ? parsed.zone : "",
      source: parsed.source === "pdf" ? "pdf" : "jakim_api",
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
      days,
    };
  } catch {
    return null;
  }
}

/** Read the full azan state (cached ~5s). Cheap: a few KV reads. */
export async function getAzanState(): Promise<{
  files: AzanFile[];
  assignments: AzanAssignments;
  prayerZone: string | null;
  prayerTimes: PrayerTimesData | null;
  /** Admin test-mode overrides — check isTestModeActive(testMode, now) before use. */
  testMode: AzanTestMode;
}> {
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) {
    return {
      files: _cache.files,
      assignments: _cache.assignments,
      prayerZone: _cache.prayerZone,
      prayerTimes: _cache.prayerTimes,
      testMode: _cache.testMode,
    };
  }

  try {
    const [filesRaw, assignRaw, zoneRaw, timesRaw, testRaw] = await Promise.all([
      readSetting(K_AZAN_FILES),
      readSetting(K_AZAN_ASSIGN),
      readSetting(K_PRAYER_ZONE),
      readSetting(K_PRAYER_TIMES),
      readSetting(K_TEST_MODE),
    ]);
    // SAFETY RESET: an expired test mode is auto-cleared so a forgotten test
    // schedule can never linger (requirement 11).
    let testMode = parseTestMode(testRaw);
    if (testMode.enabled && testMode.expiresAt != null && Date.now() >= testMode.expiresAt) {
      testMode = emptyAzanTestMode();
      await writeSetting(K_TEST_MODE, JSON.stringify(testMode)).catch(() => {});
    }
    const result = {
      files: parseFiles(filesRaw),
      assignments: parseAssignments(assignRaw),
      prayerZone: zoneRaw || null,
      prayerTimes: parsePrayerTimes(timesRaw),
      testMode,
    };
    _cache = { ...result, at: Date.now() };
    return result;
  } catch (err) {
    console.error(
      "[AZAN-STORE] read failed:",
      err instanceof Error ? err.message : err
    );
    // Fail soft: azan features appear unconfigured rather than erroring pages.
    return {
      files: [],
      assignments: { ...EMPTY_AZAN_ASSIGNMENTS },
      prayerZone: null,
      prayerTimes: null,
      testMode: emptyAzanTestMode(),
    };
  }
}

/**
 * Persist a fresh scan of azan files.
 * Upsert by Drive file ID (stable identity — rescans never duplicate):
 *   - seen again  → update metadata, available
 *   - new         → added
 *   - gone        → kept, marked unavailable (history preserved)
 */
export async function saveAzanScan(
  scanned: Omit<AzanFile, "addedAt" | "lastSeenAt" | "unavailable">[]
): Promise<AzanFile[]> {
  const prev = await getAzanFilesUncached();
  const prevById = new Map(prev.map((f) => [f.driveId, f]));
  const now = new Date().toISOString();
  const seen = new Set<string>();

  const files: AzanFile[] = scanned.map((s) => {
    seen.add(s.driveId);
    const old = prevById.get(s.driveId);
    return {
      ...s,
      unavailable: false,
      addedAt: old?.addedAt ?? now,
      lastSeenAt: now,
      // If a re-probe failed this scan but we had a duration before, keep it.
      ...(s.duration === 0 && old && old.duration > 0
        ? { duration: old.duration, durationPending: old.durationPending }
        : {}),
    };
  });

  // Files that disappeared from the folder: keep, mark unavailable.
  for (const old of prev) {
    if (!seen.has(old.driveId) && !old.unavailable) {
      files.push({ ...old, unavailable: true, lastSeenAt: old.lastSeenAt });
    }
  }

  files.sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: "base" }));
  await writeSetting(K_AZAN_FILES, JSON.stringify(files));
  invalidateCache();
  return files;
}

async function getAzanFilesUncached(): Promise<AzanFile[]> {
  try {
    return parseFiles(await readSetting(K_AZAN_FILES));
  } catch {
    return [];
  }
}

/** Save role assignments (validated by the caller against known files). */
export async function saveAzanAssignments(assignments: AzanAssignments): Promise<void> {
  await writeSetting(K_AZAN_ASSIGN, JSON.stringify(assignments));
  invalidateCache();
}

/** Save the configured Malaysian prayer zone. */
export async function savePrayerZone(zone: string): Promise<void> {
  await writeSetting(K_PRAYER_ZONE, zone.trim().toUpperCase());
  invalidateCache();
}

function parseTestMode(raw: string | null): AzanTestMode {
  if (!raw) return emptyAzanTestMode();
  try {
    const p = JSON.parse(raw);
    if (typeof p !== "object" || p === null) return emptyAzanTestMode();
    return {
      enabled: p.enabled === true,
      overrides: sanitizeOverrides(p.overrides ?? {}),
      expiresAt: typeof p.expiresAt === "number" ? p.expiresAt : null,
      updatedAt: typeof p.updatedAt === "string" ? p.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return emptyAzanTestMode();
  }
}

/** Read the stored test mode WITHOUT expiry side-effects (for the admin UI). */
export async function getAzanTestMode(): Promise<AzanTestMode> {
  return parseTestMode(await readSetting(K_TEST_MODE));
}

/**
 * Persist Prayer Time Test Mode. Overrides are sanitized (HH:MM) and are
 * ONLY ever written to their own Setting — the official JAKIM/PDF data in
 * K_PRAYER_TIMES is never touched (requirement 9).
 */
export async function saveAzanTestMode(mode: AzanTestMode): Promise<AzanTestMode> {
  const clean: AzanTestMode = {
    enabled: mode.enabled === true,
    overrides: sanitizeOverrides(mode.overrides ?? {}),
    expiresAt: typeof mode.expiresAt === "number" ? mode.expiresAt : null,
    updatedAt: new Date().toISOString(),
  };
  await writeSetting(K_TEST_MODE, JSON.stringify(clean));
  invalidateCache();
  return clean;
}

/** RESET TO OFFICIAL JAKIM TIMES — clears every override + disables. */
export async function resetAzanTestMode(): Promise<void> {
  await writeSetting(K_TEST_MODE, JSON.stringify(emptyAzanTestMode()));
  invalidateCache();
}

/** Effective overrides for schedule math, or null when test mode is off/expired. */
export async function getActiveOverrides(
  nowMs: number
): Promise<AzanTestMode["overrides"] | null> {
  const { testMode } = await getAzanState();
  return isTestModeActive(testMode, nowMs) ? testMode.overrides : null;
}

/**
 * Merge-save structured prayer times.
 * Merge (not replace) so a PDF month + an API year can coexist; rows for
 * the same date follow the most recent save.
 */
export async function savePrayerTimes(
  zone: string,
  source: PrayerTimeSource,
  days: Record<string, PrayerTimesData["days"][string]>
): Promise<PrayerTimesData> {
  const existing = parsePrayerTimes(await readSetting(K_PRAYER_TIMES));
  const merged: PrayerTimesData = {
    zone: zone.trim().toUpperCase(),
    source,
    updatedAt: new Date().toISOString(),
    days: { ...(existing?.days ?? {}), ...days },
  };
  await writeSetting(K_PRAYER_TIMES, JSON.stringify(merged));
  invalidateCache();
  return merged;
}
