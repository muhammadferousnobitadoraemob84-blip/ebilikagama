import { NextRequest, NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";
import { getAdminSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * GET /api/incidents?status=&service= — ADMIN: System Incidents list (§19).
 * Messages are pre-sanitized at ingestion; stack traces are never stored.
 */
export async function GET(request: NextRequest) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const status = request.nextUrl.searchParams.get("status") ?? "";
  const service = request.nextUrl.searchParams.get("service") ?? "";

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (service) where.service = service;

  try {
    await ensureDatabase();
    const [rows, byStatus, services] = await Promise.all([
      withRetry(() =>
        prisma.incident.findMany({ where, orderBy: { lastDetectedAt: "desc" }, take: 200 })
      ),
      withRetry(() => prisma.incident.groupBy({ by: ["status"], _count: { _all: true } })),
      withRetry(() => prisma.incident.groupBy({ by: ["service"], _count: { _all: true } })),
    ]);
    return NextResponse.json({
      rows,
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
      services: services.map((s) => s.service),
    });
  } catch (e) {
    console.error("[INCIDENTS] list failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Failed to load incidents" }, { status: 500 });
  }
}

/** PATCH /api/incidents — ADMIN: change status (open/investigating/resolved), audited. */
export async function PATCH(request: NextRequest) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { id?: string; status?: string } | null;
  if (!body?.id || !["open", "investigating", "resolved"].includes(body.status ?? "")) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  try {
    const updated = await withRetry(() =>
      prisma.incident.update({
        where: { id: body.id },
        data: {
          status: body.status!,
          resolvedAt: body.status === "resolved" ? new Date() : null,
        },
      })
    );
    await audit({ actor: admin, action: "incident.updated", targetType: "incident", targetId: body.id, metadata: { status: body.status, service: updated.service } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Incident not found" }, { status: 404 });
  }
}
