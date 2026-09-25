import { NextRequest, NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";
import { getAdminSession } from "@/lib/auth";
import {
  RETENTION_CHOICES,
  RETENTION_SETTING_KEY,
  runRetentionSweep,
  type RetentionChoice,
} from "@/lib/visitor-records";

export const dynamic = "force-dynamic";

/** GET current retention setting. */
export async function GET() {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  await ensureDatabase();

  const row = await withRetry(() =>
    prisma.setting.findUnique({ where: { key: RETENTION_SETTING_KEY } })
  );
  const value = (row?.value as RetentionChoice | undefined) ?? "365";
  return NextResponse.json({
    value,
    choices: RETENTION_CHOICES,
    configured: Boolean(row),
  });
}

/**
 * POST — set retention. Explicitly documented behavior (spec §15):
 * the value is stored; a sweep runs ONLY when the admin clicks
 * "Apply & clean now" (applyNow=true). It deletes ONLY old activity/session
 * rows — never user accounts.
 */
export async function POST(request: NextRequest) {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  await ensureDatabase();

  const body = await request.json().catch(() => null);
  const value = body?.value as RetentionChoice | undefined;
  if (!value || !RETENTION_CHOICES.includes(value)) {
    return NextResponse.json({ error: "Invalid value" }, { status: 400 });
  }

  await withRetry(() =>
    prisma.setting.upsert({
      where: { key: RETENTION_SETTING_KEY },
      create: { key: RETENTION_SETTING_KEY, value },
      update: { value },
    })
  );

  let sweep: {
    deletedActivities: number;
    deletedSessions: number;
    cutoff: Date | null;
  } | null = null;
  if (body?.applyNow === true) {
    sweep = await runRetentionSweep();
  }

  return NextResponse.json({
    ok: true,
    value,
    ...(sweep
      ? {
          sweep: {
            deletedActivities: sweep.deletedActivities,
            deletedSessions: sweep.deletedSessions,
            cutoff: sweep.cutoff,
          },
        }
      : {}),
  });
}
