import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { getAzanState, saveAzanAssignments } from "@/lib/azan-store";
import { AZAN_PRAYERS, EMPTY_AZAN_ASSIGNMENTS, type AzanAssignments } from "@/lib/azan";

export const dynamic = "force-dynamic";

// POST /api/virtual-radio/azan/assignments — ADMIN.
// Save the prayer→file mapping. One file MAY serve several prayers
// (e.g. the generic "Azan.mp3" for Zohor/Asar/Maghrib/Isyak). Every
// assigned ID is validated against the known azan files.
export async function POST(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const azan = await getAzanState();
    const known = new Set(azan.files.filter((f) => !f.unavailable).map((f) => f.driveId));

    const next: AzanAssignments = { ...EMPTY_AZAN_ASSIGNMENTS };
    for (const prayer of AZAN_PRAYERS) {
      const v = (body as Record<string, unknown>)[prayer];
      if (typeof v === "string" && v.length > 0) {
        if (!known.has(v)) {
          return NextResponse.json(
            { error: `Assigned file for ${prayer} is not a known, available azan file` },
            { status: 400 }
          );
        }
        next[prayer] = v;
      }
    }

    await saveAzanAssignments(next);
    return NextResponse.json({ success: true, assignments: next });
  } catch (err) {
    console.error("[AZAN-ASSIGN] error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to save assignments" }, { status: 500 });
  }
}
