import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { withRetry } from "@/lib/prisma";

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "freebuff-stream-secret-key-change-in-production"
);

export interface SessionPayload {
  userId: string;
  username: string;
  role: string;
  tokenVersion?: number;
}

export const SESSION_COOKIE = "admin-token";

/** DB-backed claims every authenticated request must satisfy. */
export interface VerifiedSession extends SessionPayload {
  tokenVersion: number;
}

export async function createToken(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("14d")
    .sign(SECRET);
}

export async function verifyToken(token: string): Promise<VerifiedSession | null> {
  let payload: SessionPayload;
  try {
    const result = await jwtVerify(token, SECRET);
    payload = result.payload as unknown as SessionPayload;
  } catch {
    return null;
  }
  if (!payload?.userId) return null;

  // ── Deep validation against the authoritative database ──────────────
  // The JWT alone is stateless; logout/password-reset/disable must be able
  // to revoke it. Fail CLOSED: any DB error invalidates the session rather
  // than silently trusting a possibly-stale token.
  try {
    const user = await withRetry(() =>
      prisma.user.findUnique({
        where: { id: payload.userId },
        select: { active: true, tokenVersion: true },
      })
    );
    if (!user || !user.active) return null;
    if (typeof payload.tokenVersion !== "number") return null;
    if (user.tokenVersion !== payload.tokenVersion) return null;
  } catch {
    return null;
  }
  return { ...payload, tokenVersion: payload.tokenVersion as number };
}

export async function getSession(): Promise<VerifiedSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifyToken(token);
}

/** True for admin or owner sessions. */
export function isAdminRole(role: string | undefined | null): boolean {
  return role === "admin" || role === "owner";
}

/**
 * Server-side admin authorization for API routes.
 * Returns the session when the caller is an authenticated admin/owner,
 * otherwise null — respond with 403 when null.
 */
export async function getAdminSession(): Promise<VerifiedSession | null> {
  const session = await getSession();
  if (!session || !isAdminRole(session.role)) return null;
  return session;
}

export async function verifyAndLeaveCookie(): Promise<VerifiedSession | null> {
  // For server components/pages that need to read the session cookie without
  // writing a new one (Next.js forbidden to read and write in the same request).
  return getSession();
}

/**
 * Invalidate every outstanding token for a user by bumping tokenVersion.
 * Called on logout, password reset, disable, and role change.
 * Returns false when the user no longer exists (already "revoked").
 */
export async function revokeUserSessions(userId: string): Promise<boolean> {
  try {
    const updated = await withRetry(() =>
      prisma.user.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 } },
        select: { tokenVersion: true },
      })
    );
    return updated != null;
  } catch {
    // User deleted concurrently — sessions are already dead.
    return false;
  }
}
