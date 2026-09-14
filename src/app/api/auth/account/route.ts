import { NextRequest, NextResponse } from "next/server";
import { getSession, createToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

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

    const updateData: Record<string, string | { increment: number }> = {};

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
      // Invalidate other outstanding sessions for this user (the current
      // browser gets a fresh token below when the username changed).
      updateData.tokenVersion = { increment: 1 };
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

    // Re-issue the current session after any change: a password change bumps
    // tokenVersion (killing other sessions), so this browser needs a fresh
    // token carrying the new version to stay signed in.
    if (updateData.username || updateData.passwordHash) {
      const newToken = await createToken({
        userId: updatedUser.id,
        username: updatedUser.username,
        role: updatedUser.role,
        tokenVersion: updatedUser.tokenVersion,
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
