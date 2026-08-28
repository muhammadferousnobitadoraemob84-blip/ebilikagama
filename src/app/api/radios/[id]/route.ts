import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET single radio
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const radio = await prisma.radio.findUnique({ where: { id } });

    if (!radio) {
      return NextResponse.json(
        { error: "Radio tidak dijumpai" },
        { status: 404 }
      );
    }

    const optimized = {
      ...radio,
      thumbnail:
        radio.thumbnail && radio.thumbnail.startsWith("data:")
          ? `/api/images/radio/${radio.id}`
          : radio.thumbnail,
    };

    return NextResponse.json(optimized);
  } catch {
    return NextResponse.json(
      { error: "Gagal memuatkan radio" },
      { status: 500 }
    );
  }
}

// PUT update radio (admin only)
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
    const { name, description, thumbnail, twitchUsername, category, enabled, displayOrder } = body;

    const existing = await prisma.radio.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Radio tidak dijumpai" },
        { status: 404 }
      );
    }

    const radio = await prisma.radio.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(thumbnail !== undefined && { thumbnail }),
        ...(twitchUsername !== undefined && { twitchUsername: twitchUsername || null }),
        ...(category !== undefined && { category }),
        ...(enabled !== undefined && { enabled }),
        ...(displayOrder !== undefined && { displayOrder }),
      },
    });

    return NextResponse.json(radio);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[RADIOS] PUT error:", msg);
    return NextResponse.json(
      { error: "Gagal mengemas kini radio" },
      { status: 500 }
    );
  }
}

// DELETE radio (admin only)
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

    const existing = await prisma.radio.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Radio tidak dijumpai" },
        { status: 404 }
      );
    }

    await prisma.radio.delete({ where: { id } });

    return NextResponse.json({ success: true, deletedId: id });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Gagal memadam radio", detail: msg },
      { status: 500 }
    );
  }
}
