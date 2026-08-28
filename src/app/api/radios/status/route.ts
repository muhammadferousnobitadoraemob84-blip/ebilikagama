import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getMultipleChannelStatuses } from "@/lib/twitch-status";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    // Get all enabled radios with Twitch usernames
    const radios = await prisma.radio.findMany({
      where: { enabled: true },
      select: {
        id: true,
        twitchUsername: true,
      },
    });

    if (radios.length === 0) {
      return NextResponse.json(
        { radios: [] },
        {
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate",
            Pragma: "no-cache",
          },
        }
      );
    }

    // Filter radios that have a Twitch username
    const radiosWithTwitch = radios.filter((r) => r.twitchUsername);

    if (radiosWithTwitch.length === 0) {
      return NextResponse.json(
        {
          radios: radios.map((r) => ({ id: r.id, status: "unknown" as const })),
        },
        {
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate",
            Pragma: "no-cache",
          },
        }
      );
    }

    // Check all radios' Twitch status concurrently
    const usernames = radiosWithTwitch.map((r) => r.twitchUsername!);
    const statuses = await getMultipleChannelStatuses(usernames);

    // Build response — map status to each radio ID
    const radioStatuses = radios.map((r) => {
      if (!r.twitchUsername) {
        return { id: r.id, status: "unknown" as const };
      }
      return {
        id: r.id,
        status: statuses[r.twitchUsername.toLowerCase().trim()] || ("unknown" as const),
      };
    });

    return NextResponse.json(
      { radios: radioStatuses },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
          Pragma: "no-cache",
        },
      }
    );
  } catch {
    return NextResponse.json(
      { radios: [], error: "Status check failed" },
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
