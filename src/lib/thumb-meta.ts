import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Thumbnail classification WITHOUT transferring base64 blobs.
 *
 * Historically, list endpoints selected full rows (including multi-megabyte
 * base64 `thumbnail` columns) only to rewrite them into `/api/images/...`
 * URLs. That transfers the entire blob from the database on every request —
 * on Neon free tier this consumed the monthly data-transfer (egress) quota,
 * after which EVERY query fails with code 53000 and the whole site's
 * database layer goes down.
 *
 * Instead: classify each row's thumbnail with a cheap SQL projection
 * (never selecting the blob itself):
 *   - "data" → stored as a data URI → serve via /api/images/{type}/{id}
 *   - "url"  → stored as an external URL → pass through (fetched in a tiny
 *              second query touching only those rows)
 *   - absent → no thumbnail
 */
export type ThumbMeta = { kind: "data" } | { kind: "url"; url: string };

const TABLES = {
  Channel: "Channel",
  Radio: "Radio",
  Program: "Program",
  Replay: "Replay",
} as const;

export type ThumbTable = keyof typeof TABLES;

export async function getThumbnailMeta(
  table: ThumbTable,
  where: Prisma.Sql
): Promise<Map<string, ThumbMeta>> {
  const rows = await prisma.$queryRaw<{ id: string; kind: string | null }[]>`
    SELECT "id",
      CASE
        WHEN "thumbnail" LIKE 'data:%' THEN 'data'
        WHEN "thumbnail" IS NOT NULL AND "thumbnail" <> '' THEN 'url'
        ELSE NULL
      END AS "kind"
    FROM ${Prisma.raw(`"${TABLES[table]}"`)}
    WHERE ${where}`;

  const meta = new Map<string, ThumbMeta>();
  const urlIds: string[] = [];
  for (const r of rows) {
    if (r.kind === "data") {
      meta.set(r.id, { kind: "data" });
    } else if (r.kind === "url") {
      meta.set(r.id, { kind: "url", url: "" });
      urlIds.push(r.id);
    }
  }

  // External (non-data) thumbnails are rare and tiny — fetch their actual
  // values in one small query, touching only those rows.
  if (urlIds.length > 0) {
    const urlRows = await prisma.$queryRaw<{ id: string; thumbnail: string }[]>`
      SELECT "id", "thumbnail"
      FROM ${Prisma.raw(`"${TABLES[table]}"`)}
      WHERE "id" IN (${Prisma.join(urlIds)})`;
    for (const u of urlRows) {
      meta.set(u.id, { kind: "url", url: u.thumbnail });
    }
  }

  return meta;
}

/** URL for a data-URI thumbnail served through the images endpoint. */
export function dataThumbUrl(
  type: "channel" | "radio" | "program" | "replay" | "setting",
  id: string,
  updatedAt?: Date | string | null
): string {
  let v = 0;
  try {
    v = updatedAt ? new Date(updatedAt).getTime() : 0;
  } catch {
    v = 0;
  }
  return `/api/images/${type}/${id}?v=${v}`;
}

/**
 * Guard for PUT routes: detect a thumbnail value that is merely this
 * record's own display URL. An admin form echoing the list-API value back
 * must never overwrite the stored base64 image with the URL string.
 */
export function isSelfImageUrl(
  value: unknown,
  type: "channel" | "radio" | "program" | "replay",
  id: string
): boolean {
  if (typeof value !== "string") return false;
  return value.startsWith(`/api/images/${type}/${id}`);
}
