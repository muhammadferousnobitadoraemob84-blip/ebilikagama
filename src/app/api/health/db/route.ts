import { NextResponse } from "next/server";
import { prisma, isNonRetryableDbError } from "@/lib/prisma";
import { ensureDatabase, getDbFatalError, isDatabaseDown } from "@/lib/db-init";

export const dynamic = "force-dynamic";

/**
 * Public (unauthenticated) database health probe.
 * Returns only status information — never user data or secrets — so that
 * outages like an exhausted Neon transfer quota can be diagnosed without
 * signing in (sign-in itself is unavailable when the DB is down).
 */
export async function GET() {
  const started = Date.now();

  // Breaker open: the DB was just proven down — report instantly without a
  // doomed probe, using the stored (secret-free) fatal reason.
  if (isDatabaseDown()) {
    const message = getDbFatalError() ?? "";
    const quotaExceeded =
      message.includes("data transfer quota") || message.includes("53000");
    return NextResponse.json(
      {
        status: "degraded",
        database: "unreachable",
        permanent: true,
        reason: quotaExceeded
          ? "database_transfer_quota_exhausted"
          : "database_unreachable",
        detail: quotaExceeded
          ? "The database provider's data-transfer quota is exhausted. Queries will fail until the quota resets or the plan is upgraded."
          : "The database could not be reached. It may be starting up or temporarily unavailable.",
        latencyMs: 0,
        checkedAt: new Date().toISOString(),
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Fast single-row probe; do NOT run migrations or any write here.
  try {
    await prisma.$queryRaw`SELECT 1`;
    // Init runs lazily elsewhere; report its memoized state only.
    const initReady = await Promise.race([
      ensureDatabase(),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 4000)),
    ]);
    return NextResponse.json(
      {
        status: "ok",
        database: "reachable",
        schemaReady: initReady,
        latencyMs: Date.now() - started,
        checkedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const permanent = isNonRetryableDbError(error) || !!getDbFatalError();
    // Map the known Neon quota error to an explicit, actionable hint.
    const quotaExceeded =
      message.includes("data transfer quota") || message.includes("53000");

    console.error("[HEALTH] DB check failed:", message);
    return NextResponse.json(
      {
        status: "degraded",
        database: "unreachable",
        permanent,
        reason: quotaExceeded
          ? "database_transfer_quota_exhausted"
          : "database_unreachable",
        // Safe for public display; never includes credentials or raw SQL.
        detail: quotaExceeded
          ? "The database provider's data-transfer quota is exhausted. Queries will fail until the quota resets or the plan is upgraded."
          : "The database could not be reached. It may be starting up or temporarily unavailable.",
        latencyMs: Date.now() - started,
        checkedAt: new Date().toISOString(),
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
