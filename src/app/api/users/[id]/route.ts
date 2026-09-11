import { NextRequest, NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import bcrypt from "bcryptjs";
import {
  isAdminRole,
  normalizeUsername,
  validateUsername,
  validatePassword,
  serializeUser,
} from "@/lib/user-management";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// PUT /api/users/[id] — edit a user (admin only)
// Body: { fullName?, username?, newPassword?, active?, role? }
// Role changes are owner-only. Owner/own-account protection applies.
// ─────────────────────────────────────────────────────────────
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session || !isAdminRole(session.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const existing = await withRetry(() =>
      prisma.user.findUnique({ where: { id } })
    );
    if (!existing) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const data: Record<string, unknown> = {};

    // Full name
    if (body.fullName !== undefined) {
      const fullName = String(body.fullName).trim();
      if (!fullName) {
        return NextResponse.json({ error: "Full name is required" }, { status: 400 });
      }
      data.fullName = fullName;
    }

    // Username
    if (body.username !== undefined) {
      const usernameError = validateUsername(String(body.username));
      if (usernameError) {
        return NextResponse.json({ error: usernameError }, { status: 400 });
      }
      const username = normalizeUsername(String(body.username));
      if (username.toLowerCase() !== existing.username.toLowerCase()) {
        const dup = await withRetry(() =>
          prisma.user.findFirst({
            where: { username: { equals: username, mode: "insensitive" } },
          })
        );
        if (dup) {
          return NextResponse.json(
            { error: "A user with this username already exists" },
            { status: 409 }
          );
        }
      }
      data.username = username;
    }

    // Password reset — never returns or logs the password
    if (body.newPassword) {
      const passwordError = validatePassword(String(body.newPassword));
      if (passwordError) {
        return NextResponse.json({ error: passwordError }, { status: 400 });
      }
      data.passwordHash = await bcrypt.hash(String(body.newPassword), 10);
    }

    // Account status
    if (body.active !== undefined) {
      // Prevent disabling/deleting your own account or the owner account
      if (id === session.userId) {
        return NextResponse.json(
          { error: "You cannot change the status of your own account" },
          { status: 400 }
        );
      }
      if (existing.role === "owner") {
        return NextResponse.json(
          { error: "The owner account status cannot be changed" },
          { status: 403 }
        );
      }
      data.active = Boolean(body.active);
    }

    // Role change — owner only
    if (body.role !== undefined && String(body.role) !== existing.role) {
      if (session.role !== "owner") {
        return NextResponse.json(
          { error: "Only the owner can change roles" },
          { status: 403 }
        );
      }
      if (existing.role === "owner") {
        return NextResponse.json(
          { error: "The owner role cannot be changed" },
          { status: 403 }
        );
      }
      const newRole = String(body.role).toLowerCase();
      if (!["user", "admin", "owner"].includes(newRole)) {
        return NextResponse.json({ error: "Invalid role" }, { status: 400 });
      }
      data.role = newRole;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No changes provided" }, { status: 400 });
    }

    const updated = await withRetry(() =>
      prisma.user.update({ where: { id }, data })
    );

    return NextResponse.json({
      success: true,
      user: serializeUser({
        id: updated.id,
        username: updated.username,
        fullName: updated.fullName,
        role: updated.role,
        active: updated.active,
        lastLogin: updated.lastLogin,
        createdAt: updated.createdAt,
      }),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[USERS] PUT error:", msg);
    if (msg.includes("Unique constraint")) {
      return NextResponse.json(
        { error: "A user with this username already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────
// DELETE /api/users/[id] — delete a user (admin only)
// ─────────────────────────────────────────────────────────────
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session || !isAdminRole(session.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    if (id === session.userId) {
      return NextResponse.json(
        { error: "You cannot delete your own account" },
        { status: 400 }
      );
    }

    const existing = await withRetry(() =>
      prisma.user.findUnique({ where: { id } })
    );
    if (!existing) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (existing.role === "owner") {
      return NextResponse.json(
        { error: "The owner account cannot be deleted" },
        { status: 403 }
      );
    }
    // Only the owner can delete other admins
    if (existing.role === "admin" && session.role !== "owner") {
      return NextResponse.json(
        { error: "Only the owner can delete administrator accounts" },
        { status: 403 }
      );
    }

    await withRetry(() => prisma.user.delete({ where: { id } }));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(
      "[USERS] DELETE error:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
  }
}
