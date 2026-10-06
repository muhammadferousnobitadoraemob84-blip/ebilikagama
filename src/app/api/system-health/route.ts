import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { runHealthChecks } from "@/lib/health";
import { reportIncident } from "@/lib/incidents";
import { ensureDatabase } from "@/lib/db-init";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/system-health — ADMIN: run REAL checks now (spec §2).
 * Every request performs fresh probes; nothing is hardcoded "Online".
 * Failures are reported into the Incident Center for cross-request memory.
 */
export async function GET() {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const report = await runHealthChecks();

  // Persist red services as incidents so the Incident Center shows them even
  // before anyone opens this page (best-effort).
  if (report.overall === "unhealthy") {
    await ensureDatabase().catch(() => {});
    for (const check of report.checks.filter((c) => c.level === "red")) {
      await reportIncident({
        service: check.key === "database" || check.key === "prisma" || check.key === "db_init" ? "database" : check.key === "drive" ? "drive" : check.key === "jakim" ? "jakim" : check.key === "audio_proxy" ? "audio" : check.key === "radio_scheduler" ? "radio" : check.key === "azan_scheduler" ? "azan" : "scheduler",
        kind: `health_${check.key}`,
        severity: "error",
        message: `${check.label}: ${check.detail}`,
      });
    }
  }

  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}
