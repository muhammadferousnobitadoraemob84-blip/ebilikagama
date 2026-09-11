import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createToken } from "@/lib/auth";
import { ensureDatabase } from "@/lib/db-init";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { username, password, isAdmin } = await request.json().catch(() => ({}));

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username dan kata laluan diperlukan" },
        { status: 400 }
      );
    }

    const dbReady = await ensureDatabase();
    if (!dbReady) {
      if (!process.env.DATABASE_URL) {
        return NextResponse.json(
          { error: "DATABASE_URL belum disediakan. Sila tambah DATABASE_URL di Vercel → Settings → Environment Variables." },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { error: "Pangkalan data tidak tersedia. Sila hubungi pentadbir." },
        { status: 500 }
      );
    }

    let user;
    try {
      // Normalize: trim whitespace; match username case-insensitively via
      // lowercased comparison so casing differences cannot create duplicates.
      const normalized = String(username).trim();
      user = await prisma.user.findFirst({
        where: { username: { equals: normalized, mode: "insensitive" } },
      });
    } catch (dbError) {
      console.error("[LOGIN] Database query failed:", dbError);
      return NextResponse.json(
        { error: "Gagal menyambung ke pangkalan data. Sila cuba lagi sebentar." },
        { status: 500 }
      );
    }

    // Generic error — never reveal whether the username exists.
    if (!user) {
      return NextResponse.json(
        { error: "Username atau kata laluan salah" },
        { status: 401 }
      );
    }

    if (!user.active) {
      return NextResponse.json(
        { error: "Akaun ini telah dinyahaktifkan. Sila hubungi pentadbir." },
        { status: 403 }
      );
    }

    let valid: boolean;
    try {
      valid = await bcrypt.compare(password, user.passwordHash);
    } catch (bcryptError) {
      console.error("[LOGIN] Password verification failed:", bcryptError);
      return NextResponse.json(
        { error: "Ralat pengesahan kata laluan" },
        { status: 500 }
      );
    }

    if (!valid) {
      return NextResponse.json(
        { error: "Username atau kata laluan salah" },
        { status: 401 }
      );
    }

    // Admin sign-in gate: the admin form requires an admin/owner role.
    // This is server-side — the flag alone grants nothing.
    if (isAdmin && user.role !== "admin" && user.role !== "owner") {
      return NextResponse.json(
        { error: "Akaun ini bukan akaun pentadbir." },
        { status: 403 }
      );
    }

    let token: string;
    try {
      token = await createToken({
        userId: user.id,
        username: user.username,
        role: user.role,
      });
    } catch (tokenError) {
      console.error("[LOGIN] Token creation failed:", tokenError);
      return NextResponse.json(
        { error: "Gagal mencipta sesi" },
        { status: 500 }
      );
    }

    // Record last login (best-effort; never blocks authentication)
    try {
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLogin: new Date() },
      });
    } catch {
      // non-fatal
    }

    const response = NextResponse.json({
      success: true,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
    });

    response.cookies.set("admin-token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 14,
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("[LOGIN] Unexpected error:", error);
    return NextResponse.json(
      { error: "Ralat pelayan dalaman. Sila cuba lagi." },
      { status: 500 }
    );
  }
}
