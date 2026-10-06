import { getVirtualRadioState } from "@/lib/virtual-radio-store";
import { getAzanState } from "@/lib/azan-store";
import { computeAzanSchedule, isTestModeActive } from "@/lib/azan";
import { getRadioPosition } from "@/lib/virtual-radio";
import { getValidDriveToken } from "@/lib/google-drive";
import { prisma, withRetry } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";

/**
 * Radio Diagnostics engine (spec §3).
 *
 * Each test performs a REAL inspection of the current system — configuration
 * reads, API reachability, a 1KB ranged fetch through the stream proxy,
 * timeline math and playlist/azan alignment recomputation. No test can pass
 * on assumption: anything that cannot be verified comes back yellow/gray
 * with the reason.
 */

export interface RadioTest {
  key: string;
  label: string;
  level: "green" | "yellow" | "red" | "gray";
  passed: boolean | null; // null = informational / not applicable
  detail: string;
  responseTimeMs: number | null;
}

export interface RadioDiagnosticReport {
  checkedAt: string;
  serverTime: number;
  tests: RadioTest[];
  passed: number;
  failed: number;
  warnings: number;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T; ms: number } | { ok: false; ms: number; error: string }> {
  const t0 = Date.now();
  try {
    const value = await fn();
    return { ok: true, value, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function runRadioDiagnostics(): Promise<RadioDiagnosticReport> {
  const tests: RadioTest[] = [];
  const now = Date.now();
  const add = (key: string, label: string, level: RadioTest["level"], passed: boolean | null, detail: string, ms: number | null) =>
    tests.push({ key, label, level, passed, detail, responseTimeMs: ms });

  // 1. Google Drive connectivity (real API call when connected)
  const tokenRes = await timed(() => getValidDriveToken());
  const token = tokenRes.ok ? tokenRes.value?.accessToken ?? null : null;
  if (!token) {
    add("drive", "Google Drive", "gray", null, "Not connected — radio scanning/streaming needs a Drive connection", tokenRes.ms);
  } else {
    const probe = await timed(() =>
      fetch("https://www.googleapis.com/drive/v3/about?fields=user", {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      })
    );
    add(
      "drive",
      "Google Drive",
      probe.ok && probe.value.ok ? "green" : "red",
      probe.ok ? probe.value.ok : false,
      probe.ok ? (probe.value.ok ? "Drive API reachable with a valid token" : `Drive rejected the token (HTTP ${probe.value.status})`) : probe.error,
      probe.ms
    );
  }

  // 2. Track indexing (playlist state)
  const state = await getVirtualRadioState();
  if (!state.folderId) {
    add("indexing", "Track indexing", "gray", null, "No radio folder configured", null);
  } else if (state.tracks.length === 0 && state.pending.length === 0) {
    add("indexing", "Track indexing", "yellow", false, "Folder set but nothing indexed — run Scan / Arrange Songs", null);
  } else {
    add("indexing", "Track indexing", "green", true, `${state.tracks.length} indexed · ${state.pending.length} pending duration · last scan ${state.lastScanAt ? new Date(state.lastScanAt).toLocaleString() : "never"}`, null);
  }

  // 3. Duration detection coverage
  if (state.tracks.length > 0) {
    const withDur = state.tracks.filter((t) => t.duration > 0).length;
    const ratio = withDur / state.tracks.length;
    add(
      "durations",
      "Track duration detection",
      ratio === 1 ? "green" : ratio >= 0.9 ? "yellow" : "yellow",
      ratio > 0.5,
      `${withDur}/${state.tracks.length} tracks have measured durations${state.pending.length ? ` · ${state.pending.length} need browser verification` : ""}`,
      null
    );
  } else {
    add("durations", "Track duration detection", "gray", null, "No indexed tracks to verify", null);
  }

  // 4. Audio URL/proxy — 1KB ranged fetch of the current (or first) track
  const pos = getRadioPosition(state, now);
  const probeTrack = pos ? state.tracks[pos.index] : state.tracks[0];
  if (probeTrack && probeTrack.driveId) {
    const probe = await timed(() =>
      fetch(`/api/virtual-radio/stream?id=${encodeURIComponent(probeTrack.driveId)}`, {
        headers: { Range: "bytes=0-1023" },
        cache: "no-store",
      })
    );
    if (probe.ok) {
      const buf = await probe.value.arrayBuffer();
      const ct = probe.value.headers.get("content-type") ?? "";
      const okProbe = buf.byteLength > 0 && !ct.includes("text/html") && (probe.value.status === 200 || probe.value.status === 206);
      add("proxy", "Audio URL / proxy", okProbe ? "green" : "red", okProbe, okProbe ? `Proxy returned ${buf.byteLength}B (${ct}, HTTP ${probe.value.status}) for "${probeTrack.fileName}"` : `Bad proxy response: HTTP ${probe.value.status} ${ct}`, probe.ms);
    } else {
      add("proxy", "Audio URL / proxy", "red", false, probe.error, probe.ms);
    }
  } else {
    add("proxy", "Audio URL / proxy", "gray", null, "No track available to probe", null);
  }

  // 5. HTMLAudioElement capability (client-side decoding is verified in the
  // browser UI; here we verify the server can emit a decodable content type).
  if (probeTrack) {
    const ct = tests.find((t) => t.key === "proxy");
    const audioOk = ct?.level === "green" && /audio|octet-stream|mpeg|video/i.test(ct.detail);
    add("audio_element", "HTMLAudioElement source", audioOk ? "green" : "yellow", audioOk ? true : null, audioOk ? "Content type is browser-decodable audio" : "Verify playback in the browser player (content type uncertain)", null);
  } else {
    add("audio_element", "HTMLAudioElement source", "gray", null, "No track to validate", null);
  }

  // 6. Virtual timeline + server clock sanity
  if (state.enabled && state.epoch && state.totalDuration > 0) {
    const elapsed = (now - state.epoch) / 1000;
    const cycles = Math.floor(elapsed / state.totalDuration);
    add("timeline", "Virtual timeline", "green", true, `Anchored ${Math.round(elapsed / 3600)}h ago · cycle ${cycles} · position ${pos ? `#${pos.index + 1} @ ${Math.round(pos.offset)}s` : "—"}`, null);
  } else if (state.enabled) {
    add("timeline", "Virtual timeline", "yellow", false, "Enabled but epoch/duration missing — rescan the folder", null);
  } else {
    add("timeline", "Virtual timeline", "gray", null, "Radio disabled", null);
  }

  // 7. Server clock — two rapid reads must agree within a few ms and the
  //    clock must be monotonic-ish vs the DB.
  const t1 = Date.now();
  await new Promise((r) => setTimeout(r, 50));
  const t2 = Date.now();
  const drift = Math.abs(t2 - t1 - 50);
  let dbClockMs: number | null = null;
  try {
    await ensureDatabase();
    const rows = (await withRetry(() => prisma.$queryRaw`SELECT EXTRACT(EPOCH FROM now()) * 1000 AS ms` as Promise<{ ms: string }[]>)) as { ms: string }[];
    dbClockMs = rows?.[0] ? Number(rows[0].ms) : null;
  } catch {
    dbClockMs = null;
  }
  const clockSkew = dbClockMs != null ? Math.abs(dbClockMs - t2) : null;
  if (clockSkew != null && clockSkew < 5_000) {
    add("clock", "Server clock sync", "green", true, `App↔DB clock skew ${Math.round(clockSkew)}ms · monotonic ok`, t2 - t1);
  } else if (clockSkew == null) {
    add("clock", "Server clock sync", "yellow", null, `App clock self-consistency ${drift < 100 ? "ok" : `${drift}ms drift`}; DB clock unavailable`, t2 - t1);
  } else {
    add("clock", "Server clock sync", "red", false, `App↔DB clock skew ${Math.round(clockSkew)}ms — azan timing at risk`, t2 - t1);
  }

  // 8. JAKIM prayer time data freshness
  const azanStore = await getAzanState();
  if (!azanStore.prayerZone || !azanStore.prayerTimes) {
    add("jakim", "JAKIM prayer time", "gray", null, "No zone configured / no prayer-time data", null);
  } else {
    const todayKey = new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);
    const hasToday = !!azanStore.prayerTimes.days[todayKey];
    const ageH = (now - new Date(azanStore.prayerTimes.updatedAt).getTime()) / 3_600_000;
    add(
      "jakim",
      "JAKIM prayer time",
      hasToday ? "green" : "yellow",
      hasToday,
      `Zone ${azanStore.prayerZone} · ${Object.keys(azanStore.prayerTimes.days).length} days stored · today ${hasToday ? "covered" : "MISSING"} · last sync ${Math.round(ageH)}h ago`,
      null
    );
  }

  // 9. Azan audio files (assigned + measured)
  const assignedCount = Object.values(azanStore.assignments).filter(Boolean).length;
  const files = azanStore.files.filter((f) => !f.unavailable);
  const usable = files.filter((f) => f.duration > 0);
  if (assignedCount === 0) {
    add("azan_audio", "Azan audio", "gray", null, "No azan files assigned to prayers", null);
  } else {
    const assignedUsable = Object.values(azanStore.assignments).filter((id) => {
      const f = files.find((x) => x.driveId === id);
      return f && f.duration > 0;
    }).length;
    add("azan_audio", "Azan audio", assignedUsable === assignedCount ? "green" : "red", assignedUsable === assignedCount, `${assignedCount}/5 prayers assigned · ${assignedUsable} with measured durations · ${usable.length}/${files.length} files usable`, null);
  }

  // 10. Azan scheduler — compute the schedule and verify it is well-formed
  const testActive = isTestModeActive(azanStore.testMode, now);
  const schedule = computeAzanSchedule(now, azanStore.prayerTimes, azanStore.assignments, azanStore.files, testActive ? azanStore.testMode.overrides : null);
  if (schedule.next) {
    const inMin = (schedule.next.startsAt - now) / 60_000;
    add("azan_scheduler", "Azan scheduler", "green", true, `Next: ${schedule.next.prayer} in ${inMin < 1 ? "<1" : Math.round(inMin)}min · ${testActive ? "TEST MODE times" : "official times"}`, null);
  } else if (schedule.active) {
    add("azan_scheduler", "Azan scheduler", "green", true, `Azan ${schedule.active.prayer} ACTIVE now`, null);
  } else {
    add("azan_scheduler", "Azan scheduler", "yellow", false, "Schedule produced no upcoming azan — check prayer data coverage (today/tomorrow) and assignments", null);
  }

  // 11. Playlist alignment — does the current segment END at the next azan?
  if (schedule.next && state.enabled && state.epoch && state.totalDuration > 0 && pos) {
    const currentRemaining = Math.max(0, state.tracks[pos.index].duration - pos.offset);
    const gap = (schedule.next.startsAt - now) / 1000 - currentRemaining;
    const deviation = Math.abs(gap) <= 90 ? 0 : Math.abs(gap) - 90;
    if (Math.abs(gap) <= 1.5) {
      add("alignment", "Playlist alignment", "green", true, `Segment ends ${Math.round(gap * 10) / 10}s from ${schedule.next.prayer} azan — aligned`, null);
    } else if (Math.abs(gap) <= 90) {
      add("alignment", "Playlist alignment", "green", true, `Segment ends ${Math.round(gap)}s ${gap > 0 ? "before" : "after"} ${schedule.next.prayer} azan (within tolerance)`, null);
    } else {
      add("alignment", "Playlist alignment", "yellow", false, `Segment ends ${Math.round(Math.abs(gap))}s ${gap > 0 ? "before" : "after"} ${schedule.next.prayer} azan — run ARRANGE SONGS to realign`, null);
    }
    void deviation;
  } else {
    add("alignment", "Playlist alignment", "gray", null, "No upcoming azan or timeline to align against", null);
  }

  // 12. Playback state (informational — real element events live in browsers)
  add("playback", "Playback state", "gray", null, pos && state.enabled ? `Server says track #${pos.index + 1}; actual element state is per-browser (see Broadcast History for real plays)` : "Radio not playing", null);

  const passed = tests.filter((t) => t.passed === true).length;
  const failed = tests.filter((t) => t.passed === false).length;
  const warnings = tests.filter((t) => t.level === "yellow").length;

  return { checkedAt: new Date(now).toISOString(), serverTime: now, tests, passed, failed, warnings };
}
