// Dedicated multi-user E2E fixture for authentication lifecycle testing.
// Manages ONLY three explicitly-named test accounts (multitest_a/b/c).
// Never reads, modifies, or creates any other user record.
//   node scripts/e2e-fixture-multi.cjs up     → create/refresh A, B, C
//   node scripts/e2e-fixture-multi.cjs down   → delete A, B, C (restores DB)
//   node scripts/e2e-fixture-multi.cjs count  → print user count
const path = require("path");
const fs = require("fs");
process.env.NODE_ENV = process.env.NODE_ENV || "development";

// Load .env exactly like the app does.
for (const envFile of [".env", ".env.local"]) {
  const p = path.join(__dirname, "..", envFile);
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^[\"']|[\"']$/g, "");
      }
    }
  }
}

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

// Resolve DATABASE_URL exactly like src/lib/prisma.ts (forced-host override).
const prismaSrc = fs.readFileSync(
  path.join(__dirname, "..", "src", "lib", "prisma.ts"),
  "utf8"
);
const hostMatch = prismaSrc.match(/const CORRECT_DB_HOST = "([^"]+)"/);
const urlMatch = prismaSrc.match(/const CORRECT_DB_URL = `([^`]+)`/);
if (
  hostMatch &&
  urlMatch &&
  process.env.DATABASE_URL &&
  !process.env.DATABASE_URL.includes(hostMatch[1])
) {
  process.env.DATABASE_URL = urlMatch[1].replace(
    "${CORRECT_DB_HOST}",
    hostMatch[1]
  );
}

const prisma = new PrismaClient();

const ACCOUNTS = [
  { username: "multitest_a", fullName: "Multi-Test User A", role: "user", password: "MultiA-Temp99!" },
  { username: "multitest_b", fullName: "Multi-Test User B", role: "user", password: "MultiB-Temp88!" },
  { username: "multitest_c", fullName: "Multi-Test User C", role: "user", password: "MultiC-Temp77!" },
];

(async () => {
  const action = process.argv[2] || "up";

  if (action === "count") {
    console.log("user count:", await prisma.user.count());
    return;
  }

  if (action === "down") {
    for (const { username } of ACCOUNTS) {
      await prisma.user.deleteMany({ where: { username } });
    }
    console.log("fixtures removed — user count:", await prisma.user.count());
    return;
  }

  if (action === "up") {
    for (const acct of ACCOUNTS) {
      const passwordHash = await bcrypt.hash(acct.password, 10);
      await prisma.user.upsert({
        where: { username: acct.username },
        update: { passwordHash, active: true, role: acct.role },
        create: {
          username: acct.username,
          fullName: acct.fullName,
          passwordHash,
          role: acct.role,
          active: true,
        },
      });
    }
    console.log("fixtures ready — user count:", await prisma.user.count());
    return;
  }

  console.log("unknown action");
  process.exitCode = 1;
})()
  .catch((e) => {
    console.error("FIXTURE FAILED:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
