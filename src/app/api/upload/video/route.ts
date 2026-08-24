import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { getUploadUrl, generateFileKey, isAllowedVideoType, MAX_FILE_SIZE } from "@/lib/storage";
import { prisma } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";
import fs from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

// GET - Get presigned upload URL or serve video
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");

    // If key is provided, serve the video file
    if (key) {
      // For local storage, serve from uploads directory
      const uploadsDir = path.join(process.cwd(), "uploads", "videos");
      const filePath = path.join(uploadsDir, key);

      try {
        const stat = await fs.stat(filePath);
        const range = request.headers.get("range");

        if (range) {
          // Handle range requests for video streaming
          const parts = range.replace(/bytes=/, "").split("-");
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
          const chunkSize = end - start + 1;

          const buffer = Buffer.alloc(chunkSize);
          const fileHandle = await fs.open(filePath, "r");
          await fileHandle.read(buffer, 0, chunkSize, start);
          await fileHandle.close();

          return new NextResponse(buffer, {
            status: 206,
            headers: {
              "Content-Range": `bytes ${start}-${end}/${stat.size}`,
              "Accept-Ranges": "bytes",
              "Content-Length": chunkSize.toString(),
              "Content-Type": "video/mp4",
            },
          });
        }

        // Serve full file
        const buffer = await fs.readFile(filePath);
        return new NextResponse(buffer, {
          headers: {
            "Content-Length": stat.size.toString(),
            "Content-Type": "video/mp4",
            "Accept-Ranges": "bytes",
          },
        });
      } catch {
        return NextResponse.json({ error: "Video not found" }, { status: 404 });
      }
    }

    // Generate upload URL
    const filename = searchParams.get("filename");
    const contentType = searchParams.get("contentType");

    if (!filename) {
      return NextResponse.json(
        { error: "Filename is required" },
        { status: 400 }
      );
    }

    // Validate file type
    if (!isAllowedVideoType(filename, contentType || undefined)) {
      return NextResponse.json(
        { error: "File type not allowed. Supported: MP4, MOV, WebM, MKV" },
        { status: 400 }
      );
    }

    // Generate file key
    const fileKey = generateFileKey(filename);

    // Get upload URL
    const uploadAuth = await getUploadUrl(fileKey, contentType || "video/mp4");

    return NextResponse.json({
      uploadUrl: uploadAuth.uploadUrl,
      fileKey: uploadAuth.fileKey,
      expiresAt: uploadAuth.expiresAt,
    });
  } catch (error) {
    console.error("[UPLOAD] GET error:", error);
    return NextResponse.json(
      { error: "Failed to get upload URL" },
      { status: 500 }
    );
  }
}

// POST - Handle direct video upload
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

    // Get file from form data
    const formData = await request.formData();
    const file = formData.get("video") as File;

    if (!file) {
      return NextResponse.json(
        { error: "No video file provided" },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "Fail terlalu besar. Saiz maksimum ialah 20 GB." },
        { status: 400 }
      );
    }

    // Validate file type
    if (!isAllowedVideoType(file.name, file.type)) {
      return NextResponse.json(
        { error: "File type not allowed. Supported: MP4, MOV, WebM, MKV" },
        { status: 400 }
      );
    }

    // Generate file key
    const fileKey = generateFileKey(file.name);

    // Save to local uploads directory
    const uploadsDir = path.join(process.cwd(), "uploads", "videos");
    await fs.mkdir(uploadsDir, { recursive: true });

    const filePath = path.join(uploadsDir, fileKey);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(filePath, buffer);

    // Get public URL
    const videoUrl = `/api/upload/video?key=${encodeURIComponent(fileKey)}`;

    return NextResponse.json({
      success: true,
      videoUrl,
      fileKey,
      fileSize: file.size,
    });
  } catch (error) {
    console.error("[UPLOAD] POST error:", error);
    return NextResponse.json(
      { error: "Failed to upload video" },
      { status: 500 }
    );
  }
}
