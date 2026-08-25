import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
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

  checks.jwt_secret = {
    status: process.env.JWT_SECRET ? "configured" : "using_default",
  };

  checks.node_env = {
    status: process.env.NODE_ENV || "undefined",
  };

  // Direct connection test (even if dbReady is false)
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.direct_connection = { status: "connected" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    checks.direct_connection = { status: "FAILED", detail: msg };
  }

  // Check if tables exist
  try {
    const tables = await prisma.$queryRaw`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    ` as { table_name: string }[];
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
      await prisma.$queryRaw`SELECT 1`;
      checks.database = { status: "connected" };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      checks.database = { status: "FAILED", detail: msg };
    }

    // Check User table
    try {
      const userCount = await prisma.user.count();
      checks.users_table = { status: "accessible", detail: `${userCount} users` };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      checks.users_table = { status: "FAILED", detail: msg };
    }

    // Check owner account
    try {
      const owner = await prisma.user.findFirst({ where: { role: "owner" } });
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
      const channelCount = await prisma.channel.count();
      checks.channels_table = { status: "accessible", detail: `${channelCount} channels` };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      checks.channels_table = { status: "FAILED", detail: msg };
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
