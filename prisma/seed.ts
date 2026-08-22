import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // Create owner account
  const existingOwner = await prisma.user.findUnique({ where: { username: "muhammadferousmsa" } });
  if (!existingOwner) {
    // Remove any old admin accounts first
    await prisma.user.deleteMany({ where: { role: "admin" } });
    const passwordHash = await bcrypt.hash("MuhammadFerous40*****", 10);
    await prisma.user.create({
      data: {
        username: "muhammadferousmsa",
        passwordHash,
        role: "owner",
      },
    });
    console.log("✓ Owner account created (muhammadferousmsa)");
  }

  // Seed Saluran TV channels
  const saluranTVChannels = [
    { name: "TV1", twitchUsername: "tv1official", displayOrder: 1, description: "Saluran televisyen utama Radio Televisyen Malaysia" },
    { name: "TV2", twitchUsername: "tv2official", displayOrder: 2, description: "Saluran kedua Radio Televisyen Malaysia" },
    { name: "Okey", twitchUsername: "okeytv", displayOrder: 3, description: "Saluran hiburan dan maklumat untuk rakyat Malaysia" },
    { name: "Berita", twitchUsername: "beritartm", displayOrder: 4, description: "Saluran berita 24 jam Radio Televisyen Malaysia" },
    { name: "Sukan+", twitchUsername: "sukanplus", displayOrder: 5, description: "Saluran sukan dan aktiviti lasak" },
  ];

  for (const ch of saluranTVChannels) {
    const existing = await prisma.channel.findFirst({ where: { name: ch.name } });
    if (!existing) {
      await prisma.channel.create({
        data: {
          name: ch.name,
          category: "saluran-tv",
          twitchUsername: ch.twitchUsername,
          description: ch.description,
          displayOrder: ch.displayOrder,
          active: true,
          liveStatus: "automatic",
        },
      });
    }
  }
  console.log("✓ Saluran TV channels seeded");

  // Seed Saluran Khas channels
  const saluranKhasChannels = [
    { name: "Parlimen", twitchUsername: "parlimenrtm", displayOrder: 1, description: "Siaran langsung sidang Parlimen Malaysia" },
    { name: "RTM World", twitchUsername: "rtmworld", displayOrder: 2, description: "Saluran antarabangsa Radio Televisyen Malaysia" },
    { name: "Majlis Rasmi", twitchUsername: "majlisrasmi", displayOrder: 3, description: "Siaran majlis dan acara kerajaan" },
    { name: "Ibadah", twitchUsername: "ibadahrtm", displayOrder: 4, description: "Saluran program keagamaan dan kerohanian" },
  ];

  for (const ch of saluranKhasChannels) {
    const existing = await prisma.channel.findFirst({ where: { name: ch.name } });
    if (!existing) {
      await prisma.channel.create({
        data: {
          name: ch.name,
          category: "saluran-khas",
          twitchUsername: ch.twitchUsername,
          description: ch.description,
          displayOrder: ch.displayOrder,
          active: true,
          liveStatus: "automatic",
        },
      });
    }
  }
  console.log("✓ Saluran Khas channels seeded");

  // Seed default settings
  const defaultSettings = [
    { key: "site_name", value: "eBilikAgamaTV" },
    { key: "site_logo", value: "" },
    { key: "hero_title", value: "Siaran Langsung Televisyen Malaysia" },
    { key: "hero_description", value: "Tonton saluran televisyen Malaysia secara langsung. Semua saluran RTM di satu tempat." },
    { key: "hero_image", value: "" },
    { key: "saluran_tv_title", value: "Saluran TV" },
    { key: "saluran_khas_title", value: "Saluran Khas" },
    { key: "footer_text", value: "© 2026 eBilikAgamaTV. Hak cipta terpelihara." },
    { key: "contact_email", value: "" },
    { key: "social_facebook", value: "" },
    { key: "social_twitter", value: "" },
    { key: "social_youtube", value: "" },
    { key: "social_instagram", value: "" },
  ];

  for (const setting of defaultSettings) {
    const existing = await prisma.setting.findUnique({ where: { key: setting.key } });
    if (!existing) {
      await prisma.setting.create({ data: setting });
    }
  }
  console.log("✓ Default settings seeded");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
