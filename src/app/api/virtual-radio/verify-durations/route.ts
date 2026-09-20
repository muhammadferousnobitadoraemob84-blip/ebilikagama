import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import {
  getVirtualRadioState,
  saveRadioPlaylist,
  saveRadioPending,
  ensureRadioEpoch,
} from "@/lib/virtual-radio-store";
import type { VirtualRadioPendingTrack, VirtualRadioTrack } from "@/lib/virtual-radio";

export const dynamic = "force-dynamic";

/**
 * POST /api/virtual-radio/verify-durations
 * Body: { durations: { [driveId: string]: number } }   (seconds)
 *
 * Browser-side HTML5 Audio metadata fallback completion. The admin page's
 * browser measures durations of pending tracks via the audio element's
 * loadedmetadata event (a few KB of metadata — never the full file), then
 * posts the results here. Verified tracks are promoted into the
 * synchronized playlist (appended in natural order relative to the existing
 * timeline — the epoch is NOT moved, so current listeners never desync);
 * anything still unverified stays pending.
 *
 * Validation: only IDs currently in the pending list are accepted, durations
 * must be finite and in a sane range (1s–24h).
 */
export async function POST(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await request.json().catch(() => null);
    const durations = body?.durations as Record<string, unknown> | undefined;
    if (!durations || typeof durations !== "object") {
      return NextResponse.json({ error: "Missing durations object" }, { status: 400 });
    }

    const state = await getVirtualRadioState();
    if (!state.pending || state.pending.length === 0) {
      return NextResponse.json({ error: "No pending tracks to verify" }, { status: 400 });
    }

    const byId = new Map(state.pending.map((p) => [p.driveId, p]));
    const promoted: VirtualRadioTrack[] = [];
    const stillPending: VirtualRadioPendingTrack[] = [];
    const rejected: { fileName: string; reason: string }[] = [];

    for (const p of state.pending) {
      const raw = durations[p.driveId];
      const dur = typeof raw === "number" ? raw : Number(raw);
      const valid =
        Number.isFinite(dur) && dur >= 1 && dur <= 24 * 3600 && !isProxyErrorDuration(dur);

      if (valid) {
        promoted.push({
          driveId: p.driveId,
          fileName: p.fileName,
          duration: Math.round(dur * 1000) / 1000,
          size: p.size,
          mimeType: p.mimeType,
        });
      } else if (raw === undefined || raw === null) {
        stillPending.push(p); // not attempted this round — stays pending
      } else {
        rejected.push({
          fileName: p.fileName,
          reason:
            typeof raw === "number" && (Number.isNaN(raw) || raw === Infinity)
              ? "Browser reported NaN/Infinity duration (metadata never loaded)"
              : `Measured value out of range (${String(raw)})`,
        });
        stillPending.push(p);
      }
    }

    if (promoted.length > 0) {
      // Merge into the timeline playlist, preserving natural filename order.
      const merged = [...state.tracks, ...promoted].sort((a, b) =>
        a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: "base" })
      );
      await saveRadioPlaylist(merged);
      await ensureRadioEpoch(); // creates only if missing — never moves it
    }
    await saveRadioPending(stillPending);

    return NextResponse.json({
      success: true,
      promoted: promoted.map((t) => ({ fileName: t.fileName, duration: t.duration })),
      stillPending: stillPending.map((t) => t.fileName),
      rejected,
      playlistCount: state.tracks.length + promoted.length,
      totalDuration:
        state.tracks.reduce((s, t) => s + t.duration, 0) +
        promoted.reduce((s, t) => s + t.duration, 0),
    });
  } catch (err) {
    console.error(
      "[VR-VERIFY] error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Verification failed" },
      { status: 500 }
    );
  }
}

/** A proxy that serves an HTML error page can yield bogus tiny durations. */
function isProxyErrorDuration(d: number): boolean {
  return d <= 0 || !Number.isFinite(d);
}
