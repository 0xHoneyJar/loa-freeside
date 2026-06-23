/**
 * Tier — the settlement ladder. (T1.1)
 *
 * `claimed → pinned → settled` is the positive proceed-ladder (total order).
 * `abstained` is OFF the ladder: terminal-insufficient, distinct from a not-yet
 * evaluated state. It never satisfies a positive required tier (it sits below
 * `claimed`), which is what makes "abstain over fabricate" fail-closed.
 *
 * Ported in spirit from loa-finn `spine-event.ts`.
 */
export type Tier = "claimed" | "pinned" | "settled" | "abstained";

/**
 * Rank on the proceed-ladder. `abstained` is -1 (below everything positive) so
 * that `tierGte(abstained, anyPositive)` is false — settlement cannot be reached
 * by abstaining. `tierGte(settled, claimed)` is true (2 >= 0).
 */
const TIER_RANK: Record<Tier, number> = {
  abstained: -1,
  claimed: 0,
  pinned: 1,
  settled: 2,
};

export function tierRank(t: Tier): number {
  return TIER_RANK[t];
}

/** Total-order comparison on the ladder: is `a` at least as high as `b`? */
export function tierGte(a: Tier, b: Tier): boolean {
  return TIER_RANK[a] >= TIER_RANK[b];
}

/** True iff `t` is the terminal-insufficient tier (off the positive ladder). */
export function isTerminal(t: Tier): boolean {
  return t === "abstained";
}

/**
 * TetlockForecast — calibrated confidence in **integer parts-per-million**.
 * No floats anywhere (loa-finn `tetlock-forecast.ts` discipline): a probability
 * is `probability_ppm` in `[0, 1_000_000]`. Brier/base-rate likewise integer ppm.
 */
export interface TetlockForecast {
  readonly probability_ppm: number;
  readonly base_rate_ppm: number | null;
  readonly brier_ppm: number | null;
}

const PPM_MAX = 1_000_000;

/** Throws unless `n` is an integer in `[0, 1_000_000]`. Rejects floats (G-1/T1.1). */
export function assertPpm(n: number, field: string): void {
  if (!Number.isInteger(n)) {
    throw new TypeError(`${field} must be an integer ppm (no floats), got ${n}`);
  }
  if (n < 0 || n > PPM_MAX) {
    throw new RangeError(`${field} out of [0, ${PPM_MAX}] ppm range: ${n}`);
  }
}

/** Construct a validated TetlockForecast; throws on any non-integer/out-of-range ppm. */
export function makeTetlockForecast(
  probability_ppm: number,
  base_rate_ppm: number | null = null,
  brier_ppm: number | null = null,
): TetlockForecast {
  assertPpm(probability_ppm, "probability_ppm");
  if (base_rate_ppm !== null) assertPpm(base_rate_ppm, "base_rate_ppm");
  if (brier_ppm !== null) assertPpm(brier_ppm, "brier_ppm");
  return { probability_ppm, base_rate_ppm, brier_ppm };
}

/**
 * TierStamp — the provenance-bearing tier assertion attached at a seam.
 * `verify_ref` points at the evidence that earned the tier (a snapshot id,
 * audit-chain ref, or instrument re-exec handle) — never the producer's word.
 */
export interface TierStamp {
  readonly tier: Tier;
  readonly provenance: {
    readonly by: string;
    readonly at_ppm: number; // integer logical timestamp (no Date.now in pure code)
    readonly instrument_id: string;
    readonly instrument_sha: string;
  };
  readonly confidence: TetlockForecast;
  readonly verify_ref: string;
}
