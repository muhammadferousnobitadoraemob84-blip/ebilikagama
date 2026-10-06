import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { runRadioDiagnostics } from "@/lib/radio-diagnostics";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/radio-diagnostics — ADMIN: RUN RADIO TEST (spec §3).
 * Performs the full real-inspection suite (Drive, indexing, durations,
 * proxy, timeline, clock, JAKIM, azan, alignment) and returns each test's
 * pass/fail with real timings and error details.
 */
export async function GET() {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const report = await runRadioDiagnostics();
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}
