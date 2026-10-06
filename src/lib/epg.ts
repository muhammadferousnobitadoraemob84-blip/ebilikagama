import { prisma } from "@/lib/prisma";

/**
 * EPG recurrence expansion (spec §10).
 *
 * Templates are Program rows with recurrence = daily|weekly. This helper
 * expands them into concrete instances for a target date. Read-only: it
 * never writes instances — the EPG views render the expanded schedule, and
 * editing an instance edits/overrides a one-off row like today.
 */

export function nextDate(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + delta * 86_400_000;
  const nd = new Date(t);
  return `${nd.getUTCFullYear()}-${String(nd.getUTCMonth() + 1).padStart(2, "0")}-${String(nd.getUTCDate()).padStart(2, "0")}`;
}

export function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sunday
}

/** Does the recurring template `tpl` air on `dateStr`? */
export function templateCovers(
  tpl: { date: string; recurrence: string | null; recurrenceWeekday: number | null; recurrenceUntil: string | null },
  dateStr: string
): boolean {
  if (!tpl.recurrence || tpl.recurrence === "none") return false;
  if (tpl.recurrenceUntil && dateStr > tpl.recurrenceUntil) return false;
  if (dateStr < tpl.date) return false;
  if (tpl.recurrence === "daily") return true;
  if (tpl.recurrence === "weekly") {
    // Weekly on the template's weekday (falls back to the template start date).
    const target = tpl.recurrenceWeekday ?? weekdayOf(tpl.date);
    return weekdayOf(dateStr) === target;
  }
  return false;
}

interface ExpandedProgram {
  id: string;
  channelId: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  description: string | null;
  status: string;
  recurrence: string;
}

/**
 * Expand recurring templates for (channelId, date). `excludeId` skips the
 * template itself (used by admin views that already list it).
 */
export async function expandRecurring(channelId: string, dateStr: string, excludeId?: string): Promise<ExpandedProgram[]> {
  try {
    // Look back up to 62 days for weekly templates whose start < target date.
    const from = nextDate(dateStr, -62);
    const templates = await prisma.program.findMany({
      where: {
        channelId,
        AND: [
          { recurrence: { not: null } },
          { recurrence: { not: "none" } },
        ],
        date: { gte: from, lte: dateStr },
        parentId: null, // templates only
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: {
        id: true, title: true, date: true, startTime: true, endTime: true,
        description: true, status: true, recurrence: true,
        recurrenceWeekday: true, recurrenceUntil: true,
      },
    });

    const out: ExpandedProgram[] = [];
    for (const tpl of templates) {
      if (!templateCovers(tpl, dateStr)) continue;
      out.push({
        // Deterministic virtual id per (template, date): UI can key on it.
        id: `${tpl.id}@${dateStr}`,
        channelId,
        title: tpl.title,
        date: dateStr,
        startTime: tpl.startTime,
        endTime: tpl.endTime,
        description: tpl.description,
        status: tpl.status === "finished" && dateStr !== tpl.date ? "scheduled" : tpl.status,
        recurrence: tpl.recurrence ?? "none",
      });
    }
    return out;
  } catch {
    return [];
  }
}
