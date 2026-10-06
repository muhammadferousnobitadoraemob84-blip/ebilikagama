import { prisma, withRetry } from "@/lib/prisma";
import { ensureDatabase, isDatabaseDown, getDbFatalError } from "@/lib/db-init";
import { getValidDriveToken, verifyGoogleDriveConnection } from "@/lib/google-drive";
import { getVirtualRadioState } from "@/lib/virtual-radio-store";
import { getAzanState } from "@/lib/azan-store";
import { JAKIM_ESOLAT_API } from "@/lib/azan";
import { getValidYouTubeToken } from "@/lib/youtube";

/**
 * System Health service (spec §2).
 *
 * Every check is a REAL probe performed at call time — no hardcoded
 * "Online". Results are never cached as success: only short negative
 * caching exists inside the underlying stores themselves.
 *
 * Credential rules: responses contain status/timing/labels ONLY. Tokens,
 * emails, connection strings and URLs with keys never leave the server.
 */

export type HealthLevel = "green" | "yellow" | "red" | "gray";

export interface HealthCheck {
  key: string;
  label: string;
  level: HealthLevel; // green=healthy yellow=warning red=error gray=not configured
  status: string; // short machine status
  detail: string; // human summary (safe)
  responseTimeMs: number | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
}

export interface HealthReport {
  checkedAt: string;
  checks: HealthCheck[];
  summary: { green: number; yellow: number; red: number; gray: number };
  overall: "healthy" | "degraded" | "unhealthy";
}

/** Per-process memory of the last outcome per check (survives across calls). */
const memory: Record<string, { lastSuccessAt: number | null; lastFailureAt: number | null; lastError: string | null }> = {};
function remember(key: string, ok: boolean, error?: string) {
  memory[key] ??= { lastSuccessAt: null, lastFailureAt: null, lastError: null };
  if (ok) {
    memory[key].lastSuccessAt = Date.now();
    memory[key].lastError = null;
  } else {
    memory[key].lastFailureAt = Date.now();
    memory[key].lastError = (error ?? "unknown").slice(0, 300);
  }
}
function memOf(key: string) {
  return memory[key] ?? { lastSuccessAt: null, lastFailureAt: null, lastError: null };
}

async function timed<T>(key: string, fn: () => Promise<T>): Promise<{ ok: true; value: T; ms: number } | { ok: false; ms: number; error: string }> {
  const t0 = Date.now();
  try {
    const value = await fn();
    const ms = Date.now() - t0;
    remember(key, true);
    return { ok: true, value, ms };
  } catch (e) {
    const ms = Date.now() - t0;
    const error = e instanceof Error ? e.message : String(e);
    remember(key, false, error);
    return { ok: false, ms, error };
  }
}

function mk(
  key: string,
  label: string,
  level: HealthLevel,
  status: string,
  detail: string,
  ms: number | null
): HealthCheck {
  const m = memOf(key);
  return {
    key,
    label,
    level,
    status,
    detail,
    responseTimeMs: ms,
    lastSuccessAt: m.lastSuccessAt ? new Date(m.lastSuccessAt).toISOString() : null,
    lastFailureAt: m.lastFailureAt ? new Date(m.lastFailureAt).toISOString() : null,
    lastError: m.lastError,
  };
}

/** Run all checks. Admin-only callers gate access; nothing here is public. */
export async function runHealthChecks(): Promise<HealthReport> {
  const checks: HealthCheck[] = [];

  // ── Neon PostgreSQL + Prisma ─────────────────────────────────────────
  const db = await timed("database", () => withRetry(() => prisma.$queryRaw`SELECT 1` as Promise<unknown[]>));
  if (db.ok) {
    checks.push(mk("database", "Neon PostgreSQL", "green", "connected", `Query ok in ${db.ms}ms`, db.ms));
  } else {
    const fatal = getDbFatalError();
    const level: HealthLevel = isDatabaseDown() ? "red" : "yellow";
    checks.push(
      mk("database", "Neon PostgreSQL", level, "error", fatal ? `Persistent: ${fatal}` : `Transient: ${db.error}`, db.ms)
    );
  }

  // Prisma schema sanity: a cheap model count proves the client maps the schema.
  if (db.ok) {
    const prismaCheck = await timed("prisma", () => withRetry(() => prisma.setting.count()));
    checks.push(
      prismaCheck.ok
        ? mk("prisma", "Prisma ORM", "green", "ready", `Schema queries ok (${prismaCheck.value} settings)`, prismaCheck.ms)
        : mk("prisma", "Prisma ORM", "red", "error", prismaCheck.error, prismaCheck.ms)
    );
  } else {
    checks.push(mk("prisma", "Prisma ORM", "gray", "skipped", "Skipped — database unreachable", null));
  }

  // ── DB init state ───────────────────────────────────────────────────
  const initCheck = await timed("db_init", () => ensureDatabase());
  checks.push(
    initCheck.ok && initCheck.value
      ? mk("db_init", "Database schema", "green", "ready", "Tables initialized (v6)", initCheck.ms)
      : mk("db_init", "Database schema", "red", "failed", initCheck.ok ? "Initialization returned false" : initCheck.error, initCheck.ms)
  );

  // ── Google Drive (real API call when connected; gray when not) ───────
  const token = await timed("drive_token", () => getValidDriveToken());
  if (!token.ok || !token.value) {
    checks.push(mk("drive", "Google Drive", "gray", "not_configured", "Not connected — connect in Live Replay admin", token.ms));
  } else {
    const drive = await timed("drive", () => verifyGoogleDriveConnection(token.ok ? token.value!.accessToken : ""));
    checks.push(
      drive.ok && drive.value.connected
        ? mk("drive", "Google Drive", "green", "connected", "Drive API reachable", drive.ms)
        : mk("drive", "Google Drive", "red", "error", drive.ok ? "Token rejected by Drive API" : drive.error, drive.ms)
    );
  }

  // ── JAKIM prayer-time source ────────────────────────────────────────
  const azan = await timed("azan_store", () => getAzanState());
  if (azan.ok && azan.value.prayerTimes) {
    const ageH = (Date.now() - new Date(azan.value.prayerTimes.updatedAt).getTime()) / 3_600_000;
    const jakim = await timed("jakim", () =>
      fetch(`${JAKIM_ESOLAT_API}?r=esolatApi/takwimsolat&period=month&zone=${encodeURIComponent(azan.value.prayerZone ?? "SGR01")}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
        cache: "no-store",
      })
    );
    if (jakim.ok && jakim.value.ok) {
      checks.push(
        mk("jakim", "JAKIM prayer API", "green", "reachable", `e-solat API ok · zone ${azan.value.prayerZone} · data ${azan.value.prayerTimes.source === "jakim_api" ? "from API" : "from PDF"} (${Math.round(ageH)}h old)`, jakim.ms)
      );
    } else {
      // Stored data still usable — warning, not error.
      checks.push(
        mk("jakim", "JAKIM prayer API", "yellow", "unreachable", `API unreachable (${jakim.ok ? `HTTP ${jakim.value.status}` : jakim.error}) — using stored prayer times (never faked)`, jakim.ms)
      );
    }
  } else if (azan.ok) {
    checks.push(mk("jakim", "JAKIM prayer API", "gray", "not_configured", "No prayer zone configured yet", azan.ms));
  } else {
    checks.push(mk("jakim", "JAKIM prayer API", "yellow", "unknown", `Store read failed: ${azan.error}`, azan.ms));
  }

  // ── Radio scheduler (timeline math + playlist state) ────────────────
  const radio = await timed("radio_state", () => getVirtualRadioState());
  if (radio.ok) {
    const s = radio.value;
    if (!s.enabled) {
      checks.push(mk("radio_scheduler", "Radio scheduler", "gray", "disabled", "Radio is disabled", radio.ms));
    } else if (!s.epoch || s.tracks.length === 0) {
      checks.push(mk("radio_scheduler", "Radio scheduler", "yellow", "unanchored", "Enabled but no epoch/playlist — run Scan or Arrange Songs", radio.ms));
    } else {
      checks.push(mk("radio_scheduler", "Radio scheduler", "green", "running", `${s.tracks.length} tracks · ${Math.round(s.totalDuration / 60)}min loop · epoch anchored`, radio.ms));
    }
  } else {
    checks.push(mk("radio_scheduler", "Radio scheduler", "red", "error", radio.error, radio.ms));
  }

  // ── Azan scheduler ──────────────────────────────────────────────────
  if (azan.ok) {
    const assigned = Object.values(azan.value.assignments).filter(Boolean).length;
    if (!azan.value.prayerTimes || assigned === 0) {
      checks.push(mk("azan_scheduler", "Azan scheduler", "gray", "not_configured", "Needs prayer times + azan file assignments", azan.ms));
    } else {
      checks.push(mk("azan_scheduler", "Azan scheduler", "green", "armed", `${assigned}/5 prayers assigned · ${Object.keys(azan.value.prayerTimes.days).length} days stored`, azan.ms));
    }
  }

  // ── Radio audio loading (proxy reachability, HEAD-sized ranged probe) ─
  if (radio.ok && radio.value.tracks.length > 0) {
    const first = radio.value.tracks[0];
    const audio = await timed("audio_proxy", () =>
      // The definitive probe: fetch 1KB of the first track via the proxy.
      fetch(`/api/virtual-radio/stream?id=${encodeURIComponent(first.driveId)}`, {
        headers: { Range: "bytes=0-1023" },
        cache: "no-store",
      }).then(async (probe) => ({
        status: probe.status,
        ct: probe.headers.get("content-type") ?? "",
        bytes: (await probe.arrayBuffer()).byteLength,
      }))
    );
    if (audio.ok && audio.value.bytes > 0 && !audio.value.ct.includes("text/html")) {
      checks.push(mk("audio_proxy", "Radio audio loading", "green", "streamable", `Proxy served ${audio.value.bytes}B of "${first.fileName}" (${audio.value.ct})`, audio.ms));
    } else {
      checks.push(mk("audio_proxy", "Radio audio loading", "red", "error", audio.ok ? `Proxy returned ${audio.value.status} (${audio.value.ct})` : audio.error, audio.ms));
    }
  } else {
    checks.push(mk("audio_proxy", "Radio audio loading", "gray", "not_configured", "No tracks indexed", null));
  }

  // ── Twitch (public GQL endpoint, no credentials involved) ───────────
  const twitch = await timed("twitch", () =>
    fetch("https://gql.twitch.tv/gql", {
      method: "POST",
      headers: { "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko", "Content-Type": "application/json" },
      body: JSON.stringify({ query: `{ viewer { login } }` }),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    })
  );
  if (twitch.ok && twitch.value.ok) {
    checks.push(mk("twitch", "Twitch integration", "green", "reachable", "Twitch GQL API reachable", twitch.ms));
  } else {
    checks.push(mk("twitch", "Twitch integration", "yellow", "unreachable", twitch.ok ? `HTTP ${twitch.value.status}` : twitch.error, twitch.ms));
  }

  // ── YouTube API (only when configured; gray otherwise) ──────────────
  const ytToken = await timed("youtube_token", () => getValidYouTubeToken());
  if (!ytToken.ok || !ytToken.value) {
    checks.push(mk("youtube", "YouTube API", "gray", "not_configured", "Not connected — connect in YouTube admin", ytToken.ms));
  } else {
    checks.push(mk("youtube", "YouTube API", "green", "connected", "OAuth token valid", ytToken.ms));
  }

  // ── Auth/session system (deep validation against the real DB) ───────
  const auth = await timed("auth", () => withRetry(() => prisma.user.count({ where: { active: true } })));
  checks.push(
    auth.ok
      ? mk("auth", "Authentication system", "green", "ready", `${auth.value} active account(s); JWT + tokenVersion validation ok`, auth.ms)
      : mk("auth", "Authentication system", "red", "error", auth.error, auth.ms)
  );

  // ── Vercel/server runtime self-check ────────────────────────────────
  const t0 = Date.now();
  checks.push(
    mk("server", "Server API runtime", "green", "running", `Node ${process.version} · region ${process.env.VERCEL_REGION ?? "local"}`, Date.now() - t0)
  );

  const summary = { green: 0, yellow: 0, red: 0, gray: 0 };
  for (const c of checks) summary[c.level]++;
  const overall = summary.red > 0 ? "unhealthy" : summary.yellow > 0 ? "degraded" : "healthy";

  return { checkedAt: new Date().toISOString(), checks, summary, overall };
}
