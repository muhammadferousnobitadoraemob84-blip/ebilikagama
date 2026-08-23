import { subscribe } from "@/lib/channel-events";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      // Send initial data
      const send = async () => {
        if (closed) return;
        try {
          const channels = await prisma.channel.findMany({
            where: { active: true },
            orderBy: { displayOrder: "asc" },
          });
          if (!closed) {
            // Strip base64 thumbnails to keep SSE payload small
            const optimized = channels.map((ch) => ({
              ...ch,
              thumbnail:
                ch.thumbnail && ch.thumbnail.startsWith("data:")
                  ? `/api/images/channel/${ch.id}`
                  : ch.thumbnail,
            }));
            const data = `data: ${JSON.stringify(optimized)}\n\n`;
            controller.enqueue(encoder.encode(data));
          }
        } catch {
          // DB error — send empty array so clients don't hang
          if (!closed) {
            const data = `data: ${JSON.stringify([])}\n\n`;
            controller.enqueue(encoder.encode(data));
          }
        }
      };

      send();

      // Subscribe to changes
      const unsubscribe = subscribe(() => {
        send();
      });

      // Send heartbeat every 30s to keep connection alive on Vercel
      const heartbeat = setInterval(() => {
        try {
          if (!closed) {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          }
        } catch {
          closed = true;
          clearInterval(heartbeat);
          unsubscribe();
        }
      }, 30000);

      // Handle client disconnect
      // The stream will be cancelled when the client disconnects
      // Vercel's serverless runtime handles this via abort signal
    },
    cancel() {
      // Client disconnected — cleanup is handled by GC
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
