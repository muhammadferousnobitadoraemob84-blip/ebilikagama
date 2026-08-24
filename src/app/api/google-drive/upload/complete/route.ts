import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";

export const dynamic = "force-dynamic";

// Helper to get access token
async function getAccessToken() {
  const record = await prisma.setting.findUnique({
    where: { key: "google_drive_access_token" },
  });
  return record?.value || "";
}

// POST - Complete upload session
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

    const { uploadSessionId, title, description, date, fileSize } = await request.json();

    if (!uploadSessionId || !title) {
      return NextResponse.json(
        { error: "Maklumat tidak lengkap" },
        { status: 400 }
      );
    }

    // Get upload session
    const sessionRecord = await prisma.setting.findUnique({
      where: { key: `upload_session_${uploadSessionId}` },
    });

    if (!sessionRecord) {
      return NextResponse.json(
        { error: "Sesi muat naik tidak ditemui" },
        { status: 404 }
      );
    }

    const session = JSON.parse(sessionRecord.value);
    const accessToken = await getAccessToken();

    // Verify all chunks were uploaded
    const expectedChunks = Array.from({ length: session.totalChunks }, (_, i) => i);
    const missingChunks = expectedChunks.filter(
      (i) => !session.chunksReceived.includes(i)
    );

    if (missingChunks.length > 0) {
      return NextResponse.json(
        { error: `Bahagian ${missingChunks.join(", ")} belum dimuat naik` },
        { status: 400 }
      );
    }

    // Get file metadata from Google Drive to get the file ID
    // The final chunk response should have the file ID, but we need to get it
    const metadataResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=name='${session.driveFileName}'&fields=files(id,name)`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    let fileId = "";
    if (metadataResponse.ok) {
      const metadata = await metadataResponse.json();
      if (metadata.files && metadata.files.length > 0) {
        fileId = metadata.files[0].id;
      }
    }

    // If we couldn't find the file, try to get it from the upload URL
    if (!fileId) {
      // Extract file ID from upload URL
      const urlParts = session.uploadUrl.split("/");
      const fileIdFromUrl = urlParts[6]; // /upload/drive/v3/files/{fileId}/...
      
      // Try to get metadata using the upload session
      const retryResponse = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileIdFromUrl}?fields=id`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      
      if (retryResponse.ok) {
        const retryData = await retryResponse.json();
        fileId = retryData.id;
      }
    }

    if (!fileId) {
      // Clean up session
      await prisma.setting.delete({
        where: { key: `upload_session_${uploadSessionId}` },
      });
      
      return NextResponse.json(
        { error: "Gagal mendapatkan ID fail dari Google Drive" },
        { status: 500 }
      );
    }

    // Set file permissions to public
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

    // Save replay to database
    const replay = await prisma.replay.create({
      data: {
        title,
        description: description || "",
        videoUrl: `https://drive.google.com/file/d/${fileId}/preview`,
        thumbnail: null,
        duration: null,
        fileSize: BigInt(fileSize || session.fileSize),
        date: date || new Date().toISOString().split("T")[0],
        published: false,
        googleDriveId: fileId,
      },
    });

    // Clean up upload session
    await prisma.setting.delete({
      where: { key: `upload_session_${uploadSessionId}` },
    });

    return NextResponse.json({
      success: true,
      fileId,
      replayId: replay.id,
    });
  } catch (error) {
    console.error("[UPLOAD-COMPLETE] Error:", error);
    return NextResponse.json(
      { error: "Gagal menyelesaikan muat naik" },
      { status: 500 }
    );
  }
}
