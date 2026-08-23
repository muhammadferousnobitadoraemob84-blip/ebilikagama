import { prisma } from "@/lib/prisma";
import { ensureDatabase } from "@/lib/db-init";
import HomePageClient from "@/components/HomePageClient";

// Force dynamic — never cache this page statically
export const dynamic = "force-dynamic";

async function getSettings() {
  try {
    await ensureDatabase();
    const settings = await prisma.setting.findMany();
    const map: Record<string, string> = {};
    settings.forEach((s) => {
      map[s.key] = s.value;
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
    });
    return channels.map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category,
      twitchUsername: c.twitchUsername,
      thumbnail: c.thumbnail,
      description: c.description,
      liveStatus: c.liveStatus,
      displayOrder: c.displayOrder,
    }));
  } catch {
    return [];
  }
}

export default async function HomePage() {
  // Fetch BOTH settings and channels on the server before rendering
  const [settings, channels] = await Promise.all([getSettings(), getChannels()]);

  // Pass data as props — no client-side fetch needed for initial render
  return <HomePageClient initialChannels={channels} initialSettings={settings} />;
}
