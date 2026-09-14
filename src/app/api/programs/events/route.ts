import { subscribeProgram } from "@/lib/program-events";
import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { getThumbnailMeta, dataThumbUrl } from "@/lib/thumb-meta";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const channelId = searchParams.get("channelId");
  const date = searchParams.get("date");

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = async () => {
        try {
          const where: Record<string, string> = {};
          if (channelId) where.channelId = channelId;
          if (date) where.date = date;

          // Select WITHOUT the base64 thumbnail column; classify thumbnails
          // with a cheap projection query so blobs never leave the database.
          const programs = await prisma.program.findMany({
            where: Object.keys(where).length > 0 ? where : undefined,
            orderBy: { startTime: "asc" },
            select: {
              id: true,
              channelId: true,
              title: true,
              date: true,
              startTime: true,
              endTime: true,
              description: true,
              status: true,
              youtubeBroadcastId: true,
              youtubeUrl: true,
              createdAt: true,
              updatedAt: true,
              channel: { select: { id: true, name: true } },
            },
          });
          const meta = await getThumbnailMeta(
            "Program",
            channelId
              ? date
                ? Prisma.sql`"channelId" = ${channelId} AND "date" = ${date}`
                : Prisma.sql`"channelId" = ${channelId}`
              : date
                ? Prisma.sql`"date" = ${date}`
                : Prisma.sql`true`
          );
          const optimized = programs.map((p) => {
            const m = meta.get(p.id);
            return {
              ...p,
              thumbnail:
                m?.kind === "data"
                  ? dataThumbUrl("program", p.id, p.updatedAt)
                  : m?.kind === "url"
                    ? m.url
                    : null,
            };
          });
          const data = `data: ${JSON.stringify(optimized)}\n\n`;
          controller.enqueue(encoder.encode(data));
        } catch {
          // ignore
        }
      };

      send();

      const unsubscribe = subscribeProgram(() => {
        send();
      });

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
          unsubscribe();
        }
      }, 30000);

      // Cleanup on close (via abort signal)
      request.signal?.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
