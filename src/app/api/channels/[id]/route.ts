import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { notifyChannelChange } from "@/lib/channel-events";

// GET single channel
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const channel = await prisma.channel.findUnique({ where: { id } });

    if (!channel) {
      return NextResponse.json(
        { error: "Saluran tidak dijumpai" },
        { status: 404 }
      );
    }

    return NextResponse.json(channel);
  } catch {
    return NextResponse.json(
      { error: "Gagal memuatkan saluran" },
      { status: 500 }
    );
  }
}

// PUT update channel
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Tidak dibenarkan" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { name, category, twitchUsername, thumbnail, description, displayOrder, active, liveStatus } = body;

    // Verify channel exists
    const existing = await prisma.channel.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Saluran tidak dijumpai" },
        { status: 404 }
      );
    }

    const channel = await prisma.channel.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(category !== undefined && { category }),
        ...(twitchUsername !== undefined && { twitchUsername }),
        ...(thumbnail !== undefined && { thumbnail }),
        ...(description !== undefined && { description }),
        ...(displayOrder !== undefined && { displayOrder }),
        ...(active !== undefined && { active }),
        ...(liveStatus !== undefined && { liveStatus }),
      },
    });

    notifyChannelChange();
    return NextResponse.json(channel);
  } catch {
    return NextResponse.json(
      { error: "Gagal mengemas kini saluran" },
      { status: 500 }
    );
  }
}

// DELETE channel
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Tidak dibenarkan" }, { status: 401 });
    }

    const { id } = await params;

    // Verify channel exists before deleting
    const existing = await prisma.channel.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Saluran tidak dijumpai" },
        { status: 404 }
      );
    }

    // Count related programs for warning
    const programCount = await prisma.program.count({ where: { channelId: id } });

    // Check if force delete is requested
    const { searchParams } = new URL(request.url);
    const force = searchParams.get("force") === "true";

    if (programCount > 0 && !force) {
      return NextResponse.json(
        {
          warning: true,
          message: `Saluran ini mempunyai ${programCount} program jadual yang berkaitan.`,
          programCount,
          channelId: id,
          channelName: existing.name,
        },
        { status: 200 }
      );
    }

    await prisma.channel.delete({ where: { id } });

    notifyChannelChange();
    return NextResponse.json({ success: true, deletedId: id, programsDeleted: programCount });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Gagal memadam saluran", detail: message },
      { status: 500 }
    );
  }
}
