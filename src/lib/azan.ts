// Azan & Prayer Times — shared, PURE logic (no I/O, safe client+server).
//
// Design principles (mirrors the virtual radio):
//   - Google Drive stays the ONLY home of audio bytes; here we handle
//     lightweight metadata only (Drive IDs, filenames, durations).
//   - The azan schedule is computed from PRAYER-TIME DATA + the synchronized
//     server clock — no stored cursor, no browser needed to "run" it.
//     If a visitor opens the site mid-azan, the math says so.
//   - Malaysia has no DST: MYT = UTC+8 fixed.

// ─── Types ──────────────────────────────────────────────────────────

export type AzanPrayer = "subuh" | "zohor" | "asar" | "maghrib" | "isyak";

export const AZAN_PRAYERS: AzanPrayer[] = ["subuh", "zohor", "asar", "maghrib", "isyak"];

/** One discovered Azan audio file (metadata only — audio stays in Drive). */
export interface AzanFile {
  /** Google Drive file ID — the stable identity (dedupe key). */
  driveId: string;
  fileName: string;
  mimeType: string;
  size: number | null;
  /** seconds; 0 = unknown (needs duration verification before scheduling) */
  duration: number;
  /** duration detection failed but file is playable — verify in browser */
  durationPending: boolean;
  /** file no longer exists in the scanned folder (kept for history) */
  unavailable: boolean;
  addedAt: string; // ISO
  lastSeenAt: string | null; // ISO
}

export type AzanAssignments = Record<AzanPrayer, string | null>;

export const EMPTY_AZAN_ASSIGNMENTS: AzanAssignments = {
  subuh: null,
  zohor: null,
  asar: null,
  maghrib: null,
  isyak: null,
};

/** One day of prayer times ("HH:MM" strings, Malaysia local time). */
export interface PrayerDay {
  imsak: string | null;
  subuh: string;
  syuruk: string;
  zohor: string;
  asar: string;
  maghrib: string;
  isyak: string;
}

export type PrayerTimeSource = "pdf" | "jakim_api";

/**
 * ADMIN-ONLY test overrides: temporary "HH:MM" replacements for a prayer's
 * official time, used by Prayer Time Test Mode. They NEVER touch the stored
 * official JAKIM/PDF data — they are applied only inside schedule
 * computation, and they expire (see AzanTestMode.expiresAt).
 */
export type PrayerTimeOverrides = Partial<Record<AzanPrayer, string>>;

/** Stored shape of Prayer Time Test Mode (a separate Setting — never merged into PrayerTimesData). */
export interface AzanTestMode {
  enabled: boolean;
  overrides: PrayerTimeOverrides;
  /** unix ms — after this the scheduler ignores (and the store clears) the overrides */
  expiresAt: number | null;
  updatedAt: string; // ISO
}

export function emptyAzanTestMode(): AzanTestMode {
  return { enabled: false, overrides: {}, expiresAt: null, updatedAt: new Date(0).toISOString() };
}

/** Test overrides are valid only while enabled and unexpired. */
export function isTestModeActive(mode: AzanTestMode | null, nowMs: number): mode is AzanTestMode {
  if (!mode || !mode.enabled) return false;
  if (mode.expiresAt != null && nowMs >= mode.expiresAt) return false;
  return Object.values(mode.overrides).some((v) => typeof v === "string" && validHHMM(v));
}

/** Replace invalid entries with null so callers can filter cleanly. */
export function sanitizeOverrides(overrides: PrayerTimeOverrides): PrayerTimeOverrides {
  const out: PrayerTimeOverrides = {};
  for (const prayer of AZAN_PRAYERS) {
    const v = overrides?.[prayer];
    if (typeof v === "string") {
      const clean = validHHMM(v);
      if (clean) out[prayer] = clean;
    }
  }
  return out;
}

/** Structured prayer-time data — dates keyed "YYYY-MM-DD" (Malaysia local). */
export interface PrayerTimesData {
  zone: string;
  source: PrayerTimeSource;
  updatedAt: string; // ISO
  days: Record<string, PrayerDay>;
}

// ─── Azan filename rule ─────────────────────────────────────────────
//
// ONLY files whose filename STARTS with "Azan" (after trimming, case-
// insensitive) are azan files. "Nasheed Azan.mp3" does NOT qualify; it
// merely CONTAINS the word. "Azan Subuh.mp3" and "azan.mp3" both do.

export function isAzanFileName(fileName: string): boolean {
  return fileName.trim().toLowerCase().startsWith("azan");
}

// ─── Malaysia (MYT, UTC+8) date helpers ─────────────────────────────

/** Unix ms → "YYYY-MM-DD" in Malaysia local time. */
export function msToMalaysiaDate(ms: number): string {
  const d = new Date(ms + 8 * 3600_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;
}

/** Shift a "YYYY-MM-DD" string by whole days. */
export function shiftMalaysiaDate(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + deltaDays * 86_400_000;
  const nd = new Date(t);
  return `${nd.getUTCFullYear()}-${String(nd.getUTCMonth() + 1).padStart(2, "0")}-${String(
    nd.getUTCDate()
  ).padStart(2, "0")}`;
}

/**
 * "YYYY-MM-DD" + "HH:MM" (Malaysia local) → unix ms (UTC).
 * Date.UTC handles hh-8 < 0 by rolling to the previous day — correct by
 * construction (a 04:50 MYT Subuh is 20:50 UTC the previous day).
 */
export function prayerTimeToMs(dateStr: string, hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  const [y, mo, d] = dateStr.split("-").map(Number);
  if (!m || !y || !mo || !d) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return Date.UTC(y, mo - 1, d, hh - 8, mm, 0, 0);
}

// ─── Schedule computation (pure math over stored data) ──────────────

export interface ActiveAzanEvent {
  prayer: AzanPrayer;
  driveId: string;
  fileName: string;
  /** unix ms — when the azan window started (prayer time) */
  startedAt: number;
  /** unix ms — when the azan audio is expected to end */
  endsAt: number;
  /** seconds into the azan audio right now */
  offset: number;
  duration: number;
}

export interface NextAzanEvent {
  prayer: AzanPrayer;
  driveId: string;
  fileName: string;
  /** unix ms — when the azan will start */
  startsAt: number;
}

export interface AzanSchedule {
  active: ActiveAzanEvent | null;
  next: NextAzanEvent | null;
}

export function emptyAzanSchedule(): AzanSchedule {
  return { active: null, next: null };
}

interface ScheduleEvent {
  prayer: AzanPrayer;
  driveId: string;
  fileName: string;
  startMs: number;
  durationSec: number;
}

/**
 * Enumerate azan events around `nowMs` (yesterday/today/tomorrow in Malaysia
 * time) that have both a prayer time AND an assigned, available azan file
 * with a known duration. Windows are < 1h, so ±1 day is plenty.
 */
function buildEvents(
  nowMs: number,
  times: PrayerTimesData | null,
  assignments: AzanAssignments | null,
  files: AzanFile[],
  /** test-mode "HH:MM" replacements — pure input; official data untouched */
  overrides?: PrayerTimeOverrides | null
): ScheduleEvent[] {
  if (!times || !assignments) return [];
  const usable = new Map(files.filter((f) => !f.unavailable && f.duration > 0).map((f) => [f.driveId, f]));

  const today = msToMalaysiaDate(nowMs);
  const events: ScheduleEvent[] = [];
  for (let delta = -1; delta <= 1; delta++) {
    const dateStr = shiftMalaysiaDate(today, delta);
    const day = times.days[dateStr];
    if (!day) continue;
    for (const prayer of AZAN_PRAYERS) {
      const assignedId = assignments[prayer];
      if (!assignedId) continue;
      const file = usable.get(assignedId);
      if (!file) continue;
      const hhmm = overrides?.[prayer] ?? day[prayer];
      if (!hhmm) continue;
      const startMs = prayerTimeToMs(dateStr, hhmm);
      if (startMs == null) continue;
      events.push({
        prayer,
        driveId: file.driveId,
        fileName: file.fileName,
        startMs,
        durationSec: file.duration,
      });
    }
  }
  return events;
}

/**
 * The azan schedule AT server time `nowMs`.
 * active → an azan whose [start, start+duration) window contains now
 *          (latest start wins on the impossible-overlap edge).
 * next   → the earliest future event (today or tomorrow).
 *
 * Pure function: identical result for every caller at the same instant,
 * which is exactly what lets late joiners recognize a live azan.
 */
export function computeAzanSchedule(
  nowMs: number,
  times: PrayerTimesData | null,
  assignments: AzanAssignments | null,
  files: AzanFile[],
  /** test-mode overrides — pass null for the official schedule */
  overrides?: PrayerTimeOverrides | null
): AzanSchedule {
  const events = buildEvents(nowMs, times, assignments, files, overrides ?? null);
  if (events.length === 0) return emptyAzanSchedule();

  let active: ActiveAzanEvent | null = null;
  let next: NextAzanEvent | null = null;

  for (const ev of events) {
    const endsAt = ev.startMs + ev.durationSec * 1000;
    if (nowMs >= ev.startMs && nowMs < endsAt) {
      if (!active || ev.startMs > active.startedAt) {
        active = {
          prayer: ev.prayer,
          driveId: ev.driveId,
          fileName: ev.fileName,
          startedAt: ev.startMs,
          endsAt,
          offset: Math.floor((nowMs - ev.startMs) / 1000),
          duration: ev.durationSec,
        };
      }
    } else if (ev.startMs > nowMs) {
      if (!next || ev.startMs < next.startsAt) {
        next = {
          prayer: ev.prayer,
          driveId: ev.driveId,
          fileName: ev.fileName,
          startsAt: ev.startMs,
        };
      }
    }
  }

  return { active, next };
}

// ─── Official JAKIM e-solat zones ────────────────────────────────────
//
// The zone list used to be a hard-coded array here; it drifted out of date
// (stopped at SBH08, used retired NGS/PGD/TRG codes, wrong descriptions).
// The authoritative, always-current directory now comes from the official
// e-solat.gov.my zone selector — see src/lib/jakim-zones.ts and the
// /api/virtual-radio/prayer-times/zones admin route.

/** Official JAKIM e-solat API endpoint (public, no key required). */
export const JAKIM_ESOLAT_API = "https://www.e-solat.gov.my/index.php";

export interface JakimApiRow {
  date: string; // "DD-Mon-YYYY"
  imsak: string;
  fajr: string;
  syuruk: string;
  dhuhr: string;
  asr: string;
  maghrib: string;
  isha: string;
}

/** Map a JAKIM API time string "HH:MM:SS" → "HH:MM". */
export function normalizeJakimTime(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(v.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${m[2]}`;
}

const MONTHS_SHORT = [
  ["Jan"],
  ["Feb"],
  ["Mac", "Mar"],
  ["Apr"],
  ["Mei", "May"],
  ["Jun"],
  ["Jul"],
  ["Ogos", "Aug"],
  ["Sep"],
  ["Okt", "Oct"],
  ["Nov"],
  ["Dis", "Dec"],
];

/**
 * "20-Sep-2026" or "01-Ogos-2026" → "2026-09-20" / "2026-08-01"
 * (Malaysia-local date key). The JAKIM API mixes English and Malay month
 * abbreviations (Mac, Mei, Ogos, Okt, Dis), so both are accepted.
 */
export function jakimDateToKey(dateStr: string): string | null {
  const m = /^(\d{1,2})-([A-Za-z]{3,4})-(\d{4})$/.exec(dateStr.trim());
  if (!m) return null;
  const mo = MONTHS_SHORT.findIndex((names) =>
    names.some((n) => n.toLowerCase() === m[2].toLowerCase())
  );
  if (mo < 0) return null;
  return `${m[3]}-${String(mo + 1).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`;
}

/** Convert validated JAKIM API rows → stored PrayerDay map. */
export function jakimRowsToDays(rows: JakimApiRow[]): {
  days: Record<string, PrayerDay>;
  skipped: number;
} {
  const days: Record<string, PrayerDay> = {};
  let skipped = 0;
  for (const row of rows) {
    const key = jakimDateToKey(row.date);
    const subuh = normalizeJakimTime(row.fajr);
    const syuruk = normalizeJakimTime(row.syuruk);
    const zohor = normalizeJakimTime(row.dhuhr);
    const asar = normalizeJakimTime(row.asr);
    const maghrib = normalizeJakimTime(row.maghrib);
    const isyak = normalizeJakimTime(row.isha);
    if (!key || !subuh || !syuruk || !zohor || !asar || !maghrib || !isyak) {
      skipped++;
      continue;
    }
    days[key] = {
      imsak: normalizeJakimTime(row.imsak),
      subuh,
      syuruk,
      zohor,
      asar,
      maghrib,
      isyak,
    };
  }
  return { days, skipped };
}

// ─── JAKIM monthly PDF parsing (text-extraction based) ──────────────

const MONTH_NAME_MAP: Record<string, number> = {
  january: 1, januari: 1, jan: 1,
  february: 2, februari: 2, feb: 2,
  march: 3, mac: 3, mar: 3,
  april: 4, apr: 4,
  may: 5, mei: 5,
  june: 6, jun: 6,
  july: 7, julai: 7, jul: 7,
  august: 8, ogos: 8, aug: 8,
  september: 9, sep: 9,
  october: 10, oktober: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, disember: 12, dec: 12,
};

export interface PdfRowPreview {
  day: number;
  imsak: string | null;
  subuh: string | null;
  syuruk: string | null;
  zohor: string | null;
  asar: string | null;
  maghrib: string | null;
  isyak: string | null;
  confidence: "high" | "medium" | "low";
  issues: string[];
}

export interface PdfParseResult {
  detectedYear: number | null;
  detectedMonth: number | null;
  rows: PdfRowPreview[];
  warnings: string[];
}

const HHMM = /\b(\d{1,2}):(\d{2})\b/g;

function validHHMM(s: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${m[2]}`;
}

/**
 * Extract a month's prayer-time rows from raw PDF text (pdf-parse output).
 * JAKIM monthly tables are "day + 7 HH:MM times" (imsak, subuh, syuruk,
 * zohor, asar, maghrib, isyak); some layouts omit imsak (6 times).
 * Anything unexpected is surfaced as a low-confidence row for review —
 * nothing is saved without explicit admin confirmation.
 */
export function parseJakimPdfText(text: string): PdfParseResult {
  const warnings: string[] = [];

  // Month/year detection (English + Malay month names).
  let detectedYear: number | null = null;
  let detectedMonth: number | null = null;
  const flat = text.replace(/\s+/g, " ");
  for (const m of flat.matchAll(/\b([A-Za-z]{3,10})\s+(20\d{2})\b/g)) {
    const mo = MONTH_NAME_MAP[m[1].toLowerCase()];
    if (mo) {
      detectedMonth = mo;
      detectedYear = Number(m[2]);
      break;
    }
  }
  if (detectedMonth == null) {
    for (const m of flat.matchAll(/\b(20\d{2})\s+([A-Za-z]{3,10})\b/g)) {
      const mo = MONTH_NAME_MAP[m[2].toLowerCase()];
      if (mo) {
        detectedMonth = mo;
        detectedYear = Number(m[1]);
        break;
      }
    }
  }
  if (detectedMonth == null) {
    warnings.push("Could not detect the month/year from the PDF header — confirm them below before saving.");
  }

  const rows: PdfRowPreview[] = [];
  const seenDays = new Set<number>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const dayMatch = /^(\d{1,2})(?:\s|$)/.exec(line);
    if (!dayMatch) continue;
    const day = Number(dayMatch[1]);
    if (day < 1 || day > 31 || seenDays.has(day)) continue;

    HHMM.lastIndex = 0;
    const times: string[] = [];
    for (const tm of line.matchAll(HHMM)) times.push(`${tm[1]}:${tm[2]}`);
    if (times.length < 6) continue; // not a prayer-time row

    seenDays.add(day);
    const issues: string[] = [];

    // Take the LAST up-to-8 time tokens (leading tokens may be a hijri date etc.)
    const tail = times.slice(-8);
    let conf: PdfRowPreview["confidence"] = "high";

    if (tail.length === 7) {
      const [imsak, subuh, syuruk, zohor, asar, maghrib, isyak] = tail.map(validHHMM);
      if (!subuh || !syuruk || !zohor || !asar || !maghrib || !isyak) {
        issues.push("one or more times are invalid");
        conf = "low";
      }
      rows.push({ day, imsak, subuh, syuruk, zohor, asar, maghrib, isyak, confidence: conf, issues });
    } else if (tail.length === 6) {
      // No imsak column.
      const [subuh, syuruk, zohor, asar, maghrib, isyak] = tail.map(validHHMM);
      if (!subuh || !syuruk || !zohor || !asar || !maghrib || !isyak) {
        issues.push("one or more times are invalid");
        conf = "low";
      } else {
        conf = "medium";
        issues.push("imsak column not found (leave blank or fill manually after save)");
      }
      rows.push({ day, imsak: null, subuh, syuruk, zohor, asar, maghrib, isyak, confidence: conf, issues });
    } else {
      issues.push(`unexpected column count (${tail.length} times) — row needs manual verification`);
      rows.push({
        day,
        imsak: null, subuh: null, syuruk: null, zohor: null,
        asar: null, maghrib: null, isyak: null,
        confidence: "low",
        issues,
      });
    }
  }

  rows.sort((a, b) => a.day - b.day);

  if (rows.length === 0) {
    warnings.push(
      "No day rows with 6–7 prayer times were found. The PDF may be a scanned image (no text layer) or an unexpected layout."
    );
  } else if (rows.length < 25) {
    warnings.push(`Only ${rows.length} day rows were recognized — check the review table carefully.`);
  }
  const lowCount = rows.filter((r) => r.confidence === "low").length;
  if (lowCount > 0) warnings.push(`${lowCount} row(s) have low parsing confidence — verify them before saving.`);

  return { detectedYear, detectedMonth, rows, warnings };
}

// ─── Public next-prayer computation (homepage card) ─────────────────

export interface NextPrayerInfo {
  prayer: AzanPrayer;
  /** unix ms of the next prayer time (today or tomorrow, Malaysia local) */
  startsAt: number;
  /** "HH:MM" Malaysia-local label for the next prayer */
  timeLabel: string;
}

/**
 * The NEXT prayer strictly after `nowMs` (active-azan windows don't matter
 * here — a countdown must count toward the upcoming prayer even mid-azan).
 * Scans today first, then tomorrow; returns null only when no prayer-time
 * data covers either day. Pure: identical for every caller at the same instant.
 */
export function computeNextPrayerFromTimes(
  nowMs: number,
  times: PrayerTimesData | null
): NextPrayerInfo | null {
  if (!times) return null;
  const today = msToMalaysiaDate(nowMs);
  for (const delta of [0, 1]) {
    const dateStr = shiftMalaysiaDate(today, delta);
    const day = times.days[dateStr];
    if (!day) continue;
    for (const prayer of AZAN_PRAYERS) {
      const hhmm = day[prayer];
      if (!hhmm) continue;
      const startMs = prayerTimeToMs(dateStr, hhmm);
      if (startMs == null || startMs <= nowMs) continue;
      return { prayer, startsAt: startMs, timeLabel: hhmm };
    }
  }
  return null;
}
