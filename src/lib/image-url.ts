// Deployment-scoped image URL epoch.
//
// Every deployment gets a fresh VERCEL_DEPLOYMENT_ID, so appending it to
// image URLs makes each deploy's URLs brand-new to every cache layer
// (browser, CDN). Any cache entry that ever stored a broken response for an
// old URL becomes unreachable instead of being replayed forever.
export const IMAGE_EPOCH: string =
  process.env.VERCEL_DEPLOYMENT_ID ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  "local";

/** Versioned, cache-safe URL for a replay thumbnail stored in the DB. */
export function replayThumbUrl(id: string, updatedAt: Date | string): string {
  const v = `${IMAGE_EPOCH}-${new Date(updatedAt).getTime()}`;
  return `/api/images/replay/${id}?v=${encodeURIComponent(v)}`;
}
