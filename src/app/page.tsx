import { prisma } from "@/lib/prisma";
import { ensureDatabase, isDatabaseDown } from "@/lib/db-init";
import { getThumbnailMeta, dataThumbUrl } from "@/lib/thumb-meta";
import HomePageClient from "@/components/HomePageClient";
// Force dynamic — never cache this page statically
export const dynamic = "force-dynamic";

// Settings keys this page consumes. Image settings (site_logo, hero_image)
// are served through /api/images/setting/... — their base64 blobs are never
// selected here (transferring them from the DB on every render burned the
// Neon free-tier transfer quota).

async function getSettings() {
  try {
    // Breaker open (provider down) → degrade instantly; never hang the render.
    if (!(await ensureDatabase()) || isDatabaseDown()) return {};
    const keys = [
      "hero_title",
      "hero_description",
      "saluran_tv_title",
      "saluran_khas_title",
      "site_logo",
      "hero_image",
    ];
    const imageKeys = new Set(["site_logo", "hero_image"]);

    // Text settings: one projection that never touches image values.
    const textRows = await prisma.setting.findMany({
      where: {
        key: { in: keys.filter((k) => !imageKeys.has(k)) },
        valueKind: "url",
      },
      select: { id: true, key: true, value: true, updatedAt: true },
    });

    // Image settings: projection over the derived fields only — the blob is
    // never read from the database (served via /api/images/setting/<key>).
    const imageRows = await prisma.setting.findMany({
      where: { key: { in: [...imageKeys] }, valueKind: "data" },
      select: { id: true, key: true, updatedAt: true },
    });

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
    if (!(await ensureDatabase()) || isDatabaseDown()) return [];
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
    const meta = await getThumbnailMeta("channels", { active: true });

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
              ? (m.url ?? null)
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
