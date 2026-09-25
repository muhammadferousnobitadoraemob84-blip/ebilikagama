import { NextRequest, NextResponse } from "next/server";
import { verifyToken, revokeUserSessions, SESSION_COOKIE } from "@/lib/auth";
import { ensureDatabase } from "@/lib/db-init";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  // Optional vsid hint from the client (validated against the user below).
  const hintBody = await request.json().catch(() => null);
  const vsidHint =
    hintBody && typeof hintBody.vsid === "string" ? hintBody.vsid : null;

  // Read the token from the cookie (cookies() is unreliable in some route
  // contexts) and revoke it server-side so the session is dead everywhere —
  // other tabs and any copied cookie lose access immediately.
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  let userId: string | undefined;
  if (token) {
    // Signature check only — the token may already be stale, which is fine:
    // revocation is idempotent and the version bump does the real work.
    try {
      const { payload } = await import("jose").then((m) =>
        m.jwtVerify(token, new TextEncoder().encode(
          process.env.JWT_SECRET || "freebuff-stream-secret-key-change-in-production"
        ))
      );
      userId = typeof payload.userId === "string" ? payload.userId : undefined;
    } catch {
      // Invalid/expired token — nothing to revoke beyond clearing the cookie.
    }
  }

  if (userId) {
    try {
      await ensureDatabase();
      await revokeUserSessions(userId);
    } catch (e) {
      // Never block logout on a DB hiccup; the cookie is cleared regardless.
      console.warn("[LOGOUT] Revocation warning:", e instanceof Error ? e.message : e);
    }

    // ── Visitor Records: close this browser's visitor session (best-effort).
    // The client passes its vsid hint; we verify it belongs to this user
    // before marking logout — never falsely claim logout for another session.
    const vsid = vsidHint;
    try {
      if (vsid) {
        const vs = await prisma.visitorSession.findUnique({ where: { id: vsid } });
        if (vs && vs.userId === userId && vs.status === "active") {
          await prisma.visitorSession.update({
            where: { id: vs.id },
            data: { status: "ended", logoutAt: new Date() },
          });
          await prisma.visitorActivity.create({
            data: {
              sessionId: vs.id,
              userId,
              feature: "auth",
              action: "logout",
            },
          });
        }
      }
    } catch (e) {
      console.warn(
        "[LOGOUT] visitor session warning:",
        e instanceof Error ? e.message : e
      );
    }
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return response;
}
