import { NextRequest, NextResponse } from "next/server";
import { getAuthUrl } from "@/lib/google-drive";
import { verifyToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET - Get Google Drive authorization URL
export async function GET(request: NextRequest) {
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

    // Generate state token (includes admin token hash for callback)
    const state = Buffer.from(JSON.stringify({ adminToken: token })).toString(
      "base64"
    );

    const authUrl = getAuthUrl(state);

    return NextResponse.json({ authUrl });
  } catch (error) {
    console.error("[GOOGLE-DRIVE-AUTH] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate authorization URL" },
      { status: 500 }
    );
  }
}
