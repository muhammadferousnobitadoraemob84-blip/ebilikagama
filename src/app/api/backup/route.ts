import { NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";
import { getAdminSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Backup & Restore (spec §20) — OWNER ONLY.
 *
 * GET /api/backup          → metadata about the latest backup (stored row).
 * POST /api/backup         → create a backup now (returns JSON download +
 *                            records a metadata row: size, counts, status).
 * PATCH { id, confirm }    → metadata-only restore markers are NOT supported
 *                            destructively; confirm gate required (strong
 *                            confirmation) — see note below.
 *
 * Included: users (HASHED passwords — bcrypt hashes, never plaintext),
 * roles, channels, programs, radios, replays (metadata), radio playlist +
 * azan mappings + prayer times (Setting keys), system settings, visitor
 * records, audit logs. EXCLUDED: audio/video binaries (Drive stays the
 * storage), OAuth/API tokens, session secrets, Google Drive credentials.
 */

const EXCLUDED_SETTING_PREFIXES = [
  "google_drive_access_token",
  "google_drive_refresh_token",
  "youtube_access_token",
  "youtube_refresh_token",
];

/** Mask credential-bearing Setting keys entirely (never leave the server). */
function maskSetting(key: string, value: string): { key: string; value: string } | null {
  if (EXCLUDED_SETTING_PREFIXES.includes(key)) return null;
  return { key, value };
}

export async function GET() {
  const admin = await getAdminSession();
  if (!admin || admin.role !== "owner") return NextResponse.json({ error: "Owner only" }, { status: 403 });
  await ensureDatabase();
  try {
    const rows = await withRetry(() => prisma.setting.findMany({ where: { key: { startsWith: "backup_" } } }));
    const latest = rows
      .map((r) => {
        try {
          return JSON.parse(r.value) as { createdAt: string; sizeBytes: number; status: string; counts: Record<string, number> };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => (a!.createdAt < b!.createdAt ? 1 : -1))[0] ?? null;
    return NextResponse.json({ latest });
  } catch {
    return NextResponse.json({ latest: null });
  }
}

export async function POST() {
  const admin = await getAdminSession();
  if (!admin || admin.role !== "owner") return NextResponse.json({ error: "Owner only" }, { status: 403 });
  await ensureDatabase();

  const t0 = Date.now();
  try {
    const [users, channels, programs, radios, replays, settings, visitorSessions, visitorActivities, auditLogs, radioPlaybacks] =
      await Promise.all([
        withRetry(() => prisma.user.findMany({ select: { id: true, username: true, fullName: true, passwordHash: true, profilePhoto: true, role: true, active: true, tokenVersion: true, createdAt: true } })),
        withRetry(() => prisma.channel.findMany()),
        withRetry(() => prisma.program.findMany({ take: 20000 })),
        withRetry(() => prisma.radio.findMany()),
        withRetry(() => prisma.replay.findMany({ take: 10000 })),
        withRetry(() => prisma.setting.findMany()),
        withRetry(() => prisma.visitorSession.findMany({ take: 20000 })),
        withRetry(() => prisma.visitorActivity.findMany({ take: 50000, orderBy: { createdAt: "desc" } })),
        withRetry(() => prisma.auditLog.findMany({ take: 20000, orderBy: { createdAt: "desc" } })),
        withRetry(() => prisma.radioPlayback.findMany({ take: 20000, orderBy: { startedAt: "desc" } })),
      ]);

    // Radio + azan + zone metadata live in Setting keys — include them
    // (already covered by `settings` after masking) plus explicit convenience:
    const radioKeys = [
      "virtual_radio_enabled", "virtual_radio_folder_id", "virtual_radio_folder_name",
      "virtual_radio_epoch", "virtual_radio_playlist", "virtual_radio_pending",
      "virtual_radio_azan_files", "virtual_radio_azan_assignments",
      "virtual_radio_prayer_zone", "virtual_radio_prayer_times",
      "jakim_zone_directory",
    ];

    const payload = {
      meta: {
        app: "eBilikAgamaTV",
        schemaVersion: "6",
        createdAt: new Date().toISOString(),
        // passwordHash fields contain bcrypt hashes ONLY — never plaintext.
        notes: "passwords are bcrypt hashes; audio binaries are NOT included (Google Drive remains the media storage); OAuth tokens excluded",
      },
      users,
      channels,
      programs,
      radios,
      replays,
      settings: settings.map((s) => maskSetting(s.key, s.value)).filter(Boolean),
      radioKeys,
      visitorSessions,
      visitorActivities,
      auditLogs,
      radioPlaybacks,
    };

    const json = JSON.stringify(payload, null, 2);
    const sizeBytes = Buffer.byteLength(json, "utf8");
    const counts = {
      users: users.length,
      channels: channels.length,
      programs: programs.length,
      radios: radios.length,
      replays: replays.length,
      settings: settings.length,
      visitorSessions: visitorSessions.length,
      visitorActivities: visitorActivities.length,
      auditLogs: auditLogs.length,
      radioPlaybacks: radioPlaybacks.length,
    };

    await withRetry(() =>
      prisma.setting.upsert({
        where: { key: "backup_latest" },
        update: { value: JSON.stringify({ createdAt: payload.meta.createdAt, sizeBytes, status: "success", counts, durationMs: Date.now() - t0 }) },
        create: { key: "backup_latest", value: JSON.stringify({ createdAt: payload.meta.createdAt, sizeBytes, status: "success", counts, durationMs: Date.now() - t0 }) },
      })
    );

    await audit({ actor: admin, action: "backup.created", targetType: "backup", metadata: { sizeBytes, counts } });

    return new NextResponse(json, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="ebilikagama-backup-${new Date().toISOString().slice(0, 10)}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[BACKUP] failed:", e instanceof Error ? e.message : e);
    await audit({ actor: admin, action: "backup.created", result: "failure", targetType: "backup", metadata: { error: e instanceof Error ? e.message.slice(0, 150) : "unknown" } });
    return NextResponse.json({ error: "Backup failed" }, { status: 500 });
  }
}
