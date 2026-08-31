import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting database seed...\n");

  // ── 1. OWNER ACCOUNT ──────────────────────────────────────────────
  const existingOwner = await prisma.user.findFirst({ where: { role: "owner" } });
  if (!existingOwner) {
    const passwordHash = await bcrypt.hash("MuhammadFerous40*****", 10);
    await prisma.user.create({
      data: {
        username: "muhammadferousmsa",
        fullName: "Muhammad Ferous",
        passwordHash,
        role: "owner",
        active: true,
      },
    });
    console.log("✓ Owner account created (muhammadferousmsa)");
  } else {
    console.log("✓ Owner account already exists");
  }

  // ── 2. SALURAN TV CHANNELS ────────────────────────────────────────
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
  console.log("✓ Saluran TV channels seeded (5 channels)");

  // ── 3. SALURAN KHAS CHANNELS ──────────────────────────────────────
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
  console.log("✓ Saluran Khas channels seeded (4 channels)");

  // ── 4. DEFAULT SETTINGS ───────────────────────────────────────────
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
    { key: "social_tiktok", value: "" },
  ];

  for (const setting of defaultSettings) {
    const existing = await prisma.setting.findUnique({ where: { key: setting.key } });
    if (!existing) {
      await prisma.setting.create({ data: setting });
    }
  }
  console.log("✓ Default settings seeded (13 settings)");

  // ── 5. SAMPLE TV PROGRAMS ─────────────────────────────────────────
  // Get today's date for sample programs
  const today = new Date().toISOString().split("T")[0];
  const tv1Channel = await prisma.channel.findFirst({ where: { name: "TV1" } });
  const tv2Channel = await prisma.channel.findFirst({ where: { name: "TV2" } });

  if (tv1Channel) {
    const existingPrograms = await prisma.program.count({ where: { channelId: tv1Channel.id, date: today } });
    if (existingPrograms === 0) {
      const samplePrograms = [
        { channelId: tv1Channel.id, title: "Berita Pagi", date: today, startTime: "06:00", endTime: "07:00", description: "Laporan berita pagi dan perkembangan terkini dalam dan luar negara.", status: "finished" },
        { channelId: tv1Channel.id, title: "Selamat Pagi Malaysia", date: today, startTime: "07:00", endTime: "09:00", description: "Program pagi interaktif dengan segmen berita, hiburan, dan gaya hidup.", status: "finished" },
        { channelId: tv1Channel.id, title: "Nasi Lemak Kopi O", date: today, startTime: "09:00", endTime: "10:00", description: "Program bual bicara santai bersama hos terkenal.", status: "finished" },
        { channelId: tv1Channel.id, title: "Berita Tengah Hari", date: today, startTime: "12:00", endTime: "13:00", description: "Laporan berita tengah hari memaparkan perkembangan semasa.", status: "finished" },
        { channelId: tv1Channel.id, title: "Memori: Sendai Kasihmu", date: today, startTime: "13:00", endTime: "14:30", description: "Siri drama televisyen tentang kehidupan dan pengorbanan.", status: "scheduled" },
        { channelId: tv1Channel.id, title: "Berita Petang", date: today, startTime: "18:00", endTime: "19:00", description: "Laporan berita petang dan analisis mendalam.", status: "scheduled" },
        { channelId: tv1Channel.id, title: "Buletin Utama", date: today, startTime: "20:00", endTime: "21:00", description: "Buletin berita utama Radio Televisyen Malaysia.", status: "scheduled" },
        { channelId: tv1Channel.id, title: "Program Malam", date: today, startTime: "21:00", endTime: "23:00", description: "Program hiburan malam untuk keluarga.", status: "scheduled" },
      ];
      await prisma.program.createMany({ data: samplePrograms });
      console.log("✓ Sample programs seeded for TV1 (" + samplePrograms.length + " programs)");
    } else {
      console.log("✓ Programs already exist for TV1 today");
    }
  }

  if (tv2Channel) {
    const existingPrograms = await prisma.program.count({ where: { channelId: tv2Channel.id, date: today } });
    if (existingPrograms === 0) {
      const samplePrograms = [
        { channelId: tv2Channel.id, title: "Bisa Bahasa", date: today, startTime: "08:00", endTime: "09:00", description: "Program pembelajaran bahasa interaktif.", status: "finished" },
        { channelId: tv2Channel.id, title: "Selamat Pagi Malaysia 2", date: today, startTime: "09:00", endTime: "11:00", description: "Versi kedua program pagi dengan segmen berbeza.", status: "finished" },
        { channelId: tv2Channel.id, title: "Berita 2", date: today, startTime: "12:00", endTime: "13:00", description: "Laporan berita tengah hari saluran kedua.", status: "finished" },
        { channelId: tv2Channel.id, title: "Muzik TV", date: today, startTime: "14:00", endTime: "16:00", description: "Program muzik dan video klip artis tempatan.", status: "scheduled" },
        { channelId: tv2Channel.id, title: "Filem Malaysia", date: today, startTime: "20:00", endTime: "22:00", description: "Penayangan filem-filem Malaysia pilihan.", status: "scheduled" },
      ];
      await prisma.program.createMany({ data: samplePrograms });
      console.log("✓ Sample programs seeded for TV2 (" + samplePrograms.length + " programs)");
    } else {
      console.log("✓ Programs already exist for TV2 today");
    }
  }

  // ── SUMMARY ───────────────────────────────────────────────────────
  const channelCount = await prisma.channel.count({ where: { active: true } });
  const programCount = await prisma.program.count();
  const userCount = await prisma.user.count();
  const settingCount = await prisma.setting.count();
  console.log("\n═══════════════════════════════════════");
  console.log("🌱 SEED COMPLETE");
  console.log("═══════════════════════════════════════");
  console.log(`Channels:  ${channelCount}`);
  console.log(`Programs:  ${programCount}`);
  console.log(`Users:     ${userCount}`);
  console.log(`Settings:  ${settingCount}`);
  console.log("═══════════════════════════════════════\n");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
