import { prisma } from "./prisma";

let _initialized = false;

/**
 * Ensures the database is ready by checking if tables exist.
 * If tables don't exist (first deploy), automatically runs
 * prisma db push + seed to initialize everything.
 *
 * Safe to call from any API route — only runs setup once.
 */
export async function ensureDatabase(): Promise<boolean> {
  if (_initialized) return true;

  try {
    await prisma.user.findFirst();
    _initialized = true;
    return true;
  } catch {
    // Tables don't exist — attempt auto-initialization
    try {
      console.log("[DB-INIT] Tables not found. Running prisma db push...");
      const { execSync } = await import("child_process");

      execSync("npx prisma db push --skip-generate --accept-data-loss", {
        timeout: 60000,
        stdio: "pipe",
      });
      console.log("[DB-INIT] Schema pushed to database.");

      console.log("[DB-INIT] Running seed...");
      execSync("npx tsx prisma/seed.ts", {
        timeout: 60000,
        stdio: "pipe",
      });
      console.log("[DB-INIT] Seed completed.");

      _initialized = true;
      return true;
    } catch (err) {
      console.error("[DB-INIT] Auto-initialization failed:", err);
      return false;
    }
  }
}
