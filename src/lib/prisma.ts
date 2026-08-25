import { PrismaClient } from "@prisma/client";

// Force correct DATABASE_URL if Neon integration is overriding it
// The Neon integration on Vercel keeps pointing to the old (dead) database.
// This ensures our new database is always used.
const CORRECT_DB_HOST = "ep-nameless-flower-azdw4gyi-pooler.c-3.ap-southeast-1.aws.neon.tech";
const CORRECT_DB_URL = `postgresql://neondb_owner:npg_skDMx4A5GQzV@${CORRECT_DB_HOST}/neondb?sslmode=require`;

if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes(CORRECT_DB_HOST)) {
  console.log("[PRISMA] Overriding DATABASE_URL from Neon integration to correct database.");
  process.env.DATABASE_URL = CORRECT_DB_URL;
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Cache PrismaClient across serverless warm invocations (production)
// Without this, every request creates a new connection, causing pool exhaustion
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    errorFormat: "minimal",
  });

globalForPrisma.prisma = prisma;
