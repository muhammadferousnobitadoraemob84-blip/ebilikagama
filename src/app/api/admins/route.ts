import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

// GET all admins (owner only)
export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.role !== "owner") {
      return NextResponse.json({ error: "Tidak dibenarkan" }, { status: 403 });
    }

    const admins = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        fullName: true,
        role: true,
        active: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json(admins);
  } catch {
    return NextResponse.json(
      { error: "Gagal memuatkan senarai admin" },
      { status: 500 }
    );
  }
}

// POST create new admin (owner only)
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== "owner") {
      return NextResponse.json({ error: "Tidak dibenarkan" }, { status: 403 });
    }

    const body = await request.json();
    const { username, fullName, password, confirmPassword } = body;

    // Validation
    if (!username || !password) {
      return NextResponse.json(
        { error: "Username dan kata laluan diperlukan" },
        { status: 400 }
      );
    }

    if (password !== confirmPassword) {
      return NextResponse.json(
        { error: "Password tidak sepadan." },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "Kata laluan mestilah sekurang-kurangnya 6 aksara." },
        { status: 400 }
      );
    }

    // Check duplicate username
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      return NextResponse.json(
        { error: "Username ini sudah digunakan. Sila gunakan username lain." },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const admin = await prisma.user.create({
      data: {
        username,
        fullName: fullName || null,
        passwordHash,
        role: "admin",
        active: true,
      },
      select: {
        id: true,
        username: true,
        fullName: true,
        role: true,
        active: true,
        createdAt: true,
      },
    });

    return NextResponse.json(admin, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Gagal mencipta admin" },
      { status: 500 }
    );
  }
}
