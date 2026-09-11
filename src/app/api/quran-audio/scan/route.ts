import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { prisma, withRetry } from "@/lib/prisma";
import { getValidDriveToken } from "@/lib/google-drive";
import { parseQuranFilename } from "@/lib/quran-filename-parser";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // 2 minutes for scanning large folders

const AUDIO_EXTENSIONS = /\.(mp3|m4a|ogg|wav|webm|flac|aac)$/i;
const AUDIO_MIMES = [
  "audio/mpeg", "audio/mp3", "audio/mp4", "audio/m4a",
  "audio/x-m4a", "audio/ogg", "audio/wav", "audio/webm",
  "audio/flac", "audio/aac", "audio/x-flac",
];

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: string;
  modifiedTime: string;
}

interface ScanResult {
  fileName: string;
  googleDriveId: string;
  surahNumber: number | null;
  surahName: string | null;
  ayahNumber: number | null;
  audioType: "ayah" | "full_surah";
  status: "indexed" | "needs_review" | "duplicate" | "error";
  error?: string;
}

/**
 * Recursively list all files in a Google Drive folder (with depth limit)
 */
async function listFilesRecursive(
  accessToken: string,
  folderId: string,
  depth: number = 0
): Promise<DriveFile[]> {
  if (depth > 5) return []; // Prevent infinite recursion

  const files: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false`,
      fields: "nextPageToken,files(id,name,mimeType,size,modifiedTime)",
      orderBy: "name",
      pageSize: "1000",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("[QURAN-SCAN] Drive API error:", response.status, errText);
      throw new Error("Failed to list files from Google Drive");
    }

    const data = await response.json();

    for (const file of data.files || []) {
      if (file.mimeType === "application/vnd.google-apps.folder") {
        // Recurse into subfolder
        const subFiles = await listFilesRecursive(accessToken, file.id, depth + 1);
        files.push(...subFiles);
      } else {
        files.push(file);
      }
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return files;
}

/**
 * Check if a Drive file is an audio file
 */
function isAudioFile(file: DriveFile): boolean {
  if (AUDIO_MIMES.includes(file.mimeType)) return true;
  if (file.mimeType === "application/octet-stream" || file.mimeType === "application/binary") {
    return AUDIO_EXTENSIONS.test(file.name);
  }
  return AUDIO_EXTENSIONS.test(file.name);
}

// POST — Scan the selected Google Drive folder and index all audio files
export async function POST(request: NextRequest) {
  try {
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const reciterName = (body.reciterName as string)?.trim();

    if (!reciterName) {
      return NextResponse.json(
        { error: "Reciter name (Qari) is required" },
        { status: 400 }
      );
    }

    // Get Google Drive token
    const token = await getValidDriveToken();
    if (!token) {
      return NextResponse.json(
        { error: "Google Drive is not connected. Please connect it first." },
        { status: 400 }
      );
    }

    // Get the configured folder ID
    const folderRecord = await withRetry(() =>
      prisma.setting.findUnique({ where: { key: "quran_audio_folder_id" } })
    );
    const folderId = folderRecord?.value;
    if (!folderId) {
      return NextResponse.json(
        { error: "No Google Drive folder configured. Please select a folder first." },
        { status: 400 }
      );
    }

    // Save the reciter name to settings
    await withRetry(() =>
      prisma.setting.upsert({
        where: { key: "quran_audio_qari" },
        update: { value: reciterName },
        create: { key: "quran_audio_qari", value: reciterName },
      })
    );

    console.log(`[QURAN-SCAN] Scanning folder ${folderId} for reciter "${reciterName}"...`);

    // List all files recursively
    const allFiles = await listFilesRecursive(token.accessToken, folderId);
    console.log(`[QURAN-SCAN] Found ${allFiles.length} total files in folder`);

    // Filter to audio files only
    const audioFiles = allFiles.filter(isAudioFile);
    console.log(`[QURAN-SCAN] Found ${audioFiles.length} audio files`);

    // Get existing indexed entries for this reciter
    const existingEntries = await withRetry(() =>
      prisma.quranAudio.findMany({
        where: { reciterName },
        select: {
          id: true,
          googleDriveId: true,
          surahNumber: true,
          ayahNumber: true,
          surahName: true,
        },
      })
    );

    // Build map of existing entries by Google Drive file ID
    const existingByDriveId = new Map(existingEntries.map((e) => [e.googleDriveId, e]));
    // Build set of existing drive IDs
    const existingDriveIds = new Set(existingEntries.map((e) => e.googleDriveId));
    // Build set of current drive file IDs
    const currentDriveIds = new Set(audioFiles.map((f) => f.id));

    // Find files to delete (in DB but not in Drive)
    const toDelete = existingEntries.filter((e) => !currentDriveIds.has(e.googleDriveId));

    // Find files to add (in Drive but not in DB)
    const toAdd = audioFiles.filter((f) => !existingDriveIds.has(f.id));

    // Scan results
    const results: ScanResult[] = [];
    let indexedCount = 0;
    let needsReviewCount = 0;
    let duplicateCount = 0;
    let errorCount = 0;
    let deletedCount = toDelete.length;

    // Index new files
    for (const file of toAdd) {
      const parsed = parseQuranFilename(file.name);
      const result: ScanResult = {
        fileName: file.name,
        googleDriveId: file.id,
        surahNumber: parsed.surahNumber,
        surahName: parsed.surahName,
        ayahNumber: parsed.ayahNumber || 1,
        audioType: parsed.audioType,
        status: "indexed",
      };

      if (parsed.status === "needs_review") {
        result.status = "needs_review";
        result.error = "Could not detect surah from filename";
        needsReviewCount++;
      } else if (!parsed.surahNumber) {
        result.status = "needs_review";
        result.error = "No surah number detected";
        needsReviewCount++;
      } else {
        // Check for duplicate in DB (same surah + ayah + reciter)
        const duplicate = existingEntries.find(
          (e) => e.surahNumber === parsed.surahNumber && e.ayahNumber === (parsed.ayahNumber || 1)
        );
        if (duplicate) {
          result.status = "duplicate";
          result.error = `Duplicate of existing entry (Surah ${parsed.surahNumber}, Ayah ${parsed.ayahNumber || 1})`;
          duplicateCount++;
        } else {
          // Create the database record
          try {
            const fileNumSize = parseInt(file.size || "0", 10) || 0;
            await withRetry(() =>
              prisma.quranAudio.create({
                data: {
                  surahName: parsed.surahName || "Unknown",
                  surahNumber: parsed.surahNumber!,
                  ayahNumber: parsed.ayahNumber || 1,
                  audioType: parsed.audioType,
                  reciterName,
                  fileName: file.name,
                  fileSize: fileNumSize > 0 ? BigInt(fileNumSize) : null,
                  googleDriveId: file.id,
                  googleDriveUrl: `https://drive.google.com/file/d/${file.id}/preview`,
                  status: "active",
                  uploadedBy: session.userId,
                },
              })
            );
            indexedCount++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            if (msg.includes("Unique constraint")) {
              result.status = "duplicate";
              result.error = "Duplicate entry";
              duplicateCount++;
            } else {
              result.status = "error";
              result.error = msg;
              errorCount++;
            }
          }
        }
      }

      results.push(result);
    }

    // Delete records for files no longer in Drive
    for (const entry of toDelete) {
      try {
        await withRetry(() =>
          prisma.quranAudio.delete({ where: { id: entry.id } })
        );
      } catch (err) {
        console.error(`[QURAN-SCAN] Failed to delete entry ${entry.id}:`, err);
      }
    }

    // Update last scan timestamp
    const now = new Date().toISOString();
    await withRetry(() =>
      prisma.setting.upsert({
        where: { key: "quran_audio_last_sync" },
        update: { value: now },
        create: { key: "quran_audio_last_sync", value: now },
      })
    );

    // Get total count after scan
    const totalCount = await withRetry(() =>
      prisma.quranAudio.count({ where: { reciterName, status: "active" } })
    );

    console.log(
      `[QURAN-SCAN] Complete: ${indexedCount} indexed, ${needsReviewCount} needs review, ${duplicateCount} duplicates, ${deletedCount} deleted, ${errorCount} errors. Total: ${totalCount}`
    );

    return NextResponse.json({
      success: true,
      totalFiles: audioFiles.length,
      indexed: indexedCount,
      needsReview: needsReviewCount,
      duplicates: duplicateCount,
      deleted: deletedCount,
      errors: errorCount,
      totalInDatabase: totalCount,
      lastScan: now,
      results,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[QURAN-SCAN] Error:", msg);
    return NextResponse.json(
      { error: "Scan failed: " + msg },
      { status: 500 }
    );
  }
}

// GET — Get scan status and stats
export async function GET() {
  try {
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [lastSyncRecord, qariRecord, folderRecord] = await Promise.all([
      withRetry(() => prisma.setting.findUnique({ where: { key: "quran_audio_last_sync" } })),
      withRetry(() => prisma.setting.findUnique({ where: { key: "quran_audio_qari" } })),
      withRetry(() => prisma.setting.findUnique({ where: { key: "quran_audio_folder_id" } })),
    ]);

    const reciterName = qariRecord?.value || "";
    let totalCount = 0;
    let activeCount = 0;
    let needsReviewCount = 0;

    if (reciterName) {
      [totalCount, activeCount, needsReviewCount] = await Promise.all([
        withRetry(() => prisma.quranAudio.count({ where: { reciterName } })),
        withRetry(() => prisma.quranAudio.count({ where: { reciterName, status: "active" } })),
        withRetry(() =>
          prisma.quranAudio.count({
            where: { reciterName, surahName: "Unknown" },
          })
        ),
      ]);
    }

    return NextResponse.json({
      lastScan: lastSyncRecord?.value || null,
      qari: reciterName,
      folderId: folderRecord?.value || null,
      totalIndexed: totalCount,
      activeFiles: activeCount,
      needsReview: needsReviewCount,
    });
  } catch (error) {
    console.error("[QURAN-SCAN] GET error:", error);
    return NextResponse.json(
      { error: "Failed to load scan status" },
      { status: 500 }
    );
  }
}
