import { NextRequest, NextResponse } from "next/server";
import { getSession, createToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

// PUT update account (username/password)
export async function PUT(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Tidak dibenarkan" }, { status: 401 });
    }

    const body = await request.json();
    const { currentPassword, newUsername, newPassword } = body;

    // Verify current password
    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) {
      return NextResponse.json({ error: "Pengguna tidak dijumpai" }, { status: 404 });
    }

    if (currentPassword) {
      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) {
        return NextResponse.json(
          { error: "Kata laluan semasa tidak betul" },
          { status: 401 }
        );
      }
    }

    const updateData: Record<string, string> = {};

    // Change username
    if (newUsername && newUsername !== session.username) {
      const existing = await prisma.user.findUnique({ where: { username: newUsername } });
      if (existing) {
        return NextResponse.json(
          { error: "Username ini sudah digunakan" },
          { status: 400 }
        );
      }
      updateData.username = newUsername;
    }

    // Change password
    if (newPassword) {
      if (newPassword.length < 6) {
        return NextResponse.json(
          { error: "Kata laluan mestilah sekurang-kurangnya 6 aksara" },
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

    const updatedUser = await prisma.user.update({
      where: { id: session.userId },
      data: updateData,
    });

    // If username changed, create a new token
    const response = NextResponse.json({
      success: true,
      username: updatedUser.username,
    });

    if (updateData.username) {
      const newToken = await createToken({
        userId: updatedUser.id,
        username: updatedUser.username,
        role: updatedUser.role,
      });
      response.cookies.set("admin-token", newToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24,
        path: "/",
      });
    }

    return response;
  } catch {
    return NextResponse.json(
      { error: "Gagal mengemas kini akaun" },
      { status: 500 }
    );
  }
}
