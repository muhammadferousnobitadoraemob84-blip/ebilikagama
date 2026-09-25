import { NextRequest, NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/prisma";
import { createToken } from "@/lib/auth";
import { ensureDatabase, getDbFatalError } from "@/lib/db-init";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  // Step timing: a normal login completes in well under a second; any slow
  // step is identified in the server logs instead of hanging silently.
  const t0 = Date.now();
  let tLookup = 0;
  let tVerify = 0;
  let tSession = 0;
  try {
    const { username, password, isAdmin } = await request.json().catch(() => ({}));

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username dan kata laluan diperlukan" },
        { status: 400 }
      );
    }

    // DB gate with a hard cap: if the (memoized) init/migrations stall, the
    // request fails visibly instead of hanging. Init continues in the
    // background so the next attempt is warm.
    let dbReady = false;
    try {
      dbReady = await Promise.race([
        ensureDatabase(),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000)),
      ]);
    } catch {
      dbReady = false;
    }
    if (!dbReady) {
      const fatal = getDbFatalError();
      console.error(
        `[LOGIN] DB unavailable (total ${Date.now() - t0}ms)` +
          (fatal ? ` — fatal: ${fatal}` : " — init timed out (cold start?)")
      );
      if (!process.env.DATABASE_URL) {
        return NextResponse.json(
          { error: "DATABASE_URL belum disediakan. Sila tambah DATABASE_URL di Vercel → Settings → Environment Variables." },
          { status: 500 }
        );
      }
      // Permanent failure (e.g. Neon transfer quota exhausted): tell clients
      // to back off for minutes, not spin on instant retries. The public
      // message stays generic; only a coarse reason code is exposed.
      const headers = fatal ? { "Retry-After": "300" } : { "Retry-After": "5" };
      return NextResponse.json(
        {
          error: "Perkhidmatan pengesahan tidak tersedia buat sementara. Sila cuba lagi sebentar.",
          ...(fatal ? { reason: "database_unavailable" } : {}),
        },
        { status: 503, headers }
      );
    }

    let user;
    try {
      // Exact (index-backed) match on the unique username column after
      // normalization: trim + lowercase. Using findFirst + mode:"insensitive"
      // compiles to ILIKE which bypasses the unique index; lowering the
      // input instead keeps the lookup O(1) on the index. Usernames are
      // stored normalized by User Management, so casing cannot diverge.
      const normalized = String(username).trim().toLowerCase();
      user = await withRetry(() =>
        prisma.user.findFirst({ where: { username: normalized } })
      );
      if (user && typeof user.tokenVersion !== "number") {
        // Legacy row predating the tokenVersion column — normalize it so the
        // token and future revocations always agree.
        user = await prisma.user.update({
          where: { id: user.id },
          data: { tokenVersion: 1 },
        });
      }
    } catch (dbError) {
      console.error("[LOGIN] Database query failed:", dbError);
      return NextResponse.json(
        { error: "Gagal menyambung ke pangkalan data. Sila cuba lagi sebentar." },
        { status: 500 }
      );
    }
    tLookup = Date.now() - t0;
    console.log(`[LOGIN] lookup ${tLookup}ms user=${user ? "found" : "not-found"}`);

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

    const vStart = Date.now();
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
    tVerify = Date.now() - vStart;
    console.log(`[LOGIN] verify ${tVerify}ms valid=${valid}`);

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

    const sStart = Date.now();
    let token: string;
    try {
      token = await createToken({
        userId: user.id,
        username: user.username,
        role: user.role,
        tokenVersion: user.tokenVersion,
      });
    } catch (tokenError) {
      console.error("[LOGIN] Token creation failed:", tokenError);
      return NextResponse.json(
        { error: "Gagal mencipta sesi" },
        { status: 500 }
      );
    }
    tSession = Date.now() - sStart;

    // Record last login (best-effort; never blocks authentication)
    let visitorSessionId: string | null = null;
    try {
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLogin: new Date() },
      });
    } catch {
      // non-fatal
    }

    // ── Visitor Records: open a session for this login (best-effort) ─────
    // One VisitorSession per successful login; the id is returned so the
    // browser can *hint* it on later activity posts (the server always
    // re-validates ownership — see lib/visitor-records.ts).
    try {
      const vsession = await prisma.visitorSession.create({
        data: {
          userId: user.id,
          userAgent: request.headers.get("user-agent")?.slice(0, 250) ?? null,
        },
      });
      visitorSessionId = vsession.id;
      await prisma.visitorActivity.create({
        data: {
          sessionId: vsession.id,
          userId: user.id,
          feature: "auth",
          action: "login",
        },
      });
    } catch (e) {
      // Visitor Records must never block authentication.
      console.warn(
        "[LOGIN] visitor session warning:",
        e instanceof Error ? e.message : e
      );
    }

    const response = NextResponse.json({
      success: true,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      vsid: visitorSessionId,
    });

    response.cookies.set("admin-token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 14,
      path: "/",
    });

    console.log(
      `[LOGIN] total ${Date.now() - t0}ms (lookup ${tLookup}ms · verify ${tVerify}ms · session ${tSession}ms)`
    );
    return response;
  } catch (error) {
    console.error("[LOGIN] Unexpected error:", error);
    return NextResponse.json(
      { error: "Ralat pelayan dalaman. Sila cuba lagi." },
      { status: 500 }
    );
  }
}
