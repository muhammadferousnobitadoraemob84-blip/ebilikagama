import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import {
  getVirtualRadioState,
  saveRadioPlaylist,
  saveRadioPending,
  ensureRadioEpoch,
} from "@/lib/virtual-radio-store";
import { getAzanState } from "@/lib/azan-store";
import { computeAzanSchedule, isTestModeActive, type NextAzanEvent } from "@/lib/azan";
import { getValidDriveToken } from "@/lib/google-drive";
import { listFolderFiles, checkFileAccessible } from "@/lib/drive-helpers";
import { probeAudioDuration } from "@/lib/audio-duration";
import { arrangeFiller, EXACT_TOLERANCE_S } from "@/lib/radio-arrangement";
import type { VirtualRadioPendingTrack, VirtualRadioTrack } from "@/lib/virtual-radio";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/virtual-radio/arrange — ADMIN ("ARRANGE SONGS" button).
//
// One idempotent maintenance pass, read-only against Google Drive:
//   1. RESCAN the configured radio folder (detects newly added songs,
//      drops removed ones — upsert semantics, files are never copied).
//   2. DURATION REFRESH — re-probe real audio durations for every track
//      (new ones and previously undetected); nothing is faked.
//   3. REARRANGE the playlist so the music ends exactly at the next azan
//      timestamp (see radio-arrangement.ts). The currently-playing track
//      stays first at its current offset — listeners never hear a seek.
//   4. DIAGNOSTICS — the response reports the calculated deviation from
//      the azan boundary; the engine never silently claims a perfect fit.
//
// No audio binaries pass through here; Neon keeps only metadata.

const AUDIO_EXTENSIONS_BROAD = /\.(mp3|m4a|aac|ogg|wav|webm|flac|opus)$/i;

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export async function POST() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const before = await getVirtualRadioState();
    if (!before.folderId) {
      return NextResponse.json({ error: "No folder configured. Select the radio library folder first." }, { status: 400 });
    }
    const token = await getValidDriveToken();
    if (!token) {
      return NextResponse.json({ error: "Google Drive is not connected. Connect it first." }, { status: 400 });
    }
    const accessToken = token.accessToken;

    const serverTime0 = Date.now();
    const azanStore = await getAzanState();
    const testActive = isTestModeActive(azanStore.testMode, serverTime0);
    const schedule = computeAzanSchedule(
      serverTime0,
      azanStore.prayerTimes,
      azanStore.assignments,
      azanStore.files,
      testActive ? azanStore.testMode.overrides : null
    );
    const nextAzan: NextAzanEvent | null = schedule.next;

    // ── 1. RESCAN ────────────────────────────────────────────────────
    const allFiles = await listFolderFiles(token.accessToken, before.folderId);
    const audioFiles = allFiles
      .filter((f) => f.mimeType !== "application/vnd.google-apps.folder")
      .filter((f) => f.mimeType?.startsWith("audio/") || AUDIO_EXTENSIONS_BROAD.test(f.name));
    audioFiles.sort((a, b) => naturalCompare(a.name, b.name));

    const prevById = new Map(before.tracks.map((t) => [t.driveId, t]));
    const prevPendingById = new Map(before.pending.map((p) => [p.driveId, p]));
    const knownIds = new Set([...prevById.keys(), ...prevPendingById.keys()]);

    let newSongs = 0;
    const tracks: VirtualRadioTrack[] = [];
    const pending: VirtualRadioPendingTrack[] = [];

    // Bounded-concurrency probe (same pattern as the scan route).
    const CONCURRENCY = 6;
    type Probe =
      | { ok: true; track: VirtualRadioTrack }
      | { ok: false; pending: VirtualRadioPendingTrack };
    const results: Probe[] = new Array(audioFiles.length);
    let cursor = 0;
    async function worker() {
      while (cursor < audioFiles.length) {
        const idx = cursor++;
        const file = audioFiles[idx];
        try {
          const meta = await probeAudioDuration(accessToken, {
            driveId: file.id,
            fileName: file.name,
            mimeType: file.mimeType,
            size: file.size ?? null,
          });
          if (meta?.duration && meta.duration > 0) {
            const old = prevById.get(file.id);
            if (old && Math.abs(old.duration - meta.duration) < 0.75) {
              // Duration unchanged — keep as-is (cheap, stable).
              results[idx] = { ok: true, track: old };
            } else {
              results[idx] = {
                ok: true,
                track: {
                  driveId: file.id,
                  fileName: file.name,
                  duration: Math.round(meta.duration * 1000) / 1000,
                  size: file.size ? Number(file.size) : null,
                  mimeType: file.mimeType || "audio/mpeg",
                },
              };
            }
          } else {
            const access = await checkFileAccessible(accessToken, file.id);
            if (access.playable) {
              results[idx] = {
                ok: false,
                pending: {
                  driveId: file.id,
                  fileName: file.name,
                  size: file.size ? Number(file.size) : null,
                  mimeType: file.mimeType || "audio/mpeg",
                  reason: "Duration could not be determined from file headers — needs browser verification",
                  addedAt: prevPendingById.get(file.id)?.addedAt ?? new Date().toISOString(),
                },
              };
            } else {
              // Not accessible → exclude entirely (same rule as scan).
              results[idx] = {
                ok: false,
                pending: {
                  driveId: file.id,
                  fileName: file.name,
                  size: file.size ? Number(file.size) : null,
                  mimeType: file.mimeType || "audio/mpeg",
                  reason: `Not accessible: ${access.error ?? "unknown"}`,
                  addedAt: prevPendingById.get(file.id)?.addedAt ?? new Date().toISOString(),
                },
              };
            }
          }
        } catch (err) {
          results[idx] = {
            ok: false,
            pending: {
              driveId: file.id,
              fileName: file.name,
              size: file.size ? Number(file.size) : null,
              mimeType: file.mimeType || "audio/mpeg",
              reason: `Probe failed (${err instanceof Error ? err.message : "unknown"}) — needs browser verification`,
              addedAt: prevPendingById.get(file.id)?.addedAt ?? new Date().toISOString(),
            },
          };
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, audioFiles.length) }, worker));

    for (const r of results) {
      if (!r) continue;
      if (r.ok) {
        if (!knownIds.has(r.track.driveId)) newSongs++;
        tracks.push(r.track);
      } else {
        if (!knownIds.has(r.pending.driveId)) newSongs++;
        pending.push(r.pending);
      }
    }
    tracks.sort((a, b) => naturalCompare(a.fileName, b.fileName));

    // ── 3. REARRANGE against the next azan ───────────────────────────
    // The timeline is (now − epoch) mod total. Rebuilding the playlist
    // changes `total`, which would teleport listeners unless the epoch is
    // re-anchored. Anchor: keep the CURRENT track FIRST and choose the new
    // epoch so position(now) still lands on the same track/offset.
    const nowMs = Date.now();
    const arrangeInfo = {
      attempted: false,
      nextAzanAt: null as number | null,
      nextAzanPrayer: null as string | null,
      targetSeconds: null as number | null,
      scheduledSeconds: null as number | null,
      deviationSeconds: null as number | null,
      exact: false,
      strategy: null as string | null,
      tracksAfterCurrent: 0,
    };

    let finalOrder: VirtualRadioTrack[] = tracks;

    if (!nextAzan || tracks.length === 0 || !before.epoch) {
      // No azan to fit (or nothing to schedule) — deterministic order only.
      await saveRadioPending(pending);
      if (tracks.length > 0) await saveRadioPlaylist(tracks);
    } else {
      // Current live position (pure math over the OLD playlist + epoch).
      const elapsed = (nowMs - before.epoch) / 1000;
      const oldTotal = before.totalDuration;
      const cyclePos = oldTotal > 0 ? ((elapsed % oldTotal) + oldTotal) % oldTotal : 0;
      let idx = 0;
      let offset = cyclePos;
      for (let i = 0; i < tracks.length; i++) {
        if (offset < tracks[i].duration) {
          idx = i;
          break;
        }
        offset -= tracks[i].duration;
        idx = i;
      }
      const currentTrack = tracks[idx] ?? tracks[0];
      const currentRemaining = Math.max(0, currentTrack.duration - offset);

      // Gap to fill with complete tracks AFTER the current one.
      const gapSeconds = (nextAzan.startsAt - nowMs) / 1000 - currentRemaining;
      arrangeInfo.attempted = true;
      arrangeInfo.nextAzanAt = nextAzan.startsAt;
      arrangeInfo.nextAzanPrayer = nextAzan.prayer;
      arrangeInfo.targetSeconds = Math.round(gapSeconds * 1000) / 1000;

      const pool = tracks
        .filter((t) => t.driveId !== currentTrack.driveId)
        .map((t) => ({ driveId: t.driveId, duration: t.duration }));

      const fit = arrangeFiller(pool, gapSeconds);
      arrangeInfo.scheduledSeconds = fit.scheduledSeconds;
      arrangeInfo.deviationSeconds = fit.deviationSeconds;
      arrangeInfo.exact = fit.exact;
      arrangeInfo.strategy = fit.strategy;

      const afterCurrent = fit.order
        .map((id) => pool.find((p) => p.driveId === id))
        .filter((t): t is { driveId: string; duration: number } => !!t)
        .map((t) => tracks.find((tr) => tr.driveId === t.driveId)!)
        .filter(Boolean);
      arrangeInfo.tracksAfterCurrent = afterCurrent.length;

      // New order: current track first, then the fitted fillers.
      const rest = tracks.filter((t) => t.driveId !== currentTrack.driveId && !fit.order.includes(t.driveId));
      finalOrder = [currentTrack, ...afterCurrent, ...rest];

      // Re-anchor the epoch: position(now) must equal cyclePosition 0 of the
      // new playlist (i.e. the current track at its current offset), and the
      // scheduled tracks must end at nextAzan.startsAt.
      //   cycle position of "now" in the NEW playlist = currentRemaining... no:
      //   the new playlist STARTS with the current track, so the position of
      //   "now" is `offset` into track 0. epoch' = now − offset*1000. Then
      //   track 0 ends at now + currentRemaining, and fillers (total
      //   scheduledSeconds) end at now + currentRemaining + scheduled ≈ azan.
      const newEpoch = nowMs - offset * 1000;
      await saveRadioPending(pending);
      await saveRadioPlaylist(finalOrder);
      // Persist the re-anchor via the same mechanism the epoch uses (direct
      // write keeps `ensureRadioEpoch` semantics: it exists, never recreated).
      await writeEpoch(newEpoch);
    }

    const after = await getVirtualRadioState();
    return NextResponse.json({
      success: true,
      songsScanned: audioFiles.length,
      newSongs,
      tracksIndexed: after.tracks.length,
      durationsUpdated: true,
      pendingCount: after.pending.length,
      playlistRearranged: arrangeInfo.attempted,
      arrangement: arrangeInfo.exact
        ? {
            ...arrangeInfo,
            note: `Tracks end within ${EXACT_TOLERANCE_S}s of the azan boundary.`,
          }
        : arrangeInfo.deviationSeconds != null
          ? {
              ...arrangeInfo,
              note: `No exact fit with complete tracks — scheduled sequence ends ${Math.abs(
                Math.round(arrangeInfo.deviationSeconds)
              )}s ${
                (arrangeInfo.deviationSeconds ?? 0) > 0 ? "before" : "after"
              } the azan boundary (logged for diagnostics).`,
            }
          : null,
      azan: nextAzan ? { prayer: nextAzan.prayer, startsAt: nextAzan.startsAt } : null,
    });
  } catch (err) {
    console.error("[VR-ARRANGE] error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Arrange failed" }, { status: 500 });
  }
}

/** Epoch writer (the store only exposes ensure-once semantics). */
async function writeEpoch(epochMs: number): Promise<void> {
  const { prisma, withRetry } = await import("@/lib/prisma");
  await withRetry(() =>
    prisma.setting.upsert({
      where: { key: "virtual_radio_epoch" },
      update: { value: String(Math.round(epochMs)) },
      create: { key: "virtual_radio_epoch", value: String(Math.round(epochMs)) },
    })
  );
  // Bust both stores' 5s caches so listeners pick the new timeline instantly.
  const { invalidateVirtualRadioCache } = await import("@/lib/virtual-radio-store");
  invalidateVirtualRadioCache();
}
