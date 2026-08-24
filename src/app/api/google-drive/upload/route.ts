import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";
import { 
  getReplayFolderId, 
  deleteFromGoogleDrive,
  refreshAccessToken
} from "@/lib/google-drive";
import crypto from "crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes for large uploads

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

// Helper to get valid access token
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

// POST - Upload video using resumable upload with chunks
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

    // Get form data
    const formData = await request.formData();
    const file = formData.get("video") as File;
    const title = formData.get("title") as string;
    const description = formData.get("description") as string;
    const date = formData.get("date") as string;
    const thumbnail = formData.get("thumbnail") as string | null;

    if (!file || !title) {
      return NextResponse.json(
        { error: "Maklumat tidak lengkap" },
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
    const fileType = file.type || "video/mp4";
    if (!allowedTypes.includes(fileType)) {
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
    const ext = file.name.split(".").pop() || "mp4";
    const driveFileName = `${timestamp}-${random}.${ext}`;

    // Step 1: Initialize resumable upload
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
          mimeType: fileType,
        }),
      }
    );

    if (!initResponse.ok) {
      const errorText = await initResponse.text();
      console.error("[GOOGLE-DRIVE] Init upload failed:", errorText);
      throw new Error("Gagal memulakan muat naik ke Google Drive");
    }

    const uploadUrl = initResponse.headers.get("Location");
    if (!uploadUrl) {
      throw new Error("Tiada URL muat naik diterima dari Google Drive");
    }

    // Step 2: Upload file in chunks using streaming
    const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks (smaller for Vercel)
    const fileSize = file.size;
    let offset = 0;
    let fileId = "";

    // Convert file to ArrayBuffer in chunks
    const fileBuffer = await file.arrayBuffer();

    while (offset < fileSize) {
      const end = Math.min(offset + CHUNK_SIZE, fileSize);
      const chunk = fileBuffer.slice(offset, end);
      
      const contentRange = `bytes ${offset}-${end - 1}/${fileSize}`;
      
      const chunkResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Range": contentRange,
        },
        body: chunk,
      });

      // 308 Resume Incomplete is expected for intermediate chunks
      // 200 OK is returned for the final chunk
      if (chunkResponse.status !== 308 && chunkResponse.status !== 200) {
        const errorText = await chunkResponse.text();
        console.error("[GOOGLE-DRIVE] Chunk upload failed:", chunkResponse.status, errorText);
        throw new Error(`Gagal memuat naik pada offset ${offset}`);
      }

      // Get file ID from final response
      if (chunkResponse.status === 200) {
        try {
          const responseData = await chunkResponse.json();
          fileId = responseData.id;
        } catch {
          // Response might be empty for some cases
        }
      }

      offset = end;
    }

    // If we didn't get fileId from the response, try to get it
    if (!fileId) {
      // Make a HEAD request to get the file metadata
      const metadataResponse = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${uploadUrl.split("/")[6]}?fields=id`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      
      if (metadataResponse.ok) {
        const metadata = await metadataResponse.json();
        fileId = metadata.id;
      }
    }

    if (!fileId) {
      throw new Error("Gagal mendapatkan ID fail dari Google Drive");
    }

    // Step 3: Set file permissions to public (anyone with link can view)
    await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          role: "reader",
          type: "anyone",
        }),
      }
    );

    // Step 4: Save replay to database
    const replay = await prisma.replay.create({
      data: {
        title,
        description: description || "",
        videoUrl: `https://drive.google.com/file/d/${fileId}/preview`,
        thumbnail: thumbnail || null,
        duration: null,
        fileSize: BigInt(fileSize),
        date: date || new Date().toISOString().split("T")[0],
        published: false,
        googleDriveId: fileId,
      },
    });

    return NextResponse.json({
      success: true,
      replay,
      fileId,
    });
  } catch (error) {
    console.error("[GOOGLE-DRIVE-UPLOAD] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Gagal memuat naik video";
    return NextResponse.json(
      { error: errorMessage },
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
