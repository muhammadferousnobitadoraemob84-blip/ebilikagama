import { prisma, withRetry } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";

/**
 * Configurable data retention (spec §31) for:
 *   - Visitor Records (existing visitor_record_retention setting)
 *   - Audit Logs       (audit_log_retention)
 *   - Playback History (radio_playback_retention)
 *   - Incident Logs    (incident_retention)
 *   - Timeline events  (timeline_retention)
 *
 * Allowed values: 30 | 90 | 180 | 365 (days) | forever.
 * Nothing is ever deleted silently: sweeps only run when explicitly invoked
 * (or via the cron keep-alive hook), and the configured value is visible in
 * Admin settings. Audit sweeps are Owner-only at the API layer.
 */

export const RETENTION_KEYS = {
  visitor: "visitor_record_retention", // already used by visitor-records.ts
  audit: "audit_log_retention",
  playback: "radio_playback_retention",
  incident: "incident_retention",
  timeline: "timeline_retention",
} as const;

export type RetentionFamily = keyof typeof RETENTION_KEYS;
export const RETENTION_FAMILIES = Object.keys(RETENTION_KEYS) as RetentionFamily[];
export const RETENTION_VALUES = ["30", "90", "180", "365", "forever"] as const;
export type RetentionValue = (typeof RETENTION_VALUES)[number];

function isRetentionValue(v: unknown): v is RetentionValue {
  return typeof v === "string" && (RETENTION_VALUES as readonly string[]).includes(v);
}

export async function getRetention(family: RetentionFamily): Promise<RetentionValue> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: RETENTION_KEYS[family] }, select: { value: true } });
    return isRetentionValue(row?.value) ? row!.value as RetentionValue : "365";
  } catch {
    return "365";
  }
}

export async function setRetention(family: RetentionFamily, value: RetentionValue): Promise<void> {
  await prisma.setting.upsert({
    where: { key: RETENTION_KEYS[family] },
    update: { value },
    create: { key: RETENTION_KEYS[family], value },
  });
}

function cutoffDays(value: RetentionValue): number | null {
  return value === "forever" ? null : Number(value);
}

export interface SweepResult {
  family: RetentionFamily;
  value: RetentionValue;
  cutoff: string | null;
  deleted: number;
}

/** Delete rows older than the configured retention. Never touches users. */
export async function sweepFamily(family: RetentionFamily): Promise<SweepResult> {
  await ensureDatabase();
  const value = await getRetention(family);
  const days = cutoffDays(value);
  if (days == null) return { family, value, cutoff: null, deleted: 0 };
  const cutoff = new Date(Date.now() - days * 86_400_000);
  let deleted = 0;

  switch (family) {
    case "visitor": {
      const acts = await withRetry(() => prisma.visitorActivity.deleteMany({ where: { createdAt: { lt: cutoff } } }));
      const sess = await withRetry(() => prisma.visitorSession.deleteMany({ where: { lastActivityAt: { lt: cutoff } } }));
      deleted = acts.count + sess.count;
      break;
    }
    case "audit":
      deleted = (await withRetry(() => prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } }))).count;
      break;
    case "playback":
      deleted = (await withRetry(() => prisma.radioPlayback.deleteMany({ where: { startedAt: { lt: cutoff } } }))).count;
      break;
    case "incident":
      deleted = (await withRetry(() => prisma.incident.deleteMany({ where: { resolvedAt: { lt: cutoff }, status: "resolved" } }))).count;
      break;
    case "timeline":
      deleted = (await withRetry(() => prisma.timelineEvent.deleteMany({ where: { actualAt: { lt: cutoff } } }))).count;
      break;
  }
  return { family, value, cutoff: cutoff.toISOString(), deleted };
}

/** Sweep every family (used by the admin "apply" action). */
export async function sweepAll(): Promise<SweepResult[]> {
  const out: SweepResult[] = [];
  for (const family of RETENTION_FAMILIES) {
    try {
      out.push(await sweepFamily(family));
    } catch {
      out.push({ family, value: await getRetention(family), cutoff: null, deleted: 0 });
    }
  }
  return out;
}
