import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { isAllowedVideoType, MAX_FILE_SIZE } from "@/lib/storage";
import { ensureDatabase } from "@/lib/db-init";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

export const dynamic = "force-dynamic";

// On Vercel, only /tmp is writable
// Files here are ephemeral (lost on cold start) but work for upload flow
const TMP_DIR = "/tmp";

// GET - Serve video file (only works for locally stored files)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");

    if (!key) {
      return NextResponse.json({ error: "Key is required" }, { status: 400 });
    }

    // Try multiple possible locations
    const possiblePaths = [
      path.join(process.cwd(), "uploads", "videos", key),
      path.join(TMP_DIR, "videos", key),
    ];

    for (const filePath of possiblePaths) {
      try {
        const stat = await fs.stat(filePath);
        const range = request.headers.get("range");

        if (range) {
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

        const buffer = await fs.readFile(filePath);
        return new NextResponse(buffer, {
          headers: {
            "Content-Length": stat.size.toString(),
            "Content-Type": "video/mp4",
            "Accept-Ranges": "bytes",
          },
        });
      } catch {
        // Try next path
      }
    }

    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  } catch (error) {
    console.error("[UPLOAD] GET error:", error);
    return NextResponse.json({ error: "Failed to serve video" }, { status: 500 });
  }
}

// POST - Initialize chunked upload or upload a chunk
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

    const body = await request.json();
    const { action, uploadId, chunkIndex, totalChunks, filename, fileSize, chunkData } = body;

    console.log("[UPLOAD] Action:", action, "UploadId:", uploadId);

    // Action: Initialize upload
    if (action === "init") {
      if (!filename || !fileSize) {
        return NextResponse.json({ error: "Filename and fileSize required" }, { status: 400 });
      }

      if (fileSize > MAX_FILE_SIZE) {
        return NextResponse.json({ error: "Fail terlalu besar. Saiz maksimum ialah 20 GB." }, { status: 400 });
      }

      if (!isAllowedVideoType(filename)) {
        return NextResponse.json({ error: "Format video tidak disokong" }, { status: 400 });
      }

      // Generate unique upload ID
      const newUploadId = crypto.randomUUID();
      const uploadDir = path.join(TMP_DIR, "chunks", newUploadId);
      
      try {
        await fs.mkdir(uploadDir, { recursive: true });
        console.log("[UPLOAD] Created upload dir:", uploadDir);
      } catch (dirErr) {
        console.error("[UPLOAD] Failed to create dir:", dirErr);
        return NextResponse.json({ error: "Failed to initialize upload" }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        uploadId: newUploadId,
        totalChunks: Math.ceil(fileSize / (5 * 1024 * 1024)), // 5MB chunks
      });
    }

    // Action: Upload chunk
    if (action === "chunk") {
      if (!uploadId || chunkIndex === undefined || !chunkData) {
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
      }

      const uploadDir = path.join(TMP_DIR, "chunks", uploadId);
      
      // Verify upload directory exists
      try {
        await fs.access(uploadDir);
      } catch {
        return NextResponse.json({ error: "Upload session expired. Please restart." }, { status: 404 });
      }

      // Save chunk
      const chunkPath = path.join(uploadDir, `chunk_${chunkIndex}`);
      const buffer = Buffer.from(chunkData, "base64");
      await fs.writeFile(chunkPath, buffer);

      return NextResponse.json({
        success: true,
        chunkIndex,
        received: true,
      });
    }

    // Action: Complete upload - combine chunks
    if (action === "complete") {
      if (!uploadId || !filename || !totalChunks) {
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
      }

      const uploadDir = path.join(TMP_DIR, "chunks", uploadId);
      
      // Generate final filename
      const timestamp = Date.now();
      const random = crypto.randomBytes(8).toString("hex");
      const ext = filename.split(".").pop() || "mp4";
      const finalFilename = `${timestamp}-${random}.${ext}`;
      
      // Try to save to multiple locations
      const possibleVideoDirs = [
        path.join(process.cwd(), "uploads", "videos"),
        path.join(TMP_DIR, "videos"),
      ];

      let finalPath = "";
      let videoDir = "";

      for (const dir of possibleVideoDirs) {
        try {
          await fs.mkdir(dir, { recursive: true });
          finalPath = path.join(dir, finalFilename);
          videoDir = dir;
          // Test write access
          await fs.writeFile(path.join(dir, ".test"), "test");
          await fs.unlink(path.join(dir, ".test"));
          console.log("[UPLOAD] Using video dir:", dir);
          break;
        } catch (e) {
          console.log("[UPLOAD] Cannot use dir:", dir);
          continue;
        }
      }

      if (!finalPath) {
        return NextResponse.json({ error: "Cannot write video file" }, { status: 500 });
      }

      // Combine chunks
      try {
        const writeHandle = await fs.open(finalPath, "w");
        try {
          for (let i = 0; i < totalChunks; i++) {
            const chunkPath = path.join(uploadDir, `chunk_${i}`);
            try {
              const chunkBuffer = await fs.readFile(chunkPath);
              await writeHandle.appendFile(chunkBuffer);
            } catch (chunkErr) {
              console.error(`[UPLOAD] Failed to read chunk ${i}:`, chunkErr);
              throw new Error(`Failed to read chunk ${i}`);
            }
          }
        } finally {
          await writeHandle.close();
        }
      } catch (combineErr) {
        console.error("[UPLOAD] Failed to combine chunks:", combineErr);
        return NextResponse.json({ error: "Failed to combine video chunks" }, { status: 500 });
      }

      // Clean up chunks
      try {
        await fs.rm(uploadDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }

      // Get file size
      const stat = await fs.stat(finalPath);
      const videoUrl = `/api/upload/video?key=${encodeURIComponent(finalFilename)}`;

      console.log("[UPLOAD] Upload complete:", finalFilename, "Size:", stat.size);

      return NextResponse.json({
        success: true,
        videoUrl,
        fileKey: finalFilename,
        fileSize: stat.size,
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("[UPLOAD] POST error:", error);
    return NextResponse.json(
      { error: "Failed to process upload" },
      { status: 500 }
    );
  }
}
