import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { ensureDatabase } from "@/lib/db-init";
import { notifyProgramChange } from "@/lib/program-events";

export const dynamic = "force-dynamic";

// POST - Import a YouTube scheduled stream into EPG
export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const { channelId, broadcastId, title, description, scheduledStartTime, thumbnail, youtubeUrl } = body;

    // Validate required fields
    if (!channelId || !broadcastId || !title || !scheduledStartTime) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Check for duplicate import
    const existing = await prisma.program.findFirst({
      where: { youtubeBroadcastId: broadcastId },
    });

    if (existing) {
      return NextResponse.json({
        error: "This YouTube stream has already been imported",
        existingProgram: {
          id: existing.id,
          title: existing.title,
          channel: existing.channelId,
        },
      }, { status: 409 });
    }

    // Validate channel exists
    const channel = await prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    // Convert YouTube timestamp to Malaysia time
    const ytDate = new Date(scheduledStartTime);
    const malaysiaTime = new Date(ytDate.getTime() + 8 * 60 * 60 * 1000);

    const date = malaysiaTime.toISOString().split("T")[0]; // YYYY-MM-DD
    const hours = String(malaysiaTime.getUTCHours()).padStart(2, "0");
    const minutes = String(malaysiaTime.getUTCMinutes()).padStart(2, "0");
    const startTime = `${hours}:${minutes}`;

    // Default end time: 2 hours after start
    const endDate = new Date(malaysiaTime.getTime() + 2 * 60 * 60 * 1000);
    const endHours = String(endDate.getUTCHours()).padStart(2, "0");
    const endMinutes = String(endDate.getUTCMinutes()).padStart(2, "0");
    const endTime = `${endHours}:${endMinutes}`;

    // Check for overlapping programs
    const overlapping = await prisma.program.findFirst({
      where: {
        channelId,
        date,
        OR: [
          { startTime: { lte: startTime }, endTime: { gt: startTime } },
          { startTime: { lt: endTime }, endTime: { gte: endTime } },
          { startTime: { gte: startTime }, endTime: { lte: endTime } },
        ],
      },
    });

    if (overlapping) {
      return NextResponse.json({
        conflict: true,
        error: `Schedule conflict with "${overlapping.title}" (${overlapping.startTime} - ${overlapping.endTime}). Please adjust.`,
        overlappingProgram: {
          id: overlapping.id,
          title: overlapping.title,
          startTime: overlapping.startTime,
          endTime: overlapping.endTime,
        },
      }, { status: 409 });
    }

    // Create the program entry
    const program = await prisma.program.create({
      data: {
        channelId,
        title,
        date,
        startTime,
        endTime,
        description: description || null,
        thumbnail: thumbnail || null,
        status: "scheduled",
        youtubeBroadcastId: broadcastId,
        youtubeUrl: youtubeUrl || `https://www.youtube.com/watch?v=${broadcastId}`,
      },
      include: { channel: { select: { id: true, name: true } } },
    });

    notifyProgramChange();

    return NextResponse.json({
      success: true,
      program,
      message: `Program "${title}" added to ${channel.name} on ${date} at ${startTime}`,
    }, { status: 201 });
  } catch (error) {
    console.error("[YOUTUBE-IMPORT] Error:", error);
    return NextResponse.json({ error: "Failed to import stream" }, { status: 500 });
  }
}
