import { subscribeProgram } from "@/lib/program-events";
import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

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

          const programs = await prisma.program.findMany({
            where: Object.keys(where).length > 0 ? where : undefined,
            include: { channel: { select: { id: true, name: true } } },
            orderBy: { startTime: "asc" },
          });
          const data = `data: ${JSON.stringify(programs)}\n\n`;
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
