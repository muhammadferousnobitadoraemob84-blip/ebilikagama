import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";
import { 
  getOrCreateReplayFolder, 
  uploadToGoogleDrive, 
  deleteFromGoogleDrive 
} from "@/lib/google-drive";
import crypto from "crypto";

export const dynamic = "force-dynamic";

// Helper to get Google Drive access token from database
async function getGoogleDriveAccessToken() {
  const accessTokenRecord = await prisma.setting.findUnique({
    where: { key: "google_drive_access_token" },
  });
  return accessTokenRecord?.value || "";
}

// POST - Upload video to Google Drive
export async function POST(request: NextRequest) {
  try {
    await ensureDatabase();

    // Verify admin authentication
    const token = request.cookies.get("admin-token")?.value;
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      await verifyToken(token);
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if Google Drive is connected
    const driveConnected = await prisma.setting.findUnique({
      where: { key: "google_drive_connected" },
    });

    if (driveConnected?.value !== "true") {
      return NextResponse.json(
        { error: "Google Drive tidak disambungkan. Sila sambungkan terlebih dahulu." },
        { status: 400 }
      );
    }

    // Get access token
    const accessToken = await getGoogleDriveAccessToken();

    if (!accessToken) {
      return NextResponse.json(
        { error: "Token Google Drive tidak ditemui." },
        { status: 400 }
      );
    }

    // Get file from form data
    const formData = await request.formData();
    const file = formData.get("video") as File;

    if (!file) {
      return NextResponse.json(
        { error: "Tiada fail video diberikan" },
        { status: 400 }
      );
    }

    // Validate file size (20GB max)
    const MAX_SIZE = 20 * 1024 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "Fail terlalu besar. Saiz maksimum ialah 20 GB." },
        { status: 400 }
      );
    }

    // Validate file type
    const allowedTypes = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Format video tidak disokong. Gunakan: MP4, MOV, WebM, MKV" },
        { status: 400 }
      );
    }

    // Get or create folder
    const folderId = await getOrCreateReplayFolder(accessToken);

    // Generate unique filename
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString("hex");
    const ext = file.name.split(".").pop() || "mp4";
    const driveFileName = `${timestamp}-${random}.${ext}`;

    // Convert file to buffer
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    // Upload to Google Drive
    const result = await uploadToGoogleDrive(
      accessToken,
      driveFileName,
      file.type,
      file.size,
      fileBuffer,
      folderId
    );

    return NextResponse.json({
      success: true,
      fileId: result.fileId,
      webViewLink: result.webViewLink,
      fileName: driveFileName,
      fileSize: file.size,
    });
  } catch (error) {
    console.error("[GOOGLE-DRIVE-UPLOAD] Error:", error);
    return NextResponse.json(
      { error: "Gagal memuat naik ke Google Drive" },
      { status: 500 }
    );
  }
}

// DELETE - Delete file from Google Drive
export async function DELETE(request: NextRequest) {
  try {
    await ensureDatabase();

    // Verify admin authentication
    const token = request.cookies.get("admin-token")?.value;
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      await verifyToken(token);
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { fileId } = await request.json();

    if (!fileId) {
      return NextResponse.json(
        { error: "File ID is required" },
        { status: 400 }
      );
    }

    // Get access token
    const accessToken = await getGoogleDriveAccessToken();

    if (!accessToken) {
      return NextResponse.json(
        { error: "Google Drive not connected" },
        { status: 400 }
      );
    }

    // Delete from Google Drive
    const deleted = await deleteFromGoogleDrive(accessToken, fileId);

    if (!deleted) {
      return NextResponse.json(
        { error: "Failed to delete from Google Drive" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[GOOGLE-DRIVE-DELETE] Error:", error);
    return NextResponse.json(
      { error: "Failed to delete from Google Drive" },
      { status: 500 }
    );
  }
}
