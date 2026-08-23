import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getMultipleChannelStatuses } from "@/lib/twitch-status";

export const dynamic = "force-dynamic";

// Prevent Vercel from caching this endpoint
export const revalidate = 0;

export async function GET() {
  try {
    // Get all active channels with their Twitch usernames
    const channels = await prisma.channel.findMany({
      where: { active: true },
      select: {
        id: true,
        twitchUsername: true,
      },
    });

    if (channels.length === 0) {
      return NextResponse.json({ channels: [] }, {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
          Pragma: "no-cache",
        },
      });
    }

    // Check all channels' live status concurrently
    const usernames = channels.map((c) => c.twitchUsername);
    const statuses = await getMultipleChannelStatuses(usernames);

    // Build response
    const channelStatuses = channels.map((ch) => ({
      id: ch.id,
      status: statuses[ch.twitchUsername.toLowerCase().trim()] || "unknown",
    }));

    return NextResponse.json({ channels: channelStatuses }, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
      },
    });
  } catch {
    return NextResponse.json(
      { channels: [], error: "Status check failed" },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
          Pragma: "no-cache",
        },
      }
    );
  }
}
