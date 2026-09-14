import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/auth";
import { ensureDatabase } from "@/lib/db-init";
import { replayThumbUrl } from "@/lib/image-url";

export const dynamic = "force-dynamic";

// GET /api/replays/thumbnails/status — admin-only repair-scan report.
// Read-only: identifies broken/missing thumbnails without touching records.
export async function GET() {
  try {
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    await ensureDatabase();

    const replays = await prisma.replay.findMany({
      select: { id: true, title: true, date: true, updatedAt: true, thumbnail: true },
    });

    const items = replays.map((r) => {
      const t = r.thumbnail || "";
      let status: "healthy" | "missing" | "corrupt" = "healthy";
      if (!t) {
        status = "missing";
      } else if (!t.startsWith("data:image/")) {
        status = "corrupt";
      } else {
        const b64 = t.slice(t.indexOf(";base64,") + 8);
        if (!b64 || b64.length < 100) status = "corrupt";
      }
      return {
        id: r.id,
        title: r.title,
        date: r.date,
        updatedAt: r.updatedAt,
        status,
        chars: t.length,
        displayUrl: status === "healthy" ? replayThumbUrl(r.id, r.updatedAt) : null,
      };
    });

    const healthy = items.filter((i) => i.status === "healthy").length;
    const missing = items.filter((i) => i.status === "missing").length;
    const corrupt = items.filter((i) => i.status === "corrupt").length;

    return NextResponse.json({
      total: items.length,
      healthy,
      missing,
      corrupt,
      items,
    });
  } catch (error) {
    console.error("[REPLAY-THUMBS] Status error:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to scan thumbnails" }, { status: 500 });
  }
}
