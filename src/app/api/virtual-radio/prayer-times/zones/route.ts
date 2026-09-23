import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { getJakimZoneDirectory } from "@/lib/jakim-zones";

export const dynamic = "force-dynamic";

// GET /api/virtual-radio/prayer-times/zones — ADMIN.
// Serves the authoritative JAKIM e-solat zone directory (grouped by state,
// official descriptions straight from e-solat.gov.my). `?force=1` busts the
// in-memory TTL so a stale list can never persist — the admin UI calls this
// with force when it wants a guaranteed-fresh directory. On live failure the
// route still returns the last-known-good snapshot (stale: true) instead of
// an incomplete list.

export async function GET(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const force = request.nextUrl.searchParams.get("force") === "1";
  try {
    const dir = await getJakimZoneDirectory({ force });
    const sabah = dir.groups.find((g) => g.state.toLowerCase() === "sabah");
    return NextResponse.json({
      success: true,
      ...dir,
      sabahCodes: sabah ? sabah.zones.map((z) => z.code) : [],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Zone directory fetch failed";
    console.error("[JAKIM-ZONES] error:", msg);
    return NextResponse.json(
      { error: `Could not load the JAKIM zone directory: ${msg}` },
      { status: 502 }
    );
  }
}
