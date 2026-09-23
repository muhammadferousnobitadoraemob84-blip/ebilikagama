// ─── Authoritative JAKIM e-Solat zone directory ───────────────────────
//
// The prayer-zone list is NOT hard-coded in this app. It is parsed from the
// OFFICIAL e-solat.gov.my zone selector (the same site that serves the
// takwimsolat prayer-time API): <optgroup label="State"> options shaped
// "CODE - official area description". When JAKIM adds or renames zones
// (e.g. SBH08/SBH09, TRG01–04, PRK01–07, WLY02 Labuan), the selector picks
// them up automatically — no source edits, no invented names.
//
// Caching: 10-minute in-memory TTL + a last-known-good snapshot persisted in
// the existing Setting table (JSON metadata only). If the live page is
// unreachable, the snapshot is served flagged `stale: true` so the dropdown
// never regresses to an incomplete list. `force` bypasses the TTL.

import { prisma, withRetry } from "@/lib/prisma";

export interface JakimZone {
  code: string;
  name: string;
}

export interface JakimZoneGroup {
  state: string;
  zones: JakimZone[];
}

export interface JakimZoneDirectory {
  groups: JakimZoneGroup[];
  total: number;
  fetchedAt: string; // ISO timestamp of the last successful live parse
  source: string; // human-readable provenance
  stale: boolean; // true = served from last-known-good snapshot
}

const ESOLAT_URL = "https://www.e-solat.gov.my/";
const K_ZONE_DIR = "jakim_zone_directory"; // Setting key — JSON snapshot
const MEM_TTL_MS = 10 * 60 * 1000;

let _mem: { at: number; dir: JakimZoneDirectory } | null = null;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** Parse the official e-solat zone <select> out of the page HTML. */
export function parseEsolatZoneDirectory(html: string): JakimZoneGroup[] {
  const groups: JakimZoneGroup[] = [];
  const groupRe = /<optgroup\s+label="([^"]*)">([\s\S]*?)<\/optgroup>/gi;
  const optionRe = /<option\s+value=['"]([A-Z]{3}\d{2})['"][^>]*>\s*[A-Z]{3}\d{2}\s*-\s*([^<]*?)\s*<\/option>/gi;

  let g: RegExpExecArray | null;
  while ((g = groupRe.exec(html))) {
    const state = decodeEntities(g[1]).trim();
    const zones: JakimZone[] = [];
    let o: RegExpExecArray | null;
    while ((o = optionRe.exec(g[2]))) {
      const name = decodeEntities(o[2]).replace(/\s+/g, " ").trim();
      if (name) zones.push({ code: o[1], name });
    }
    if (state && zones.length > 0) groups.push({ state, zones });
  }
  return groups;
}

async function readSnapshot(): Promise<JakimZoneDirectory | null> {
  try {
    const row = await withRetry(() =>
      prisma.setting.findUnique({ where: { key: K_ZONE_DIR }, select: { value: true } })
    );
    if (!row?.value) return null;
    const parsed = JSON.parse(row.value) as JakimZoneDirectory;
    if (!Array.isArray(parsed.groups) || parsed.groups.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeSnapshot(dir: JakimZoneDirectory): Promise<void> {
  try {
    const value = JSON.stringify(dir);
    await withRetry(() =>
      prisma.setting.upsert({
        where: { key: K_ZONE_DIR },
        update: { value },
        create: { key: K_ZONE_DIR, value },
      })
    );
  } catch {
    // Snapshot persistence is best-effort only.
  }
}

export async function getJakimZoneDirectory(
  opts?: { force?: boolean }
): Promise<JakimZoneDirectory> {
  if (!opts?.force && _mem && Date.now() - _mem.at < MEM_TTL_MS) return _mem.dir;

  try {
    const res = await fetch(ESOLAT_URL, {
      headers: {
        Accept: "text/html",
        "User-Agent": "Mozilla/5.0 (compatible; eBilikAgamaTV/1.0; zone directory)",
      },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`e-solat.gov.my returned HTTP ${res.status}`);
    const html = await res.text();
    const groups = parseEsolatZoneDirectory(html);
    if (groups.length === 0) throw new Error("e-solat page contained no zone options");

    const dir: JakimZoneDirectory = {
      groups,
      total: groups.reduce((n, g) => n + g.zones.length, 0),
      fetchedAt: new Date().toISOString(),
      source: "e-solat.gov.my official zone directory (live)",
      stale: false,
    };
    _mem = { at: Date.now(), dir };
    await writeSnapshot(dir);
    return dir;
  } catch (err) {
    const snap = await readSnapshot();
    if (snap) {
      const dir: JakimZoneDirectory = {
        ...snap,
        stale: true,
        source: "e-solat.gov.my official zone directory (last known good)",
      };
      _mem = { at: Date.now(), dir };
      return dir;
    }
    throw err;
  }
}

/** Look up one zone (code → official name + owning state). */
export function findJakimZone(
  dir: JakimZoneDirectory,
  code: string
): { zone: JakimZone; state: string } | null {
  for (const g of dir.groups) {
    const zone = g.zones.find((z) => z.code === code);
    if (zone) return { zone, state: g.state };
  }
  return null;
}
