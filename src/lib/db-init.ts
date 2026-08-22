import { prisma } from "./prisma";

let _initialized = false;

/**
 * Ensures the database is ready by checking if tables exist.
 * If tables don't exist (first deploy), attempts auto-initialization.
 *
 * On Vercel, if auto-init via child_process fails (common in serverless),
 * returns false so the caller can show a helpful setup message.
 */
export async function ensureDatabase(): Promise<boolean> {
  if (_initialized) return true;

  // Step 1: Check if tables already exist
  try {
    await prisma.user.findFirst();
    _initialized = true;
    return true;
  } catch {
    // Tables don't exist — attempt auto-initialization
  }

  // Step 2: Try auto-init via child_process (works in some environments)
  try {
    console.log("[DB-INIT] Tables not found. Attempting auto-initialization...");
    const { execSync } = await import("child_process");

    execSync("npx prisma db push --skip-generate --accept-data-loss", {
      timeout: 60000,
      stdio: "pipe",
      cwd: process.cwd(),
    });
    console.log("[DB-INIT] Schema pushed to database.");

    execSync("npx tsx prisma/seed.ts", {
      timeout: 60000,
      stdio: "pipe",
      cwd: process.cwd(),
    });
    console.log("[DB-INIT] Seed completed.");

    _initialized = true;
    return true;
  } catch (err) {
    console.error("[DB-INIT] Auto-initialization failed:", err);
    // Return false — caller should show setup instructions
    return false;
  }
}
