import { NextResponse } from "next/server";
import { getDb, isNonRetryableDbError } from "@/lib/prisma";
import { getDbFatalError, isDatabaseDown } from "@/lib/db-init";

export const dynamic = "force-dynamic";

/**
 * Public (unauthenticated) database health probe.
 * Returns only status information — never user data or secrets.
 */
export async function GET() {
  const started = Date.now();

  try {
    // Cheap liveness probe: perform a 1-document aggregate.
    const snap = await getDb().collection("settings").limit(1).get();
    void snap;

    // Schema/init state reported by the legacy gate (kept for warmups).
    const initReady = await Promise.race([
      ensureDatabaseSafe(),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000)),
    ]);

    return NextResponse.json(
      {
        status: "ok",
        database: "reachable",
        backend: "firestore",
        schemaReady: initReady,
        latencyMs: Date.now() - started,
        checkedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const permanent = isNonRetryableDbError(error) || !!getDbFatalError();

    console.error("[HEALTH] Firestore check failed:", message);
    // Boolean presence only — never the values — so a misconfigured
    // variable NAME or environment scope is diagnosable from the outside.
    return NextResponse.json(
      {
        status: "degraded",
        database: "unreachable",
        backend: "firestore",
        permanent,
        env: {
          hasFirebaseServiceAccount: !!process.env.FIREBASE_SERVICE_ACCOUNT,
          hasGoogleApplicationCredentials:
            !!process.env.GOOGLE_APPLICATION_CREDENTIALS,
          hasStorageBucket: !!process.env.FIREBASE_STORAGE_BUCKET,
        },
        reason: /not configured|FIREBASE_SERVICE_ACCOUNT/i.test(message)
          ? "firebase_not_configured"
          : "firestore_unreachable",
        detail: /not configured/i.test(message)
          ? "Firebase Admin credentials are not configured in this environment."
          : "Firestore could not be reached. It may be a transient Google Cloud issue.",
        latencyMs: Date.now() - started,
        checkedAt: new Date().toISOString(),
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}

async function ensureDatabaseSafe(): Promise<boolean> {
  try {
    const mod = await import("@/lib/db-init");
    if (isDatabaseDown()) return false;
    return await mod.ensureDatabase();
  } catch {
    return false;
  }
}
