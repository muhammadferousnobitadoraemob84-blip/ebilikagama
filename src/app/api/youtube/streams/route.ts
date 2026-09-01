import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getYouTubeScheduledStreams, refreshYouTubeAccessToken } from "@/lib/youtube";
import { verifyToken } from "@/lib/auth";
import { ensureDatabase } from "@/lib/db-init";

export const dynamic = "force-dynamic";

// GET - Fetch scheduled YouTube streams
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

    // Get YouTube tokens
    const accessTokenRecord = await prisma.setting.findUnique({ where: { key: "youtube_access_token" } });
    const refreshTokenRecord = await prisma.setting.findUnique({ where: { key: "youtube_refresh_token" } });
    const connectedRecord = await prisma.setting.findUnique({ where: { key: "youtube_connected" } });

    if (connectedRecord?.value !== "true" || !accessTokenRecord?.value) {
      return NextResponse.json({ error: "YouTube account not connected" }, { status: 400 });
    }

    let accessToken = accessTokenRecord.value;
    const refreshToken = refreshTokenRecord?.value;

    // Try to fetch streams with current token
    let result = await getYouTubeScheduledStreams(accessToken);

    // If unauthorized, try refreshing the token
    if (result.error?.includes("expired") && refreshToken) {
      try {
        const tokens = await refreshYouTubeAccessToken(refreshToken);
        accessToken = tokens.access_token;

        // Save new access token
        await prisma.setting.upsert({
          where: { key: "youtube_access_token" },
          update: { value: accessToken },
          create: { key: "youtube_access_token", value: accessToken },
        });

        // Retry with new token
        result = await getYouTubeScheduledStreams(accessToken);
      } catch (refreshError) {
        console.error("[YOUTUBE-STREAMS] Token refresh failed:", refreshError);
        // Mark as disconnected
        await prisma.setting.upsert({
          where: { key: "youtube_connected" },
          update: { value: "false" },
          create: { key: "youtube_connected", value: "false" },
        });
        return NextResponse.json({ error: "YouTube authorization expired. Please reconnect.", streams: [] });
      }
    }

    if (result.error) {
      return NextResponse.json({ error: result.error, streams: [] });
    }

    // Mark which streams have already been imported
    const importedBroadcastIds = new Set(
      (
        await prisma.program.findMany({
          where: { youtubeBroadcastId: { not: null } },
          select: { youtubeBroadcastId: true },
        })
      ).map((p) => p.youtubeBroadcastId)
    );

    const streamsWithImportStatus = result.streams.map((stream) => ({
      ...stream,
      alreadyImported: importedBroadcastIds.has(stream.id),
    }));

    return NextResponse.json({ streams: streamsWithImportStatus });
  } catch (error) {
    console.error("[YOUTUBE-STREAMS] Error:", error);
    return NextResponse.json({ error: "Failed to fetch streams", streams: [] }, { status: 500 });
  }
}
