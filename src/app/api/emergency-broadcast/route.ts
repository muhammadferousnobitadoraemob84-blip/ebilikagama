import { NextRequest, NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";
import { getAdminSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { reportIncident } from "@/lib/incidents";

export const dynamic = "force-dynamic";

/**
 * Emergency Broadcast / Override (spec §11).
 *
 * Priority model (displayed on the site + enforced server-side):
 *   Emergency Broadcast > Scheduled Live Broadcast > Normal Schedule > Default
 *
 * Activation is EXPLICIT: create (scheduled) → activate (requires a client
 * confirmation flag `confirm: true`) → stop. Every transition is audited.
 * Nothing silently interrupts a running broadcast — the public header shows
 * an active emergency banner with its title/description.
 */

function safe(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

/** GET — ADMIN: list overrides (newest first) + currently-active one. */
export async function GET() {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await ensureDatabase();

  try {
    const [rows, active] = await Promise.all([
      withRetry(() => prisma.emergencyBroadcast.findMany({ orderBy: { createdAt: "desc" }, take: 50 })),
      withRetry(() =>
        prisma.emergencyBroadcast.findFirst({
          where: { status: "active", startsAt: { lte: new Date() }, endsAt: { gt: new Date() } },
          orderBy: { activatedAt: "desc" },
        })
      ),
    ]);

    // Auto-expire rows whose window has passed.
    const now = new Date();
    for (const r of rows) {
      if ((r.status === "active" || r.status === "scheduled") && r.endsAt <= now) {
        await prisma.emergencyBroadcast.update({ where: { id: r.id }, data: { status: "expired" } }).catch(() => {});
      }
    }

    return NextResponse.json({
      rows: rows.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        channelName: r.channelName,
        mediaType: r.mediaType,
        mediaRef: r.mediaRef,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        status: r.status,
        activatedAt: r.activatedAt,
        stoppedAt: r.stoppedAt,
        stoppedReason: r.stoppedReason,
        createdByName: r.createdByName,
      })),
      active: active
        ? { id: active.id, title: active.title, description: active.description, channelName: active.channelName, mediaType: active.mediaType, mediaRef: active.mediaRef, endsAt: active.endsAt }
        : null,
    });
  } catch (e) {
    console.error("[EMERGENCY] list failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Failed to load emergency broadcasts" }, { status: 500 });
  }
}

/** POST — ADMIN: create (status=scheduled) or activate. Body: {confirm?: boolean, action?: "activate"|"stop", id} */
export async function POST(request: NextRequest) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await ensureDatabase();

  const body = (await request.json().catch(() => null)) as {
    action?: "create" | "activate" | "stop";
    id?: string;
    confirm?: boolean;
    title?: string;
    description?: string;
    channelId?: string | null;
    mediaType?: string;
    mediaRef?: string | null;
    startsAt?: string;
    endsAt?: string;
    stopReason?: string;
  } | null;

  try {
    // ── ACTIVATE ────────────────────────────────────────────────────────
    if (body?.action === "activate") {
      if (!body.id || !body.confirm) {
        return NextResponse.json({ error: "Confirmation required before activating" }, { status: 400 });
      }
      const existing = await withRetry(() => prisma.emergencyBroadcast.findUnique({ where: { id: body.id! } }));
      if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (existing.status === "stopped" || existing.status === "expired") {
        return NextResponse.json({ error: "Cannot re-activate a stopped/expired broadcast" }, { status: 400 });
      }
      // Deactivate any other active override (single emergency at a time).
      await withRetry(() =>
        prisma.emergencyBroadcast.updateMany({ where: { status: "active", id: { not: body.id! } }, data: { status: "stopped", stoppedAt: new Date(), stoppedReason: "superseded" } })
      );
      const updated = await withRetry(() =>
        prisma.emergencyBroadcast.update({
          where: { id: body.id! },
          data: { status: "active", activatedAt: new Date(), startsAt: existing.startsAt > new Date() ? new Date() : existing.startsAt },
        })
      );
      await audit({ actor: admin, action: "emergency.activated", targetType: "emergency", targetId: updated.id, metadata: { title: updated.title } });
      return NextResponse.json({ ok: true, active: true });
    }

    // ── STOP ────────────────────────────────────────────────────────────
    if (body?.action === "stop") {
      if (!body.id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
      const updated = await withRetry(() =>
        prisma.emergencyBroadcast.updateMany({
          where: { id: body.id, status: { in: ["active", "scheduled"] } },
          data: { status: "stopped", stoppedAt: new Date(), stoppedReason: safe(body.stopReason, 200) ?? "manual_stop" },
        })
      );
      if (updated.count === 0) return NextResponse.json({ error: "Not found or already stopped" }, { status: 404 });
      await audit({ actor: admin, action: "emergency.stopped", targetType: "emergency", targetId: body.id, metadata: { reason: safe(body.stopReason, 200) ?? "manual_stop" } });
      return NextResponse.json({ ok: true });
    }

    // ── CREATE (default) ────────────────────────────────────────────────
    const title = safe(body?.title, 150);
    const startsAt = body?.startsAt ? new Date(body.startsAt) : null;
    const endsAt = body?.endsAt ? new Date(body.endsAt) : null;
    if (!title || !startsAt || !endsAt || endsAt <= startsAt) {
      return NextResponse.json({ error: "Title and a valid start/end window are required" }, { status: 400 });
    }
    let channelName: string | null = null;
    let channelId: string | null = null;
    const wantedChannelId = typeof body?.channelId === "string" && body.channelId.trim() ? body.channelId.trim() : null;
    if (wantedChannelId) {
      const ch = await withRetry(() => prisma.channel.findUnique({ where: { id: wantedChannelId }, select: { name: true } }));
      channelName = ch?.name ?? null;
      channelId = wantedChannelId;
    }
    const created = await withRetry(() =>
      prisma.emergencyBroadcast.create({
        data: {
          title,
          description: safe(body?.description, 1000),
          channelId,
          channelName,
          mediaType: ["program", "youtube", "replay", "text"].includes(body?.mediaType ?? "") ? body!.mediaType! : "text",
          mediaRef: safe(body?.mediaRef, 500),
          startsAt,
          endsAt,
          status: "scheduled",
          createdBy: admin.userId,
          createdByName: admin.username,
        },
      })
    );
    await audit({ actor: admin, action: "emergency.created", targetType: "emergency", targetId: created.id, metadata: { title, channelName } });
    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch (e) {
    console.error("[EMERGENCY] failed:", e instanceof Error ? e.message : e);
    await reportIncident({ service: "scheduler", kind: "emergency_error", severity: "warning", message: `Emergency broadcast API error: ${e instanceof Error ? e.message.slice(0, 150) : "unknown"}` });
    return NextResponse.json({ error: "Operation failed" }, { status: 500 });
  }
}
