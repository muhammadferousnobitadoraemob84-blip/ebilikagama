// Production data backup — dumps every major table to timestamped JSON files.
// READ-ONLY on the database: SELECTs only, never writes, never drops.
// Usage:
//   node scripts/backup-production-data.cjs
// Resolves the connection string exactly like the app does (from
// src/lib/prisma.ts). Output: backups/db-backup-<timestamp>/
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

function resolveDbUrl() {
  // Mirror src/lib/prisma.ts: parse the hardcoded URL out of the source so
  // the credential is never typed into a shell or printed.
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "prisma.ts"), "utf8");
  const host = src.match(/CORRECT_DB_HOST = "([^"]+)"/)?.[1];
  const userPass = src.match(/postgresql:\/\/([^@"]+)@/)?.[1];
  if (!host || !userPass) throw new Error("Could not resolve DB host/credentials from prisma.ts");
  return `postgresql://${userPass}@${host}/neondb?sslmode=require&connect_timeout=10`;
}

async function main() {
  const url = resolveDbUrl();
  const prisma = new PrismaClient({
    datasources: { db: { url } },
    log: [{ emit: "stdout", level: "error" }],
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = path.join(__dirname, "..", "backups", `db-backup-${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });

  try {
    // Liveness gate
    await prisma.$queryRaw`SELECT 1`;
    console.log("[BACKUP] Database reachable — starting full read-only dump.");

    const jobs = [
      ["User", () => prisma.user.findMany()],
      ["Channel", () => prisma.channel.findMany()],
      ["Radio", () => prisma.radio.findMany()],
      ["Replay", () => prisma.replay.findMany()],
      ["Program", () => prisma.program.findMany()],
      ["Setting", () => prisma.setting.findMany()],
      ["QuranAudio", () => prisma.quranAudio.findMany()],
      ["Subscriber", () => prisma.subscriber.findMany()],
    ];

    const summary = [];
    for (const [name, fn] of jobs) {
      try {
        const rows = await fn();
        const file = path.join(outDir, `${name}.json`);
        fs.writeFileSync(file, JSON.stringify(rows, null, 2), "utf8");
        summary.push({ table: name, rows: rows.length, file: path.basename(file) });
        console.log(`[BACKUP] ${name}: ${rows.length} rows → ${path.basename(file)}`);
      } catch (e) {
        summary.push({ table: name, error: e.message });
        console.error(`[BACKUP] ${name}: FAILED — ${e.message}`);
      }
    }

    fs.writeFileSync(
      path.join(outDir, "summary.json"),
      JSON.stringify({ stampedAt: new Date().toISOString(), summary }, null, 2),
      "utf8"
    );
    console.log(`[BACKUP] Complete → ${outDir}`);
    const failed = summary.filter((s) => s.error);
    process.exitCode = failed.length === summary.length ? 2 : 0;
  } catch (e) {
    console.error(`[BACKUP] Database unreachable: ${e.message}`);
    console.error("[BACKUP] Nothing dumped. Retry once the provider block lifts.");
    process.exitCode = 2;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

main();
