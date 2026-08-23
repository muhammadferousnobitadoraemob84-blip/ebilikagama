import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { notifyProgramChange } from "@/lib/program-events";

export const dynamic = "force-dynamic";

// GET /api/programs - List programs (public by channel+date, or all for admin)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const channelId = searchParams.get("channelId");
  const date = searchParams.get("date");
  const channelDate = searchParams.get("channelDate"); // channelId + date combined
  const all = searchParams.get("all");

  // Public endpoint: filter by channelId + date
  if (channelId && date) {
    try {
      const programs = await prisma.program.findMany({
        where: { channelId, date },
        include: { channel: { select: { id: true, name: true } } },
        orderBy: { startTime: "asc" },
      });
      // Strip base64 thumbnails from public response
      const optimized = programs.map((p) => ({
        ...p,
        thumbnail:
          p.thumbnail && p.thumbnail.startsWith("data:")
            ? `/api/images/program/${p.id}`
            : p.thumbnail,
      }));
      return NextResponse.json(optimized);
    } catch {
      return NextResponse.json([], { status: 500 });
    }
  }

  // Admin endpoint: all programs
  if (all) {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const where: Record<string, unknown> = {};
    const filterChannel = searchParams.get("filterChannel");
    const filterDate = searchParams.get("filterDate");
    const filterStatus = searchParams.get("filterStatus");

    if (filterChannel) where.channelId = filterChannel;
    if (filterDate) where.date = filterDate;
    if (filterStatus) where.status = filterStatus;

    try {
      const programs = await prisma.program.findMany({
        where,
        include: { channel: { select: { id: true, name: true, category: true } } },
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
      });
      return NextResponse.json(programs);
    } catch {
      return NextResponse.json([], { status: 500 });
    }
  }

  return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
}

// POST /api/programs - Create program (admin only)
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { channelId, title, date, startTime, endTime, description, thumbnail, status } = body;

    if (!channelId || !title || !date || !startTime || !endTime) {
      return NextResponse.json(
        { error: "Medan wajib tidak lengkap" },
        { status: 400 }
      );
    }

    // Validate channel exists
    const channel = await prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) {
      return NextResponse.json(
        { error: "Saluran tidak dijumpai" },
        { status: 404 }
      );
    }

    // Conflict detection: check for overlapping programs on same channel+date
    const overlapping = await prisma.program.findFirst({
      where: {
        channelId,
        date,
        id: { not: "" }, // exclude none (new record)
        OR: [
          { startTime: { lte: startTime }, endTime: { gt: startTime } },
          { startTime: { lt: endTime }, endTime: { gte: endTime } },
          { startTime: { gte: startTime }, endTime: { lte: endTime } },
        ],
      },
    });

    if (overlapping) {
      return NextResponse.json(
        {
          error: `Jadual bertindih dengan program "${overlapping.title}" (${overlapping.startTime} - ${overlapping.endTime}). Sila laraskan masa program.`,
          conflict: true,
          overlappingProgram: {
            id: overlapping.id,
            title: overlapping.title,
            startTime: overlapping.startTime,
            endTime: overlapping.endTime,
          },
        },
        { status: 409 }
      );
    }

    const program = await prisma.program.create({
      data: {
        channelId,
        title,
        date,
        startTime,
        endTime,
        description: description || null,
        thumbnail: thumbnail || null,
        status: status || "scheduled",
      },
      include: { channel: { select: { id: true, name: true } } },
    });

    notifyProgramChange();
    return NextResponse.json(program, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Gagal mencipta program" },
      { status: 500 }
    );
  }
}
