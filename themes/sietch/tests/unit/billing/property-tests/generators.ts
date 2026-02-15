/**
 * Property Test Generators — Billing Domain
 *
 * fast-check arbitraries for credit lots, reservations, revenue rules,
 * and operation sequences. Used by all property-based tests.
 *
 * Sprint refs: Task 1.1
 */

import fc from 'fast-check';

// =============================================================================
// Constants
// =============================================================================

/** PRD-defined maximum micro-USD value ($1B = 10^15 micro-USD) */
export const MAX_MICRO_USD = 1_000_000_000_000_000n;

/** Minimum lot amount (1 micro-USD) */
export const MIN_LOT_MICRO = 1n;

/** Total basis points (100%) */
export const TOTAL_BPS = 10000;

/** fast-check iteration count — respects FAST_CHECK_NUM_RUNS env var */
export const NUM_RUNS = parseInt(process.env.FAST_CHECK_NUM_RUNS ?? '1000', 10);

// =============================================================================
// Lot Generators
// =============================================================================

/**
 * Generate a valid micro-USD amount in the range [1, MAX_MICRO_USD].
 * Uses bigint arbitrary with explicit bounds.
 */
export function microUsdAmount(max: bigint = MAX_MICRO_USD): fc.Arbitrary<bigint> {
  return fc.bigInt({ min: MIN_LOT_MICRO, max });
}

/**
 * Generate a small micro-USD amount that respects the default system ceiling ($1M).
 * Range: [1, 1_000_000_000_000] ($1M max = DEFAULT_CEILING_MICRO)
 */
export function smallMicroUsdAmount(): fc.Arbitrary<bigint> {
  return fc.bigInt({ min: 1n, max: 1_000_000_000_000n });
}

// =============================================================================
// Operation Generators
// =============================================================================

/** Operations that can be applied to a credit lot */
export type LotOperation =
  | { type: 'reserve'; amount: bigint }
  | { type: 'finalize'; amount: bigint }
  | { type: 'release' }
  | { type: 'expire_tick' };

/**
 * Generate a random lot operation.
 * Amounts are capped at 'maxAmount' to keep operations feasible.
 */
export function lotOperation(maxAmount: bigint): fc.Arbitrary<LotOperation> {
  return fc.oneof(
    fc.bigInt({ min: 1n, max: maxAmount }).map(amount => ({ type: 'reserve' as const, amount })),
    fc.bigInt({ min: 1n, max: maxAmount }).map(amount => ({ type: 'finalize' as const, amount })),
    fc.constant({ type: 'release' as const }),
    fc.constant({ type: 'expire_tick' as const }),
  );
}

/**
 * Generate a sequence of lot operations.
 */
export function lotOperationSequence(maxAmount: bigint, maxOps = 20): fc.Arbitrary<LotOperation[]> {
  return fc.array(lotOperation(maxAmount), { minLength: 1, maxLength: maxOps });
}

// =============================================================================
// Reservation Generators
// =============================================================================

export type ReservationAction =
  | { type: 'finalize'; costFraction: number }
  | { type: 'release' }
  | { type: 'expire_tick' };

/**
 * Generate a reservation terminal action.
 * costFraction ∈ [0.0, 2.0] — allows surplus (< 1.0) and overrun (> 1.0).
 */
export function reservationAction(): fc.Arbitrary<ReservationAction> {
  return fc.oneof(
    fc.double({ min: 0, max: 2.0, noNaN: true }).map(costFraction => ({
      type: 'finalize' as const,
      costFraction,
    })),
    fc.constant({ type: 'release' as const }),
    fc.constant({ type: 'expire_tick' as const }),
  );
}

// =============================================================================
// Revenue Rule Generators
// =============================================================================

export interface GeneratedBpsSplit {
  commonsBps: number;
  communityBps: number;
  foundationBps: number;
}

/**
 * Generate a valid BPS split that sums to 10000.
 * Generates two random values and derives the third.
 */
export function bpsSplit(): fc.Arbitrary<GeneratedBpsSplit> {
  return fc
    .tuple(
      fc.integer({ min: 0, max: TOTAL_BPS }),
      fc.integer({ min: 0, max: TOTAL_BPS }),
    )
    .filter(([a, b]) => a + b <= TOTAL_BPS)
    .map(([commonsBps, communityBps]) => ({
      commonsBps,
      communityBps,
      foundationBps: TOTAL_BPS - commonsBps - communityBps,
    }));
}

export type RuleLifecycleAction =
  | { type: 'propose'; actor: string; split: GeneratedBpsSplit }
  | { type: 'submit'; ruleIndex: number; actor: string }
  | { type: 'approve'; ruleIndex: number; actor: string }
  | { type: 'reject'; ruleIndex: number; actor: string }
  | { type: 'activate_ready' };

/**
 * Generate a revenue rule lifecycle action.
 * ruleIndex selects which rule to operate on (modulo current rule count).
 */
export function ruleLifecycleAction(maxRules = 5): fc.Arbitrary<RuleLifecycleAction> {
  const actor = fc.oneof(fc.constant('admin-a'), fc.constant('admin-b'), fc.constant('admin-c'));
  return fc.oneof(
    fc.tuple(actor, bpsSplit()).map(([a, split]) => ({
      type: 'propose' as const,
      actor: a,
      split,
    })),
    fc.tuple(fc.nat({ max: maxRules - 1 }), actor).map(([i, a]) => ({
      type: 'submit' as const,
      ruleIndex: i,
      actor: a,
    })),
    fc.tuple(fc.nat({ max: maxRules - 1 }), actor).map(([i, a]) => ({
      type: 'approve' as const,
      ruleIndex: i,
      actor: a,
    })),
    fc.tuple(fc.nat({ max: maxRules - 1 }), actor).map(([i, a]) => ({
      type: 'reject' as const,
      ruleIndex: i,
      actor: a,
    })),
    fc.constant({ type: 'activate_ready' as const }),
  );
}

/**
 * Generate a sequence of rule lifecycle actions.
 */
export function ruleLifecycleSequence(maxOps = 30): fc.Arbitrary<RuleLifecycleAction[]> {
  return fc.array(ruleLifecycleAction(), { minLength: 1, maxLength: maxOps });
}

// =============================================================================
// Multi-Lot Generators
// =============================================================================

export interface GeneratedLot {
  amountMicro: bigint;
  createdAtOffset: number;
}

/**
 * Generate N lots with different amounts and creation offsets.
 * Offsets are used to simulate FIFO ordering by created_at.
 */
export function lotSet(count: { min: number; max: number }): fc.Arbitrary<GeneratedLot[]> {
  return fc.array(
    fc.tuple(
      smallMicroUsdAmount(),
      fc.nat({ max: 100000 }),
    ).map(([amountMicro, createdAtOffset]) => ({
      amountMicro,
      createdAtOffset,
    })),
    { minLength: count.min, maxLength: count.max },
  );
}
