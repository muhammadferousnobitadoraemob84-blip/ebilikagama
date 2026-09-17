import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionWithStatus } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const check = await getSessionWithStatus();

  // Session store temporarily unreachable: the session cookie may well be
  // perfectly valid. Report 503 (ambiguous) instead of "logged out" so the
  // client never evicts an authenticated user on a transient DB blip.
  if (check.status === "transient-error") {
    return NextResponse.json(
      { loggedIn: false, error: "session_check_unavailable" },
      { status: 503 }
    );
  }

  if (check.status !== "authenticated") {
    return NextResponse.json({ loggedIn: false });
  }

  const session = check.session;

  // Fetch user data
  const user = await prisma.user
    .findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        username: true,
        fullName: true,
        profilePhoto: true,
        role: true,
        active: true,
      },
    })
    .catch(() => null);

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
}
