import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

export const dynamic = "force-dynamic";

// POST - Upload thumbnail
export async function POST(request: NextRequest) {
  try {
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
    const file = formData.get("thumbnail") as File;

    if (!file) {
      return NextResponse.json(
        { error: "No thumbnail file provided" },
        { status: 400 }
      );
    }

    // Validate file size (max 5MB for thumbnails)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "Thumbnail too large. Maximum size is 5MB." },
        { status: 400 }
      );
    }

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "File type not allowed. Supported: JPG, PNG, WebP" },
        { status: 400 }
      );
    }

    // Generate unique filename
    const ext = file.name.split(".").pop() || "jpg";
    const filename = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${ext}`;

    // Save to uploads directory
    const uploadsDir = path.join(process.cwd(), "uploads", "thumbnails");
    await fs.mkdir(uploadsDir, { recursive: true });

    const filePath = path.join(uploadsDir, filename);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(filePath, buffer);

    // Return URL
    const thumbnailUrl = `/api/upload/thumbnail?name=${encodeURIComponent(filename)}`;

    return NextResponse.json({
      success: true,
      thumbnailUrl,
    });
  } catch (error) {
    console.error("[THUMBNAIL] POST error:", error);
    return NextResponse.json(
      { error: "Failed to upload thumbnail" },
      { status: 500 }
    );
  }
}

// GET - Serve thumbnail
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get("name");

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Sanitize filename
    const safeName = path.basename(name);
    const filePath = path.join(process.cwd(), "uploads", "thumbnails", safeName);

    try {
      const buffer = await fs.readFile(filePath);
      const ext = safeName.split(".").pop()?.toLowerCase();
      const contentType = ext === "png" ? "image/png" : 
                         ext === "webp" ? "image/webp" : "image/jpeg";

      return new NextResponse(buffer, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    } catch {
      return NextResponse.json({ error: "Thumbnail not found" }, { status: 404 });
    }
  } catch (error) {
    console.error("[THUMBNAIL] GET error:", error);
    return NextResponse.json(
      { error: "Failed to serve thumbnail" },
      { status: 500 }
    );
  }
}
