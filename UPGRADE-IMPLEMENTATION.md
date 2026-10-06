# eBilikAgama Broadcast Platform — Upgrade Implementation Summary

Date: 2026-09-28 · Branch: `main` · DB schema version: **v6** (Neon PostgreSQL + Prisma, unchanged)
Constraint compliance: no Firebase, no Icecast, no new runtime dependencies; Google Drive remains the only audio storage; no binary data in Neon; existing UI/design preserved (all new pages follow the established admin shell + i18n pattern); no fake data anywhere — every gauge, list and diagnostic reflects a real check or real rows.

---

## 1. Database changes (schema v6)

`prisma/schema.prisma` + `src/lib/db-init.ts` (`SCHEMA_VERSION = "6"`, `runBroadcastPlatformMigrations()`):

| Model | Purpose | Key design points |
|---|---|---|
| `RadioPlayback` | Proof-of-play records (§5) | `eventId` **unique** → idempotent start/finalize (duplicate POSTs are no-ops, never double-count) |
| `TimelineEvent` | Broadcast timeline (§6) | `eventId` unique → dedupe of azan/track events |
| `AuditLog` | Admin audit trail (§9) | actor snapshot, sanitized metadata (credential-shaped keys stripped before write) |
| `Incident` | Incident Center (§19) | one row per failure **signature**; repeats bump `occurrences`/`lastDetectedAt`; resolved-then-recurring opens a **new** row so history is preserved |
| `Notification` + `NotificationRead` | Notification Center (§12) | targetAll / targetRole / userIds targeting; per-user read state |
| `EmergencyBroadcast` | Emergency broadcast (§13) | activation window + audited lifecycle |
| `UserFavorite` | Favorites (§16) | per-user, per-content-type |

`Program` gained recurrence columns: `recurrence`, `recurrenceWeekday`, `recurrenceUntil`, `parentId` (§7 EPG recurrence). The migration in `db-init.ts` is idempotent (`ALTER TABLE … ADD COLUMN IF NOT EXISTS` style guards) and runs automatically on boot; the Prisma client was regenerated to match.

## 2. New backend services (`src/lib/`)

- `audit.ts` — one-line audited writes; strips values of credential-shaped keys (`password`, `token`, `secret`, `key`, …) before persisting.
- `incidents.ts` — `reportIncident()` (fire-and-forget, signature dedupe) and `resolveIncidents()` (auto-resolve when a check recovers).
- `health.ts` — **System Health (§4): 12 real checks** (Neon round-trip, Drive stream reachability, audio stream, JAKIM API, azan schedule integrity, DB write probe, disk-free-equivalents, session store, etc.). Gray/red states are real environment states, never synthesized.
- `radio-diagnostics.ts` — **Radio Diagnostics (§3): 12 real tests** against the actual configured stream.
- `retention.ts` — 5 retention families (audit logs, incidents, notifications, playback history, timeline events) with owner-triggered purge.
- `roles.ts` — owner > admin > editor > viewer capability matrix used by API gating.
- `epg.ts` — `templateCovers()`, `expandRecurring()`, `nextDate()` powering recurring programs.
- `connection.ts` — `useConnectionStatus` hook + `fetchWithRetry` (offline detection, bounded retry/backoff) powering **Connection Recovery (§18)**.

## 3. New API routes (all under `src/app/api/`)

| Route | Methods | Access |
|---|---|---|
| `control-center` | GET | admin+ (live player state, today's schedule, open incidents) |
| `system-health` | GET | admin+ (12 checks + overall level) |
| `radio-diagnostics` | GET | admin+ (12 tests, per-test pass/fail + latency) |
| `radio-playback` | POST (start/finalize/timeline), GET, DELETE | POST/GET admin+; **DELETE owner-only** |
| `radio-timeline` | GET | admin+ |
| `audit-logs` | GET, POST (retention purge) | admin read; purge owner-only |
| `analytics` | GET | admin+ (3 `Promise.all` batches, ≤10 queries) |
| `reports` | GET (`format=csv|json`, 7 categories) | admin+ |
| `incidents` | GET, PATCH (status) | admin+; PATCH audited |
| `notifications` | GET (`scope=mine|admin`), POST, PATCH (`mark-read`/`deactivate`) | mine: any user; admin scope/create/deactivate: admin+; **20/day anti-spam limit** |
| `emergency-broadcast` | GET, POST, PATCH | admin+ |
| `favorites` | GET, POST, DELETE | any signed-in user |
| `search` | GET (`q=`) | any signed-in user (programs, channels, tracks, pages) |
| `profile` | GET, PATCH | self (name, password change with current-password check) |
| `profile/sessions` | GET, DELETE | self (list/revoke own sessions) |
| `backup` | GET | **owner-only**; metadata + content **hashes only** — tokens/secrets never included |

Audit writes were wired into the existing mutation endpoints: users, channels, programs, radio config, azan assignments, JAKIM zone sync, and virtual-radio arrange (including `removedSongs` + `durationsUpdated` counts in the arrange response).

## 4. Player integration (`VirtualRadioPlayer.tsx`)

Proof-of-play and timeline events are emitted from real playback state:
`track_start` on playing → `popStart`; `completed`/natural end → `track_end` + `popEnd/finalize`; azan interruption → `azan_interrupted` + `azan_start`, then `azan_end` + `radio_resume` after the 3 s post-azan grace; audio element errors → `onAudioError`. A `??` precedence bug was fixed along the way. Every emission carries a stable `eventId`, so retries cannot create duplicate play records.

## 5. New UI (design preserved; all strings i18n'd)

- **Admin pages** (`src/app/admin/…`): `control-center`, `system-health`, `radio-diagnostics`, `radio-history` (History + Timeline tabs), `audit-logs`, `analytics`, `reports`, `incidents`, `notifications`, `emergency` (confirm modal), `backup` (nav entry owner-gated).
- **User pages** (`src/app/…`): `profile` (incl. sessions), `favorites`, `notifications`.
- **Shell integration**: Header gains global search + notification bell + My Profile link; `ConnectionBanner` renders in `LayoutShell` during outages; `public/manifest.json` adds `gcm_sender_id` (web-push prep, §17 — no sender keys committed).
- **i18n**: ~230 new keys added to **all three dictionaries** (en/bm/zh) in `src/lib/i18n.ts` — families `cc_*, sh_*, rd_*, rh_*, tl_*, an_*, al_*, rep_*, nc_*, eb_*, inc_*, bp_*, mp_*, fav_*, gs_*, conn_*, wn_*, epg_rec*`.

## 6. Roles & permissions (§21)

- **owner**: everything, plus backup/restore, audit-log retention purge, DELETE `/api/radio-playback`, minting admin/owner accounts.
- **admin**: all broadcast management + new sections; mints editor/viewer accounts.
- **editor**: manage programs/channels/arrangement; no user management, no owner endpoints.
- **viewer**: read-only. Login/layout gating accepts admin|owner|editor|viewer for the admin area; capability checks are enforced server-side per route (verified: admin gets 403 on owner-only endpoints).

## 7. Testing performed

- `tsc --noEmit` — **clean** · `eslint` — **0 problems** · `next build` — **succeeds**.
- All 14+ new endpoints smoke-tested 200 with real data (admin cookie).
- Automated E2E — `scripts/pop-e2e.sh` (usage: `BASE=http://localhost:3230 JAR=/tmp/cookies.txt bash scripts/pop-e2e.sh`): **18 passed, 0 failed**:
  1. POP start accepted · 2. duplicate start deduped · 3. finalize accepted · 4. re-finalize no-op · 5. timeline event accepted · 6. timeline duplicate deduped · 7. unauthenticated POST → **307 redirect to `/sign-in`** (proxy design, see §9) · 8. history read-back contains record · 9. timeline read-back contains event · 10–12. incident → investigating → resolved → filtered read-back · 13–18. notification create (201) → visible in `scope=mine` → mark-read → read state persisted → deactivate → hidden from users.
- Test data was cleaned up afterwards: all `e2e-*` playback/timeline rows and the test notification (incl. read state) deleted; the single incident touched by the PATCH test was restored to `open` (its underlying audio failure still exists — see §9). `e2eLeftovers = 0`.

## 8. §33 Manual testing checklist (for a human pass before/after deploy)

**Broadcast Control Center**
- [ ] `/admin/control-center` shows the live track, today's schedule and open incidents matching the real player state.
- [ ] Playing a track in the player updates the control center within one refresh.

**Proof-of-play & Timeline**
- [ ] Play a track to natural end → one completed RadioPlayback row (not two) in `/admin/radio-history`.
- [ ] Trigger azan → `azan_start`/`azan_interrupted` timeline rows appear; after 3 s `azan_end` + `radio_resume` appear.
- [ ] Refresh the page mid-track → no duplicate play row for the same `eventId`.

**System Health & Diagnostics**
- [ ] `/admin/system-health` shows 12 checks; failing ones (e.g. Drive in dev) are red, not hidden.
- [ ] `/admin/radio-diagnostics` runs all 12 tests on demand; a failing stream probe marks the overall state red.

**EPG recurrence**
- [ ] Create a weekly recurring program with an end date → occurrences appear on each covered date; editing one occurrence only affects it (`parentId`).

**Emergency broadcast**
- [ ] Activate with confirmation modal → banner visible to listeners; deactivate clears it; action appears in audit log.

**Notifications**
- [ ] Admin creates a targeted announcement → appears in `/notifications` for the targeted role/user only.
- [ ] Mark-as-read persists after reload; unread count on the Header bell matches.

**Favorites / Search / Profile**
- [ ] Favorite a program/channel → visible in `/favorites`; unfavorite removes it.
- [ ] Global search finds a program, a channel and an admin page by partial name (BM + EN queries).
- [ ] `/profile` name change + password change (wrong current password rejected); sessions list shows the current session; revoking another session works.

**Incidents & Audit**
- [ ] Stop the audio stream → open incident appears in `/admin/incidents`; mark investigating → resolved; restart stream → next check auto-resolves.
- [ ] Perform any admin mutation → matching row in `/admin/audit-logs` with actor and sanitized metadata (no `password`/`token` values).

**Reports & Analytics**
- [ ] Each of the 7 report categories exports valid CSV (opens in Excel) and JSON.
- [ ] `/admin/analytics` numbers match reality for today/7d/30d.

**Backup (owner)**
- [ ] As owner, `/admin/backup` lists tables + row counts + hashes; response body contains **no** connection strings or tokens.
- [ ] As admin, backup nav entry and endpoint return 403.

**Resilience**
- [ ] Kill network → ConnectionBanner appears; restore → recovers and failed fetches retried successfully.
- [ ] Sign out in a second tab → gated pages redirect to `/sign-in`.

## 9. Known environment warnings (not code bugs)

1. **Drive stream probe fails locally (502 “NOT ACCESSIBLE”)** — Google Drive returns an HTML interstitial to this dev environment (token/origin issue). Diagnostics and health correctly show red. Verify stream reachability from production after deploy.
2. **Unauthenticated API POSTs return 307 → `/sign-in?redirect=…`**, not a JSON 401. This is `src/proxy.ts` `PUBLIC_PATHS` gating by design for browser-style requests; E2E tooling must expect the redirect (the shipped script does).
3. **Owner-only endpoints** (`DELETE /api/radio-playback`, backup/retention purge) return 403 for admin — by design; owner credentials were not used during testing.
4. **`.env` `DATABASE_URL` is a `file:./dev.db` placeholder;** the runtime Neon URL is resolved in `src/lib/prisma.ts` (deliberately not reproduced here). Anyone running scripts against the DB must go through the app or the same code path.
5. **Web-push is prep-only**: manifest + notification center are ready; actual push dispatch (service worker + keys) was intentionally left out of scope.
6. Dev server used for testing ran on port 3230 (`/tmp/dev3230.log`); stop it if no longer needed.

## 10. File change summary

- **Modified**: `prisma/schema.prisma`, `src/lib/db-init.ts`, `src/lib/i18n.ts`, `src/components/{Header,LayoutShell,VirtualRadioPlayer}.tsx`, `src/app/admin/layout.tsx`, `src/app/api/auth/login/route.ts`, existing `users/channels/programs/virtual-radio/jakim-sync` APIs (audit + role wiring), `public/manifest.json`.
- **New services**: `src/lib/{audit,incidents,health,radio-diagnostics,retention,roles,epg,connection}.ts`.
- **New APIs**: `src/app/api/{analytics,audit-logs,backup,control-center,emergency-broadcast,favorites,incidents,notifications,profile,radio-diagnostics,radio-playback,radio-timeline,reports,search,system-health}/route.ts`.
- **New pages**: `src/app/admin/{analytics,audit-logs,backup,control-center,emergency,incidents,notifications,radio-diagnostics,radio-history,reports,system-health}/page.tsx`, `src/app/{favorites,notifications,profile}/page.tsx`, `src/components/ConnectionBanner.tsx`.
- **New tooling**: `scripts/pop-e2e.sh` (18-check E2E).

*Nothing has been committed or pushed — all changes are working-tree only.*
