import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Database keep-alive endpoint
// Keeps Neon free-tier database from sleeping
// Set up an external cron (e.g. cron-job.org) to call this every 5 minutes

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1 as alive`;
    return NextResponse.json({
      status: "alive",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // Retry once after delay (cold start wake-up)
    await new Promise((resolve) => setTimeout(resolve, 3000));
    try {
      await prisma.$queryRaw`SELECT 1 as alive`;
      return NextResponse.json({
        status: "alive_after_retry",
        timestamp: new Date().toISOString(),
      });
    } catch {
      return NextResponse.json({ status: "failed", error: msg }, { status: 503 });
    }
  }
}
