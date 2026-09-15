# Firebase Production Configuration (Neon → Firestore migration)

## Status

The application data layer (`src/lib/prisma.ts`) is now a **Firestore-backed
adapter** that preserves the Prisma call shape — all API routes, auth, and
pages work unchanged. Data lives in Firestore; oversized image blobs live in
Firebase Storage.

## Required environment variables (Vercel Production + Preview)

| Variable | Value | Notes |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | The **complete service-account JSON** (single line, or base64 of it) | Server-only. Never `NEXT_PUBLIC_*`. Never committed. |
| `FIREBASE_STORAGE_BUCKET` | `<project-id>.firebasestorage.app` (or legacy `.appspot.com`) | Required for oversized thumbnails/profile photos |
| `JWT_SECRET` | Strong random secret | Session signing (unchanged) |

Where to get the service-account JSON:
Firebase Console → Project settings → Service accounts →
**Generate new private key** → paste the entire JSON (or its base64) into
`FIREBASE_SERVICE_ACCOUNT`.

## One-time Firebase project setup

1. Create (or reuse) a Firebase project in the Firebase console.
2. Enable **Cloud Firestore** (production mode) — any region; choose one close
   to your users (e.g. `asia-southeast1`).
3. Enable **Storage** (default bucket) — used only for oversized image blobs.
4. Add a Web App (optional; only for config values — the server uses the
   service account).
5. Generate the service-account key (above) and set it in Vercel.

## Deploy Firestore assets (CLI, optional but recommended)

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

- `firestore.rules` — denies ALL direct client access (server-only backend).
  Deploying them is a hardening step; the app works even before deployment
  because the default locked mode also denies client access.
- `firestore.indexes.json` — composite indexes for quranAudio/programs
  queries. Firestore also auto-suggests index-creation links in the console
  if one is ever missing.

## Data migration (one command, idempotent)

```bash
# Source (Neon) is read-only during migration; nothing is modified there.
DATABASE_URL="<neon connection string>" \
FIREBASE_SERVICE_ACCOUNT="<service account json or base64>" \
FIREBASE_STORAGE_BUCKET="<project>.firebasestorage.app" \
node scripts/migrate-neon-to-firestore.cjs
```

The script:
- migrates users, channels, settings, programs, subscribers, replays, radios,
  quranAudio with **original IDs preserved**,
- offloads image blobs > 900 KB to Storage (`gcs://` sentinels),
- verifies old-vs-new counts per table and prints a ✓/✗ table,
- is safe to re-run (merge-set by document ID; never duplicates).

## Rollout sequence

1. Set the three env vars in Vercel → redeploy → `/api/health/db` must report
   `reachable`.
2. Run the migration script (Neon must be reachable — if it is still
   quota-blocked, wait for reset/upgrade first; the app keeps serving from
   Firestore whatever has been migrated).
3. Smoke-test production (login, admin, homepage, replay, quran).
4. Remove `DATABASE_URL` from Vercel only after verification. The Neon
   database itself is never deleted.

## Rollback

Revert to the last Neon-backed commit (`3770a78`) and restore `DATABASE_URL`.
No data migration is needed to roll back — Neon was never modified.
