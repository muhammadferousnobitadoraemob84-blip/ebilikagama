import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST - Disconnect YouTube account
export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get("admin-token")?.value;
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await verifyToken(token);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Remove YouTube tokens and connection info
    const keysToRemove = [
      "youtube_access_token",
      "youtube_refresh_token",
      "youtube_connected",
      "youtube_channel_name",
      "youtube_channel_id",
    ];

    for (const key of keysToRemove) {
      try {
        await prisma.setting.delete({ where: { key } });
      } catch {
        // Key may not exist, ignore
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[YOUTUBE-DISCONNECT] Error:", error);
    return NextResponse.json({ error: "Failed to disconnect" }, { status: 500 });
  }
}
