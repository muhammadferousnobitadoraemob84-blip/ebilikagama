// ─────────────────────────────────────────────────────────────────────────────
// eBilikAgamaTV data layer — FIRESTORE BACKEND
// ─────────────────────────────────────────────────────────────────────────────
// This module preserves the Prisma-client call shape (prisma.<model>.<op>())
// so the application's API routes keep working unchanged, but every operation
// is executed against Google Cloud Firestore via the Firebase Admin SDK.
//
// Design decisions:
//  • Collections: users, channels, settings, programs, subscribers, replays,
//    radios, quranAudio. Document IDs = legacy record IDs (stable references).
//  • The browser never talks to Firestore — server (Admin SDK) only.
//    firestore.rules deny ALL direct client access.
//  • Image blobs (base64 data URIs) larger than BLOB_INLINE_LIMIT are moved
//    to Firebase Storage (sentinel gcs://<bucket>/<path>) so list endpoints
//    never transfer megabytes — the egress pattern that exhausted the
//    previous provider's quota. gcs:// sentinels are NEVER returned to
//    callers; readers see null and the API layer rewrites to /api/images/....
//  • Self-display-URL guard: writing a record's own /api/images/<type>/<id>
//    URL back into its image field is a no-op (an admin form echoing the
//    list value can never corrupt the stored image).
//  • Write-time derived fields thumbKind/thumbIsBlob power cheap thumbnail
//    classification (see lib/thumb-meta.ts) without reading blob bytes.
// ─────────────────────────────────────────────────────────────────────────────
import { App, cert, getApps, initializeApp } from "firebase-admin/app";
import {
  FieldValue,
  Firestore,
  getFirestore,
  Timestamp,
} from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import crypto from "crypto";

// ── Firebase initialization (lazy, cached across warm invocations) ──────────

export class FirebaseNotConfiguredError extends Error {
  constructor() {
    super(
      "Firebase is not configured: FIREBASE_SERVICE_ACCOUNT (or GOOGLE_APPLICATION_CREDENTIALS) is unavailable. Data operations are unavailable."
    );
    this.name = "FirebaseNotConfiguredError";
  }
}

interface GlobalExt {
  __ebatFirebaseApp?: App;
  __ebatFirestore?: Firestore;
}
const g = globalThis as unknown as GlobalExt;

function getApp(): App {
  if (g.__ebatFirebaseApp) return g.__ebatFirebaseApp;
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  const bucket = process.env.FIREBASE_STORAGE_BUCKET || undefined;
  let app: App;
  if (rawJson) {
    const json =
      rawJson.trim().startsWith("{")
        ? rawJson
        : Buffer.from(rawJson, "base64").toString("utf8");
    app = initializeApp({ credential: cert(JSON.parse(json)), storageBucket: bucket });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    // Application Default Credentials (e.g. GOOGLE_APPLICATION_CREDENTIALS
    // path or platform-provided identity).
    app = initializeApp({ storageBucket: bucket });
  } else {
    throw new FirebaseNotConfiguredError();
  }
  g.__ebatFirebaseApp = app;
  return app;
}

export function getDb(): Firestore {
  if (g.__ebatFirestore) return g.__ebatFirestore;
  const db = getFirestore(getApp());
  g.__ebatFirestore = db;
  return db;
}

// ── Error classification (kept for existing callers) ─────────────────────────

export function isNonRetryableDbError(error: unknown): boolean {
  const msg =
    error instanceof Error
      ? `${error.message} ${String((error as { code?: string }).code ?? "")}`
      : String(error);
  return (
    error instanceof FirebaseNotConfiguredError ||
    msg.includes("Firebase is not configured") ||
    msg.includes("FIREBASE_SERVICE_ACCOUNT") ||
    /credential|unauthenticated|permission.denied/i.test(msg)
  );
}

/** Light retry for transient Firestore errors. */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (isNonRetryableDbError(error)) throw error;
      const msg = error instanceof Error ? error.message : String(error);
      if (!/unavailable|deadline|internal|ECONNRESET|ETIMEDOUT/i.test(msg)) throw error;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  throw lastError;
}

// ── Blob handling ────────────────────────────────────────────────────────────

const BLOB_INLINE_LIMIT = 900_000; // bytes of data-URI kept inline in a doc
const IMAGE_FIELDS: Record<string, string[]> = {
  users: ["profilePhoto"],
  channels: ["thumbnail"],
  radios: ["thumbnail"],
  programs: ["thumbnail"],
  replays: ["thumbnail"],
  quranAudio: [],
  settings: [],
  subscribers: [],
};

const MODEL_TO_URL_TYPE: Record<string, string> = {
  users: "user",
  channels: "channel",
  radios: "radio",
  programs: "program",
  replays: "replay",
  settings: "setting",
};

function parseDataUri(
  value: string
): { contentType: string; buffer: Buffer } | null {
  const m = /^data:([^;,]+)(;base64)?,([\s\S]*)$/.exec(value);
  if (!m) return null;
  try {
    const buffer = m[2]
      ? Buffer.from(m[3], "base64")
      : Buffer.from(decodeURIComponent(m[3]), "utf8");
    return { contentType: m[1] || "application/octet-stream", buffer };
  } catch {
    return null;
  }
}

async function offloadLargeBlob(
  collection: string,
  id: string,
  value: string
): Promise<string> {
  if (!value.startsWith("data:") || value.length <= BLOB_INLINE_LIMIT) return value;
  const parsed = parseDataUri(value);
  if (!parsed) return value;
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
  if (!bucketName) return value; // degrade: keep inline when Storage is unconfigured
  try {
    const bucket = getStorage(getApp()).bucket(bucketName);
    const objectPath = `blobs/${collection}/${id}`;
    await bucket.file(objectPath).save(parsed.buffer, {
      contentType: parsed.contentType,
      resumable: false,
      metadata: { cacheControl: "public, max-age=604800" },
    });
    return `gcs://${bucketName}/${objectPath}`;
  } catch {
    return value; // degrade: keep inline rather than lose the image
  }
}

/** gcs:// sentinels never leave the server; readers see null. */
function sanitizeOutgoing(collection: string, data: Record<string, unknown>) {
  for (const f of IMAGE_FIELDS[collection] ?? []) {
    if (typeof data[f] === "string" && (data[f] as string).startsWith("gcs://")) {
      data[f] = null;
    }
  }
}

/** Compute write-time derived classification fields. */
function deriveThumbFields(collection: string, data: Record<string, unknown>) {
  if (collection === "settings") {
    // Settings store images in `value` (e.g. site_logo base64 or a URL).
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

/** Echoing a record's own display URL into its image field is a no-op. */
function stripSelfDisplayUrls(
  collection: string,
  id: string,
  data: Record<string, unknown>
) {
  const type = MODEL_TO_URL_TYPE[collection];
  if (!type) return;
  for (const f of IMAGE_FIELDS[collection] ?? []) {
    if (data[f] === `/api/images/${type}/${id}`) delete data[f];
  }
}

// ── Mini-cuid (uniqueness only; migrated IDs remain stable) ──────────────────

let cuidCounter = 0;
function cuid(): string {
  const time = Date.now().toString(36);
  const rand = crypto.randomBytes(8).toString("hex");
  const seq = (cuidCounter++ % 36).toString(36);
  return `c${time}${seq}${rand}`.slice(0, 25);
}

// ── Model types (mirror of the legacy schema) ────────────────────────────────

export interface User {
  id: string;
  username: string;
  fullName: string | null;
  passwordHash: string;
  profilePhoto: string | null;
  role: string;
  active: boolean;
  tokenVersion: number;
  lastLogin: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface Channel {
  id: string;
  name: string;
  category: string;
  twitchUsername: string;
  thumbnail: string | null;
  description: string | null;
  liveStatus: string;
  displayOrder: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}
export interface Setting {
  id: string;
  key: string;
  value: string;
  updatedAt: Date;
}
export interface Program {
  id: string;
  channelId: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  description: string | null;
  thumbnail: string | null;
  status: string;
  youtubeBroadcastId: string | null;
  youtubeUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface Subscriber {
  id: string;
  anonymousId: string;
  createdAt: Date;
  active: boolean;
}
export interface Replay {
  id: string;
  title: string;
  description: string | null;
  videoUrl: string | null;
  googleDriveId: string | null;
  googleDriveUrl: string | null;
  thumbnail: string | null;
  duration: number | null;
  fileSize: number | null;
  date: string;
  published: boolean;
  createdAt: Date;
  updatedAt: Date;
}
export interface Radio {
  id: string;
  name: string;
  description: string | null;
  thumbnail: string | null;
  twitchUsername: string | null;
  category: string;
  enabled: boolean;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}
export interface QuranAudio {
  id: string;
  surahName: string;
  surahNumber: number;
  ayahNumber: number;
  audioType: string;
  reciterName: string;
  fileName: string;
  fileSize: number | null;
  duration: number | null;
  googleDriveId: string;
  googleDriveUrl: string | null;
  status: string;
  uploadedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── Query translation ────────────────────────────────────────────────────────

type Where = Record<string, unknown>;
type OrderBySpec = Record<string, "asc" | "desc" | undefined>;
type OrderBy = OrderBySpec | OrderBySpec[];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function ciSafe(v: unknown, ci: boolean): unknown {
  return ci && typeof v === "string" ? v.toLowerCase() : v;
}

type Row = Record<string, unknown> & { id: string };

interface CompiledWhere {
  query: FirebaseFirestore.Query;
  postFilter?: (rows: Row[]) => Row[];
}

function applyWhere(q: FirebaseFirestore.Query, where: Where): CompiledWhere {
  let query = q;
  const inMemory: Array<(rows: Row[]) => Row[]> = [];
  const orBranches = where.OR as Where[] | undefined;

  for (const [field, condRaw] of Object.entries(where)) {
    if (field === "OR" || field === "NOT") continue;
    if (isPlainObject(condRaw)) {
      const cond = condRaw;
      if ("equals" in cond) {
        if (cond.mode === "insensitive") {
          // Firestore == is case-sensitive; match in memory instead.
          const target = String(cond.equals).toLowerCase();
          inMemory.push((rows: Row[]) =>
            rows.filter((r) => String(r[field] ?? "").toLowerCase() === target)
          );
        } else {
          query = query.where(field, "==", cond.equals);
        }
      } else if ("in" in cond) {
        query = query.where(field, "in", cond.in);
      } else if ("not" in cond) {
        const notVal = cond.not;
        if (notVal === null) {
          query = query.where(field, "!=", null);
        } else {
          inMemory.push((rows: Row[]) => rows.filter((r) => r[field] !== notVal));
        }
      } else if ("contains" in cond) {
        const ci = cond.mode === "insensitive";
        const needle = ciSafe(cond.contains, ci) as string;
        inMemory.push((rows: Row[]) =>
          rows.filter((r) =>
            String(ciSafe(r[field], ci) ?? "").includes(String(needle))
          )
        );
      } else if ("gte" in cond || "gt" in cond || "lte" in cond || "lt" in cond) {
        if ("gte" in cond) query = query.where(field, ">=", cond.gte);
        if ("gt" in cond) query = query.where(field, ">", cond.gt);
        if ("lte" in cond) query = query.where(field, "<=", cond.lte);
        if ("lt" in cond) query = query.where(field, "<", cond.lt);
      }
    } else {
      query = query.where(field, "==", condRaw);
    }
  }

  if (orBranches && orBranches.length > 0) {
    const matchers = orBranches.map((branch) => {
      const entries = Object.entries(branch);
      return (row: Record<string, unknown>) =>
        entries.every(([f, c]) => {
          if (isPlainObject(c)) {
            const cond = c;
            const ci = cond.mode === "insensitive";
            const target = ciSafe(row[f], ci);
            if ("contains" in cond) {
              return String(target ?? "").includes(
                String(ciSafe(cond.contains, ci))
              );
            }
            return target === cond.equals;
          }
          return row[f] === c;
        });
    });
    inMemory.push((rows: Row[]) => rows.filter((r) => matchers.some((m) => m(r))));
  }

  return {
    query,
    postFilter: inMemory.length
      ? (rows: Row[]) => inMemory.reduce((acc, fn) => fn(acc), rows)
      : undefined,
  };
}

function applyOrderBy(
  query: FirebaseFirestore.Query,
  orderBy: OrderBy | undefined
): FirebaseFirestore.Query {
  if (!orderBy) return query;
  const list = Array.isArray(orderBy) ? orderBy : [orderBy];
  for (const o of list) {
    for (const [field, dir] of Object.entries(o)) {
      if (dir === "asc" || dir === "desc") query = query.orderBy(field, dir);
    }
  }
  return query;
}

function sortInMemory(
  rows: Row[],
  orderBy: OrderBy | undefined
): Row[] {
  if (!orderBy) return rows;
  const list = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...rows].sort((a, b) => {
    for (const o of list) {
      for (const [field, dir] of Object.entries(o)) {
        if (dir !== "asc" && dir !== "desc") continue;
        const av = a[field] ?? "";
        const bv = b[field] ?? "";
        const cmp = av === bv ? 0 : av > bv ? 1 : -1;
        if (cmp !== 0) return dir === "desc" ? -cmp : cmp;
      }
    }
    return 0;
  });
}

function fixDates<T>(data: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...data };
  for (const [k, v] of Object.entries(out)) {
    if (v instanceof Timestamp) out[k] = v.toDate();
    else if (typeof v === "bigint") out[k] = Number(v);
  }
  return out as T;
}

// ── Typed model API ──────────────────────────────────────────────────────────

type Doc = Record<string, unknown>;

interface ModelOptions {
  where?: Where;
  orderBy?: OrderBy;
  select?: Doc;
  /** Prisma-style relation include. Only program→channel is used in the app. */
  include?: Doc;
  data?: Doc;
}

function makeModelApi<T extends { id: string }>(collection: string) {
  const col = () => getDb().collection(collection);
  const now = () => new Date();

  async function prepWrite(id: string, data: Doc): Promise<Doc> {
    const d = { ...data };
    stripSelfDisplayUrls(collection, id, d);
    const blobFields =
      collection === "settings"
        ? ["value"]
        : IMAGE_FIELDS[collection] ?? [];
    for (const f of blobFields) {
      if (typeof d[f] === "string" && (d[f] as string).startsWith("data:")) {
        d[f] = await offloadLargeBlob(collection, id, d[f] as string);
      }
    }
    deriveThumbFields(collection, d);
    delete d.id;
    return d;
  }

  async function fetchRows(
    where: Where,
    orderBy?: OrderBy,
    limit?: number
  ): Promise<Row[]> {
    const { query, postFilter } = applyWhere(col(), where ?? {});
    let q = applyOrderBy(query, orderBy);
    if (limit) q = q.limit(limit);
    const snap = await withRetry(() => q.get());
    let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Row[];
    if (postFilter) rows = postFilter(rows);
    return rows;
  }

  async function resolveDoc(where: Where): Promise<Doc | null> {
    if (where && typeof where.id === "string") {
      const snap = await withRetry(() => col().doc(String(where.id)).get());
      return snap.exists ? ({ id: snap.id, ...snap.data() } as Doc) : null;
    }
    const rows = await fetchRows(where, undefined, 25);
    return rows[0] ?? null;
  }


  function project(row: Doc, select: Doc | undefined): Doc {
    if (!select) return row;
    const picked: Doc = { id: row.id };
    for (const k of Object.keys(select)) picked[k] = row[k];
    return picked;
  }

  /** Hydrate program.channel (the only relation include the app uses). */
  async function hydrateInclude(
    rows: Array<Doc & { id: string }>,
    include: Doc | undefined
  ): Promise<Array<Doc & { id: string }>> {
    if (!include || !include.channel || collection !== "programs") return rows;
    const ids = [...new Set(rows.map((r) => r.channelId).filter(Boolean))] as string[];
    if (!ids.length) return rows;
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 10) chunks.push(ids.slice(i, i + 10));
    const map = new Map<string, Doc>();
    for (const chunk of chunks) {
      const snap = await withRetry(() =>
        getDb().getAll(...chunk.map((id) => getDb().collection("channels").doc(id)))
      );
      for (const d of snap) {
        if (d.exists) map.set(d.id, { id: d.id, ...d.data() } as Doc);
      }
    }
    const channelSelect = (include.channel as Doc)?.select as Doc | undefined;
    return rows.map((r) => {
      const ch = map.get(r.channelId as string);
      r.channel = ch ? project(ch, channelSelect) : null;
      return r;
    });
  }

  const api = {
    async findUnique(opts: ModelOptions & { where: Where }): Promise<T | null> {
      const row = await resolveDoc(opts.where);
      if (!row) return null;
      sanitizeOutgoing(collection, row);
      return fixDates<T>(project(row, opts.select));
    },

    async findFirst(opts: ModelOptions = {}): Promise<T | null> {
      const rows: Row[] = await fetchRows(opts.where ?? {}, opts.orderBy, 50);
      const ordered = sortInMemory(rows, opts.orderBy);
      const row = ordered[0];
      if (!row) return null;
      sanitizeOutgoing(collection, row);
      return fixDates<T>(project(row, opts.select));
    },

    async findMany(opts: ModelOptions = {}): Promise<T[]> {
      let rows: Row[] = await fetchRows(opts.where ?? {}, opts.orderBy);
      rows = sortInMemory(rows, opts.orderBy);
      rows = await hydrateInclude(rows, opts.include);
      return rows.map((row) => {
        sanitizeOutgoing(collection, row);
        return fixDates<T>(project(row, opts.select));
      });
    },

    async count(opts?: { where?: Where }): Promise<number> {
      const { query, postFilter } = applyWhere(col(), opts?.where ?? {});
      if (postFilter) {
        const snap = await withRetry(() => query.get());
        return postFilter(snap.docs.map((d) => ({ id: d.id, ...d.data() }))).length;
      }
      const snap = await withRetry(() => query.count().get());
      return snap.data().count;
    },

    async groupBy(
      opts: { by: string[] } & ModelOptions & {
          _count?: Record<string, boolean>;
        } & { orderBy?: OrderBy }
    ): Promise<Array<Record<string, unknown> & { _count: Record<string, number> }>> {
      if (!(opts.by.length === 1 && opts.by[0] === "reciterName")) {
        throw new Error(`groupBy(${opts.by}) not supported by the Firestore adapter`);
      }
      const rows = await fetchRows(opts.where ?? {});
      const counts = new Map<string, number>();
      for (const r of rows) {
        const k = String(r.reciterName ?? "");
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      const out = [...counts.entries()].map(([reciterName, n]) => ({
        reciterName,
        _count: { reciterName: n },
      }));
      const dir =
        Array.isArray(opts.orderBy) === false &&
        (opts.orderBy as Record<string, "asc" | "desc">)?.reciterName === "desc"
          ? -1
          : 1;
      out.sort((a, b) => dir * a.reciterName.localeCompare(b.reciterName));
      return out;
    },

    async create(opts: { data: Doc; select?: Doc; include?: Doc }): Promise<T> {
      const id = cuid();
      const data = await prepWrite(id, { ...opts.data });
      const payload: Doc = { ...data, id, createdAt: now(), updatedAt: now() };
      await withRetry(() => col().doc(id).set(payload));
      sanitizeOutgoing(collection, payload);
      return fixDates<T>(payload);
    },

    async createMany(opts: { data: Doc[] }): Promise<{ count: number }> {
      const chunkSize = 400;
      let count = 0;
      for (let i = 0; i < opts.data.length; i += chunkSize) {
        const batch = getDb().batch();
        for (const item of opts.data.slice(i, i + chunkSize)) {
          const id = cuid();
          const payload: Doc = { ...item, id, createdAt: now(), updatedAt: now() };
          batch.set(col().doc(id), payload);
          count++;
        }
        await withRetry(() => batch.commit());
      }
      return { count };
    },

    async update(
      opts: ModelOptions & { where: Where; data: Doc }
    ): Promise<T> {
      const existing = await resolveDoc(opts.where);
      if (!existing) {
        throw new Error(
          `Record to update not found in ${collection} (P2025-equivalent)`
        );
      }
      const id = existing.id as string;
      const data = { ...opts.data };
      // Prisma increment/decrement → Firestore FieldValue.
      for (const [k, v] of Object.entries(data)) {
        if (isPlainObject(v) && "increment" in v) {
          data[k] = FieldValue.increment(Number(v.increment));
        } else if (isPlainObject(v) && "decrement" in v) {
          data[k] = FieldValue.increment(-Number(v.decrement));
        }
      }
      const cleaned = await prepWrite(id, data);
      const payload: Doc = { ...cleaned, updatedAt: now() };
      await withRetry(() => col().doc(id).set(payload, { merge: true }));
      const merged: Doc = { ...existing };
      for (const [k, v] of Object.entries(payload)) {
        merged[k] = v instanceof FieldValue ? existing[k] : v;
      }
      sanitizeOutgoing(collection, merged);
      return fixDates<T>(merged);
    },

    async upsert(
      opts: ModelOptions & { where: Where; create: Doc; update: Doc }
    ): Promise<T> {
      const existing = await resolveDoc(opts.where);
      if (existing) {
        return api.update({ where: { id: existing.id }, data: opts.update });
      }
      const created = await api.create({ data: opts.create });
      // For keyed models (settings), keep the key lookup consistent.
      const key = (opts.where as { key?: string }).key;
      if (key && created && (created as unknown as Doc).key !== key) {
        await withRetry(() =>
          col()
            .doc((created as unknown as Doc).id as string)
            .set({ key }, { merge: true })
        );
        (created as unknown as Doc).key = key;
      }
      return created;
    },

    async delete(opts: { where: Where }): Promise<T> {
      const existing = await resolveDoc(opts.where);
      if (!existing)
        throw new Error(`Record to delete not found in ${collection}`);
      await withRetry(() => col().doc(existing.id as string).delete());
      sanitizeOutgoing(collection, existing);
      return fixDates<T>(existing);
    },

    async deleteMany(opts?: { where?: Where }): Promise<{ count: number }> {
      const rows: Row[] = await fetchRows(opts?.where ?? {});
      const batch = getDb().batch();
      for (const r of rows) batch.delete(col().doc(r.id as string));
      if (rows.length) await withRetry(() => batch.commit());
      return { count: rows.length };
    },
  };

  return api;
}

// ── The Prisma-compatible client (Firestore-backed) ──────────────────────────

export const prisma = {
  user: makeModelApi<User>("users"),
  channel: makeModelApi<Channel>("channels"),
  setting: makeModelApi<Setting>("settings"),
  program: makeModelApi<Program>("programs"),
  subscriber: makeModelApi<Subscriber>("subscribers"),
  replay: makeModelApi<Replay>("replays"),
  radio: makeModelApi<Radio>("radios"),
  quranAudio: makeModelApi<QuranAudio>("quranAudio"),
  // Legacy no-ops kept so untouched imports keep compiling.
  $queryRaw: <T = unknown[]>(..._args: unknown[]) => Promise.resolve([] as unknown as T),
  $executeRawUnsafe: async (..._a: unknown[]) => 0,
  $disconnect: async () => {},
  $transaction: async <T,>(fn: () => Promise<T>): Promise<T> => fn(),
};

export default prisma;
