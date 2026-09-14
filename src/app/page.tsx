import { prisma } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";
import { getThumbnailMeta, dataThumbUrl } from "@/lib/thumb-meta";
import { Prisma } from "@prisma/client";
import HomePageClient from "@/components/HomePageClient";
// Force dynamic — never cache this page statically
export const dynamic = "force-dynamic";

// Settings keys this page consumes. Image settings (site_logo, hero_image)
// are served through /api/images/setting/... — their base64 blobs are never
// selected here (transferring them from the DB on every render burned the
// Neon free-tier transfer quota).

async function getSettings() {
  try {
    await ensureDatabase();
    const keys = [
      "hero_title",
      "hero_description",
      "saluran_tv_title",
      "saluran_khas_title",
      "site_logo",
      "hero_image",
    ];
    const imageKeys = ["site_logo", "hero_image"];

    // Text settings: exclude any value that is a base64 data URI so blobs
    // are never transferred from the database.
    const textRows = await prisma.$queryRaw<
      { key: string; value: string }[]
    >`SELECT "key", "value" FROM "Setting"
       WHERE "key" IN (${Prisma.join(keys)}) AND ("value" NOT LIKE 'data:%')`;

    // Image settings: fetch only existence + timestamp, never the blob.
    const imageRows = await prisma.$queryRaw<
      { key: string; "updatedAt": Date | null }[]
    >`SELECT "key", "updatedAt" FROM "Setting"
       WHERE "key" IN (${Prisma.join(imageKeys)}) AND ("value" LIKE 'data:%')`;

    const map: Record<string, string> = {};
    for (const s of textRows) {
      map[s.key] = s.value;
    }
    for (const s of imageRows) {
      map[s.key] = dataThumbUrl("setting", s.key, s.updatedAt);
    }
    return {
      hero_title: map.hero_title || "",
      hero_description: map.hero_description || "",
      hero_image: map.hero_image || "",
      saluran_tv_title: map.saluran_tv_title || "",
      saluran_khas_title: map.saluran_khas_title || "",
    };
  } catch {
    return {};
  }
}

async function getChannels() {
  try {
    await ensureDatabase();
    // Select channel fields WITHOUT the base64 thumbnail column; classify
    // thumbnails with a cheap side query (see lib/thumb-meta.ts).
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
    const meta = await getThumbnailMeta("Channel", Prisma.sql`"active" = true`);

    return channels.map((c) => {
      const m = meta.get(c.id);
      return {
        id: c.id,
        name: c.name,
        category: c.category,
        twitchUsername: c.twitchUsername,
        thumbnail:
          m?.kind === "data"
            ? dataThumbUrl("channel", c.id, c.updatedAt)
            : m?.kind === "url"
              ? m.url
              : null,
        description: c.description,
        liveStatus: c.liveStatus,
        displayOrder: c.displayOrder,
      };
    });
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const [settings, channels] = await Promise.all([
    getSettings(),
    getChannels(),
  ]);

  return (
    <HomePageClient initialChannels={channels} initialSettings={settings} />
  );
}
