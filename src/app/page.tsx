import { prisma } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";
import HomePageClient from "@/components/HomePageClient";

// Force dynamic — never cache this page statically
export const dynamic = "force-dynamic";

async function getSettings() {
  try {
    await ensureDatabase();
    const settings = await prisma.setting.findMany({
      select: { key: true, value: true },
    });
    const map: Record<string, string> = {};
    settings.forEach((s) => {
      // Replace base64 images with API URLs to keep HTML small
      if (
        (s.key === "site_logo" || s.key === "hero_image") &&
        s.value.startsWith("data:")
      ) {
        map[s.key] = `/api/images/setting/${s.key}`;
      } else {
        map[s.key] = s.value;
      }
    });
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
    const channels = await prisma.channel.findMany({
      where: { active: true },
      orderBy: { displayOrder: "asc" },
      select: {
        id: true,
        name: true,
        category: true,
        twitchUsername: true,
        thumbnail: true,
        description: true,
        liveStatus: true,
        displayOrder: true,
      },
    });
    // Replace base64 thumbnails with lightweight image URLs
    return channels.map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category,
      twitchUsername: c.twitchUsername,
      thumbnail:
        c.thumbnail && c.thumbnail.startsWith("data:")
          ? `/api/images/channel/${c.id}`
          : c.thumbnail,
      description: c.description,
      liveStatus: c.liveStatus,
      displayOrder: c.displayOrder,
    }));
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
