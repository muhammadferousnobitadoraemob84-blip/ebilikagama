import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import {
  getVirtualRadioState,
  saveRadioPlaylist,
  saveRadioPending,
  ensureRadioEpoch,
} from "@/lib/virtual-radio-store";
import { probeAudioDuration } from "@/lib/audio-duration";
import { getValidDriveToken } from "@/lib/google-drive";
import type { VirtualRadioPendingTrack } from "@/lib/virtual-radio";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST — Scan the configured Drive folder and build the deterministic playlist.
//
// For every audio file: probe its duration from a small ranged read of the
// file head (Xing/CBR/M4A parsing — no full downloads, no bytes stored).
// Order is deterministic: natural-sort by filename (001.mp3 → 002.mp3 …),
// so every visitor computes the identical timeline.
//
// The epoch is created lazily on the FIRST successful scan and never moved
// afterwards, so rescans don't desync listeners.
const TIMELINE_SAFE_EXTENSIONS = /\.(mp3|m4a|aac)$/i;

// Same set, but for classification: anything the stream proxy can serve as
// audio (the browser decodes mp3/m4a natively; the others play but can't be
// timed server-side).
const AUDIO_EXTENSIONS_BROAD = /\.(mp3|m4a|aac|ogg|wav|webm|flac|opus)$/i;

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

async function listFolderFiles(accessToken: string, folderId: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false`,
      fields: "nextPageToken,files(id,name,mimeType,size)",
      orderBy: "name",
      pageSize: "1000",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      const reason = errText.match(/"reason"\s*:\s*"([^"]+)"/)?.[1] || `HTTP ${res.status}`;
      throw new Error(`Drive listing failed (${reason})`);
    }

    const data = await res.json();
    files.push(...(data.files || []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return files;
}

/**
 * Lightweight accessibility check: can the file actually be served as audio?
 * This is the "playable" leg of the playable-vs-duration distinction.
 * Reuses the same sources as the stream proxy (authed API → anonymous).
 */
async function checkFileAccessible(
  accessToken: string,
  driveId: string
): Promise<{ playable: boolean; error?: string }> {
  try {
    // Ranged read of the very first bytes through the authed API.
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}`, Range: "bytes=0-1023" } }
    );
    if (res.ok || res.status === 206) {
      const ct = (res.headers.get("Content-Type") || "").toLowerCase();
      if (ct.includes("text/html")) {
        return { playable: false, error: "Drive returned an HTML page instead of audio (permission/interstitial)" };
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength === 0) {
        return { playable: false, error: "File content is empty" };
      }
      return { playable: true };
    }
    if (res.status === 404) return { playable: false, error: "File not found on Drive (deleted or moved)" };
    if (res.status === 401 || res.status === 403) {
      return { playable: false, error: "Access denied by Drive (file permissions)" };
    }
    return { playable: false, error: `Drive returned HTTP ${res.status}` };
  } catch (err) {
    return { playable: false, error: `Network error reaching Drive: ${err instanceof Error ? err.message : "unknown"}` };
  }
}

export async function POST(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const state = await getVirtualRadioState();
    if (!state.folderId) {
      return NextResponse.json(
        { error: "No folder configured. Select the radio library folder first." },
        { status: 400 }
      );
    }

    const token = await getValidDriveToken();
    if (!token) {
      return NextResponse.json(
        { error: "Google Drive is not connected. Connect it first." },
        { status: 400 }
      );
    }

    const allFiles = await listFolderFiles(token.accessToken, state.folderId);

    // Audio classification: Drive audio MIME or a known audio extension.
    // Subfolders are intentionally NOT recursed: the radio library is flat.
    const audioFiles = allFiles
      .filter((f) => f.mimeType !== "application/vnd.google-apps.folder")
      .filter(
        (f) =>
          f.mimeType?.startsWith("audio/") || AUDIO_EXTENSIONS_BROAD.test(f.name)
      );

    const totalFiles = allFiles.length;
    const skipped = totalFiles - audioFiles.length;

    // Deterministic order: natural sort by filename.
    audioFiles.sort((a, b) => naturalCompare(a.name, b.name));

    const tracks: { driveId: string; fileName: string; duration: number; size: number | null; mimeType: string }[] = [];
    const pending: VirtualRadioPendingTrack[] = [];
    const errors: { fileName: string; error: string }[] = [];
    let noDuration = 0;

    // Bounded-concurrency probing (6 at a time): fast enough to finish large
    // folders inside the function timeout while staying gentle on Drive quota.
    // Results are collected per original index, then re-sorted deterministically.
    const accessToken = token.accessToken;
    const CONCURRENCY = 6;
    const results: (
      | { ok: true; track: { driveId: string; fileName: string; duration: number; size: number | null; mimeType: string } }
      | { ok: false; fileName: string; error: string }
      | { ok: false; pending: VirtualRadioPendingTrack }
    )[] = new Array(audioFiles.length);

    let cursor = 0;
    async function worker() {
      while (cursor < audioFiles.length) {
        const idx = cursor++;
        const file = audioFiles[idx];
        const base = {
          driveId: file.id,
          fileName: file.name,
          size: file.size ? Number(file.size) : null,
          mimeType: file.mimeType || "audio/mpeg",
        };
        try {
          const meta = await probeAudioDuration(accessToken, {
            driveId: file.id,
            fileName: file.name,
            mimeType: file.mimeType,
            size: file.size ?? null,
          });
          if (meta?.duration && meta.duration > 0) {
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
          } else {
            // Duration unknown ≠ unplayable. Verify the file is actually
            // reachable before filing it as duration-pending.
            const access = await checkFileAccessible(accessToken, file.id);
            if (access.playable) {
              results[idx] = {
                ok: false,
                pending: {
                  ...base,
                  reason:
                    meta?.detected && meta.detected !== "none"
                      ? `Timing header incomplete (${meta.detected}) — needs browser verification`
                      : "Duration could not be determined from file headers — needs browser verification",
                  addedAt: new Date().toISOString(),
                },
              };
            } else {
              results[idx] = {
                ok: false,
                fileName: file.name,
                error: access.error || "File is not accessible for playback",
              };
            }
          }
        } catch (err) {
          // A thrown probe error is NOT proof of unplayability either — check
          // accessibility before classifying as a hard failure.
          const access = await checkFileAccessible(accessToken, file.id);
          if (access.playable) {
            results[idx] = {
              ok: false,
              pending: {
                ...base,
                reason: `Duration probe failed (${err instanceof Error ? err.message : "unknown"}) — needs browser verification`,
                addedAt: new Date().toISOString(),
              },
            };
          } else {
            results[idx] = {
              ok: false,
              fileName: file.name,
              error: access.error || (err instanceof Error ? err.message : "Probe failed"),
            };
          }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, audioFiles.length) }, worker));

    // audioFiles is already natural-sorted; results[] preserves that order.
    for (const r of results) {
      if (!r) continue;
      if (r.ok) {
        tracks.push(r.track);
      } else if ("pending" in r) {
        pending.push(r.pending);
      } else {
        noDuration++;
        errors.push({ fileName: r.fileName, error: r.error });
      }
    }

    // Persist the pending list alongside the playlist.
    await saveRadioPending(pending);

    if (tracks.length === 0) {
      // Genuinely nothing playable-and-timed. Distinguish the cases clearly:
      const msg =
        pending.length > 0
          ? `No tracks with server-measurable durations were found. ${pending.length} accessible audio file(s) are pending browser duration verification — open the admin page to verify them.`
          : errors[0]?.error
            ? `No playable tracks found. First error: ${errors[0].fileName} — ${errors[0].error}`
            : "No MP3/M4A audio files with detectable durations were found in the folder.";
      return NextResponse.json(
        {
          error: msg,
          totalFiles,
          skipped,
          pendingCount: pending.length,
          pendingFiles: pending.map((p) => p.fileName).slice(0, 10),
        },
        { status: 422 }
      );
    }

    await saveRadioPlaylist(tracks);
    const epoch = await ensureRadioEpoch();

    const totalDuration = tracks.reduce((s, t) => s + t.duration, 0);

    return NextResponse.json({
      success: true,
      discovered: audioFiles.length,
      indexed: tracks.length,
      skipped,
      noDuration,
      pendingCount: pending.length,
      pendingFiles: pending.map((p) => p.fileName),
      errors: errors.slice(0, 10),
      totalDuration,
      epoch,
      lastScanAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error(
      "[VIRTUAL-RADIO-SCAN] error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Scan failed" },
      { status: 500 }
    );
  }
}
