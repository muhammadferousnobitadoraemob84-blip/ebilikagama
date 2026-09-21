import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { getAzanState } from "@/lib/azan-store";
import { computeAzanSchedule, msToMalaysiaDate } from "@/lib/azan";

export const dynamic = "force-dynamic";

// GET /api/virtual-radio/azan — ADMIN.
// One snapshot for the admin page: azan files, role assignments, prayer-time
// source/zone, and the live schedule computed from the synchronized server
// clock (next prayer + active azan, if any). No Drive calls, no secrets.
export async function GET() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const azan = await getAzanState();
    const serverTime = Date.now();
    const schedule = computeAzanSchedule(
      serverTime,
      azan.prayerTimes,
      azan.assignments,
      azan.files
    );

    return NextResponse.json(
      {
        serverTime,
        files: azan.files,
        assignments: azan.assignments,
        prayerZone: azan.prayerZone,
        prayerTimes: azan.prayerTimes
          ? {
              zone: azan.prayerTimes.zone,
              source: azan.prayerTimes.source,
              updatedAt: azan.prayerTimes.updatedAt,
              dayCount: Object.keys(azan.prayerTimes.days).length,
              today: azan.prayerTimes.days[msToMalaysiaDate(serverTime)] ?? null,
            }
          : null,
        schedule,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[AZAN-GET] error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to load azan state" }, { status: 500 });
  }
}
