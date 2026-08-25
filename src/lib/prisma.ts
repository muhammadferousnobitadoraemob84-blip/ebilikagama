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
    // Connection pool settings for Neon serverless
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });

globalForPrisma.prisma = prisma;

/**
 * Execute a database query with automatic retry logic.
 * Handles Neon free-tier cold starts (first connection after sleep takes 2-5s).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delayMs = 1500
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < maxRetries) {
        // Exponential backoff: 1.5s, 3s, 4.5s
        const waitTime = delayMs * attempt;
        console.log(`[RETRY] Attempt ${attempt}/${maxRetries} failed, retrying in ${waitTime}ms...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  }
  
  throw lastError;
}
