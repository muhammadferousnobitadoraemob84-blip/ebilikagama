import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { getAzanState, getAzanTestMode, saveAzanTestMode, resetAzanTestMode } from "@/lib/azan-store";
import { isTestModeActive, msToMalaysiaDate, sanitizeOverrides, type AzanPrayer } from "@/lib/azan";

export const dynamic = "force-dynamic";

// ADMIN-ONLY Prayer Time Test Mode API.
//
// GET    → current test mode + official times for reference.
// POST   → enable/apply overrides ({overrides, expiresAt?}) or
//          {action:"disable"} (keeps values, stops using them).
// DELETE → RESET TO OFFICIAL JAKIM TIMES: disables and clears every
//          override. Official JAKIM/PDF data is NEVER touched by any of
//          these operations — test values live in their own Setting key.

const MAX_TEST_MS = 6 * 60 * 60 * 1000; // hard safety cap: 6 hours

function forbidden() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export async function GET() {
  if (!(await getAdminSession())) return forbidden();
  try {
    const azan = await getAzanState();
    const serverTime = Date.now();
    const today = azan.prayerTimes?.days[msToMalaysiaDate(serverTime)] ?? null;
    return NextResponse.json(
      {
        serverTime,
        testMode: { ...azan.testMode, active: isTestModeActive(azan.testMode, serverTime) },
        officialToday: today
          ? {
              subuh: today.subuh,
              zohor: today.zohor,
              asar: today.asar,
              maghrib: today.maghrib,
              isyak: today.isyak,
            }
          : null,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[TEST-MODE GET]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to load test mode" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await getAdminSession())) return forbidden();
  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: "enable" | "apply" | "disable";
      overrides?: Partial<Record<AzanPrayer, string>>;
      expiresAt?: number | null;
    };

    const current = await getAzanTestMode();

    if (body.action === "disable") {
      const saved = await saveAzanTestMode({ ...current, enabled: false, expiresAt: null });
      return NextResponse.json({ ok: true, testMode: { ...saved, active: false } });
    }

    // enable/apply: sanitize overrides, clamp expiry to the safety cap.
    const overrides = sanitizeOverrides(body.overrides ?? current.overrides);
    const now = Date.now();
    let expiresAt = typeof body.expiresAt === "number" ? body.expiresAt : current.expiresAt;
    if (expiresAt != null && (expiresAt <= now || expiresAt - now > MAX_TEST_MS)) {
      expiresAt = now + MAX_TEST_MS; // clamp: expired input or beyond the cap
    }
    const saved = await saveAzanTestMode({
      enabled: true,
      overrides,
      expiresAt,
      updatedAt: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true, testMode: { ...saved, active: isTestModeActive(saved, Date.now()) } });
  } catch (err) {
    console.error("[TEST-MODE POST]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to save test mode" }, { status: 500 });
  }
}

export async function DELETE() {
  if (!(await getAdminSession())) return forbidden();
  try {
    await resetAzanTestMode();
    return NextResponse.json({ ok: true, testMode: { enabled: false, overrides: {}, expiresAt: null, active: false }, message: "Using official prayer times" });
  } catch (err) {
    console.error("[TEST-MODE DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to reset test mode" }, { status: 500 });
  }
}
