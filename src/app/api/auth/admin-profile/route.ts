import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json({ loggedIn: false });
    }

    // Fetch admin profile photo
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        username: true,
        fullName: true,
        profilePhoto: true,
        role: true,
        active: true,
      },
    });

    if (!user || !user.active) {
      return NextResponse.json({ loggedIn: false });
    }

    return NextResponse.json({
      loggedIn: true,
      userId: user.id,
      username: user.username,
      fullName: user.fullName,
      profilePhoto: user.profilePhoto,
      role: user.role,
    });
  } catch {
    return NextResponse.json({ loggedIn: false });
  }
}
