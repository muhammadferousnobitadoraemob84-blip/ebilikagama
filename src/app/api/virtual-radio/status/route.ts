import { NextResponse } from "next/server";
import { getVirtualRadioState } from "@/lib/virtual-radio-store";
import { getAzanState } from "@/lib/azan-store";
import { computeAzanSchedule } from "@/lib/azan";

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
  const schedule = computeAzanSchedule(
    serverTime,
    azanStore.prayerTimes,
    azanStore.assignments,
    azanStore.files
  );

  return NextResponse.json(
    { ...state, serverTime, azan: schedule },
    { headers: { "Cache-Control": "no-store, must-revalidate" } }
  );
}
