import { NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, { status: string; detail?: string }> = {};

  // Auto-initialize if needed
  let dbReady = false;
  try {
    dbReady = await ensureDatabase();
    checks.auto_init = {
      status: dbReady ? "ready" : "FAILED",
      detail: dbReady ? "Database initialized" : "Could not initialize database",
    };
  } catch (e) {
    const dbError = e instanceof Error ? e.message : String(e);
    checks.auto_init = {
      status: "FAILED",
      detail: `Exception: ${dbError}`,
    };
  }

  // Check environment variables
  checks.database_url = {
    status: process.env.DATABASE_URL ? "configured" : "MISSING",
    detail: process.env.DATABASE_URL
      ? `Provider: ${process.env.DATABASE_URL.split(":")[0]}`
      : "DATABASE_URL environment variable is not set in Vercel",
  };

  // Stale-database incident probe: which DATABASE_HOST does THIS runtime
  // actually hold, and which DB-related env vars exist. Hostname only —
  // never credentials.
  try {
    const dbRelated = Object.keys(process.env)
      .filter((k) => /DATABASE|POSTGRES|NEON|PG/i.test(k))
      .sort();
    let envHost = "unset";
    if (process.env.DATABASE_URL) {
      try {
        envHost = new URL(process.env.DATABASE_URL).hostname;
      } catch {
        envHost = "unparseable";
      }
    }
    checks.env_probe = {
      status: "ok",
      detail: `host=${envHost} vars=${dbRelated.join("|") || "none"}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    checks.env_probe = { status: "FAILED", detail: msg };
  }

  checks.jwt_secret = {
    status: process.env.JWT_SECRET ? "configured" : "using_default",
  };

  checks.node_env = {
    status: process.env.NODE_ENV || "undefined",
  };

  // Direct connection test with retry (handles Neon cold starts)
  try {
    await withRetry(() => prisma.$queryRaw`SELECT 1`);
    checks.direct_connection = { status: "connected" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    checks.direct_connection = { status: "FAILED", detail: msg };
  }

  // Check if tables exist
  try {
    const tables = await withRetry(() =>
      prisma.$queryRaw`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' 
        ORDER BY table_name
      `
    ) as { table_name: string }[];
    checks.tables = { 
      status: tables.length > 0 ? 'exists' : 'empty',
      detail: tables.map(t => t.table_name).join(', ') || 'No tables found'
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    checks.tables = { status: "FAILED", detail: msg };
  }

  if (dbReady) {
    // Check database connection
    try {
      await withRetry(() => prisma.$queryRaw`SELECT 1`);
      checks.database = { status: "connected" };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      checks.database = { status: "FAILED", detail: msg };
    }

    // Check User table
    try {
      const userCount = await withRetry(() => prisma.user.count());
      checks.users_table = { status: "accessible", detail: `${userCount} users` };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      checks.users_table = { status: "FAILED", detail: msg };
    }

    // Check owner account
    try {
      const owner = await withRetry(() => prisma.user.findFirst({ where: { role: "owner" } }));
      checks.owner_account = {
        status: owner ? "exists" : "MISSING",
        detail: owner ? `Username: ${owner.username}` : "No owner account found",
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      checks.owner_account = { status: "FAILED", detail: msg };
    }

    // Check channels
    try {
      const channelCount = await withRetry(() => prisma.channel.count());
      checks.channels_table = { status: "accessible", detail: `${channelCount} channels` };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      checks.channels_table = { status: "FAILED", detail: msg };
    }

    // Database identity: which Postgres database/user/version is this runtime
    // actually connected to, and how much content does it hold. Nothing here
    // is sensitive (no host, no credentials) — it exists to diagnose
    // "production shows the wrong database" incidents like the 2026-10-06
    // stale-database one.
    try {
      const ident = (await withRetry(() =>
        prisma.$queryRaw`
          SELECT current_database() AS db, current_user AS usr,
                 split_part(version(), ' ', 2) AS pgver
        `
      )) as { db: string; usr: string; pgver: string }[];
      const settingCount = await withRetry(() => prisma.setting.count());
      const replayCount = await withRetry(() => prisma.replay.count());
      checks.db_identity = {
        status: "ok",
        detail: `db=${ident[0]?.db} user=${ident[0]?.usr} pg=${ident[0]?.pgver} settings=${settingCount} replays=${replayCount}`,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      checks.db_identity = { status: "FAILED", detail: msg };
    }
  }

  const allHealthy = Object.values(checks).every(
    (c) => c.status !== "FAILED" && c.status !== "MISSING"
  );

  return NextResponse.json({
    status: allHealthy ? "healthy" : "DEGRADED",
    checks,
    timestamp: new Date().toISOString(),
  });
}
