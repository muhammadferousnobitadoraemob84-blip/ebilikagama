// ─────────────────────────────────────────────────────────────────────────────
// ONE-TIME DATA MIGRATION: Neon PostgreSQL → Firestore
// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY against Neon (SELECTs only — the source database is never
// modified). Idempotent: re-running never duplicates (upsert by legacy ID).
//
// Required environment:
//   DATABASE_URL        — the Neon connection string (source of truth)
//   FIREBASE_SERVICE_ACCOUNT — service-account JSON (inline or base64)
//   FIREBASE_STORAGE_BUCKET  — bucket for oversized image blobs (optional)
//
// Run:  node scripts/migrate-neon-to-firestore.cjs
// ─────────────────────────────────────────────────────────────────────────────
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const admin = require("firebase-admin");

const BLOB_INLINE_LIMIT = 900_000;

function resolveNeonUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  // Fallback: parse from src/lib/prisma.ts history (git show) so the
  // credential never needs to be typed.
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src", "lib", "prisma.ts"),
    "utf8"
  );
  const host = src.match(/CORRECT_DB_HOST = "([^"]+)"/)?.[1];
  const userPass = src.match(/postgresql:\/\/([^@"]+)@/)?.[1];
  if (host && userPass) {
    return `postgresql://${userPass}@${host}/neondb?sslmode=require&connect_timeout=10`;
  }
  throw new Error("DATABASE_URL not set and could not be resolved from source");
}

function initFirebase() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT is required");
  const json =
    raw.trim().startsWith("{")
      ? JSON.parse(raw)
      : JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  const app = admin.apps.length
    ? admin.app()
    : admin.initializeApp({
        credential: admin.credential.cert(json),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || undefined,
      });
  return { db: admin.firestore(app), bucket: process.env.FIREBASE_STORAGE_BUCKET };
}

// Map legacy table → Firestore collection. IDs are preserved verbatim.
const TABLES = [
  { table: "User", collection: "users" },
  { table: "Channel", collection: "channels" },
  { table: "Setting", collection: "settings" },
  { table: "Program", collection: "programs" },
  { table: "Subscriber", collection: "subscribers" },
  { table: "Replay", collection: "replays" },
  { table: "Radio", collection: "radios" },
  { table: "QuranAudio", collection: "quranAudio" },
];

function toFirestoreValue(v) {
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Date) return admin.firestore.Timestamp.fromDate(v);
  return v;
}

function deriveThumbFields(data) {
  if (!("thumbnail" in data)) return;
  const v = data.thumbnail;
  if (typeof v === "string" && v.startsWith("data:")) {
    data.thumbKind = "data";
    data.thumbIsBlob = v.length > BLOB_INLINE_LIMIT;
  } else if (typeof v === "string" && v.length > 0) {
    data.thumbKind = "url";
    data.thumbIsBlob = false;
  } else {
    data.thumbKind = null;
    data.thumbIsBlob = false;
  }
}

async function offloadBlob(bucket, collection, id, value) {
  if (!bucket || !value.startsWith("data:") || value.length <= BLOB_INLINE_LIMIT)
    return value;
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(value);
  if (!m) return value;
  const objectPath = `blobs/${collection}/${id}`;
  await bucket.file(objectPath).save(Buffer.from(m[3], "base64"), {
    contentType: m[1],
    resumable: false,
    metadata: { cacheControl: "public, max-age=604800" },
  });
  return `gcs://${process.env.FIREBASE_STORAGE_BUCKET}/${objectPath}`;
}

async function migrateTable(prisma, db, bucket, { table, collection }) {
  const model = table.charAt(0).toLowerCase() + table.slice(1);
  const rows = await prisma[table.charAt(0).toLowerCase() + table.slice(1)].findMany();
  console.log(`[${table}] source rows: ${rows.length}`);

  let written = 0;
  for (const row of rows) {
    const data = {};
    for (const [k, v] of Object.entries(row)) data[k] = toFirestoreValue(v);
    delete data.id; // used as the document ID instead

    // Offload oversized image blobs to Storage (sentinel in the doc).
    for (const f of ["thumbnail", "profilePhoto"]) {
      if (typeof data[f] === "string") {
        data[f] = await offloadBlob(bucket, collection, row.id, data[f]);
      }
    }
    deriveThumbFields(data);

    await db.collection(collection).doc(row.id).set(data, { merge: true });
    written++;
  }
  return { source: rows.length, written };
}

async function main() {
  const prisma = new PrismaClient({
    datasources: { db: { url: resolveNeonUrl() } },
    log: [{ emit: "stdout", level: "error" }],
  });
  const { db, bucket } = initFirebase();
  console.log("=== Neon → Firestore migration starting ===");

  const results = {};
  for (const spec of TABLES) {
    try {
      results[spec.table] = await migrateTable(prisma, db, bucket, spec);
      console.log(
        `[${spec.table}] → ${spec.collection}: wrote ${results[spec.table].written}`
      );
    } catch (e) {
      console.error(`[${spec.table}] MIGRATION FAILED: ${e.message}`);
      results[spec.table] = { error: e.message };
    }
  }

  // Verification: source counts vs Firestore counts
  console.log("\n=== VERIFICATION (old vs new) ===");
  let allMatch = true;
  for (const spec of TABLES) {
    let fsCount = 0;
    try {
      const snap = await db.collection(spec.collection).count().get();
      fsCount = snap.data().count;
    } catch {}
    const src = results[spec.table]?.source ?? "?";
    const match = src === fsCount;
    if (!match) allMatch = false;
    console.log(
      `${spec.table.padEnd(12)} old: ${String(src).padEnd(6)} new: ${String(fsCount).padEnd(6)} ${match ? "✓" : "✗ MISMATCH"}`
    );
  }
  console.log(allMatch ? "\nALL COUNTS MATCH ✓" : "\nCOUNT MISMATCHES — investigate before cutover");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("MIGRATION FATAL:", e);
  process.exit(1);
});
