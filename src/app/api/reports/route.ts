import { NextRequest, NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";
import { getAdminSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { runHealthChecks } from "@/lib/health";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/reports?category=…&from=YYYY-MM-DD&to=…&format=csv|json — ADMIN (§23).
 * Categories: radio_broadcast | visitor_activity | user_session |
 *             schedule_adherence | system_health | incident | admin_audit.
 * CSV export is audited; JSON returns the same rows for on-screen tables.
 */
export async function GET(request: NextRequest) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sp = request.nextUrl.searchParams;
  const category = sp.get("category") ?? "radio_broadcast";
  const format = sp.get("format") === "csv" ? "csv" : "json";
  const from = sp.get("from") ? new Date(`${sp.get("from")}T00:00:00`) : new Date(Date.now() - 7 * 86_400_000);
  const to = sp.get("to") ? new Date(`${sp.get("to")}T23:59:59.999`) : new Date();

  try {
    await ensureDatabase();
    let header: string[] = [];
    let rows: (string | number | null)[][] = [];

    switch (category) {
      case "radio_broadcast": {
        const data = await withRetry(() =>
          prisma.radioPlayback.findMany({ where: { startedAt: { gte: from, lte: to } }, orderBy: { startedAt: "asc" }, take: 5000 })
        );
        header = ["Start", "End", "Track", "Track ID", "Status", "Played (s)", "Expected (s)", "Azan interrupted", "Azan prayer"];
        rows = data.map((r) => [
          r.startedAt.toISOString(), r.endedAt?.toISOString() ?? "", r.trackTitle, r.trackId, r.status,
          Math.round(r.durationPlayed), Math.round(r.expectedDuration), r.azanInterrupted ? "yes" : "no", r.azanPrayer ?? "",
        ]);
        break;
      }
      case "visitor_activity": {
        const data = await withRetry(() =>
          prisma.visitorActivity.findMany({
            where: { createdAt: { gte: from, lte: to } },
            orderBy: { createdAt: "asc" },
            take: 5000,
            include: { user: { select: { username: true, fullName: true, role: true } } },
          })
        );
        header = ["Timestamp", "User", "Full name", "Role", "Feature", "Action", "Page"];
        rows = data.map((r) => [
          r.createdAt.toISOString(), r.user.username, r.user.fullName ?? "", r.user.role, r.feature, r.action, r.page ?? "",
        ]);
        break;
      }
      case "user_session": {
        const data = await withRetry(() =>
          prisma.visitorSession.findMany({
            where: { loginAt: { gte: from, lte: to } },
            orderBy: { loginAt: "asc" },
            take: 5000,
            include: { user: { select: { username: true, fullName: true, role: true } } },
          })
        );
        header = ["Login", "Last activity", "Logout", "User", "Full name", "Role", "Status", "Duration (s)"];
        rows = data.map((r) => [
          r.loginAt.toISOString(), r.lastActivityAt.toISOString(), r.logoutAt?.toISOString() ?? "",
          r.user.username, r.user.fullName ?? "", r.user.role, r.status,
          Math.round(Math.max(0, ((r.logoutAt ?? r.lastActivityAt).getTime() - r.loginAt.getTime()) / 1000)),
        ]);
        break;
      }
      case "schedule_adherence": {
        // EPG rows that should have aired in the window vs their status.
        const fromKey = from.toISOString().slice(0, 10);
        const toKey = to.toISOString().slice(0, 10);
        const data = await withRetry(() =>
          prisma.program.findMany({
            where: { date: { gte: fromKey, lte: toKey } },
            orderBy: [{ date: "asc" }, { startTime: "asc" }],
            take: 5000,
            include: { channel: { select: { name: true } } },
          })
        );
        header = ["Date", "Channel", "Program", "Start", "End", "Status"];
        rows = data.map((p) => [p.date, p.channel.name, p.title, p.startTime, p.endTime, p.status]);
        break;
      }
      case "system_health": {
        const report = await runHealthChecks();
        header = ["Check", "Level", "Status", "Detail", "Response (ms)"];
        rows = report.checks.map((c) => [c.label, c.level, c.status, c.detail, c.responseTimeMs ?? ""]);
        break;
      }
      case "incident": {
        const data = await withRetry(() =>
          prisma.incident.findMany({
            where: { firstDetectedAt: { gte: from, lte: to } },
            orderBy: { firstDetectedAt: "desc" },
            take: 5000,
          })
        );
        header = ["First detected", "Last detected", "Service", "Severity", "Status", "Occurrences", "Message"];
        rows = data.map((i) => [
          i.firstDetectedAt.toISOString(), i.lastDetectedAt.toISOString(), i.service, i.severity, i.status, i.occurrences, i.message,
        ]);
        break;
      }
      case "admin_audit": {
        const data = await withRetry(() =>
          prisma.auditLog.findMany({ where: { createdAt: { gte: from, lte: to } }, orderBy: { createdAt: "asc" }, take: 5000 })
        );
        header = ["Timestamp", "Actor", "Action", "Target type", "Target ID", "Result"];
        rows = data.map((r) => [r.createdAt.toISOString(), r.actorName ?? "", r.action, r.targetType ?? "", r.targetId ?? "", r.result]);
        break;
      }
      default:
        return NextResponse.json({ error: "Unknown category" }, { status: 400 });
    }

    await audit({ actor: admin, action: "records.exported", targetType: "report", targetId: category, metadata: { format, rows: rows.length } });

    if (format === "csv") {
      const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const csv = [header.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${category}-${new Date().toISOString().slice(0, 10)}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json({ category, from: from.toISOString(), to: to.toISOString(), header, rows });
  } catch (e) {
    console.error("[REPORTS] failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Failed to build report" }, { status: 500 });
  }
}
