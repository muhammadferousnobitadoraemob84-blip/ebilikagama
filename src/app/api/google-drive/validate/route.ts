import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST - Validate Google Drive link
export async function POST(request: NextRequest) {
  try {
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

    const { link, fileId } = await request.json();

    if (!link || !fileId) {
      return NextResponse.json({
        valid: false,
        message: "Maklumat tidak lengkap.",
      });
    }

    // Validate Google Drive URL format
    const googleDrivePatterns = [
      /drive\.google\.com\/file\/d\/[a-zA-Z0-9_-]+/,
      /drive\.google\.com\/open\?id=[a-zA-Z0-9_-]+/,
      /drive\.google\.com\/uc\?id=[a-zA-Z0-9_-]+/,
    ];

    const isValidFormat = googleDrivePatterns.some((pattern) => pattern.test(link));

    if (!isValidFormat) {
      return NextResponse.json({
        valid: false,
        message: "Google Drive link tidak sah.",
      });
    }

    // Try to access the file metadata to check if it's accessible
    // Note: This checks if the file exists and is publicly accessible
    try {
      const checkUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,size`;
      const response = await fetch(checkUrl);

      if (response.ok) {
        const data = await response.json();
        return NextResponse.json({
          valid: true,
          fileId: data.id,
          fileName: data.name,
          mimeType: data.mimeType,
          fileSize: data.size,
          message: `✓ Video ditemui: ${data.name || "File detected"}`,
        });
      } else if (response.status === 404) {
        return NextResponse.json({
          valid: false,
          fileId,
          message: "Video tidak ditemui. Pastikan link betul.",
        });
      } else if (response.status === 403) {
        return NextResponse.json({
          valid: true,
          fileId,
          message: "⚠ Video mungkin tidak boleh diakses secara umum. Sila tetapkan Google Drive sharing kepada 'Anyone with the link'.",
        });
      } else {
        // For other errors, assume the link format is valid
        return NextResponse.json({
          valid: true,
          fileId,
          message: "✓ Format link sah. Pastikan video ditetapkan sebagai 'Anyone with the link'.",
        });
      }
    } catch {
      // If we can't check (network error), still accept the link format
      return NextResponse.json({
        valid: true,
        fileId,
        message: "✓ Format link sah. Pastikan video ditetapkan sebagai 'Anyone with the link'.",
      });
    }
  } catch (error) {
    console.error("[GOOGLE-DRIVE-VALIDATE] Error:", error);
    return NextResponse.json({
      valid: false,
      message: "Gagal menyemak video.",
    });
  }
}
