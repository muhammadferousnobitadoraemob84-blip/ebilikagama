import { NextRequest, NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { ensureDatabase } from "@/lib/db-init";
import bcrypt from "bcryptjs";
import {
  isAdminRole,
  normalizeUsername,
  validateUsername,
  validatePassword,
  serializeUser,
} from "@/lib/user-management";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface BulkRow {
  fullName: string;
  username: string;
  password: string;
}

interface BulkResultRow {
  fullName: string;
  username: string;
  status: "created" | "skipped" | "failed";
  reason?: string;
}

// ─────────────────────────────────────────────────────────────
// POST /api/users/bulk — create multiple users (admin only)
// Body: { users: [{ fullName, username, password }] }
// Every row is validated; invalid rows never block valid ones.
// Duplicate usernames are skipped with a clear reason.
// ─────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session || !isAdminRole(session.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const dbReady = await ensureDatabase();
    if (!dbReady) {
      return NextResponse.json({ error: "Database unavailable" }, { status: 500 });
    }

    const body = await request.json().catch(() => ({}));
    const rows: BulkRow[] = Array.isArray(body.users) ? body.users : [];

    if (rows.length === 0) {
      return NextResponse.json({ error: "No users provided" }, { status: 400 });
    }
    if (rows.length > 200) {
      return NextResponse.json(
        { error: "Too many users in one batch (max 200)" },
        { status: 400 }
      );
    }

    // Load all existing usernames once for fast duplicate checks
    const existingUsers = await withRetry(() =>
      prisma.user.findMany({ select: { username: true } })
    );
    const existingSet = new Set(
      existingUsers.map((u) => u.username.toLowerCase())
    );

    const results: BulkResultRow[] = [];
    const created: ReturnType<typeof serializeUser>[] = [];
    let createdCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const row of rows) {
      const fullName = String(row?.fullName || "").trim();
      const rawUsername = String(row?.username || "");
      const password = String(row?.password || "");
      const username = normalizeUsername(rawUsername);

      // Validate every row
      if (!fullName) {
        failedCount++;
        results.push({
          fullName,
          username,
          status: "failed",
          reason: "Full name is required",
        });
        continue;
      }
      const usernameError = validateUsername(rawUsername);
      if (usernameError) {
        failedCount++;
        results.push({ fullName, username, status: "failed", reason: usernameError });
        continue;
      }
      const passwordError = validatePassword(password);
      if (passwordError) {
        failedCount++;
        results.push({ fullName, username, status: "failed", reason: passwordError });
        continue;
      }
      if (existingSet.has(username)) {
        skippedCount++;
        results.push({
          fullName,
          username,
          status: "skipped",
          reason: "Username already exists",
        });
        continue;
      }
      // Duplicate within this same batch
      if (results.some((r) => r.username === username && r.status !== "failed")) {
        skippedCount++;
        results.push({
          fullName,
          username,
          status: "skipped",
          reason: "Duplicate within this batch",
        });
        continue;
      }

      try {
        const passwordHash = await bcrypt.hash(password, 10);
        const user = await withRetry(() =>
          prisma.user.create({
            data: {
              username,
              fullName,
              passwordHash,
              role: "user",
              active: true,
            },
          })
        );
        existingSet.add(username);
        createdCount++;
        results.push({ fullName, username, status: "created" });
        created.push(
          serializeUser({
            id: user.id,
            username: user.username,
            fullName: user.fullName,
            role: user.role,
            active: user.active,
            lastLogin: user.lastLogin,
            createdAt: user.createdAt,
          })
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        if (msg.includes("Unique constraint")) {
          skippedCount++;
          results.push({
            fullName,
            username,
            status: "skipped",
            reason: "Username already exists",
          });
        } else {
          failedCount++;
          results.push({ fullName, username, status: "failed", reason: "Database error" });
        }
      }
    }

    return NextResponse.json({
      success: true,
      createdCount,
      skippedCount,
      failedCount,
      results,
      created,
    });
  } catch (error) {
    console.error(
      "[USERS-BULK] Error:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json({ error: "Bulk creation failed" }, { status: 500 });
  }
}
