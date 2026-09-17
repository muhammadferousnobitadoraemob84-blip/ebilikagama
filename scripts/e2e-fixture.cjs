// Dedicated E2E fixture for authentication flow testing.
// Manages ONLY the "logouttest99" test account — never reads, modifies, or
// creates any other user record. Usage:
//   node scripts/e2e-fixture.cjs up     → create/refresh the test user
//   node scripts/e2e-fixture.cjs down   → delete the test user (restores DB)
//   node scripts/e2e-fixture.cjs count  → print user count
const path = require("path");
process.env.NODE_ENV = process.env.NODE_ENV || "development";

// Load .env exactly like the app does (no dotenv dependency needed here).
const fs = require("fs");
for (const envFile of [".env", ".env.local"]) {
  const p = path.join(__dirname, "..", envFile);
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  }
}

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

// Resolve the database URL exactly like src/lib/prisma.ts does: when the
// env value points at a different host, the app forces its known-good URL.
// We reuse that module's constants (via regex) rather than duplicating any
// connection data in this script.
const prismaSrc = fs.readFileSync(
  path.join(__dirname, "..", "src", "lib", "prisma.ts"),
  "utf8"
);
const hostMatch = prismaSrc.match(/const CORRECT_DB_HOST = "([^"]+)"/);
const urlMatch = prismaSrc.match(/const CORRECT_DB_URL = `([^`]+)`/);
if (hostMatch && urlMatch && process.env.DATABASE_URL && !process.env.DATABASE_URL.includes(hostMatch[1])) {
  process.env.DATABASE_URL = urlMatch[1].replace("${CORRECT_DB_HOST}", hostMatch[1]);
}

const prisma = new PrismaClient();

const FIXTURE_USERNAME = "logouttest99";

async function main() {
  const action = process.argv[2];
  if (action === "count") {
    console.log("user count:", await prisma.user.count());
    return;
  }
  if (action === "up") {
    const passwordHash = await bcrypt.hash("LogoutFix99!x", 10);
    await prisma.user.upsert({
      where: { username: FIXTURE_USERNAME },
      update: { passwordHash, active: true, role: "user", tokenVersion: { increment: 1 } },
      create: {
        username: FIXTURE_USERNAME,
        fullName: "E2E Logout Fixture",
        passwordHash,
        role: "user",
        active: true,
      },
    });
    console.log("fixture ready — user count:", await prisma.user.count());
    return;
  }
  if (action === "down") {
    await prisma.user.deleteMany({ where: { username: FIXTURE_USERNAME } });
    console.log("fixture removed — user count:", await prisma.user.count());
    return;
  }
  console.error("usage: node scripts/e2e-fixture.cjs up|down|count");
  process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("fixture error:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
