import { NextRequest, NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";
import { getAdminSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getRetention, setRetention, sweepFamily } from "@/lib/retention";

export const dynamic = "force-dynamic";

const ACTIONS = [
  "user.created", "user.updated", "user.disabled", "user.enabled", "user.deleted", "user.password_reset", "role.changed",
  "channel.created", "channel.updated", "channel.deleted",
  "program.created", "program.updated", "program.deleted", "program.duplicated",
  "radio.playlist_arranged", "radio.config_changed",
  "azan.assignments_changed", "azan.prayer_zone_changed", "azan.test_mode_applied", "azan.test_mode_reset",
  "emergency.created", "emergency.activated", "emergency.stopped",
  "setting.changed", "drive.folder_changed", "youtube.connected", "youtube.disconnected",
  "backup.created", "records.exported", "retention.changed",
  "notification.created", "incident.updated",
];

/**
 * GET /api/audit-logs — ADMIN: filtered, paginated audit trail (spec §9).
 * Rows are immutable here: no PUT/PATCH exists. Owner may manage retention.
 */
export async function GET(request: NextRequest) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sp = request.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(10, Number(sp.get("pageSize") ?? "50") || 50));
  const from = sp.get("from");
  const to = sp.get("to");
  const action = sp.get("action") ?? "";
  const actor = sp.get("actor") ?? "";
  const search = (sp.get("search") ?? "").trim();
  const exportCsv = sp.get("export") === "1";

  const where: Record<string, unknown> = {};
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: new Date(`${from}T00:00:00`) } : {}),
      ...(to ? { lte: new Date(`${to}T23:59:59.999`) } : {}),
    };
  }
  if (action) where.action = action;
  if (actor) where.actorUserId = actor;
  if (search) {
    where.OR = [
      { actorName: { contains: search, mode: "insensitive" } },
      { action: { contains: search, mode: "insensitive" } },
      { targetType: { contains: search, mode: "insensitive" } },
      { targetId: { contains: search, mode: "insensitive" } },
    ];
  }

  try {
    await ensureDatabase();
    if (exportCsv) {
      // Export (authorized data only, audited).
      const rows = await withRetry(() =>
        prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 5000 })
      );
      await audit({ actor: admin, action: "records.exported", targetType: "audit_log", metadata: { rows: rows.length } });
      const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const header = "Timestamp,Actor,Action,TargetType,TargetId,Result,Metadata";
      const body = rows
        .map((r) => [r.createdAt.toISOString(), r.actorName ?? "", r.action, r.targetType ?? "", r.targetId ?? "", r.result, r.metadata ?? ""].map(esc).join(","))
        .join("\n");
      return new NextResponse(`${header}\n${body}`, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="audit-logs-${new Date().toISOString().slice(0, 10)}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const [total, rows, actors] = await Promise.all([
      withRetry(() => prisma.auditLog.count({ where })),
      withRetry(() =>
        prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: exportCsv ? undefined : (page - 1) * pageSize,
          take: exportCsv ? undefined : pageSize,
        })
      ),
      withRetry(() =>
        prisma.auditLog.groupBy({ by: ["actorUserId", "actorName"], _count: { _all: true } })
      ),
    ]);

    const retention = await getRetention("audit");
    return NextResponse.json({
      rows,
      total,
      page,
      pageSize,
      actions: ACTIONS,
      actors: actors.map((a) => ({ id: a.actorUserId, name: a.actorName, count: a._count._all })),
      retention,
    });
  } catch (e) {
    console.error("[AUDIT-API] failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Failed to load audit logs" }, { status: 500 });
  }
}

/**
 * POST /api/audit-logs — OWNER ONLY: manage audit-log retention (§9/§31).
 * Body: { value: "30"|"90"|"180"|"365"|"forever", applyNow?: boolean }
 */
export async function POST(request: NextRequest) {
  const admin = await getAdminSession();
  if (!admin || admin.role !== "owner") {
    return NextResponse.json({ error: "Only the owner can manage audit retention" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { value?: string; applyNow?: boolean } | null;
  const value = body?.value;
  if (!value || !["30", "90", "180", "365", "forever"].includes(value)) {
    return NextResponse.json({ error: "Invalid retention value" }, { status: 400 });
  }
  await setRetention("audit", value as "30" | "90" | "180" | "365" | "forever");
  await audit({ actor: admin, action: "retention.changed", targetType: "audit_log", metadata: { value, applyNow: !!body?.applyNow } });
  const sweep = body?.applyNow ? await sweepFamily("audit") : null;
  return NextResponse.json({ ok: true, value, sweep });
}
