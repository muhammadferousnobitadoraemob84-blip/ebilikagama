import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { getAzanState } from "@/lib/azan-store";
import { AZAN_PRAYERS, type AzanPrayer } from "@/lib/azan";

export const dynamic = "force-dynamic";

// POST /api/virtual-radio/azan/test — ADMIN.
// Manual "TEST AZAN" preview: returns the stream URL for the file assigned
// to the chosen prayer. Pure client-side playback — it does NOT touch the
// prayer schedule or the radio timeline.
export async function POST(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await request.json().catch(() => null);
    const prayer = (body as { prayer?: string } | null)?.prayer;
    if (!prayer || !AZAN_PRAYERS.includes(prayer as AzanPrayer)) {
      return NextResponse.json({ error: "Invalid prayer" }, { status: 400 });
    }

    const azan = await getAzanState();
    const assignedId = azan.assignments[prayer as AzanPrayer];
    const file = azan.files.find((f) => f.driveId === assignedId && !f.unavailable);
    if (!file) {
      return NextResponse.json(
        { error: `No azan file is assigned to ${prayer}` },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      prayer,
      fileName: file.fileName,
      duration: file.duration,
      streamUrl: `/api/virtual-radio/stream?id=${encodeURIComponent(file.driveId)}`,
    });
  } catch (err) {
    console.error("[AZAN-TEST] error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Test request failed" }, { status: 500 });
  }
}
