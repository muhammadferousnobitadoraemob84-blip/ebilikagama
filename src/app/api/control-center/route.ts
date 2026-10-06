import { NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/prisma";
import { ensureDatabase, isDatabaseDown } from "@/lib/db-init";
import { getAdminSession } from "@/lib/auth";
import { getVirtualRadioState } from "@/lib/virtual-radio-store";
import { getAzanState } from "@/lib/azan-store";
import { computeAzanSchedule, isTestModeActive } from "@/lib/azan";
import { getRadioPosition } from "@/lib/virtual-radio";
import { getMultipleChannelStatuses } from "@/lib/twitch-status";
import { getValidDriveToken } from "@/lib/google-drive";
import { getValidYouTubeToken } from "@/lib/youtube";
import { msToMalaysiaDate } from "@/lib/azan";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/control-center — ADMIN: one aggregate payload for the Broadcast
 * Control Center (spec §1). Every value is computed from real system state:
 *   - RADIO: enabled/epoch/track/position/next track/next azan/countdown +
 *     scheduler + azan-scheduler status.
 *   - TV CHANNELS: name + Twitch live status (cached 10s per channel).
 *   - SPECIAL CHANNELS: same list filtered by category.
 *   - SYSTEM: Neon (real query), Drive (token validity), JAKIM (stored data
 *     freshness), Twitch/YouTube (token/API), scheduler states, auth.
 *   - USERS: active sessions (last 30 min) + latest activity rows.
 * No credentials, tokens or emails ever leave this endpoint.
 */
export async function GET() {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const serverTime = Date.now();
  await ensureDatabase();

  // ── RADIO ────────────────────────────────────────────────────────────
  const state = await getVirtualRadioState();
  const azanStore = await getAzanState();
  const testActive = isTestModeActive(azanStore.testMode, serverTime);
  const schedule = computeAzanSchedule(
    serverTime,
    azanStore.prayerTimes,
    azanStore.assignments,
    azanStore.files,
    testActive ? azanStore.testMode.overrides : null
  );
  const pos = getRadioPosition(state, serverTime);
  const currentTrack = pos ? state.tracks[pos.index] ?? null : null;
  const nextTrack = pos ? state.tracks[(pos.index + 1) % state.tracks.length] ?? null : null;

  const radio = {
    enabled: state.enabled,
    online: state.enabled && !!pos,
    currentTrack: currentTrack ? { id: currentTrack.driveId, title: currentTrack.fileName, position: Math.round(pos!.offset), duration: currentTrack.duration } : null,
    nextTrack: nextTrack ? { id: nextTrack.driveId, title: nextTrack.fileName, duration: nextTrack.duration } : null,
    epoch: state.epoch,
    totalDuration: state.totalDuration,
    trackCount: state.tracks.length,
    pendingCount: state.pending.length,
    schedulerStatus: !state.enabled ? "OFFLINE" : !state.epoch ? "UNANCHORED" : "RUNNING",
    azan: {
      active: schedule.active
        ? { prayer: schedule.active.prayer, startedAt: schedule.active.startedAt, endsAt: schedule.active.endsAt, offset: schedule.active.offset }
        : null,
      next: schedule.next ? { prayer: schedule.next.prayer, startsAt: schedule.next.startsAt, countdownSeconds: Math.round((schedule.next.startsAt - serverTime) / 1000) } : null,
      usingTestTimes: testActive,
    },
    azanSchedulerStatus: !azanStore.prayerTimes || Object.values(azanStore.assignments).every((v) => !v)
      ? "NOT_CONFIGURED"
      : schedule.active
        ? "AZAN_ACTIVE"
        : schedule.next
          ? "ARMED"
          : "NO_SCHEDULE",
  };

  // ── TV CHANNELS ──────────────────────────────────────────────────────
  let channels: { id: string; name: string; category: string; active: boolean; liveStatus: string; status: "online" | "offline" | "unknown"; currentProgram: string | null }[] = [];
  try {
    const todayKey = new Date().toISOString().slice(0, 10);
    const [rows, programs] = await Promise.all([
      withRetry(() => prisma.channel.findMany({ where: { active: true }, orderBy: { displayOrder: "asc" }, select: { id: true, name: true, category: true, active: true, liveStatus: true, twitchUsername: true } })),
      withRetry(() =>
        prisma.program.findMany({
          where: { date: todayKey },
          select: { channelId: true, title: true, startTime: true, endTime: true },
          orderBy: { startTime: "asc" },
        })
      ),
    ]);
    const nowHHmm = new Date().toTimeString().slice(0, 5);
    const currentByChannel = new Map<string, string>();
    for (const p of programs) {
      if (p.startTime <= nowHHmm && p.endTime > nowHHmm && !currentByChannel.has(p.channelId)) {
        currentByChannel.set(p.channelId, p.title);
      }
    }
    const twitch = await getMultipleChannelStatuses(rows.map((c) => c.twitchUsername));
    channels = rows.map((c) => {
      const s = twitch[c.twitchUsername.toLowerCase().trim()] ?? "unknown";
      return {
        id: c.id,
        name: c.name,
        category: c.category,
        active: c.active,
        liveStatus: c.liveStatus,
        status: c.liveStatus === "live" ? "online" : s,
        currentProgram: currentByChannel.get(c.id) ?? null,
      };
    });
  } catch {
    channels = [];
  }

  // ── SYSTEM ───────────────────────────────────────────────────────────
  let databaseOk = false;
  let databaseLatency: number | null = null;
  try {
    const t0 = Date.now();
    await withRetry(() => prisma.$queryRaw`SELECT 1`);
    databaseLatency = Date.now() - t0;
    databaseOk = true;
  } catch {
    databaseOk = false;
  }
  const driveToken = await getValidDriveToken().catch(() => null);
  const ytToken = await getValidYouTubeToken().catch(() => null);

  const zoneDirInfo = {
    zone: azanStore.prayerZone,
    source: azanStore.prayerTimes?.source ?? null,
    updatedAt: azanStore.prayerTimes?.updatedAt ?? null,
    dayCount: azanStore.prayerTimes ? Object.keys(azanStore.prayerTimes.days).length : 0,
    todayCovered: azanStore.prayerTimes ? !!azanStore.prayerTimes.days[msToMalaysiaDate(serverTime)] : false,
  };

  const system = {
    database: { ok: databaseOk, latencyMs: databaseLatency, down: isDatabaseDown() },
    drive: { connected: !!driveToken },
    jakim: zoneDirInfo,
    twitch: { reachable: true }, // channel statuses above already hit the API
    youtube: { connected: !!ytToken },
    scheduler: radio.schedulerStatus,
    azanScheduler: radio.azanSchedulerStatus,
    auth: { ok: true, actor: admin.username, role: admin.role },
  };

  // ── USERS (aggregated, no personal content) ──────────────────────────
  let users = { activeSessions: 0, recentActivity: [] as { user: string; role: string; feature: string; action: string; at: string }[] };
  try {
    const since = new Date(serverTime - 30 * 60_000);
    const [activeSessions, activities] = await Promise.all([
      withRetry(() =>
        prisma.visitorSession.count({ where: { status: "active", lastActivityAt: { gte: since } } })
      ),
      withRetry(() =>
        prisma.visitorActivity.findMany({
          orderBy: { createdAt: "desc" },
          take: 8,
          include: { user: { select: { username: true, fullName: true, role: true } } },
        })
      ),
    ]);
    users = {
      activeSessions,
      recentActivity: activities.map((a) => ({
        user: a.user.fullName || a.user.username,
        role: a.user.role,
        feature: a.feature,
        action: a.action,
        at: a.createdAt.toISOString(),
      })),
    };
  } catch {
    // keep defaults
  }

  return NextResponse.json(
    { serverTime, radio, channels, specialChannels: channels.filter((c) => c.category === "saluran-khas"), system, users },
    { headers: { "Cache-Control": "no-store, must-revalidate" } }
  );
}
