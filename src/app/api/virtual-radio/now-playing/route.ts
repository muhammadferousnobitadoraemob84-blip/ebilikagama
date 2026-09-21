import { NextResponse } from "next/server";
import { getVirtualRadioState } from "@/lib/virtual-radio-store";
import { getAzanState } from "@/lib/azan-store";
import { getRadioPosition } from "@/lib/virtual-radio";
import { computeAzanSchedule } from "@/lib/azan";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/virtual-radio/now-playing — PUBLIC (like /api/virtual-radio/time).
//
// Lightweight now-playing snapshot for the homepage widget: the timeline
// position is pure math over the stored playlist, so this costs a few
// cached Setting reads — no Drive calls, no credentials, no audio bytes.
// Only file names + durations are exposed (no Drive file IDs), so the
// payload is safe for anonymous visitors.
//
// The client recomputes the position each second using the shared
// getRadioPosition() math and its synced clock; it refetches periodically.
export async function GET() {
  try {
    const state = await getVirtualRadioState();
    const serverTime = Date.now();

    if (!state.enabled || state.tracks.length === 0 || !state.epoch) {
      return NextResponse.json(
        { enabled: false, trackCount: state.tracks.length, serverTime },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // Azan interruption info (metadata only: prayer + filename + times).
    // During an azan the widget shows the azan instead of the playlist track.
    const azanStore = await getAzanState();
    const azan = computeAzanSchedule(serverTime, azanStore.prayerTimes, azanStore.assignments, azanStore.files);

    const pos = getRadioPosition(state, serverTime);
    const current = pos ? state.tracks[pos.index] : null;
    const next =
      pos && state.tracks.length > 1
        ? state.tracks[(pos.index + 1) % state.tracks.length]
        : null;

    return NextResponse.json(
      {
        enabled: true,
        epoch: state.epoch,
        totalDuration: state.totalDuration,
        trackCount: state.tracks.length,
        serverTime,
        // Metadata only — names + durations (no Drive IDs, no sizes).
        tracks: state.tracks.map((t) => ({
          fileName: t.fileName,
          duration: t.duration,
        })),
        position: pos && current
          ? {
              index: pos.index,
              offset: pos.offset,
              cyclePosition: pos.cyclePosition,
              cycle: pos.cycle,
              fileName: current.fileName,
              duration: current.duration,
              next: next ? next.fileName : null,
            }
          : null,
        azan: {
          active: azan.active
            ? {
                prayer: azan.active.prayer,
                fileName: azan.active.fileName,
                offset: azan.active.offset,
                duration: azan.active.duration,
                endsAt: azan.active.endsAt,
              }
            : null,
          next: azan.next ? { prayer: azan.next.prayer, startsAt: azan.next.startsAt } : null,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error(
      "[VR-NOWPLAYING] error:",
      err instanceof Error ? err.message : err
    );
    // Fail soft: the widget simply stays hidden.
    return NextResponse.json(
      { enabled: false, serverTime: Date.now() },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
