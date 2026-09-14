import { subscribe } from "@/lib/channel-events";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getThumbnailMeta, dataThumbUrl } from "@/lib/thumb-meta";

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
          // No base64 blobs over the wire: select without the thumbnail
          // column and classify thumbnails with a cheap projection query.
          const channels = await prisma.channel.findMany({
            where: { active: true },
            orderBy: { displayOrder: "asc" },
            select: {
              id: true,
              name: true,
              category: true,
              twitchUsername: true,
              description: true,
              liveStatus: true,
              displayOrder: true,
              updatedAt: true,
            },
          });
          if (!closed) {
            const meta = await getThumbnailMeta(
              "Channel",
              Prisma.sql`"active" = true`
            );
            const optimized = channels.map((ch) => {
              const m = meta.get(ch.id);
              return {
                ...ch,
                thumbnail:
                  m?.kind === "data"
                    ? dataThumbUrl("channel", ch.id, ch.updatedAt)
                    : m?.kind === "url"
                      ? m.url
                      : null,
              };
            });
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
