// Virtual Radio prototype test fixture manager.
// Creates TWO disclosed temporary accounts for testing (deleted after):
//   vrtest_admin (role admin) and vrtest_user (role user)
// Same stack as the app: prisma + bcryptjs. Never prints passwords/hashes.
// Usage: node vr-test-fixture.cjs up|down
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

function resolveDbUrl() {
  // Resolve the DB exactly like the app: .env DATABASE_URL, overridden by the
  // hardcoded CORRECT_DB_URL in src/lib/prisma.ts when it points elsewhere.
  // (The .env value here is a stale file: placeholder — the real URL lives in
  // prisma.ts, so we extract it from there instead of duplicating secrets.)
  let url = process.env.DATABASE_URL;
  const envPath = path.join(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, "utf8");
    for (const line of env.split("\n")) {
      const m = line.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?\s*$/);
      if (m) { url = m[1].trim(); break; }
    }
  }

  // Extract the app's own override constants from src/lib/prisma.ts.
  const prismaPath = path.join(__dirname, "..", "src", "lib", "prisma.ts");
  if (fs.existsSync(prismaPath)) {
    const src = fs.readFileSync(prismaPath, "utf8");
    const hostMatch = src.match(/const CORRECT_DB_HOST = "([^"]+)"/);
    const urlMatch = src.match(/const CORRECT_DB_URL = `([^`]+)`/);
    if (hostMatch && urlMatch && (!url || !url.includes(hostMatch[1]))) {
      url = urlMatch[1].replace(/\$\{CORRECT_DB_HOST\}/g, hostMatch[1]);
    }
  }

  if (!url || !url.startsWith("postgres")) {
    throw new Error("Could not resolve a postgres DATABASE_URL (mirroring app logic)");
  }
  return url;
}

const prisma = new PrismaClient({ datasources: { db: { url: resolveDbUrl() } } });
const PASSWORD = "VrTest-" + Math.random().toString(36).slice(2, 10) + "!a";

async function up() {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const credsPath = path.join(require("os").tmpdir(), "vr-test-creds.json");
  for (const [username, role] of [["vrtest_admin", "admin"], ["vrtest_user", "user"]]) {
    await prisma.user.upsert({
      where: { username },
      update: { passwordHash: hash, role, active: true, tokenVersion: { increment: 1 } },
      create: { username, passwordHash: hash, role, active: true, fullName: "VR Test Fixture" },
    });
  }
  fs.writeFileSync(credsPath, JSON.stringify({ username: "vrtest_admin", user: "vrtest_user", password: PASSWORD }));
  console.log("fixtures ready (credentials in", credsPath + ")");
  const count = await prisma.user.count();
  console.log("user count:", count);
}

async function down() {
  for (const username of ["vrtest_admin", "vrtest_user"]) {
    try { await prisma.user.delete({ where: { username } }); } catch {}
  }
  const credsPath = path.join(require("os").tmpdir(), "vr-test-creds.json");
  if (fs.existsSync(credsPath)) fs.unlinkSync(credsPath);
  console.log("fixtures removed; user count:", await prisma.user.count());
}

(async () => {
  try {
    if (process.argv[2] === "up") await up();
    else if (process.argv[2] === "down") await down();
    else console.log("usage: up|down");
  } catch (err) {
    console.error("fixture error:", err.message || err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
