// Kept as a compatibility gate for the ~21 modules that import
// ensureDatabase()/isDatabaseDown(). Firestore requires no schema setup or
// seeding: collections are created on first write. The gate reports "ready"
// once a trivial Firestore operation succeeds, and keeps the circuit-breaker
// semantics (fast-fail for 60s after a proven failure) for hot paths.
import {
  getDb,
  isNonRetryableDbError,
  FirebaseNotConfiguredError,
} from "@/lib/prisma";

let _initialized = false;
let _initPromise: Promise<boolean> | null = null;
let _fatalError: string | null = null;
const BREAKER_COOLDOWN_MS = 60_000;
let _breakerOpenUntil = 0;

/** Human-readable reason for the last permanent data-layer failure. */
export function getDbFatalError(): string | null {
  return _fatalError;
}

/** True while the breaker is open (recently proven down). */
export function isDatabaseDown(): boolean {
  return Date.now() < _breakerOpenUntil;
}

function openBreaker(reason: string) {
  _fatalError = reason;
  _breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS;
}

async function probe(): Promise<boolean> {
  try {
    // Cheapest possible server-side Firestore operation.
    await getDb().collection("settings").limit(1).get();
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isNonRetryableDbError(err) || err instanceof FirebaseNotConfiguredError) {
      openBreaker(msg);
      console.error("[DB-GATE] Non-retryable Firestore failure:", msg);
    } else {
      // Transient (network, rules propagation, cold auth) — brief breaker.
      openBreaker(msg);
      console.error("[DB-GATE] Firestore probe failed:", msg);
    }
    return false;
  }
}

/**
 * Ensures the data layer is reachable. Promise-memoized; a failed probe is
 * retried on later requests after the breaker cooldown so recovery (e.g.
 * credentials being added) is detected automatically.
 */
export function ensureDatabase(): Promise<boolean> {
  if (_initialized) return Promise.resolve(true);
  if (isDatabaseDown()) return Promise.resolve(false);
  if (!_initPromise) {
    _initPromise = probe().then((ok) => {
      if (ok) _initialized = true;
      else _initPromise = null;
      return ok;
    });
  }
  return _initPromise;
}
