import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/auth";
import { notifyProgramChange } from "@/lib/program-events";
import { isDatabaseDown } from "@/lib/db-init";
import { getThumbnailMeta, dataThumbUrl } from "@/lib/thumb-meta";
import { isDbUnavailableError, serviceUnavailable } from "@/lib/api-errors";

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
    if (isDatabaseDown()) return serviceUnavailable([]);
    try {
      // Select WITHOUT the base64 thumbnail column; classify via cheap query
      // so blobs are never transferred from the database.
      const programs = await prisma.program.findMany({
        where: { channelId, date },
        orderBy: { startTime: "asc" },
        select: {
          id: true,
          channelId: true,
          title: true,
          date: true,
          startTime: true,
          endTime: true,
          description: true,
          status: true,
          youtubeBroadcastId: true,
          youtubeUrl: true,
          createdAt: true,
          updatedAt: true,
          channel: { select: { id: true, name: true } },
        },
      });
      const meta = await getThumbnailMeta(
        "programs",
        { channelId, date }
      );
      const optimized = programs.map((p) => {
        const m = meta.get(p.id);
        return {
          ...p,
          thumbnail:
            m?.kind === "data"
              ? dataThumbUrl("program", p.id, p.updatedAt)
              : m?.kind === "url"
                ? m.url
                : null,
        };
      });
      return NextResponse.json(optimized);
    } catch (error) {
      if (isDbUnavailableError(error)) {
        return serviceUnavailable([]);
      }
      return NextResponse.json([], { status: 500 });
    }
  }

  // Admin endpoint: all programs
  if (all) {
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
