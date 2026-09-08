import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma, withRetry } from "@/lib/prisma";
import {
  getValidDriveToken,
  uploadToGoogleDrive,
  deleteFromGoogleDrive,
} from "@/lib/google-drive";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
const MAX_AUDIO_SIZE = 50 * 1024 * 1024; // 50MB

// GET — List all Quran Audio entries
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const surahNumber = searchParams.get("surah");
    const reciterName = searchParams.get("reciter");

    const where: Record<string, unknown> = {};
    if (surahNumber) where.surahNumber = parseInt(surahNumber, 10);
    if (reciterName) where.reciterName = reciterName;

    const entries = await withRetry(() =>
      prisma.quranAudio.findMany({
        where,
        orderBy: [{ surahNumber: "asc" }, { ayahNumber: "asc" }],
      })
    );

    // Convert BigInt fields to Number for JSON serialization
    const serialized = entries.map((e) => ({
      ...e,
      fileSize: e.fileSize ? Number(e.fileSize) : null,
    }));

    return NextResponse.json(serialized);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[QURAN-AUDIO] GET error:", msg);
    return NextResponse.json({ error: "Failed to load Quran audio entries" }, { status: 500 });
  }
}

// POST — Upload a new Quran Audio entry to Google Drive + save metadata
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File;
    const surahName = formData.get("surahName") as string;
    const surahNumber = parseInt(formData.get("surahNumber") as string, 10);
    const ayahNumber = parseInt(formData.get("ayahNumber") as string, 10);
    const reciterName = formData.get("reciterName") as string;

    // Validate required fields
    if (!file || !surahName || isNaN(surahNumber) || isNaN(ayahNumber) || !reciterName) {
      return NextResponse.json(
        { error: "Missing required fields: file, surahName, surahNumber, ayahNumber, reciterName" },
        { status: 400 }
      );
    }

    // Validate file type
    if (!ALLOWED_AUDIO_TYPES.includes(file.type) && !file.name.match(/\.(mp3|m4a|ogg|wav|webm)$/i)) {
      return NextResponse.json(
        { error: "Invalid file type. Allowed: MP3, M4A, OGG, WAV, WebM" },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_AUDIO_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum size: 50MB" },
        { status: 400 }
      );
    }

    // Validate surah/ayah numbers
    if (surahNumber < 1 || surahNumber > 114) {
      return NextResponse.json({ error: "Invalid surah number (1-114)" }, { status: 400 });
    }
    if (ayahNumber < 1) {
      return NextResponse.json({ error: "Invalid ayah number" }, { status: 400 });
    }

    // Check for duplicate
    const existing = await withRetry(() =>
      prisma.quranAudio.findUnique({
        where: {
          surahNumber_ayahNumber_reciterName: {
            surahNumber,
            ayahNumber,
            reciterName,
          },
        },
      })
    );
    if (existing) {
      return NextResponse.json(
        { error: `Audio already exists for Surah ${surahNumber}, Ayah ${ayahNumber} by ${reciterName}` },
        { status: 409 }
      );
    }

    // Get valid Google Drive token
    const token = await getValidDriveToken();
    if (!token) {
      return NextResponse.json(
        { error: "Google Drive is not connected. Please connect it in Site Settings first." },
        { status: 500 }
      );
    }

    // Get the selected Google Drive folder from DB
    const folderRecord = await withRetry(() =>
      prisma.setting.findUnique({ where: { key: "quran_audio_folder_id" } })
    );
    const folderId = folderRecord?.value;
    if (!folderId) {
      return NextResponse.json(
        { error: "No Google Drive folder configured. Please select a folder in the Quran Audio settings first." },
        { status: 400 }
      );
    }

    // Upload to Google Drive
    const fileName = `quran_${surahNumber}_${ayahNumber}_${reciterName.replace(/\s+/g, "_")}.${file.name.split(".").pop() || "mp3"}`;
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const result = await uploadToGoogleDrive(
      token.accessToken,
      fileName,
      file.type || "audio/mpeg",
      file.size,
      buffer,
      folderId
    );

    // Save metadata to database
    const entry = await withRetry(() =>
      prisma.quranAudio.create({
        data: {
          surahName,
          surahNumber,
          ayahNumber,
          reciterName,
          fileName,
          fileSize: BigInt(file.size),
          googleDriveId: result.fileId,
          googleDriveUrl: result.webViewLink,
          status: "active",
          uploadedBy: session.userId,
        },
      })
    );

    return NextResponse.json({
      ...entry,
      fileSize: entry.fileSize ? Number(entry.fileSize) : null,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[QURAN-AUDIO] POST error:", msg);
    return NextResponse.json({ error: "Failed to upload Quran audio: " + msg }, { status: 500 });
  }
}

// DELETE — Remove a Quran Audio entry (optionally delete from Google Drive)
export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const deleteFromDrive = searchParams.get("deleteFromDrive") === "true";

    if (!id) {
      return NextResponse.json({ error: "Missing entry ID" }, { status: 400 });
    }

    const entry = await withRetry(() =>
      prisma.quranAudio.findUnique({ where: { id } })
    );
    if (!entry) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }

    // Delete from Google Drive if requested
    if (deleteFromDrive && entry.googleDriveId) {
      const token = await getValidDriveToken();
      if (token) {
        await deleteFromGoogleDrive(token.accessToken, entry.googleDriveId);
      }
    }

    // Delete from database
    await withRetry(() =>
      prisma.quranAudio.delete({ where: { id } })
    );

    return NextResponse.json({ success: true, deletedFromDrive: deleteFromDrive });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[QURAN-AUDIO] DELETE error:", msg);
    return NextResponse.json({ error: "Failed to delete: " + msg }, { status: 500 });
  }
}
