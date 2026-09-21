import { NextResponse } from "next/server";
import { getAzanState } from "@/lib/azan-store";
import { computeNextPrayerFromTimes, msToMalaysiaDate } from "@/lib/azan";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/virtual-radio/prayer-times/today — PUBLIC.
//
// Lightweight snapshot for the homepage prayer-times card: today's Malaysia-
// local prayer times for the configured JAKIM zone + the next prayer (pure
// math over stored data, so the countdown works with the client's synced
// clock). Costs a few cached Setting reads — no Drive calls, no credentials.
// Exposes times and names only; safe for anonymous visitors.
export async function GET() {
  try {
    const azan = await getAzanState();
    const serverTime = Date.now();

    if (!azan.prayerZone || !azan.prayerTimes) {
      return NextResponse.json(
        { configured: false, serverTime },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const todayKey = msToMalaysiaDate(serverTime);
    const today = azan.prayerTimes.days[todayKey] ?? null;
    const next = computeNextPrayerFromTimes(serverTime, azan.prayerTimes);

    return NextResponse.json(
      {
        configured: true,
        serverTime,
        zone: azan.prayerZone,
        date: todayKey,
        source: azan.prayerTimes.source,
        // Times only (strings) — nothing sensitive exists in this data.
        today,
        next: next
          ? { prayer: next.prayer, startsAt: next.startsAt, timeLabel: next.timeLabel }
          : null,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error(
      "[PRAYER-TIMES-TODAY] error:",
      err instanceof Error ? err.message : err
    );
    // Fail soft: the card simply stays hidden.
    return NextResponse.json(
      { configured: false, serverTime: Date.now() },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
