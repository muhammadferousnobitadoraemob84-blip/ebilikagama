// READ-ONLY authentication audit over the real user table.
// - Never prints passwords or hash contents (only hash *format* metadata).
// - SELECT queries only; zero writes; zero schema changes.
// Run: node scripts/auth-audit.cjs
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

function hashFormat(hash) {
  if (!hash || typeof hash !== "string") return "MISSING";
  if (/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash)) return "bcrypt-valid";
  if (/^\$2[aby]\$/.test(hash)) return "bcrypt-malformed";
  if (hash.startsWith("$argon2")) return "argon2";
  if (/^[0-9a-f]{32}$/i.test(hash)) return "md5-like";
  if (/^[0-9a-f]{64}$/i.test(hash)) return "sha256-like";
  return "unknown-format";
}

(async () => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      role: true,
      active: true,
      passwordHash: true,
      tokenVersion: true,
      createdAt: true,
      lastLogin: true,
    },
  });

  const report = {
    total: users.length,
    hashFormats: {},
    problems: [],
  };

  const seenLower = new Map();
  for (const u of users) {
    const fmt = hashFormat(u.passwordHash);
    report.hashFormats[fmt] = (report.hashFormats[fmt] || 0) + 1;

    const issues = [];
    if (fmt === "MISSING") issues.push("no passwordHash");
    else if (fmt !== "bcrypt-valid") issues.push(`incompatible hash format: ${fmt}`);
    if (u.username !== u.username.trim() || u.username !== u.username.toLowerCase())
      issues.push("username not normalized (case/whitespace)");
    if (!u.active) issues.push("disabled");
    if (typeof u.tokenVersion !== "number") issues.push("missing tokenVersion");

    const key = u.username.toLowerCase();
    if (seenLower.has(key)) issues.push(`duplicate-of-id:${seenLower.get(key)}`);
    else seenLower.set(key, u.id);

    if (issues.length) {
      report.problems.push({
        id: u.id,
        username: u.username, // username is not a secret
        role: u.role,
        issues,
      });
    }
  }

  // Login-lookup reachability: exact match after the login API's normalization.
  const logins = await prisma.user.count({
    where: { active: true },
  });
  report.activeUsers = logins;

  console.log("════ AUTH AUDIT (read-only) ════");
  console.log(JSON.stringify(report, null, 2));
})()
  .catch((e) => {
    console.error("AUDIT FAILED:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
