import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import crypto from "crypto";

export const dynamic = "force-dynamic";

// POST - Upload thumbnail (stores as base64 in response, saved to DB by caller)
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

    // Convert to base64 data URL
    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString("base64");
    const dataUrl = `data:${file.type};base64,${base64}`;

    // Return data URL (will be stored in database)
    return NextResponse.json({
      success: true,
      thumbnailUrl: dataUrl,
    });
  } catch (error) {
    console.error("[THUMBNAIL] POST error:", error);
    return NextResponse.json({ error: "Failed to upload thumbnail" }, { status: 500 });
  }
}
