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
/**
 * Errors that can never succeed on retry — rethrow immediately instead of
 * burning backoff time and hammering the database. Neon returns code 53000
 * when the project's monthly data-transfer quota is exhausted, and P1001/P2024
 * cover unreachable/suspended compute.
 */
export function isNonRetryableDbError(error: unknown): boolean {
  const msg =
    error instanceof Error
      ? `${error.message} ${String((error as { code?: string }).code ?? "")}`
      : String(error);
  return (
    msg.includes("data transfer quota") ||
    msg.includes("exceeded the data transfer") ||
    msg.includes("53000") ||
    msg.includes("P1001") ||
    msg.includes("P2024") ||
    msg.includes("quota")
  );
}

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
      
      // Permanent failures (quota exhaustion, unreachable DB) will not get
      // better by retrying — surface them at once.
      if (isNonRetryableDbError(lastError)) {
        throw lastError;
      }
      
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
