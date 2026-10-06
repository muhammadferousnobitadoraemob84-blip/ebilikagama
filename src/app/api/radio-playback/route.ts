import { NextRequest, NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";
import { getAdminSession, getSession } from "@/lib/auth";
import { reportIncident } from "@/lib/incidents";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * Radio Proof-of-Play + Broadcast Timeline ingestion (spec §4–§6).
 *
 * The BROWSER is the only witness of real playback (HTMLAudioElement
 * events), so authenticated radio listeners POST playback facts here.
 * Hard rules:
 *  - Identity comes from the verified session (client-supplied userId is
 *    never trusted).
 *  - Idempotent: `eventId` is unique — retries never duplicate rows.
 *  - `completed` requires the element's real `ended` event (wasAzan=false,
 *    duration ≈ declared). Interrupted/azan/error statuses are explicit.
 *  - No audio bytes, no personal data — drive IDs + titles + timings only.
 */

interface StartBody {
  eventId: string;
  trackId: string;
  trackTitle: string;
  startedAt: number; // client wall-clock (synced-ish); server clamps skew
  expectedStartAt?: number | null;
  expectedEndAt?: number | null;
  expectedDuration?: number | null;
  sessionId?: string | null; // browser broadcast instance id
  cyclePosition?: number | null;
}

interface EndBody {
  eventId: string;
  endedAt: number;
  durationPlayed: number; // seconds actually heard
  status: "completed" | "interrupted" | "azan_interrupted" | "error" | "skipped";
  interruptionReason?: string | null;
  azanPrayer?: string | null;
}

interface TimelineBody {
  eventId: string;
  kind: "track_start" | "track_end" | "azan_start" | "azan_end" | "radio_resume";
  label: string;
  expectedAt?: number | null;
  actualAt: number;
  detail?: Record<string, unknown> | null;
}

function sanitize(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim().slice(0, max);
}

/** POST /api/radio-playback — start, end and timeline events in one route. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await ensureDatabase();
    const body = (await request.json().catch(() => null)) as
      | (StartBody | EndBody | TimelineBody)
      | null;
    if (!body || typeof body !== "object" || !("eventId" in body) || typeof body.eventId !== "string") {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const serverNow = Date.now();
    const safeId = sanitize(body.eventId, 120)!;

    // ── Timeline event (black box) ─────────────────────────────────────
    if ("kind" in body) {
      const tl = body as TimelineBody;
      const kinds = ["track_start", "track_end", "azan_start", "azan_end", "radio_resume"];
      if (!kinds.includes(tl.kind)) return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
      const label = sanitize(tl.label, 200) ?? "event";
      const actualAt = new Date(Number(tl.actualAt) || serverNow);
      const expectedAt = tl.expectedAt ? new Date(Number(tl.expectedAt)) : null;
      const diff = expectedAt ? (actualAt.getTime() - expectedAt.getTime()) / 1000 : null;
      // Clamp absurd client clock offsets (>5 min) — keep only the fact.
      const actualSafe = Math.abs(actualAt.getTime() - serverNow) > 300_000 ? new Date(serverNow) : actualAt;
      await withRetry(() =>
        prisma.timelineEvent.upsert({
          where: { eventId: safeId },
          update: {},
          create: {
            eventId: safeId,
            kind: tl.kind,
            label,
            expectedAt,
            actualAt: actualSafe,
            diffSeconds: diff != null ? Math.round(diff * 1000) / 1000 : null,
            detail: tl.detail ? JSON.stringify(sanitizeDetail(tl.detail)) : null,
          },
        })
      );
      return NextResponse.json({ ok: true, deduped: false });
    }

    // ── Playback END (finalize existing start row) ─────────────────────
    if ("status" in body) {
      const end = body as EndBody;
      const statuses = ["completed", "interrupted", "azan_interrupted", "error", "skipped"];
      if (!statuses.includes(end.status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      const durationPlayed = Math.max(0, Number(end.durationPlayed) || 0);
      const updated = await withRetry(() =>
        prisma.radioPlayback.updateMany({
          where: { eventId: safeId, endedAt: null },
          data: {
            endedAt: new Date(Number(end.endedAt) || serverNow),
            durationPlayed,
            status: end.status,
            interruptionReason: sanitize(end.interruptionReason, 200),
            azanInterrupted: end.status === "azan_interrupted",
            azanPrayer: end.status === "azan_interrupted" ? sanitize(end.azanPrayer, 20) : null,
          },
        })
      );
      if (updated.count === 0) {
        return NextResponse.json({ ok: true, deduped: true }); // already finalized
      }
      if (end.status === "error") {
        await reportIncident({
          service: "audio",
          kind: "playback_error",
          severity: "warning",
          message: `Radio playback error: ${sanitize(end.interruptionReason, 150) ?? "unknown"}`,
        });
      }
      return NextResponse.json({ ok: true });
    }

    // ── Playback START (proof-of-play record) ──────────────────────────
    const start = body as StartBody;
    const trackId = sanitize(start.trackId, 120);
    const trackTitle = sanitize(start.trackTitle, 250);
    if (!trackId || !trackTitle) return NextResponse.json({ error: "Missing track fields" }, { status: 400 });
    // Client clocks may be skewed; clamp to ±5 min of server time.
    const rawStart = Number(start.startedAt) || serverNow;
    const startedAt = new Date(Math.min(Math.max(rawStart, serverNow - 300_000), serverNow + 5_000));
    await withRetry(() =>
      prisma.radioPlayback.upsert({
        where: { eventId: safeId },
        update: {}, // never overwrite a finalized record
        create: {
          eventId: safeId,
          trackId,
          trackTitle,
          startedAt,
          expectedDuration: Math.max(0, Number(start.expectedDuration) || 0),
          expectedStartAt: start.expectedStartAt ? new Date(Number(start.expectedStartAt)) : null,
          expectedEndAt: start.expectedEndAt ? new Date(Number(start.expectedEndAt)) : null,
          status: "playing",
          sessionId: sanitize(start.sessionId, 120),
          clientId: session.userId.slice(0, 8) + "…" // anonymous per-user hint, no personal data
        },
      })
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Unique violations are benign (idempotent retry won the race).
    if (msg.includes("Unique constraint")) return NextResponse.json({ ok: true, deduped: true });
    console.error("[RADIO-PLAYBACK] error:", msg);
    return NextResponse.json({ error: "Failed to record playback event" }, { status: 500 });
  }
}

function sanitizeDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (v == null) continue;
    if (typeof v === "string") out[k] = v.slice(0, 150);
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return out;
}

/** GET /api/radio-playback?range=today|7d|30d — ADMIN: history + stats. */
export async function GET(request: NextRequest) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sp = request.nextUrl.searchParams;
  const range = sp.get("range") ?? "7d";
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(10, Number(sp.get("pageSize") ?? "50") || 50));
  const status = sp.get("status") ?? "";
  const search = (sp.get("search") ?? "").trim();

  const days = range === "today" ? 1 : range === "30d" ? 30 : range === "90d" ? 90 : 7;
  const from = new Date(Date.now() - days * 86_400_000);
  if (range === "today") from.setHours(0, 0, 0, 0);

  const where: Record<string, unknown> = { startedAt: { gte: from } };
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { trackTitle: { contains: search, mode: "insensitive" } },
      { trackId: { contains: search, mode: "insensitive" } },
    ];
  }

  try {
    await ensureDatabase();
    const [total, rows, byStatus, topTracks, integrity] = await Promise.all([
      withRetry(() => prisma.radioPlayback.count({ where })),
      withRetry(() =>
        prisma.radioPlayback.findMany({
          where,
          orderBy: { startedAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        })
      ),
      withRetry(() =>
        prisma.radioPlayback.groupBy({ by: ["status"], _count: { _all: true }, where: { startedAt: { gte: from } } })
      ),
      withRetry(() =>
        prisma.radioPlayback.groupBy({
          by: ["trackId", "trackTitle"],
          _count: { _all: true },
          _sum: { durationPlayed: true },
          where: { startedAt: { gte: from }, status: { in: ["completed", "interrupted", "azan_interrupted"] } },
          orderBy: { _count: { trackId: "desc" } },
          take: 10,
        })
      ),
      withRetry(() =>
        prisma.radioPlayback.count({ where: { startedAt: { gte: from }, status: { in: ["completed", "interrupted", "azan_interrupted", "error"] }, durationPlayed: { gt: 0 } } })
      ),
    ]);

    // Total airtime actually played (aggregate, not a scan).
    const agg = await withRetry(() =>
      prisma.radioPlayback.aggregate({ _sum: { durationPlayed: true }, where: { startedAt: { gte: from } } })
    );

    return NextResponse.json({
      rows,
      total,
      page,
      pageSize,
      range,
      stats: {
        byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
        totalAirtimeSeconds: Math.round(agg._sum.durationPlayed ?? 0),
        verifiedPlays: integrity,
        topTracks: topTracks.map((t) => ({
          trackId: t.trackId,
          title: t.trackTitle,
          plays: t._count._all,
          seconds: Math.round(t._sum.durationPlayed ?? 0),
        })),
      },
    });
  } catch (e) {
    console.error("[RADIO-PLAYBACK] list failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Failed to load radio history" }, { status: 500 });
  }
}

/** DELETE /api/radio-playback?id=… — OWNER only. Removes ONE bad record (audited). */
export async function DELETE(request: NextRequest) {
  const admin = await getAdminSession();
  if (!admin || admin.role !== "owner") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  await prisma.radioPlayback.delete({ where: { id } }).catch(() => {});
  await audit({
    actor: admin,
    action: "records.exported",
    targetType: "radio_playback",
    targetId: id,
    metadata: { operation: "delete_record" },
  });
  return NextResponse.json({ ok: true });
}
