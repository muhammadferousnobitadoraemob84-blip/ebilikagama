import { PrismaClient } from "@prisma/client";

let _initialized = false;
let _prisma: PrismaClient | null = null;

function getPrisma(): PrismaClient {
  if (!_prisma) {
    _prisma = new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
      errorFormat: "minimal",
    });
  }
  return _prisma;
}

/**
 * Ensures the database tables exist.
 * Uses raw SQL to create tables (works on Vercel where child_process doesn't).
 * Idempotent — safe to call multiple times.
 */
export async function ensureDatabase(): Promise<boolean> {
  if (_initialized) return true;

  // Check if DATABASE_URL is set
  if (!process.env.DATABASE_URL) {
    console.error("[DB-INIT] DATABASE_URL is not set.");
    return false;
  }

  const client = getPrisma();

  // Step 1: Check if tables already exist
  try {
    console.log("[DB-INIT] Checking database connection...");
    await client.user.findFirst();
    console.log("[DB-INIT] Tables exist, running migrations...");
    // Tables exist — run migrations then mark initialized
    await runMigrations(client);
    _initialized = true;
    console.log("[DB-INIT] Database ready.");
    return true;
  } catch (err) {
    console.error("[DB-INIT] Tables check failed:", err);
    // Tables don't exist or connection failed — try to create
  }

  // Step 2: Create tables using raw SQL (PostgreSQL)
  try {
    console.log("[DB-INIT] Creating tables...");

    // User table
    await client.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "User" (
        "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
        "username" TEXT NOT NULL,
        "fullName" TEXT,
        "passwordHash" TEXT NOT NULL,
        "profilePhoto" TEXT,
        "role" TEXT NOT NULL DEFAULT 'admin',
        "active" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "User_username_key" UNIQUE ("username")
      );
    `);

    // Channel table
    await client.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Channel" (
        "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
        "name" TEXT NOT NULL,
        "category" TEXT NOT NULL,
        "twitchUsername" TEXT NOT NULL,
        "thumbnail" TEXT,
        "description" TEXT,
        "liveStatus" TEXT NOT NULL DEFAULT 'automatic',
        "displayOrder" INTEGER NOT NULL DEFAULT 0,
        "active" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL
      );
    `);

    // Setting table
    await client.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Setting" (
        "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
        "key" TEXT NOT NULL,
        "value" TEXT NOT NULL,
        CONSTRAINT "Setting_key_key" UNIQUE ("key")
      );
    `);

    // Program table
    await client.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Program" (
        "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
        "channelId" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "date" TEXT NOT NULL,
        "startTime" TEXT NOT NULL,
        "endTime" TEXT NOT NULL,
        "description" TEXT,
        "thumbnail" TEXT,
        "status" TEXT NOT NULL DEFAULT 'scheduled',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "Program_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // Create index
    try {
      await client.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "Program_channelId_date_idx" ON "Program"("channelId", "date");
      `);
    } catch {
      // Index might already exist
    }

    // Subscriber table (anonymous) - drop old table if exists and recreate
    await client.$executeRawUnsafe(`DROP TABLE IF EXISTS "Subscriber" CASCADE;`);
    await client.$executeRawUnsafe(`
      CREATE TABLE "Subscriber" (
        "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
        "anonymousId" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "active" BOOLEAN NOT NULL DEFAULT true,
        CONSTRAINT "Subscriber_anonymousId_key" UNIQUE ("anonymousId")
      );
    `);

    // Replay table
    await client.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Replay" (
        "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
        "title" TEXT NOT NULL,
        "description" TEXT,
        "videoUrl" TEXT NOT NULL,
        "thumbnail" TEXT,
        "duration" INTEGER,
        "fileSize" BIGINT,
        "date" TEXT NOT NULL,
        "published" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL
      );
    `);

    console.log("[DB-INIT] Tables created successfully.");

    // Step 3: Seed data
    await seedData(client);

    _initialized = true;
    return true;
  } catch (err) {
    console.error("[DB-INIT] Table creation failed:", err);
    return false;
  }
}

async function runMigrations(client: PrismaClient) {
  // Add profilePhoto column to User table if it doesn't exist
  try {
    await client.$executeRawUnsafe(`
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profilePhoto" TEXT;
    `);
  } catch {
    // Column might already exist
  }

  // Check if Subscriber table has the correct schema
  // If it has 'email' column instead of 'anonymousId', drop and recreate
  try {
    const hasEmailColumn = await client.$queryRaw`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Subscriber' AND column_name = 'email'
      ) as exists
    `;
    
    const result = hasEmailColumn as { exists: boolean }[];
    if (result && result[0] && result[0].exists) {
      console.log("[DB-INIT] Subscriber table has old schema, recreating...");
      await client.$executeRawUnsafe(`DROP TABLE IF EXISTS "Subscriber" CASCADE;`);
    }
  } catch {
    // Table might not exist yet
  }

  // Create Subscriber table if it doesn't exist (new anonymous schema)
  try {
    await client.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Subscriber" (
        "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
        "anonymousId" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "active" BOOLEAN NOT NULL DEFAULT true,
        CONSTRAINT "Subscriber_anonymousId_key" UNIQUE ("anonymousId")
      );
    `);
  } catch {
    // Table might already exist
  }

  // Create Replay table if it doesn't exist
  try {
    await client.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Replay" (
        "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
        "title" TEXT NOT NULL,
        "description" TEXT,
        "videoUrl" TEXT NOT NULL,
        "thumbnail" TEXT,
        "duration" INTEGER,
        "fileSize" BIGINT,
        "date" TEXT NOT NULL,
        "published" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL
      );
    `);
  } catch {
    // Table might already exist
  }
}

async function seedData(client: PrismaClient) {
  console.log("[DB-INIT] Seeding data...");

  // Seed owner account
  const existingOwner = await client.user.findFirst({ where: { role: "owner" } });
  if (!existingOwner) {
    // Use bcryptjs to hash password
    const bcrypt = await import("bcryptjs");
    const passwordHash = await bcrypt.hash("MuhammadFerous40*****", 10);
    await client.user.create({
      data: {
        username: "muhammadferousmsa",
        fullName: "Muhammad Ferous",
        passwordHash,
        role: "owner",
        active: true,
      },
    });
    console.log("[DB-INIT] Owner account created.");
  }

  // Seed channels
  const channels = [
    { name: "TV1", category: "saluran-tv", twitchUsername: "tv1official", displayOrder: 1, description: "Saluran televisyen utama Radio Televisyen Malaysia" },
    { name: "TV2", category: "saluran-tv", twitchUsername: "tv2official", displayOrder: 2, description: "Saluran kedua Radio Televisyen Malaysia" },
    { name: "Okey", category: "saluran-tv", twitchUsername: "okeytv", displayOrder: 3, description: "Saluran hiburan dan maklumat untuk rakyat Malaysia" },
    { name: "Berita", category: "saluran-tv", twitchUsername: "beritartm", displayOrder: 4, description: "Saluran berita 24 jam Radio Televisyen Malaysia" },
    { name: "Sukan+", category: "saluran-tv", twitchUsername: "sukanplus", displayOrder: 5, description: "Saluran sukan dan aktiviti lasak" },
    { name: "Parlimen", category: "saluran-khas", twitchUsername: "parlimenrtm", displayOrder: 1, description: "Siaran langsung sidang Parlimen Malaysia" },
    { name: "RTM World", category: "saluran-khas", twitchUsername: "rtmworld", displayOrder: 2, description: "Saluran antarabangsa Radio Televisyen Malaysia" },
    { name: "Majlis Rasmi", category: "saluran-khas", twitchUsername: "majlisrasmi", displayOrder: 3, description: "Siaran majlis dan acara kerajaan" },
    { name: "Ibadah", category: "saluran-khas", twitchUsername: "ibadahrtm", displayOrder: 4, description: "Saluran program keagamaan dan kerohanian" },
  ];

  for (const ch of channels) {
    const existing = await client.channel.findFirst({ where: { name: ch.name } });
    if (!existing) {
      await client.channel.create({ data: { ...ch, active: true, liveStatus: "automatic" } });
    }
  }
  console.log("[DB-INIT] Channels seeded.");

  // Seed settings
  const settings = [
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

  for (const s of settings) {
    const existing = await client.setting.findUnique({ where: { key: s.key } });
    if (!existing) {
      await client.setting.create({ data: s });
    }
  }
  console.log("[DB-INIT] Settings seeded.");

  // Seed sample programs for today
  const today = new Date().toISOString().split("T")[0];
  const tv1 = await client.channel.findFirst({ where: { name: "TV1" } });
  if (tv1) {
    const count = await client.program.count({ where: { channelId: tv1.id, date: today } });
    if (count === 0) {
      await client.program.createMany({
        data: [
          { channelId: tv1.id, title: "Berita Pagi", date: today, startTime: "06:00", endTime: "07:00", description: "Laporan berita pagi.", status: "finished" },
          { channelId: tv1.id, title: "Selamat Pagi Malaysia", date: today, startTime: "07:00", endTime: "09:00", description: "Program pagi interaktif.", status: "finished" },
          { channelId: tv1.id, title: "Berita Tengah Hari", date: today, startTime: "12:00", endTime: "13:00", description: "Laporan berita tengah hari.", status: "scheduled" },
          { channelId: tv1.id, title: "Buletin Utama", date: today, startTime: "20:00", endTime: "21:00", description: "Buletin berita utama RTM.", status: "scheduled" },
        ],
      });
      console.log("[DB-INIT] Sample programs seeded.");
    }
  }

  console.log("[DB-INIT] Seed complete.");
}
