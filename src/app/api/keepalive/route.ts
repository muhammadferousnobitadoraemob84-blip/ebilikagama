import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Database keep-alive endpoint
// Keeps Neon free-tier database from sleeping
// Can be called by Vercel cron, external monitoring, or anyone
// Schedule: every 5 minutes via Vercel cron in vercel.json

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Simple query to keep Neon awake
    await prisma.$queryRaw`SELECT 1 as alive`;

    return NextResponse.json({
      status: "alive",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[KEEPALIVE] Database ping failed:", msg);

    // Try once more after a short delay (wake-up from cold start)
    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      await prisma.$queryRaw`SELECT 1 as alive`;
      return NextResponse.json({
        status: "alive_after_retry",
        database: "connected",
        timestamp: new Date().toISOString(),
      });
    } catch {
      return NextResponse.json(
        {
          status: "failed",
          error: msg,
          timestamp: new Date().toISOString(),
        },
        { status: 503 }
      );
    }
  }
}
