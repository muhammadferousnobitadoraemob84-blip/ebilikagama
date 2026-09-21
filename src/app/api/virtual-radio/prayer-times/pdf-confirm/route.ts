import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { savePrayerTimes, savePrayerZone } from "@/lib/azan-store";
import type { PrayerDay } from "@/lib/azan";
/** Validate a possibly-edited review-table value "HH:MM" → normalized. */
function validHHMM(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${m[2]}`;
}

export const dynamic = "force-dynamic";

// POST /api/virtual-radio/prayer-times/pdf-confirm — ADMIN.
// STEP 2 of the PDF import: save the rows the admin reviewed (and fixed)
// in the preview table. Body: { zone, year, month, rows: [{day, times...}] }.
// Rows are re-validated server-side before storage; invalid rows are
// rejected individually rather than silently saved.
export async function POST(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const zone = String((body as Record<string, unknown>).zone ?? "").trim().toUpperCase();
    const year = Number((body as Record<string, unknown>).year);
    const month = Number((body as Record<string, unknown>).month);
    const rows = (body as Record<string, unknown>).rows;

    if (!/^[A-Z]{3}\d{2}$/.test(zone)) {
      return NextResponse.json({ error: "Provide a valid zone code (e.g. SBH05)" }, { status: 400 });
    }
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ error: "Provide a valid year" }, { status: 400 });
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: "Provide a valid month" }, { status: 400 });
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "No rows to save" }, { status: 400 });
    }

    const days: Record<string, PrayerDay> = {};
    const rejected: { day: number; reason: string }[] = [];

    for (const row of rows as Record<string, unknown>[]) {
      const day = Number(row.day);
      if (!Number.isInteger(day) || day < 1 || day > 31) {
        rejected.push({ day, reason: "invalid day" });
        continue;
      }
      // Days must exist in the chosen month.
      const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
      if (day > daysInMonth) {
        rejected.push({ day, reason: `day ${day} does not exist in month ${month}` });
        continue;
      }
      const subuh = validHHMM(row.subuh);
      const syuruk = validHHMM(row.syuruk);
      const zohor = validHHMM(row.zohor);
      const asar = validHHMM(row.asar);
      const maghrib = validHHMM(row.maghrib);
      const isyak = validHHMM(row.isyak);
      const imsak = row.imsak == null ? null : validHHMM(row.imsak);
      if (!subuh || !syuruk || !zohor || !asar || !maghrib || !isyak) {
        rejected.push({ day, reason: "missing/invalid required times" });
        continue;
      }
      const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      days[key] = { imsak, subuh, syuruk, zohor, asar, maghrib, isyak };
    }

    if (Object.keys(days).length === 0) {
      return NextResponse.json(
        { error: "All rows were invalid — nothing was saved", rejected },
        { status: 422 }
      );
    }

    const saved = await savePrayerTimes(zone, "pdf", days);
    await savePrayerZone(zone);

    return NextResponse.json({
      success: true,
      zone,
      source: "pdf",
      savedDays: Object.keys(days).length,
      rejected,
      totalDaysStored: Object.keys(saved.days).length,
      updatedAt: saved.updatedAt,
    });
  } catch (err) {
    console.error("[PDF-CONFIRM] error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to save prayer times" }, { status: 500 });
  }
}
