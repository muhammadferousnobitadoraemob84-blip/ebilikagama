import { prisma, withRetry } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";

/**
 * System Incidents service (spec §19).
 *
 * One row per unique failure signature. Repeated occurrences of the same
 * problem bump `occurrences` + `lastDetectedAt` instead of flooding the
 * table. Messages are safe, human-readable summaries — never stack traces.
 */

export type IncidentService =
  | "radio" | "azan" | "drive" | "jakim" | "youtube" | "twitch"
  | "database" | "auth" | "audio" | "scheduler";

export type IncidentSeverity = "info" | "warning" | "error" | "critical";

export interface IncidentInput {
  service: IncidentService;
  kind: string; // failure kind, e.g. "api_unreachable"
  severity?: IncidentSeverity;
  message: string; // already-safe summary (callers must strip secrets)
}

/** Report a failure. Fire-and-forget: never throws to the caller. */
export async function reportIncident(input: IncidentInput): Promise<void> {
  try {
    await ensureDatabase();
    const signature = `${input.service}:${input.kind}`;
    const existing = await withRetry(() =>
      prisma.incident.findUnique({ where: { signature }, select: { id: true, status: true } })
    );
    if (existing && existing.status !== "resolved") {
      await withRetry(() =>
        prisma.incident.update({
          where: { signature },
          data: {
            lastDetectedAt: new Date(),
            occurrences: { increment: 1 },
            message: input.message.slice(0, 800),
            severity: input.severity ?? "warning",
          },
        })
      );
    } else {
      // Resolved incident recurring → open a NEW row so history is preserved.
      await withRetry(() =>
        prisma.incident.create({
          data: {
            signature: `${input.service}:${input.kind}:${Date.now()}`,
            service: input.service,
            severity: input.severity ?? "warning",
            message: input.message.slice(0, 800),
            status: "open",
          },
        }).catch(async () => {
          // Unique-race with a concurrent create — fall back to the bump path.
          await prisma.incident.upsert({
            where: { signature },
            update: { lastDetectedAt: new Date(), occurrences: { increment: 1 } },
            create: {
              signature,
              service: input.service,
              severity: input.severity ?? "warning",
              message: input.message.slice(0, 800),
            },
          });
        })
      );
    }
  } catch (e) {
    console.warn("[INCIDENT] report failed:", e instanceof Error ? e.message : e);
  }
}

/**
 * Mark a failure signature healthy again: resolve any OPEN incident that
 * matches. Called by the health checker when a check recovers.
 */
export async function resolveIncidents(service: IncidentService, kind: string): Promise<void> {
  try {
    await ensureDatabase();
    const candidates = await withRetry(() =>
      prisma.incident.findMany({
        where: { service, status: { not: "resolved" }, signature: { startsWith: `${service}:${kind}` } },
        select: { id: true },
      })
    );
    for (const c of candidates) {
      await prisma.incident
        .update({
          where: { id: c.id },
          data: { status: "resolved", resolvedAt: new Date() },
        })
        .catch(() => {});
    }
  } catch {
    // non-fatal
  }
}
