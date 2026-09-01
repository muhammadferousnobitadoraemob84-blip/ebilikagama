import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";
import { verifyToken } from "@/lib/auth";
import { getValidYouTubeToken, getYouTubeChannelInfo } from "@/lib/youtube";

export const dynamic = "force-dynamic";

// GET - Check YouTube connection status (with real API verification)
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

    const connectedSetting = await prisma.setting.findUnique({ where: { key: "youtube_connected" } });
    const channelNameSetting = await prisma.setting.findUnique({ where: { key: "youtube_channel_name" } });
    const channelIdSetting = await prisma.setting.findUnique({ where: { key: "youtube_channel_id" } });

    const isConnected = connectedSetting?.value === "true";
    const hasError = connectedSetting?.value === "error";

    // If previously connected, verify with a real API call (with automatic token refresh)
    if (isConnected || hasError) {
      const tokenData = await getValidYouTubeToken();

      if (!tokenData) {
        // Tokens are invalid/expired and refresh failed
        await prisma.setting.upsert({
          where: { key: "youtube_connected" },
          update: { value: "false" },
          create: { key: "youtube_connected", value: "false" },
        });

        return NextResponse.json({
          connected: false,
          channelName: null,
          channelId: null,
          error: "YouTube authorization has expired. Please reconnect your YouTube account.",
        });
      }

      // Verify channel info with the valid token
      const channelInfo = await getYouTubeChannelInfo(tokenData.accessToken);

      if (!channelInfo.connected) {
        // Channel verification failed — keep tokens but mark as error
        await prisma.setting.upsert({
          where: { key: "youtube_connected" },
          update: { value: "error" },
          create: { key: "youtube_connected", value: "error" },
        });

        return NextResponse.json({
          connected: false,
          channelName: channelNameSetting?.value || null,
          channelId: channelIdSetting?.value || null,
          error: channelInfo.error || "YouTube channel could not be verified.",
          errorDetails: channelInfo.errorDetails || null,
        });
      }

      // Channel verified — update stored info
      await prisma.setting.upsert({
        where: { key: "youtube_connected" },
        update: { value: "true" },
        create: { key: "youtube_connected", value: "true" },
      });

      await prisma.setting.upsert({
        where: { key: "youtube_channel_name" },
        update: { value: channelInfo.channelName || "" },
        create: { key: "youtube_channel_name", value: channelInfo.channelName || "" },
      });

      await prisma.setting.upsert({
        where: { key: "youtube_channel_id" },
        update: { value: channelInfo.channelId || "" },
        create: { key: "youtube_channel_id", value: channelInfo.channelId || "" },
      });

      return NextResponse.json({
        connected: true,
        channelName: channelInfo.channelName || channelNameSetting?.value || null,
        channelId: channelInfo.channelId || channelIdSetting?.value || null,
        verified: true,
      });
    }

    // Not connected
    return NextResponse.json({
      connected: false,
      channelName: null,
      channelId: null,
    });
  } catch (error) {
    console.error("[YOUTUBE-STATUS] Error:", error);
    return NextResponse.json({ connected: false, channelName: null, channelId: null }, { status: 200 });
  }
}
