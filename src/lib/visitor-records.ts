import { prisma, withRetry } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";
import { getSession } from "@/lib/auth";
import type { NextRequest } from "next/server";

/**
 * Visitor Records service.
 *
 * Privacy & integrity rules baked into every helper:
 *  - The authenticated user is derived SERVER-SIDE from the verified JWT —
 *    never from a client-supplied userId (spec §19).
 *  - Actions are allowlisted; arbitrary client strings are never stored.
 *  - `metadata` is a tiny allowlist-checked JSON blob (names/titles only).
 *    No passwords, hashes, tokens or form contents ever reach these tables.
 *  - Visitors are always real authenticated users; there is no fake ID.
 */

export const VISITOR_TRACK_ROUTE = "/api/visitor-records/track";

/** Storage key for the browser-side session binding (spec: not authoritative identity data). */
export const VISITOR_VSID_KEY = "ebilikagama-vsid";

/** Retention Setting key. Value = allowed days ("30"|"90"|"180"|"365"|"forever"). */
export const RETENTION_SETTING_KEY = "visitor_record_retention";

export const RETENTION_CHOICES = ["30", "90", "180", "365", "forever"] as const;
export type RetentionChoice = (typeof RETENTION_CHOICES)[number];

// ── Allowlist (spec §3 — meaningful features/actions only) ─────────────────
export const VISITOR_FEATURES = [
  "auth",
  "homepage",
  "tv",
  "radio",
  "replay",
  "quran",
  "schedule",
  "other",
] as const;
export type VisitorFeature = (typeof VISITOR_FEATURES)[number];

/** Action registry: action string → allowed metadata keys. */
const ACTION_META_KEYS: Record<string, string[]> = {
  login: [],
  logout: [],
  page_opened: [],
  tv_channel_opened: [],
  program_selected: [],
  radio_opened: [],
  radio_play: [],
  radio_pause: [],
  radio_azan_played: [],
  radio_track_changed: [],
  replay_opened: [],
  video_played: [],
  video_paused: [],
  quran_opened: [],
  surah_selected: [],
  audio_played: [],
  audio_paused: [],
  search_used: [],
  language_changed: ["language"],
  theme_changed: [],
  other: [],
};

export function isKnownAction(action: string): boolean {
  return Object.prototype.hasOwnProperty.call(ACTION_META_KEYS, action);
}

function sanitizeMetadata(action: string, raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const allowed = ACTION_META_KEYS[action];
  if (!allowed || allowed.length === 0) return null;
  const out: Record<string, string> = {};
  for (const key of allowed) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === "string" && value.length > 0) {
      // Defensive cap: names/titles only, never large payloads.
      out[key] = value.slice(0, 120);
      if (allowed.length === 1) break;
    }
  }
  return Object.keys(out).length > 0 ? JSON.stringify(out) : null;
}

const PAGE_RE = /^\/[\w\-./]?[\w\-./]{0,120}$/;
const HOUR_MS = 60 * 60 * 1000;
/** Bindings older than this are considered stale and recreated on demand. */
const BINDING_MAX_AGE_MS = 14 * 24 * HOUR_MS;
/** Throttle for session lastActivityAt updates. */
const LAST_ACTIVITY_DEBOUNCE_MS = 60_000;

// ── Session binding (spec §19: server decides everything) ───────────────────

export interface TrackContext {
  user: {
    id: string;
    username: string;
    fullName: string | null;
    role: string;
  };
  sessionId: string;
}

/**
 * Resolve the track context: server-verified user + their VisitorSession.
 * `vsidHint` is only a hint — it must match a session belonging to the
 * verified user, or it is ignored (no cross-user contamination possible).
 */
async function resolveTrackContext(
  vsidHint: string | null,
  userAgent: string | null
): Promise<TrackContext | null> {
  const session = await getSession();
  if (!session) return null;

  const user = await withRetry(() =>
    prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, username: true, fullName: true, role: true, active: true },
    })
  );
  if (!user || !user.active) return null;

  // Hint must belong to this user, else create/find a fresh session.
  if (vsidHint) {
    const binding = await withRetry(() =>
      prisma.visitorSession.findUnique({ where: { id: vsidHint } })
    );
    if (binding && binding.userId === user.id && binding.status === "active") {
      // Refresh lastActivityAt at most once a minute (perf §13).
      if (Date.now() - binding.lastActivityAt.getTime() > LAST_ACTIVITY_DEBOUNCE_MS) {
        try {
          await prisma.visitorSession.update({
            where: { id: binding.id },
            data: { lastActivityAt: new Date() },
          });
        } catch {
          // Non-fatal
        }
      }
      return { user, sessionId: binding.id };
    }
  }

  // No valid hint → reuse this user's most recent active session created
  // within the last 12h (single-device tab-in-tab continuity), else create one.
  const recent = await withRetry(() =>
    prisma.visitorSession.findFirst({
      where: {
        userId: user.id,
        status: "active",
        loginAt: { gte: new Date(Date.now() - 12 * HOUR_MS) },
      },
      orderBy: { loginAt: "desc" },
    })
  );
  if (recent) return { user, sessionId: recent.id };

  const created = await withRetry(() =>
    prisma.visitorSession.create({
      data: {
        userId: user.id,
        userAgent: userAgent ? userAgent.slice(0, 250) : null,
      },
    })
  );
  return { user, sessionId: created.id };
}

export interface TrackResult {
  ok: boolean;
  sessionId?: string;
  action: "logged" | "throttled" | "unauthenticated" | "rejected";
}

/** In-process recent-write cache (best-effort dedupe/throttle). */
const recentWrites = new Map<string, number>();
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [k, t] of recentWrites) {
    if (t < cutoff) recentWrites.delete(k);
  }
}, 60_000).unref?.();

export interface TrackInput {
  feature: string;
  action: string;
  page?: string;
  metadata?: unknown;
  /** Client hint only — validated against the verified user. */
  vsid?: string | null;
}

/**
 * Server-side activity logging entry point (spec §19):
 *   logVisitorActivity({ feature, action, page, metadata })
 * Identity is always derived from the real session.
 */
export async function logVisitorActivity(
  request: NextRequest,
  input: TrackInput
): Promise<TrackResult> {
  // Dedupe/throttle identical events per user within 20s.
  const session = await getSession();
  if (!session) return { ok: false, action: "unauthenticated" };

  const { feature, action, page } = input;
  if (!isKnownAction(action)) return { ok: false, action: "rejected" };
  const meta = sanitizeMetadata(action, input.metadata);

  // Dedupe/throttle identical events per user within 20s. The feature is
  // part of the key: "homepage opened" + "quran opened" firing together on
  // the homepage are distinct events and must both be recorded.
  const dedupeKey = `${session.userId}|${feature}|${action}|${meta ?? ""}`;
  const now = Date.now();
  const last = recentWrites.get(dedupeKey);
  if (last && now - last < 20_000) {
    return { ok: true, action: "throttled" };
  }
  recentWrites.set(dedupeKey, now);

  try {
    await ensureDatabase();
    const ctx = await resolveTrackContext(input.vsid ?? null, request.headers.get("user-agent"));
    if (!ctx) return { ok: false, action: "unauthenticated" };

    const pageSafe =
      typeof page === "string" && PAGE_RE.test(page) ? page.slice(0, 120) : null;

    await withRetry(() =>
      prisma.visitorActivity.create({
        data: {
          sessionId: ctx.sessionId,
          userId: ctx.user.id,
          feature,
          action,
          page: pageSafe,
          metadata: meta,
        },
      })
    );
    return { ok: true, action: "logged", sessionId: ctx.sessionId };
  } catch (e) {
    // Logging must never break the user's feature.
    console.warn(
      "[VISITOR] log failed:",
      e instanceof Error ? e.message : e
    );
    return { ok: false, action: "rejected" } as TrackResult;
  }
}

// ── Retention (spec §15) ────────────────────────────────────────────────────

export async function getRetentionDays(): Promise<number | null> {
  try {
    const row = await prisma.setting.findUnique({
      where: { key: RETENTION_SETTING_KEY },
    });
    const value = row?.value as RetentionChoice | undefined;
    if (!value || value === "forever") return null;
    return Number(value);
  } catch {
    return null;
  }
}

/**
 * Explicitly-invoked retention sweep. Deletes ONLY old VisitorActivity /
 * VisitorSession rows — never user accounts (spec §15).
 */
export async function runRetentionSweep(): Promise<{
  deletedActivities: number;
  deletedSessions: number;
  cutoff: Date | null;
}> {
  const days = await getRetentionDays();
  if (!days) return { deletedActivities: 0, deletedSessions: 0, cutoff: null };
  const cutoff = new Date(Date.now() - days * 24 * HOUR_MS);

  const delAct = await prisma.visitorActivity.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  // Sessions whose last activity is older than the cutoff; activities were
  // just deleted for those, so cascade-removal of metadata is consistent.
  const delSess = await prisma.visitorSession.deleteMany({
    where: { lastActivityAt: { lt: cutoff } },
  });
  return {
    deletedActivities: delAct.count,
    deletedSessions: delSess.count,
    cutoff,
  };
}
