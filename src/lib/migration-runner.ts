// Server-side Neon → Firestore migration runner.
// Invoked by the admin-only endpoint /api/admin/migrate (POST) once Neon is
// reachable. Read-only against Neon; idempotent into Firestore (merge-set by
// legacy ID). Preserves original IDs and offloads oversized blobs to Storage.
import { getDb } from "@/lib/prisma";

const BLOB_INLINE_LIMIT = 900_000;

type NeonModel =
  | "user"
  | "channel"
  | "setting"
  | "program"
  | "subscriber"
  | "replay"
  | "radio"
  | "quranAudio";

const TABLES: Array<{ model: NeonModel; collection: string }> = [
  { model: "user", collection: "users" },
  { model: "channel", collection: "channels" },
  { model: "setting", collection: "settings" },
  { model: "program", collection: "programs" },
  { model: "subscriber", collection: "subscribers" },
  { model: "replay", collection: "replays" },
  { model: "radio", collection: "radios" },
  { model: "quranAudio", collection: "quranAudio" },
];

interface TableResult {
  source: number;
  written: number;
}

function toFirestoreValue(v: unknown): unknown {
  if (typeof v === "bigint") return Number(v);
  return v;
}

function deriveThumbFields(collection: string, data: Record<string, unknown>) {
  if (collection === "settings") {
    if ("value" in data) {
      const v = data.value;
      if (typeof v === "string" && v.startsWith("data:")) {
        data.valueKind = "data";
        data.valueIsBlob = v.length > BLOB_INLINE_LIMIT;
      } else if (typeof v === "string" && v.length > 0) {
        data.valueKind = "url";
        data.valueIsBlob = false;
      } else {
        data.valueKind = null;
        data.valueIsBlob = false;
      }
    }
    return;
  }
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

async function offloadBlob(
  collection: string,
  id: string,
  value: string
): Promise<string> {
  if (!value.startsWith("data:") || value.length <= BLOB_INLINE_LIMIT) return value;
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
  if (!bucketName) return value;
  try {
    const { getStorage } = await import("firebase-admin/storage");
    const { getApp } = await import("firebase-admin/app");
    const m = /^data:([^;,]+);base64,([\s\S]*)$/.exec(value);
    if (!m) return value;
    const path = `blobs/${collection}/${id}`;
    await getStorage(getApp())
      .bucket(bucketName)
      .file(path)
      .save(Buffer.from(m[2], "base64"), {
        contentType: m[1],
        resumable: false,
        metadata: { cacheControl: "public, max-age=604800" },
      });
    return `gcs://${bucketName}/${path}`;
  } catch {
    return value; // degrade: keep inline rather than lose the image
  }
}

export async function runMigration(): Promise<{
  tables: Record<string, TableResult>;
  verification: Array<{ table: string; old: number; new: number; match: boolean }>;
  allMatch: boolean;
}> {
  const db = getDb();
  const tables: Record<string, TableResult> = {};

  for (const spec of TABLES) {
    // Neon read — the Firestore adapter's findMany runs against Firestore,
    // NOT Neon, so the source read must go through a dedicated Neon client.
    const source = await readFromNeon(spec.model);
    let written = 0;
    for (const row of source as Array<Record<string, unknown>>) {
      const id = String(row.id);
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        if (k === "id") continue;
        data[k] = toFirestoreValue(v);
      }
      for (const f of ["thumbnail", "profilePhoto", "value"]) {
        if (typeof data[f] === "string") {
          data[f] = await offloadBlob(spec.collection, id, data[f] as string);
        }
      }
      deriveThumbFields(spec.collection, data);
      await db.collection(spec.collection).doc(id).set(data, { merge: true });
      written++;
    }
    tables[spec.collection] = { source: source.length, written };
  }

  // Verification: old (Neon) vs new (Firestore) counts per collection.
  const verification: Array<{ table: string; old: number; new: number; match: boolean }> = [];
  let allMatch = true;
  for (const spec of TABLES) {
    const srcCount = (await countNeon(spec.model)) as number;
    const fsSnap = await db.collection(spec.collection).count().get();
    const fsCount = fsSnap.data().count;
    const match = srcCount === fsCount;
    if (!match) allMatch = false;
    verification.push({
      table: spec.collection,
      old: srcCount,
      new: fsCount,
      match,
    });
  }
  return { tables, verification, allMatch };
}

// ── Dedicated Neon access (bypasses the Firestore adapter) ──────────────────

interface NeonLike {
  findMany: () => Promise<unknown[]>;
  count: () => Promise<number>;
}

async function neonClient(): Promise<typeof import("@prisma/client") | null> {
  try {
    return await import("@prisma/client");
  } catch {
    return null;
  }
}

async function readFromNeon(model: NeonModel): Promise<unknown[]> {
  const mod = await neonClient();
  if (!mod) throw new Error("@prisma/client is not available in this build");
  // The generated client connects via DATABASE_URL at runtime.
  const url = resolveNeonUrl();
  const client = new mod.PrismaClient({
    datasources: { db: { url } },
  });
  try {
    const delegate = (client as unknown as Record<string, NeonLike>)[String(model)];
    return await delegate.findMany();
  } finally {
    await client.$disconnect();
  }
}

async function countNeon(model: NeonModel): Promise<number> {
  const mod = await neonClient();
  if (!mod) throw new Error("@prisma/client is not available in this build");
  const url = resolveNeonUrl();
  const client = new mod.PrismaClient({
    datasources: { db: { url } },
  });
  try {
    const delegate = (client as unknown as Record<string, NeonLike>)[String(model)];
    return await delegate.count();
  } finally {
    await client.$disconnect();
  }
}

function resolveNeonUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  throw new Error(
    "DATABASE_URL is not configured in this environment; cannot read Neon."
  );
}

