// Radio playlist arrangement engine (PURE — no I/O, unit-testable).
//
// GOAL: the normal radio sequence must END exactly at the next azan
// timestamp — no song still playing at the azan boundary (beyond a tiny,
// logged deviation), no long silent gap, no song+azan overlap.
//
// MODEL: the shared radio timeline is `position(t) = (t − epoch) mod total`.
// The server re-arranges by (a) keeping the CURRENTLY-PLAYING track first in
// the new order and (b) re-anchoring the epoch so that position(now) still
// maps to the SAME track at the SAME offset — listeners never hear a seek.
// Every track after the current one is chosen from the REAL Drive-indexed
// durations (subset-sum, repeats as fallback) so the last one ends as close
// to the azan timestamp as mathematically possible. When an exact fit is
// impossible the engine returns the SIGNED deviation so admins see the
// residual gap — never a silent false "perfect".

export interface ArrangePoolTrack {
  driveId: string;
  duration: number; // seconds (real, Drive-indexed)
}

export interface ArrangeResult {
  /** Drive IDs to play AFTER the current track, in order. */
  order: string[];
  /** Seconds the scheduler WANTED to fill (azanStart − currentTrackEnd). */
  targetSeconds: number;
  /** Seconds of complete tracks actually scheduled. */
  scheduledSeconds: number;
  /** scheduled − target (signed). 0 = perfect; + = azan trims the tail; − = short silence/wrap. */
  deviationSeconds: number;
  /** |deviation| ≤ tolerance. */
  exact: boolean;
  /** True when the fit needed to reuse tracks (fallback knapsack). */
  usedRepeats: boolean;
  /** Why this shape was chosen (admin diagnostics). */
  strategy: "exact-subset" | "near-subset" | "exact-repeat" | "near-repeat" | "none-fits" | "no-gap";
}

/** Duration quantization for the DP (real durations are fractional). */
const Q = 1; // 1-second grid
/** Prefer a small overshoot (azan trims a song's tail — designed behavior) over a silence gap. */
const OVERSHOOT_BIAS_S = 30;
/** Search window around the target for a near fit. */
const NEAR_WINDOW_S = 120;
/** |deviation| at or below this counts as exact. */
export const EXACT_TOLERANCE_S = 1.5;

/**
 * Choose an ordered list of complete tracks from `pool` whose total duration
 * lands as close as possible to `gapSeconds`.
 * Pass 1: distinct tracks (0/1 knapsack). Pass 2 (fallback): repeats allowed
 * (unbounded knapsack) — for any gap ≥ the shortest track this almost always
 * finds an exact fit. Overshoot is preferred over undershoot at equal distance.
 */
export function arrangeFiller(
  pool: ArrangePoolTrack[],
  gapSeconds: number
): ArrangeResult {
  const empty: ArrangeResult = {
    order: [],
    targetSeconds: gapSeconds,
    scheduledSeconds: 0,
    deviationSeconds: -gapSeconds,
    exact: false,
    usedRepeats: false,
    strategy: "none-fits",
  };
  if (!Number.isFinite(gapSeconds) || gapSeconds <= 0.5) {
    return { ...empty, strategy: "no-gap", deviationSeconds: -Math.max(0, gapSeconds) };
  }

  const usable = pool
    .map((t) => ({ driveId: t.driveId, dur: Math.max(1, Math.round(t.duration)), real: t.duration }))
    .filter((t) => t.dur >= 1)
    .slice(0, 200); // safety bound; Drive radio libraries are far smaller
  if (usable.length === 0) return empty;

  const target = Math.round(gapSeconds);
  const minDur = Math.min(...usable.map((t) => t.dur));
  // DP table bound: never explore beyond the largest sensible remainder.
  const cap = Math.min(target + NEAR_WINDOW_S, 14 * 3600);

  // Best near-target reachable remainder (prefer exact, then overshoot, then undershoot).
  const pickBest = (reach: Uint8Array): { r: number; kind: "exact" | "over" | "under" } | null => {
    if (target <= cap && reach[target]) return { r: target, kind: "exact" };
    for (let k = 1; k <= NEAR_WINDOW_S; k++) {
      const over = target + k;
      const under = target - k;
      if (over <= cap && reach[over] && k <= OVERSHOOT_BIAS_S) return { r: over, kind: "over" };
      if (under >= 0 && reach[under]) return { r: under, kind: "under" };
      if (over <= cap && reach[over]) return { r: over, kind: "over" }; // beyond bias: still better than far under
    }
    return null;
  };

  // ── Pass 1: distinct tracks (0/1 knapsack with reconstruction) ─────
  const reach1 = new Uint8Array(cap + 1);
  const from1 = new Int32Array(cap + 1).fill(-1); // track index used to reach g
  const prev1 = new Int32Array(cap + 1).fill(-1); // previous g
  reach1[0] = 1;
  for (let i = 0; i < usable.length; i++) {
    const d = usable[i].dur;
    for (let g = cap; g >= d; g--) {
      if (!reach1[g] && reach1[g - d]) {
        reach1[g] = 1;
        from1[g] = i;
        prev1[g] = g - d;
      }
    }
  }
  const best1 = pickBest(reach1);

  // ── Pass 2: repeats allowed (unbounded knapsack) ────────────────────
  let best2: { r: number; kind: "exact" | "over" | "under" } | null = null;
  let from2: Int32Array | null = null;
  let prev2: Int32Array | null = null;
  if (target >= minDur) {
    const reach2 = new Uint8Array(cap + 1);
    from2 = new Int32Array(cap + 1).fill(-1);
    prev2 = new Int32Array(cap + 1).fill(-1);
    reach2[0] = 1;
    for (let g = 1; g <= cap; g++) {
      for (let i = 0; i < usable.length; i++) {
        const d = usable[i].dur;
        if (d <= g && reach2[g - d]) {
          reach2[g] = 1;
          from2[g] = i;
          prev2[g] = g - d;
          break;
        }
      }
    }
    best2 = pickBest(reach2);
  }

  // Choose the better pass: exact beats near; at equal |deviation| prefer distinct.
  let chosen: { r: number; repeats: boolean } | null = null;
  const dev = (b: { r: number } | null) => (b ? b.r - target : Number.POSITIVE_INFINITY);
  const d1 = Math.abs(dev(best1));
  const d2 = Math.abs(dev(best2));
  if (best1 && (d1 <= d2 || !best2)) chosen = { r: best1.r, repeats: false };
  else if (best2) chosen = { r: best2.r, repeats: true };
  if (!chosen) return empty;

  // Reconstruct the chosen multiset, then order it with light variety
  // (repeat copies of one track are never adjacent).
  const from = chosen.repeats ? from2! : from1;
  const prev = chosen.repeats ? prev2! : prev1;
  const counts = new Map<number, number>(); // usable index → copies
  let g = chosen.r;
  while (g > 0 && from[g] >= 0) {
    const i = from[g];
    counts.set(i, (counts.get(i) ?? 0) + 1);
    g = prev[g];
  }
  if (g !== 0) return empty; // reconstruction failed — treat as no fit

  const order = diversify(usable, counts);
  const scheduledReal = order.reduce(
    (s, id) => s + (pool.find((p) => p.driveId === id)?.duration ?? 0),
    0
  );
  const deviation = scheduledReal - gapSeconds;
  const strategy: ArrangeResult["strategy"] = chosen.repeats
    ? Math.abs(deviation) <= EXACT_TOLERANCE_S
      ? "exact-repeat"
      : "near-repeat"
    : Math.abs(deviation) <= EXACT_TOLERANCE_S
      ? "exact-subset"
      : "near-subset";

  return {
    order,
    targetSeconds: gapSeconds,
    scheduledSeconds: Math.round(scheduledReal * 1000) / 1000,
    deviationSeconds: Math.round(deviation * 1000) / 1000,
    exact: Math.abs(deviation) <= EXACT_TOLERANCE_S,
    usedRepeats: chosen.repeats,
    strategy,
  };
}

/**
 * Order the chosen multiset so identical tracks are separated when possible
 * (greedy most-copies-first that differs from the previous pick).
 */
function diversify(usable: { driveId: string; dur: number }[], counts: Map<number, number>): string[] {
  const remaining = new Map(counts);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const out: string[] = [];
  let lastIdx = -1;
  for (let n = 0; n < total; n++) {
    let pick = -1;
    let pickCount = -1;
    for (const [i, c] of remaining) {
      if (c <= 0 || i === lastIdx) continue;
      if (c > pickCount) {
        pick = i;
        pickCount = c;
      }
    }
    if (pick < 0) {
      // Only same-as-last copies remain — unavoidable adjacency.
      for (const [i, c] of remaining) {
        if (c > 0) {
          pick = i;
          break;
        }
      }
    }
    if (pick < 0) break;
    out.push(usable[pick].driveId);
    remaining.set(pick, (remaining.get(pick) ?? 0) - 1);
    lastIdx = pick;
  }
  return out;
}
