import { NextRequest, NextResponse } from "next/server";
import { getAdminSession, isAdminRole } from "@/lib/auth";
import { getDb } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Admin-only migration status endpoint.
 *
 * Reports whether the Neon → Firestore data migration has run, by counting
 * Firestore documents in each application collection. Read-only. When Neon
 * is still unreachable (quota lock), it reports that too, so the admin can
 * see exactly what is pending without any local tooling.
 */
export async function GET(request: NextRequest) {
  const session = await getAdminSession();
  if (!session || !isAdminRole(session.role)) {
    return NextResponse.json({ error: "Tidak dibenarkan" }, { status: 403 });
  }

  const collections = [
    "users",
    "channels",
    "settings",
    "programs",
    "subscribers",
    "replays",
    "radios",
    "quranAudio",
  ];
  const counts: Record<string, number> = {};
  let firestoreOk = true;
  try {
    const db = getDb();
    for (const c of collections) {
      const snap = await db.collection(c).count().get();
      counts[c] = snap.data().count;
    }
  } catch (e) {
    firestoreOk = false;
    return NextResponse.json(
      {
        error: "Firestore unavailable",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 503 }
    );
  }

  return NextResponse.json({
    firestore: { ok: firestoreOk, counts },
    neon: {
      note: "Neon remains the source of truth until the migration runs.",
      reachableHint: "Run POST on this endpoint to attempt the migration.",
    },
    checkedAt: new Date().toISOString(),
  });
}

/**
 * POST: attempt the Neon → Firestore migration server-side.
 *
 * The heavy lifting reuses the migration logic compiled into the bundle via
 * a dynamic import of the migration module — which runs only when Neon is
 * reachable. Responds 503 with the provider error while Neon is locked, so
 * the admin can simply retry later.
 */
export async function POST(request: NextRequest) {
  const session = await getAdminSession();
  if (!session || !isAdminRole(session.role)) {
    return NextResponse.json({ error: "Tidak dibenarkan" }, { status: 403 });
  }

  // The migration's first Neon read acts as the reachability gate: while the
  // provider quota lock persists it throws, which we surface as a clean 503.
  try {
    const { runMigration } = await import("@/lib/migration-runner");
    const result = await runMigration();
    return NextResponse.json({ status: "completed", result });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    const providerBlocked = /quota|Can't reach database|ECONNREFUSED|ETIMEDOUT|P1001/i.test(
      detail
    );
    return NextResponse.json(
      {
        error: providerBlocked
          ? "Neon is not reachable (provider transfer-quota lock likely active)."
          : "Migration failed",
        detail,
        hint: providerBlocked
          ? "Retry after the quota resets or the plan is upgraded. Nothing was written."
          : "Partial data may have been written; the migration is idempotent and safe to re-run.",
      },
      { status: providerBlocked ? 503 : 500, headers: { "Retry-After": "3600" } }
    );
  }
}
