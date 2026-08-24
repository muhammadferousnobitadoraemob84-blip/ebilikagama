import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";
import { 
  getReplayFolderId, 
  initializeResumableUpload,
  finalizeUpload,
  deleteFromGoogleDrive,
  refreshAccessToken
} from "@/lib/google-drive";
import crypto from "crypto";

export const dynamic = "force-dynamic";

// Helper to get Google Drive tokens from database
async function getGoogleDriveTokens() {
  const accessTokenRecord = await prisma.setting.findUnique({
    where: { key: "google_drive_access_token" },
  });
  const refreshTokenRecord = await prisma.setting.findUnique({
    where: { key: "google_drive_refresh_token" },
  });
  return {
    accessToken: accessTokenRecord?.value || "",
    refreshToken: refreshTokenRecord?.value || "",
  };
}

// Helper to refresh and update access token
async function refreshAndUpdateToken(refreshToken: string) {
  try {
    const tokens = await refreshAccessToken(refreshToken);
    await prisma.setting.upsert({
      where: { key: "google_drive_access_token" },
      update: { value: tokens.access_token },
      create: { key: "google_drive_access_token", value: tokens.access_token },
    });
    return tokens.access_token;
  } catch (error) {
    console.error("[GOOGLE-DRIVE] Token refresh failed:", error);
    throw new Error("Gagal memperbaharui token Google Drive");
  }
}

// Helper to get valid access token (with auto-refresh)
async function getValidAccessToken(): Promise<string> {
  const { accessToken, refreshToken } = await getGoogleDriveTokens();
  
  if (!accessToken) {
    throw new Error("Token Google Drive tidak ditemui");
  }
  
  if (!refreshToken) {
    throw new Error("Refresh token tidak ditemui");
  }
  
  return accessToken;
}

// POST - Initialize resumable upload (get upload URL for browser)
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
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      return NextResponse.json(
        { error: "Token Google Drive tidak ditemui." },
        { status: 400 }
      );
    }

    // Get request body
    const { fileName, mimeType, fileSize } = await request.json();

    if (!fileName || !mimeType || !fileSize) {
      return NextResponse.json(
        { error: "Maklumat fail tidak lengkap" },
        { status: 400 }
      );
    }

    // Validate file size (20GB max)
    const MAX_SIZE = 20 * 1024 * 1024 * 1024;
    if (fileSize > MAX_SIZE) {
      return NextResponse.json(
        { error: "Fail terlalu besar. Saiz maksimum ialah 20 GB." },
        { status: 400 }
      );
    }

    // Validate file type
    const allowedTypes = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"];
    if (!allowedTypes.includes(mimeType)) {
      return NextResponse.json(
        { error: "Format video tidak disokong. Gunakan: MP4, MOV, WebM, MKV" },
        { status: 400 }
      );
    }

    // Get folder ID
    const folderId = await getReplayFolderId();

    // Generate unique filename
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString("hex");
    const ext = fileName.split(".").pop() || "mp4";
    const driveFileName = `${timestamp}-${random}.${ext}`;

    // Initialize resumable upload and get upload URL
    const { uploadUrl } = await initializeResumableUpload(
      accessToken,
      driveFileName,
      folderId
    );

    // Store the upload URL temporarily (we'll need it to finalize)
    await prisma.setting.upsert({
      where: { key: `google_drive_upload_${timestamp}` },
      update: { value: uploadUrl },
      create: { key: `google_drive_upload_${timestamp}`, value: uploadUrl },
    });

    return NextResponse.json({
      success: true,
      uploadUrl,
      driveFileName,
      uploadId: timestamp,
    });
  } catch (error) {
    console.error("[GOOGLE-DRIVE-UPLOAD] Error:", error);
    return NextResponse.json(
      { error: "Gagal memulakan muat naik ke Google Drive" },
      { status: 500 }
    );
  }
}

// PUT - Finalize upload and save to database
export async function PUT(request: NextRequest) {
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

    // Get request body
    const { fileId, title, description, date, thumbnail, fileSize, uploadId } = await request.json();

    if (!fileId || !title) {
      return NextResponse.json(
        { error: "Maklumat tidak lengkap" },
        { status: 400 }
      );
    }

    // Get access token
    const accessToken = await getValidAccessToken();

    // Finalize upload (set permissions)
    const result = await finalizeUpload(accessToken, fileId);

    // Clean up upload ID from settings
    if (uploadId) {
      await prisma.setting.deleteMany({
        where: { key: `google_drive_upload_${uploadId}` },
      });
    }

    // Save replay to database
    const replay = await prisma.replay.create({
      data: {
        title,
        description: description || "",
        videoUrl: result.webViewLink,
        thumbnail: thumbnail || null,
        duration: null,
        fileSize: fileSize || null,
        date: date || new Date().toISOString().split("T")[0],
        published: false,
        googleDriveId: fileId,
      },
    });

    return NextResponse.json({
      success: true,
      replay,
      fileId: result.fileId,
    });
  } catch (error) {
    console.error("[GOOGLE-DRIVE-FINALIZE] Error:", error);
    return NextResponse.json(
      { error: "Gagal menyelesaikan muat naik" },
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
    const accessToken = await getValidAccessToken();

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
