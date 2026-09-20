import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { getVirtualRadioState } from "@/lib/virtual-radio-store";
import { getRadioPosition } from "@/lib/virtual-radio";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET — admin-only diagnostic: server-side view of the radio timeline.
// The admin page compares THIS (server-computed) against the client's
// own calculation from the synced clock — if both agree, sync works.
export async function GET() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const state = await getVirtualRadioState();
  const serverNow = Date.now();
  const position = getRadioPosition(state, serverNow);

  return NextResponse.json(
    {
      serverTime: serverNow,
      serverTimeIso: new Date(serverNow).toISOString(),
      epoch: state.epoch,
      enabled: state.enabled,
      totalDuration: state.totalDuration,
      trackCount: state.tracks.length,
      position: position
        ? {
            index: position.index,
            cycle: position.cycle,
            offset: position.offset,
            cyclePosition: position.cyclePosition,
            fileName: state.tracks[position.index]?.fileName ?? null,
          }
        : null,
    },
    { headers: { "Cache-Control": "no-store, must-revalidate" } }
  );
}
