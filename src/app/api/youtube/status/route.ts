import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";
import { verifyToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET - Check YouTube connection status
export async function GET(request: NextRequest) {
  try {
    await ensureDatabase();

    const token = request.cookies.get("admin-token")?.value;
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await verifyToken(token);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const connected = await prisma.setting.findUnique({ where: { key: "youtube_connected" } });
    const channelName = await prisma.setting.findUnique({ where: { key: "youtube_channel_name" } });
    const channelId = await prisma.setting.findUnique({ where: { key: "youtube_channel_id" } });

    return NextResponse.json({
      connected: connected?.value === "true",
      channelName: channelName?.value || null,
      channelId: channelId?.value || null,
    });
  } catch (error) {
    console.error("[YOUTUBE-STATUS] Error:", error);
    return NextResponse.json({ connected: false, channelName: null, channelId: null }, { status: 200 });
  }
}
