import { NextRequest, NextResponse } from "next/server";
import { exchangeYouTubeCodeForTokens, getYouTubeChannelInfo } from "@/lib/youtube";
import { prisma } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";

export const dynamic = "force-dynamic";

// GET - OAuth callback from Google (YouTube)
export async function GET(request: NextRequest) {
  try {
    await ensureDatabase();

    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const error = searchParams.get("error");

    if (error) {
      console.error("[YOUTUBE-CALLBACK] OAuth error:", error);
      return NextResponse.redirect(
        new URL("/admin/youtube?yt=error&message=Authorization denied", request.url)
      );
    }

    if (!code) {
      return NextResponse.redirect(
        new URL("/admin/youtube?yt=error&message=No authorization code", request.url)
      );
    }

    // Exchange code for tokens (redirect_uri is deterministic, not from request.url)
    const tokens = await exchangeYouTubeCodeForTokens(code);

    if (!tokens.access_token) {
      return NextResponse.redirect(
        new URL("/admin/youtube?yt=error&message=Failed to get access token", request.url)
      );
    }

    // Get YouTube channel info
    const channelInfo = await getYouTubeChannelInfo(tokens.access_token);

    if (!channelInfo.connected) {
      return NextResponse.redirect(
        new URL("/admin/youtube?yt=error&message=Failed to verify YouTube connection", request.url)
      );
    }

    // Save tokens to database (Settings table)
    await prisma.setting.upsert({
      where: { key: "youtube_access_token" },
      update: { value: tokens.access_token },
      create: { key: "youtube_access_token", value: tokens.access_token },
    });

    if (tokens.refresh_token) {
      await prisma.setting.upsert({
        where: { key: "youtube_refresh_token" },
        update: { value: tokens.refresh_token },
        create: { key: "youtube_refresh_token", value: tokens.refresh_token },
      });
    }

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

    return NextResponse.redirect(
      new URL("/admin/youtube?yt=success", request.url)
    );
  } catch (error) {
    console.error("[YOUTUBE-CALLBACK] Error:", error);
    return NextResponse.redirect(
      new URL("/admin/youtube?yt=error&message=Server error", request.url)
    );
  }
}
