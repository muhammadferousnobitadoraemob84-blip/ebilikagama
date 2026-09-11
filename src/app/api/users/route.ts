import { NextRequest, NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { ensureDatabase } from "@/lib/db-init";
import bcrypt from "bcryptjs";
import {
  USER_DOMAIN,
  isAdminRole,
  normalizeUsername,
  validateUsername,
  validatePassword,
  serializeUser,
} from "@/lib/user-management";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// GET /api/users — list users (admin only)
// Query: ?search=&role=&status=&sort=name_asc|name_desc|newest|oldest
// ─────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session || !isAdminRole(session.role)) {
      return NextResponse.json(
        { error: "Forbidden", code: "FORBIDDEN" },
        { status: 403 }
      );
    }

    const dbReady = await ensureDatabase();
    if (!dbReady) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim() || "";
    const roleFilter = searchParams.get("role") || "";
    const statusFilter = searchParams.get("status") || "";
    const sort = searchParams.get("sort") || "name_asc";

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: "insensitive" } },
        { username: { contains: search, mode: "insensitive" } },
      ];
    }
    if (roleFilter) where.role = roleFilter;
    if (statusFilter === "active") where.active = true;
    if (statusFilter === "disabled") where.active = false;

    const orderBy =
      sort === "name_desc"
        ? [{ fullName: "desc" as const }, { username: "desc" as const }]
        : sort === "newest"
        ? [{ createdAt: "desc" as const }]
        : sort === "oldest"
        ? [{ createdAt: "asc" as const }]
        : [{ fullName: "asc" as const }, { username: "asc" as const }];

    const users = await withRetry(() =>
      prisma.user.findMany({ where, orderBy })
    );

    return NextResponse.json(
      users.map((u) =>
        serializeUser({
          id: u.id,
          username: u.username,
          fullName: u.fullName,
          role: u.role,
          active: u.active,
          lastLogin: u.lastLogin,
          createdAt: u.createdAt,
        })
      )
    );
  } catch (error) {
    console.error(
      "[USERS] GET error:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json(
      { error: "Failed to load users" },
      { status: 500 }
    );
  }
}

// ─────────────────────────────────────────────────────────────
// POST /api/users — create a single user (admin only)
// Body: { fullName, username, password, role? }
// Only owners may create admin/owner accounts.
// ─────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session || !isAdminRole(session.role)) {
      return NextResponse.json(
        { error: "Forbidden", code: "FORBIDDEN" },
        { status: 403 }
      );
    }

    const dbReady = await ensureDatabase();
    if (!dbReady) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const fullName = String(body.fullName || "").trim();
    const rawUsername = String(body.username || "");
    const password = String(body.password || "");
    const requestedRole = String(body.role || "user").toLowerCase();

    // Validation
    if (!fullName) {
      return NextResponse.json({ error: "Full name is required" }, { status: 400 });
    }
    if (fullName.length > 120) {
      return NextResponse.json({ error: "Full name is too long" }, { status: 400 });
    }

    const usernameError = validateUsername(rawUsername);
    if (usernameError) {
      return NextResponse.json({ error: usernameError }, { status: 400 });
    }
    const username = normalizeUsername(rawUsername);

    const passwordError = validatePassword(password);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    // Role assignment: only the owner can mint admin/owner accounts.
    let role = "user";
    if (requestedRole === "admin" || requestedRole === "owner") {
      if (session.role !== "owner") {
        return NextResponse.json(
          { error: "Only the owner can create administrator accounts" },
          { status: 403 }
        );
      }
      role = requestedRole === "owner" ? "owner" : "admin";
    }

    // Duplicate protection (case-insensitive)
    const existing = await withRetry(() =>
      prisma.user.findFirst({ where: { username: { equals: username, mode: "insensitive" } } })
    );
    if (existing) {
      return NextResponse.json(
        { error: "A user with this username already exists", code: "DUPLICATE" },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await withRetry(() =>
      prisma.user.create({
        data: {
          username,
          fullName,
          passwordHash,
          role,
          active: true,
        },
      })
    );

    return NextResponse.json(
      {
        success: true,
        user: serializeUser({
          id: user.id,
          username: user.username,
          fullName: user.fullName,
          role: user.role,
          active: user.active,
          lastLogin: user.lastLogin,
          createdAt: user.createdAt,
        }),
      },
      { status: 201 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[USERS] POST error:", msg);
    if (msg.includes("Unique constraint")) {
      return NextResponse.json(
        { error: "A user with this username already exists", code: "DUPLICATE" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  }
}
