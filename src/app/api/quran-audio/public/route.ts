import { NextRequest, NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET — Public endpoint for the visitor Quran player
// Returns available audio entries grouped by surah for the player
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const surahNumber = searchParams.get("surah");
    const reciterName = searchParams.get("reciter");

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
          reciterName: true,
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
