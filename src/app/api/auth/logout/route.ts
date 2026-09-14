import { NextRequest, NextResponse } from "next/server";
import { verifyToken, revokeUserSessions, SESSION_COOKIE } from "@/lib/auth";
import { ensureDatabase } from "@/lib/db-init";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
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
