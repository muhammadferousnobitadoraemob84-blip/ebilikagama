import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { notifyProgramChange } from "@/lib/program-events";

export const dynamic = "force-dynamic";

// GET /api/programs/[id]
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const program = await prisma.program.findUnique({
      where: { id },
      include: { channel: { select: { id: true, name: true, category: true } } },
    });
    if (!program) {
      return NextResponse.json({ error: "Program tidak dijumpai" }, { status: 404 });
    }
    return NextResponse.json(program);
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// PUT /api/programs/[id] - Update program (admin only)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const { channelId, title, date, startTime, endTime, description, thumbnail, status } = body;

    // Check program exists
    const existing = await prisma.program.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Program tidak dijumpai" }, { status: 404 });
    }

    // Conflict detection: check for overlapping programs (excluding this one)
    if (channelId && date && startTime && endTime) {
      const overlapping = await prisma.program.findFirst({
        where: {
          channelId,
          date,
          id: { not: id },
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
    }

    const program = await prisma.program.update({
      where: { id },
      data: {
        ...(channelId && { channelId }),
        ...(title && { title }),
        ...(date && { date }),
        ...(startTime && { startTime }),
        ...(endTime && { endTime }),
        ...(description !== undefined && { description: description || null }),
        ...(thumbnail !== undefined && { thumbnail: thumbnail || null }),
        ...(status && { status }),
      },
      include: { channel: { select: { id: true, name: true } } },
    });

    notifyProgramChange();
    return NextResponse.json(program);
  } catch {
    return NextResponse.json(
      { error: "Gagal mengemas kini program" },
      { status: 500 }
    );
  }
}

// DELETE /api/programs/[id] - Delete program (admin only)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const existing = await prisma.program.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Program tidak dijumpai" }, { status: 404 });
    }

    await prisma.program.delete({ where: { id } });
    notifyProgramChange();
    return NextResponse.json({ success: true, deletedId: id });
  } catch {
    return NextResponse.json(
      { error: "Gagal memadam program" },
      { status: 500 }
    );
  }
}
