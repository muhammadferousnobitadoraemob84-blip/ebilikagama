import { NextResponse } from "next/server";
import { getVirtualRadioState } from "@/lib/virtual-radio-store";
import { getAzanState } from "@/lib/azan-store";
import { computeAzanSchedule, isTestModeActive, type AzanPrayer } from "@/lib/azan";
import { getRadioPosition } from "@/lib/virtual-radio";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET — current virtual radio state for players.
// Authenticated-only (not in PUBLIC_PATHS): the radio page sits behind the
// sign-in gate, so its data endpoint does too.
//
// The response extends the radio state with the AZAN schedule computed from
// the synchronized SERVER clock: `azan.active` when the visitor opens the
// site mid-azan (they join the azan, then rejoin the radio timeline), and
// `azan.next` for the upcoming prayer. Pure math — no browser is needed to
// "run" the schedule.
export async function GET() {
  const state = await getVirtualRadioState();
  const azanStore = await getAzanState();
  const serverTime = Date.now();
  // Admin Prayer Time Test Mode: when active (and unexpired) the SCHEDULER
  // runs on the override times. Official JAKIM data is never modified.
  const testActive = isTestModeActive(azanStore.testMode, serverTime);
  const schedule = computeAzanSchedule(
    serverTime,
    azanStore.prayerTimes,
    azanStore.assignments,
    azanStore.files,
    testActive ? azanStore.testMode.overrides : null
  );

  // ── Per-azan segment countdown (client scheduler input) ────────────
  // The playlist loops every totalDuration seconds, so it passes the azan
  // timestamp once per cycle. Report the NEXT cycle boundary ≥ now: the
  // absolute instant the current loop's remaining music must end for the
  // azan to take over exactly. The client compares this against the synced
  // server clock (absolute time — never a fragile setTimeout chain).
  let segment: {
    boundaryAt: number;
    secondsRemaining: number;
    withinWindow: boolean;
    azan: { prayer: AzanPrayer; startsAt: number; endsAt: number } | null;
  } | null = null;
  if (state.enabled && state.epoch && state.totalDuration > 0) {
    const azanRef = schedule.active ?? schedule.next;
    const azanStart = azanRef ? (schedule.active ? schedule.active.startedAt : schedule.next!.startsAt) : null;
    const azanEnd = schedule.active ? schedule.active.endsAt : null;
    if (azanStart != null) {
      const elapsed = serverTime - state.epoch;
      const cycle = Math.floor(elapsed / (state.totalDuration * 1000));
      // Candidate boundary: the end of this loop cycle (or the next one if
      // already past). While an azan is ACTIVE the segment window is "now" —
      // the client is inside it and must join the azan, not wait a full loop.
      let boundaryAt = state.epoch + (cycle + 1) * state.totalDuration * 1000;
      const withinWindow = !!schedule.active;
      if (withinWindow) boundaryAt = serverTime;
      else if (boundaryAt <= serverTime) boundaryAt += state.totalDuration * 1000;
      // Skip boundaries that fall INSIDE an azan window (music must not be
      // scheduled over a live azan) — push to the following cycle.
      const azanWinStart = schedule.active ? schedule.active.startedAt : azanStart;
      const azanWinEnd = azanEnd ?? azanStart + 3600_000;
      let guard = 0;
      while (!withinWindow && boundaryAt > azanWinStart && boundaryAt < azanWinEnd + 3000 && guard++ < 8) {
        boundaryAt += state.totalDuration * 1000;
      }
      segment = {
        boundaryAt,
        secondsRemaining: Math.max(0, (boundaryAt - serverTime) / 1000),
        withinWindow,
        azan: azanRef
          ? {
              prayer: azanRef.prayer,
              startsAt: schedule.active ? schedule.active.startedAt : schedule.next!.startsAt,
              endsAt: azanEnd ?? (schedule.next!.startsAt + 3600_000),
            }
          : null,
      };
    }
  }

  return NextResponse.json(
    { ...state, serverTime, azan: schedule, segment },
    { headers: { "Cache-Control": "no-store, must-revalidate" } }
  );
}
