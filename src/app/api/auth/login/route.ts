import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createToken } from "@/lib/auth";
import { ensureDatabase } from "@/lib/db-init";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username dan kata laluan diperlukan" },
        { status: 400 }
      );
    }

    // Ensure database is ready (auto-init on first request)
    const dbReady = await ensureDatabase();
    if (!dbReady) {
      return NextResponse.json(
        { error: "Pangkalan data tidak tersedia. Sila pastikan DATABASE_URL disediakan di Vercel." },
        { status: 500 }
      );
    }

    // Look up user
    let user;
    try {
      user = await prisma.user.findUnique({ where: { username } });
    } catch (dbError) {
      console.error("[LOGIN] Database query failed:", dbError);
      return NextResponse.json(
        { error: "Gagal menyambung ke pangkalan data. Sila cuba lagi sebentar." },
        { status: 500 }
      );
    }

    if (!user) {
      return NextResponse.json(
        { error: "Username atau kata laluan salah" },
        { status: 401 }
      );
    }

    // Check if account is active
    if (!user.active) {
      return NextResponse.json(
        { error: "Akaun ini telah dinyahaktifkan. Sila hubungi owner." },
        { status: 403 }
      );
    }

    // Verify password
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

    // Create JWT token
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
      maxAge: 60 * 60 * 24,
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
