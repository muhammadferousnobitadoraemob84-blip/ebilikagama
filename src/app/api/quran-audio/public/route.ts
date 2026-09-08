import { NextRequest, NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET — Public endpoint for the visitor Quran player
//
// Modes:
//   GET /api/quran-audio/public?reciters=1
//       → [{ name, count }] — distinct indexed reciters (for the Qari dropdown)
//
//   GET /api/quran-audio/public?surah=89&reciter=Mishary%20Rashid%20Alafasy
//       → indexed ayah entries for one surah + reciter, ordered by ayahNumber
//
//   GET /api/quran-audio/public
//       → all active indexed entries (ordered surah → ayah)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const wantReciters = searchParams.get("reciters") === "1";
    const surahNumber = searchParams.get("surah");
    const reciterName = searchParams.get("reciter");

    if (wantReciters) {
      const groups = await withRetry(() =>
        prisma.quranAudio.groupBy({
          by: ["reciterName"],
          where: { status: "active" },
          _count: { reciterName: true },
          orderBy: { reciterName: "asc" },
        })
      );
      return NextResponse.json(
        groups.map((g) => ({ name: g.reciterName, count: g._count.reciterName }))
      );
    }

    const where: Record<string, unknown> = { status: "active" };
    if (surahNumber) where.surahNumber = parseInt(surahNumber, 10);
    if (reciterName) where.reciterName = reciterName;

    const entries = await withRetry(() =>
      prisma.quranAudio.findMany({
        where,
        select: {
          id: true,
          surahName: true,
          surahNumber: true,
          ayahNumber: true,
          audioType: true,
          reciterName: true,
          fileName: true,
          duration: true,
        },
        orderBy: [{ surahNumber: "asc" }, { ayahNumber: "asc" }],
      })
    );

    return NextResponse.json(entries);
  } catch (error) {
    console.error("[QURAN-AUDIO-PUBLIC] Error:", error);
    return NextResponse.json({ error: "Failed to load Quran audio" }, { status: 500 });
  }
}
