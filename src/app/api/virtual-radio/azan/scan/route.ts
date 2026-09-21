import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { getVirtualRadioState } from "@/lib/virtual-radio-store";
import { saveAzanScan } from "@/lib/azan-store";
import { getValidDriveToken } from "@/lib/google-drive";
import { listFolderFiles, checkFileAccessible } from "@/lib/drive-helpers";
import { probeAudioDuration } from "@/lib/audio-duration";
import { isAzanFileName } from "@/lib/azan";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/virtual-radio/azan/scan — ADMIN.
// Scan the ALREADY-CONFIGURED radio folder and discover Azan audio files:
//   - ONLY filenames starting with "Azan" (trimmed, case-insensitive) qualify
//   - every other file is IGNORED (counted, never treated as azan)
//   - durations probed from tiny ranged reads (no full downloads, no bytes stored)
//   - upsert by Drive file ID: rescans update, never duplicate; files that
//     disappeared are kept and marked unavailable
// Read-only against Drive (listing + ranged head reads).

const AUDIO_EXTENSIONS_BROAD = /\.(mp3|m4a|aac|ogg|wav|webm|flac|opus)$/i;

export async function POST() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const radio = await getVirtualRadioState();
    if (!radio.folderId) {
      return NextResponse.json(
        { error: "No folder configured. Select the radio library folder first (above)." },
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

    const allFiles = await listFolderFiles(token.accessToken, radio.folderId);
    const audioFiles = allFiles
      .filter((f) => f.mimeType !== "application/vnd.google-apps.folder")
      .filter((f) => f.mimeType?.startsWith("audio/") || AUDIO_EXTENSIONS_BROAD.test(f.name));

    const azanMatches = audioFiles.filter((f) => isAzanFileName(f.name));
    const ignoredMusic = audioFiles.length - azanMatches.length;
    const ignoredNonAudio = allFiles.length - audioFiles.length;

    // Bounded-concurrency duration probes (same pattern as the radio scan).
    const CONCURRENCY = 6;
    const results: {
      driveId: string;
      fileName: string;
      mimeType: string;
      size: number | null;
      duration: number;
      durationPending: boolean;
      error?: string;
    }[] = new Array(azanMatches.length);

    const accessToken = token.accessToken; // non-null: guarded above

    let cursor = 0;
    async function worker() {
      while (cursor < azanMatches.length) {
        const idx = cursor++;
        const file = azanMatches[idx];
        const base = {
          driveId: file.id,
          fileName: file.name,
          mimeType: file.mimeType || "audio/mpeg",
          size: file.size ? Number(file.size) : null,
          duration: 0,
          durationPending: false,
        };
        try {
          const meta = await probeAudioDuration(accessToken, {
            driveId: file.id,
            fileName: file.name,
            mimeType: file.mimeType,
            size: file.size ?? null,
          });
          if (meta?.duration && meta.duration > 0) {
            results[idx] = { ...base, duration: Math.round(meta.duration * 1000) / 1000 };
          } else {
            // Playable ≠ duration-known: keep the file, flag for verification.
            const access = await checkFileAccessible(accessToken, file.id);
            results[idx] = access.playable
              ? { ...base, durationPending: true }
              : { ...base, error: access.error || "File is not accessible for playback" };
          }
        } catch (err) {
          const access = await checkFileAccessible(accessToken, file.id);
          results[idx] = access.playable
            ? { ...base, durationPending: true }
            : {
                ...base,
                error: access.error || (err instanceof Error ? err.message : "Probe failed"),
              };
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, azanMatches.length || 1) }, worker));

    const ok = results.filter((r): r is NonNullable<typeof r> => !!r && !r.error);
    const failed = results.filter((r): r is NonNullable<typeof r> => !!r && !!r.error);

    // Upsert by Drive file ID (never duplicates; missing → unavailable).
    const saved = await saveAzanScan(ok);

    return NextResponse.json({
      success: true,
      totalFiles: allFiles.length,
      azanCount: ok.length,
      azanFiles: saved,
      ignoredMusic,
      ignoredNonAudio,
      errors: failed.map((f) => ({ fileName: f.fileName, error: f.error })),
      pendingCount: ok.filter((f) => f.durationPending).length,
    });
  } catch (err) {
    console.error("[AZAN-SCAN] error:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Azan scan failed" },
      { status: 500 }
    );
  }
}
