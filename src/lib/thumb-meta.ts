// Thumbnail classification WITHOUT reading blob bytes.
//
// On write, the data layer (lib/prisma.ts) stores derived fields
// thumbKind ("data" | "url" | null) and thumbIsBlob alongside every record
// with a thumbnail. This module issues cheap Firestore projections over
// those fields to build id→meta maps, so list endpoints never transfer
// image bytes — the egress pattern that exhausted the previous provider.
import { getDb } from "@/lib/prisma";

export type ThumbKind = "data" | "url" | null;

export interface ThumbnailMeta {
  kind: ThumbKind;
  url?: string;
}

/**
 * Returns id → { kind, url } for a collection using only the tiny derived
 * fields. `filters` are extra equality constraints (e.g. active flag).
 */
export async function getThumbnailMeta(
  collection: string,
  filters: Record<string, unknown> = {}
): Promise<Map<string, ThumbnailMeta>> {
  const out = new Map<string, ThumbnailMeta>();
  let q: FirebaseFirestore.Query = getDb().collection(collection);
  for (const [k, v] of Object.entries(filters)) {
    q = q.where(k, "==", v);
  }
  const snap = await q.select("thumbKind", "thumbnail").get();
  for (const doc of snap.docs) {
    const data = doc.data();
    const kind = (data.thumbKind ?? null) as ThumbKind;
    if (kind === "url" && typeof data.thumbnail === "string") {
      out.set(doc.id, { kind: "url", url: data.thumbnail });
    } else if (kind === "data") {
      out.set(doc.id, { kind: "data" });
    } else {
      out.set(doc.id, { kind: null });
    }
  }
  return out;
}

/**
 * True when `value` is this record's own display URL
 * (/api/images/<type>/<id>) — such echoes must never overwrite stored
 * image data.
 */
export function isSelfImageUrl(value: unknown, type: string, id: string): boolean {
  if (typeof value !== "string") return false;
  return value.startsWith(`/api/images/${type}/${id}`);
}

/** Internal display URL served by /api/images/<type>/<id>. */
export function dataThumbUrl(
  type: string,
  id: string,
  updatedAt?: Date | string | null
): string {
  const epoch =
    process.env.VERCEL_DEPLOYMENT_ID ||
    (updatedAt ? new Date(updatedAt).getTime().toString(36) : "0");
  return `/api/images/${type}/${id}?v=${epoch}`;
}
