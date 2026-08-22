import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, { status: string; detail?: string }> = {};

  // Check 1: Environment variables
  checks.database_url = {
    status: process.env.DATABASE_URL ? "configured" : "MISSING",
    detail: process.env.DATABASE_URL
      ? `Provider: ${process.env.DATABASE_URL.split(":")[0]}`
      : "DATABASE_URL environment variable is not set",
  };

  checks.jwt_secret = {
    status: process.env.JWT_SECRET ? "configured" : "using_default",
  };

  checks.node_env = {
    status: process.env.NODE_ENV || "undefined",
  };

  // Check 2: Prisma database connection
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: "connected" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    checks.database = { status: "FAILED", detail: msg };
  }

  // Check 3: User table
  try {
    const userCount = await prisma.user.count();
    checks.users_table = { status: "accessible", detail: `${userCount} users` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    checks.users_table = { status: "FAILED", detail: msg };
  }

  // Check 4: Owner account
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

  // Check 5: Channel table
  try {
    const channelCount = await prisma.channel.count();
    checks.channels_table = { status: "accessible", detail: `${channelCount} channels` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    checks.channels_table = { status: "FAILED", detail: msg };
  }

  // Check 6: Prisma Client version
  checks.prisma_client = {
    status: "loaded",
    detail: `Prisma Client initialized`,
  };

  const allHealthy = Object.values(checks).every(
    (c) => c.status !== "FAILED" && c.status !== "MISSING"
  );

  return NextResponse.json({
    status: allHealthy ? "healthy" : "DEGRADED",
    checks,
    timestamp: new Date().toISOString(),
  });
}
