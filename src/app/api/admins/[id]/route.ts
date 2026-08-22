import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import bcrypt from "bcryptjs";

// PUT update admin (owner only)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session || session.role !== "owner") {
      return NextResponse.json({ error: "Tidak dibenarkan" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const { fullName, username, active, newPassword } = body;

    // Verify target exists
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Admin tidak dijumpai" },
        { status: 404 }
      );
    }

    // Prevent modifying the owner's active status or role
    if (existing.role === "owner") {
      if (active === false) {
        return NextResponse.json(
          { error: "Akaun owner tidak boleh dinyahaktifkan." },
          { status: 400 }
        );
      }
    }

    const updateData: Record<string, unknown> = {};

    if (fullName !== undefined) updateData.fullName = fullName || null;

    if (username && username !== existing.username) {
      const dup = await prisma.user.findUnique({ where: { username } });
      if (dup) {
        return NextResponse.json(
          { error: "Username ini sudah digunakan. Sila gunakan username lain." },
          { status: 400 }
        );
      }
      updateData.username = username;
    }

    if (active !== undefined && existing.role !== "owner") {
      updateData.active = active;
    }

    if (newPassword) {
      if (newPassword.length < 6) {
        return NextResponse.json(
          { error: "Kata laluan mestilah sekurang-kurangnya 6 aksara." },
          { status: 400 }
        );
      }
      updateData.passwordHash = await bcrypt.hash(newPassword, 10);
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "Tiada perubahan dilakukan" },
        { status: 400 }
      );
    }

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        username: true,
        fullName: true,
        role: true,
        active: true,
        createdAt: true,
      },
    });

    return NextResponse.json(updated);
  } catch {
    return NextResponse.json(
      { error: "Gagal mengemas kini admin" },
      { status: 500 }
    );
  }
}

// DELETE admin (owner only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session || session.role !== "owner") {
      return NextResponse.json({ error: "Tidak dibenarkan" }, { status: 403 });
    }

    const { id } = await params;

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Admin tidak dijumpai" },
        { status: 404 }
      );
    }

    // Prevent deleting the owner
    if (existing.role === "owner") {
      return NextResponse.json(
        { error: "Akaun owner tidak boleh dipadamkan." },
        { status: 400 }
      );
    }

    // Prevent deleting yourself
    if (existing.id === session.userId) {
      return NextResponse.json(
        { error: "Anda tidak boleh memadamkan akaun sendiri." },
        { status: 400 }
      );
    }

    await prisma.user.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Gagal memadam admin" },
      { status: 500 }
    );
  }
}
