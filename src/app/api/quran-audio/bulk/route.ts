import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { prisma, withRetry } from "@/lib/prisma";
import {
  getValidDriveToken,
  uploadToGoogleDrive,
  deleteFromGoogleDrive,
} from "@/lib/google-drive";
import { parseQuranFilename, type ParsedQuranFile } from "@/lib/quran-filename-parser";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // 2 minutes for bulk uploads

const ALLOWED_AUDIO_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
];
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB per file
const MAX_BULK_FILES = 200; // Max files per bulk upload

interface BulkFileMetadata {
  fileName: string;
  originalName: string;
  fileSize: number;
  surahNumber: number;
  surahName: string;
  ayahNumber: number;
  audioType: "ayah" | "full_surah";
  reciterName: string;
  googleDriveId?: string;
  googleDriveUrl?: string;
  status: "pending" | "uploading" | "success" | "error" | "skipped";
  error?: string;
}

// POST — Bulk upload Quran audio files
export async function POST(request: NextRequest) {
  try {
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const formData = await request.formData();
    const reciterName = formData.get("reciterName") as string;
    const duplicateAction = (formData.get("duplicateAction") as string) || "skip"; // "skip" | "replace"

    if (!reciterName?.trim()) {
      return NextResponse.json({ error: "Reciter name is required" }, { status: 400 });
    }

    // Collect all audio files
    const files: File[] = [];
    for (const [key, value] of formData.entries()) {
      if (key === "files" && value instanceof File) {
        files.push(value);
      }
    }

    if (files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    if (files.length > MAX_BULK_FILES) {
      return NextResponse.json(
        { error: `Too many files. Maximum: ${MAX_BULK_FILES}` },
        { status: 400 }
      );
    }

    // Validate all files first
    const validationErrors: string[] = [];
    for (const file of files) {
      if (!ALLOWED_AUDIO_TYPES.includes(file.type) && !file.name.match(/\.(mp3|m4a|ogg|wav|webm)$/i)) {
        validationErrors.push(`${file.name}: Invalid file type`);
      }
      if (file.size > MAX_FILE_SIZE) {
        validationErrors.push(`${file.name}: File too large (max 50MB)`);
      }
    }
    if (validationErrors.length > 0) {
      return NextResponse.json(
        { error: "Validation errors:\n" + validationErrors.join("\n") },
        { status: 400 }
      );
    }

    // Get Google Drive token and folder
    const token = await getValidDriveToken();
    if (!token) {
      return NextResponse.json(
        { error: "Google Drive is not connected. Please connect it first." },
        { status: 400 }
      );
    }

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

    // Parse all filenames
    const parsedFiles = files.map((file) => ({
      file,
      parsed: parseQuranFilename(file.name),
    }));

    // Check for duplicates in the batch and in the database
    const bulkMetadata: BulkFileMetadata[] = [];
    const existingEntries = await withRetry(() =>
      prisma.quranAudio.findMany({
        where: { reciterName: reciterName.trim() },
        select: { surahNumber: true, ayahNumber: true, id: true, googleDriveId: true },
      })
    );

    for (const { file, parsed } of parsedFiles) {
      const meta: BulkFileMetadata = {
        fileName: `quran_${parsed.surahNumber || 0}_${parsed.ayahNumber || 0}_${reciterName.trim().replace(/\s+/g, "_")}.${file.name.split(".").pop() || "mp3"}`,
        originalName: file.name,
        fileSize: file.size,
        surahNumber: parsed.surahNumber || 0,
        surahName: parsed.surahName || "Unknown",
        ayahNumber: parsed.ayahNumber || 1,
        audioType: parsed.audioType,
        reciterName: reciterName.trim(),
        status: parsed.status === "needs_review" ? "error" : "pending",
        error: parsed.status === "needs_review" ? "Could not detect surah from filename" : undefined,
      };

      // Check for existing duplicate
      if (parsed.surahNumber && parsed.ayahNumber) {
        const existing = existingEntries.find(
          (e) => e.surahNumber === parsed.surahNumber && e.ayahNumber === parsed.ayahNumber
        );
        if (existing) {
          if (duplicateAction === "replace") {
            meta.status = "pending";
            meta.error = undefined;
          } else {
            meta.status = "skipped";
            meta.error = "Duplicate exists";
          }
        }
      }

      bulkMetadata.push(meta);
    }

    // Start uploading
    const results: BulkFileMetadata[] = [];
    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    for (let i = 0; i < parsedFiles.length; i++) {
      const { file } = parsedFiles[i];
      const meta = bulkMetadata[i];

      // Skip files that need review or are already marked as skipped
      if (meta.status === "error" || meta.status === "skipped") {
        results.push(meta);
        if (meta.status === "skipped") skipCount++;
        else errorCount++;
        continue;
      }

      try {
        meta.status = "uploading";

        // Upload to Google Drive
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        const driveResult = await uploadToGoogleDrive(
          token.accessToken,
          meta.fileName,
          file.type || "audio/mpeg",
          file.size,
          buffer,
          folderId
        );

        meta.googleDriveId = driveResult.fileId;
        meta.googleDriveUrl = driveResult.webViewLink;

        // If replacing, delete old file and entry
        if (duplicateAction === "replace") {
          const existing = existingEntries.find(
            (e) => e.surahNumber === meta.surahNumber && e.ayahNumber === meta.ayahNumber
          );
          if (existing) {
            if (existing.googleDriveId) {
              await deleteFromGoogleDrive(token.accessToken, existing.googleDriveId);
            }
            await withRetry(() =>
              prisma.quranAudio.delete({ where: { id: existing.id } })
            );
          }
        }

        // Save to database
        await withRetry(() =>
          prisma.quranAudio.create({
            data: {
              surahName: meta.surahName,
              surahNumber: meta.surahNumber,
              ayahNumber: meta.ayahNumber,
              audioType: meta.audioType,
              reciterName: meta.reciterName,
              fileName: meta.fileName,
              fileSize: BigInt(file.size),
              googleDriveId: driveResult.fileId,
              googleDriveUrl: driveResult.webViewLink,
              status: "active",
              uploadedBy: session.userId,
            },
          })
        );

        meta.status = "success";
        successCount++;
      } catch (error) {
        meta.status = "error";
        meta.error = error instanceof Error ? error.message : "Upload failed";
        errorCount++;
      }

      results.push(meta);
    }

    return NextResponse.json({
      success: true,
      total: files.length,
      uploaded: successCount,
      skipped: skipCount,
      errors: errorCount,
      files: results,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[QURAN-AUDIO-BULK] Error:", msg);
    return NextResponse.json({ error: "Bulk upload failed: " + msg }, { status: 500 });
  }
}

// DELETE — Bulk delete Quran Audio entries
export async function DELETE(request: NextRequest) {
  try {
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { ids, deleteFromDrive } = await request.json();

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "No IDs provided" }, { status: 400 });
    }

    const token = deleteFromDrive ? await getValidDriveToken() : null;
    let deletedCount = 0;

    for (const id of ids) {
      try {
        const entry = await withRetry(() =>
          prisma.quranAudio.findUnique({ where: { id } })
        );
        if (!entry) continue;

        if (deleteFromDrive && token && entry.googleDriveId) {
          await deleteFromGoogleDrive(token.accessToken, entry.googleDriveId);
        }

        await withRetry(() =>
          prisma.quranAudio.delete({ where: { id } })
        );
        deletedCount++;
      } catch {
        // Skip failed deletes
      }
    }

    return NextResponse.json({ success: true, deleted: deletedCount });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[QURAN-AUDIO-BULK-DELETE] Error:", msg);
    return NextResponse.json({ error: "Bulk delete failed: " + msg }, { status: 500 });
  }
}
