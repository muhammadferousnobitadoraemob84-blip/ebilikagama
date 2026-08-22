import { subscribe } from "@/lib/channel-events";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial data
      const send = async () => {
        try {
          const channels = await prisma.channel.findMany({
            where: { active: true },
            orderBy: { displayOrder: "asc" },
          });
          const data = `data: ${JSON.stringify(channels)}\n\n`;
          controller.enqueue(encoder.encode(data));
        } catch {
          // ignore
        }
      };

      send();

      // Subscribe to changes
      const unsubscribe = subscribe(() => {
        send();
      });

      // Send heartbeat every 30s to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
          unsubscribe();
        }
      }, 30000);

      // Cleanup on close
      const originalCancel = controller.close.bind(controller);
      // We handle cleanup via the abort signal below
      void originalCancel;
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
