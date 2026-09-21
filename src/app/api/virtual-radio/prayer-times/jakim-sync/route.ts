import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { savePrayerTimes, savePrayerZone } from "@/lib/azan-store";
import {
  JAKIM_ESOLAT_API,
  JAKIM_ZONES,
  jakimRowsToDays,
  type JakimApiRow,
} from "@/lib/azan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/virtual-radio/prayer-times/jakim-sync — ADMIN. { zone: "SBH05" }
//
// Uses the OFFICIAL JAKIM e-solat API (e-solat.gov.my takwimsolat endpoint —
// public, no key). period=year returns a full year of daily times for the
// zone in one request. The zone is validated against the LIVE API before
// anything is saved, so an invalid/retired code can never corrupt data.
//
// Field mapping (JAKIM → app): fajr→subuh, dhuhr→zohor, asr→asar, isha→isyak.
// Times are Malaysia local (UTC+8); the scheduler converts to UTC per date.

export async function POST(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await request.json().catch(() => null);
    const zone = (body as { zone?: string } | null)?.zone?.trim().toUpperCase();
    if (!zone || !/^[A-Z]{3}\d{2}$/.test(zone)) {
      return NextResponse.json({ error: "Provide a valid zone code (e.g. SBH05)" }, { status: 400 });
    }

    const url = `${JAKIM_ESOLAT_API}?r=esolatApi/takwimsolat&period=year&zone=${encodeURIComponent(zone)}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(25_000),
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `JAKIM e-solat API returned HTTP ${res.status}` },
        { status: 502 }
      );
    }

    const data = (await res.json()) as { prayerTime?: JakimApiRow[] | { data?: string[] }; status?: string | string[] };
    const rows = Array.isArray(data.prayerTime) ? data.prayerTime : null;

    if (!rows || rows.length === 0 || (data.status && String(data.status).includes("NO_RECORD"))) {
      const known = JAKIM_ZONES.some((z) => z.code === zone);
      return NextResponse.json(
        {
          error: known
            ? `JAKIM returned no records for zone ${zone} — the code may be retired; pick another zone.`
            : `Zone ${zone} is not recognized by the JAKIM e-solat API. Pick a zone from the list.`,
        },
        { status: 422 }
      );
    }

    const { days, skipped } = jakimRowsToDays(rows);
    if (Object.keys(days).length === 0) {
      return NextResponse.json(
        { error: "JAKIM returned rows but none could be parsed into prayer times" },
        { status: 502 }
      );
    }

    const saved = await savePrayerTimes(zone, "jakim_api", days);
    await savePrayerZone(zone);

    const keys = Object.keys(saved.days).sort();
    return NextResponse.json({
      success: true,
      zone,
      source: "jakim_api",
      dayCount: Object.keys(saved.days).length,
      rowsReceived: rows.length,
      rowsSkipped: skipped,
      from: keys[0],
      to: keys[keys.length - 1],
      totalDaysStored: Object.keys(saved.days).length,
      updatedAt: saved.updatedAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "JAKIM sync failed";
    console.error("[JAKIM-SYNC] error:", msg);
    const timedOut = msg.includes("aborted") || msg.includes("timeout");
    return NextResponse.json(
      { error: timedOut ? "JAKIM e-solat API did not respond in time — try again." : msg },
      { status: 502 }
    );
  }
}
