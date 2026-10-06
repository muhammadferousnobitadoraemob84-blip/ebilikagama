import { prisma, withRetry } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";
import type { VerifiedSession } from "@/lib/auth";

/**
 * Admin Audit Log service (spec §9).
 *
 * Rules baked in:
 *  - Append-only. Nothing in this module ever updates or deletes a row.
 *  - NEVER record passwords, tokens, secrets or hashes — callers pass only
 *    safe metadata (names, ids, counts). `sanitizeMeta` strips obvious
 *    credential-shaped keys as a second line of defence.
 *  - Never throws: auditing must not break the admin action it records.
 */

export const AUDIT_RETENTION_KEY = "audit_log_retention";

/** Setting key prefix families the audit log must never accept in metadata. */
const FORBIDDEN_META_KEYS = /^(password|passwd|pwd|token|secret|apikey|api_key|key|authorization|cookie|credential|refresh_?token|access_?token|passwordhash|hash)/i;

export interface AuditInput {
  actor?: VerifiedSession | null; // admin session (null = system)
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  result?: "success" | "failure";
  metadata?: Record<string, unknown> | null;
}

function sanitizeMeta(meta: Record<string, unknown> | null | undefined): string | null {
  if (!meta || typeof meta !== "object") return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (FORBIDDEN_META_KEYS.test(k)) continue; // never store credential-shaped keys
    if (v == null) continue;
    if (typeof v === "string") out[k] = v.slice(0, 200);
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    // Objects/arrays are deliberately dropped — flat, small, safe values only.
  }
  return Object.keys(out).length > 0 ? JSON.stringify(out) : null;
}

/**
 * Record one admin action. Fire-and-forget safe: failures are logged, never
 * propagated — an audit outage must not break the admin operation.
 */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await ensureDatabase();
    await withRetry(() =>
      prisma.auditLog.create({
        data: {
          actorUserId: input.actor?.userId ?? null,
          actorName: input.actor?.username ?? null,
          action: input.action,
          targetType: input.targetType ?? null,
          targetId: input.targetId ?? null,
          result: input.result ?? "success",
          metadata: sanitizeMeta(input.metadata),
        },
      })
    );
  } catch (e) {
    console.warn("[AUDIT] write failed:", e instanceof Error ? e.message : e);
  }
}

/** Convenience wrapper for "action attempted but failed" records. */
export async function auditFailure(input: AuditInput, error: unknown): Promise<void> {
  await audit({
    ...input,
    result: "failure",
    metadata: {
      ...(input.metadata ?? {}),
      error: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
    },
  });
}

/** List actions (for the admin UI filter dropdown). */
export const AUDIT_ACTIONS: { group: string; actions: string[] }[] = [
  {
    group: "Users & roles",
    actions: [
      "user.created", "user.updated", "user.disabled", "user.enabled",
      "user.deleted", "user.password_reset", "role.changed",
    ],
  },
  {
    group: "Broadcast",
    actions: [
      "channel.created", "channel.updated", "channel.deleted",
      "program.created", "program.updated", "program.deleted", "program.duplicated",
      "radio.playlist_arranged", "radio.config_changed",
      "azan.assignments_changed", "azan.prayer_zone_changed",
      "azan.test_mode_applied", "azan.test_mode_reset",
      "emergency.created", "emergency.activated", "emergency.stopped",
    ],
  },
  {
    group: "System",
    actions: [
      "setting.changed", "drive.folder_changed", "youtube.connected", "youtube.disconnected",
      "backup.created", "records.exported", "retention.changed",
      "notification.created", "incident.updated",
    ],
  },
];
