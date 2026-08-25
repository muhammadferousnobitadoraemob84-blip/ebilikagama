import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Vercel Cron: runs every 5 minutes to keep Neon database awake
// Configure in vercel.json: { "crons": [{ "path": "/api/cron/keep-alive", "schedule": "*/5 * * *" }] }
// Also accessible via GET from external monitoring services (UptimeRobot, etc.)

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Verify it's either a Vercel cron request or has the correct secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  
  if (!isVercelCron && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Simple query to keep Neon awake
    await prisma.$queryRaw`SELECT 1 as alive`;
    
    // Also check table count to confirm full connectivity
    const tables = await prisma.$queryRaw`
      SELECT COUNT(*) as count FROM information_schema.tables 
      WHERE table_schema = 'public'
    ` as { count: bigint }[];

    return NextResponse.json({
      status: "alive",
      database: "connected",
      tables: tables[0]?.count || 0,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[KEEP-ALIVE] Database ping failed:", msg);
    
    // Try to wake up the database by retrying once after a short delay
    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      await prisma.$queryRaw`SELECT 1 as alive`;
      return NextResponse.json({
        status: "alive_after_retry",
        database: "connected",
        timestamp: new Date().toISOString(),
      });
    } catch {
      return NextResponse.json({
        status: "failed",
        error: msg,
        timestamp: new Date().toISOString(),
      }, { status: 503 });
    }
  }
}
