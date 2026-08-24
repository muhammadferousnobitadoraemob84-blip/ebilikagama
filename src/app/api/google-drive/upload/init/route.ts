import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";
import { getReplayFolderId } from "@/lib/google-drive";
import crypto from "crypto";

export const dynamic = "force-dynamic";

// Helper to get access token
async function getAccessToken() {
  const record = await prisma.setting.findUnique({
    where: { key: "google_drive_access_token" },
  });
  return record?.value || "";
}

// POST - Initialize upload session
export async function POST(request: NextRequest) {
  try {
    await ensureDatabase();

    // Verify admin auth
    const token = request.cookies.get("admin-token")?.value;
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      await verifyToken(token);
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check Google Drive connected
    const driveConnected = await prisma.setting.findUnique({
      where: { key: "google_drive_connected" },
    });

    if (driveConnected?.value !== "true") {
      return NextResponse.json(
        { error: "Google Drive tidak disambungkan" },
        { status: 400 }
      );
    }

    const { fileName, mimeType, fileSize, totalChunks } = await request.json();

    if (!fileName || !fileSize) {
      return NextResponse.json(
        { error: "Maklumat tidak lengkap" },
        { status: 400 }
      );
    }

    // Validate file size (20GB max)
    if (fileSize > 20 * 1024 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Fail terlalu besar. Saiz maksimum ialah 20 GB." },
        { status: 400 }
      );
    }

    const accessToken = await getAccessToken();
    if (!accessToken) {
      return NextResponse.json(
        { error: "Token Google Drive tidak ditemui" },
        { status: 400 }
      );
    }

    const folderId = await getReplayFolderId();

    // Generate unique filename
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString("hex");
    const ext = fileName.split(".").pop() || "mp4";
    const driveFileName = `${timestamp}-${random}.${ext}`;

    // Initialize resumable upload with Google Drive
    const initResponse = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({
          name: driveFileName,
          parents: [folderId],
          mimeType: mimeType || "video/mp4",
        }),
      }
    );

    if (!initResponse.ok) {
      const error = await initResponse.text();
      console.error("[UPLOAD-INIT] Failed:", error);
      return NextResponse.json(
        { error: "Gagal memulakan muat naik ke Google Drive" },
        { status: 500 }
      );
    }

    const uploadUrl = initResponse.headers.get("Location");
    if (!uploadUrl) {
      return NextResponse.json(
        { error: "Tiada URL muat naik diterima" },
        { status: 500 }
      );
    }

    // Create upload session in database
    const uploadSessionId = `upload_${timestamp}_${random}`;
    await prisma.setting.create({
      data: {
        key: `upload_session_${uploadSessionId}`,
        value: JSON.stringify({
          uploadUrl,
          driveFileName,
          fileName,
          fileSize,
          totalChunks,
          mimeType,
          chunksReceived: [],
          createdAt: new Date().toISOString(),
        }),
      },
    });

    return NextResponse.json({
      success: true,
      uploadSessionId,
      driveFileName,
    });
  } catch (error) {
    console.error("[UPLOAD-INIT] Error:", error);
    return NextResponse.json(
      { error: "Gagal memulakan sesi muat naik" },
      { status: 500 }
    );
  }
}
