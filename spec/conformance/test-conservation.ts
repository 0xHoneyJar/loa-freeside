/**
 * Conservation Invariant Conformance Tests
 *
 * Validates conservation invariants I-1 through I-5 against golden vectors.
 * These are the economic safety properties that must hold at all times.
 *
 * @see spec/vectors/conservation-i1-i5.json
 * @see loa-hounfour v7.0.0 §4: Conservation Invariants
 * @module spec/conformance/test-conservation
 */

import { describe, it, expect } from 'vitest';
import conservationVectors from '../vectors/conservation-i1-i5.json';

// --------------------------------------------------------------------------
// Invariant Checkers (reference implementation)
// --------------------------------------------------------------------------

const MICRO_PER_CENT = 10_000n;

/**
 * I-1: committed + reserved + available = limit
 * available = limit - committed - reserved (derived)
 */
function checkI1(limitCents: bigint, committedCents: bigint, reservedCents: bigint): {
  pass: boolean;
  availableCents: bigint;
} {
  const available = limitCents - committedCents - reservedCents;
  return {
    pass: available >= 0n,
    availableCents: available,
  };
}

/**
 * I-2: SUM(credits) - SUM(debits) = remaining (per lot)
 */
function checkI2(entries: Array<{ entry_type: string; amount_micro: number }>): {
  pass: boolean;
  totalCredits: bigint;
  totalDebits: bigint;
  remaining: bigint;
} {
  let totalCredits = 0n;
  let totalDebits = 0n;

  for (const entry of entries) {
    if (entry.entry_type === 'credit') {
      totalCredits += BigInt(entry.amount_micro);
    } else {
      totalDebits += BigInt(entry.amount_micro);
    }
  }

  const remaining = totalCredits - totalDebits;
  return {
    pass: remaining >= 0n,
    totalCredits,
    totalDebits,
    remaining,
  };
}

/**
 * I-3: Redis.committed ≈ Postgres.SUM(usage_events.amount_micro)
 */
function checkI3(
  redisCommittedCents: bigint,
  pgCommittedMicro: bigint,
  limitMicro: bigint,
  driftTolerancePercent: number,
): {
  pass: boolean;
  driftMicro: bigint;
  toleranceMicro: bigint;
} {
  const redisCommittedMicro = redisCommittedCents * MICRO_PER_CENT;
  const drift = redisCommittedMicro > pgCommittedMicro
    ? redisCommittedMicro - pgCommittedMicro
    : pgCommittedMicro - redisCommittedMicro;

  const toleranceMicro = limitMicro > 0n
    ? BigInt(Math.floor(Number(limitMicro) * driftTolerancePercent))
    : 100_000n;

  return {
    pass: drift <= toleranceMicro,
    driftMicro: drift,
    toleranceMicro,
  };
}

/**
 * I-4: Fence tokens are strictly monotonic
 */
function checkI4Monotonic(tokens: number[]): boolean {
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] <= tokens[i - 1]) return false;
  }
  return true;
}

function checkI4Advance(lastToken: bigint, attemptToken: bigint): boolean {
  return attemptToken > lastToken;
}

/**
 * I-5: Finalization idempotency (finalization_id UNIQUE)
 */
function checkI5(finalizationId: string, existingIds: string[]): 'FINALIZED' | 'DUPLICATE' {
  return existingIds.includes(finalizationId) ? 'DUPLICATE' : 'FINALIZED';
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('Conservation Invariants — Golden Vectors', () => {
  const vectors = conservationVectors.vectors;

  describe('I-1: committed + reserved + available = limit', () => {
    for (const v of vectors.filter(v => v.invariant_id === 'I-1')) {
      it(`${v.id}: ${v.description}`, () => {
        const result = checkI1(
          BigInt(v.input.limit_cents!),
          BigInt(v.input.committed_cents!),
          BigInt(v.input.reserved_cents!),
        );
        expect(result.pass).toBe(v.expected_pass);
        expect(result.availableCents).toBe(BigInt(v.derived!.available_cents));
      });
    }
  });

  describe('I-2: SUM(lot_entries) per lot = credits - debits', () => {
    for (const v of vectors.filter(v => v.invariant_id === 'I-2')) {
      it(`${v.id}: ${v.description}`, () => {
        const result = checkI2(v.input.entries!);
        expect(result.pass).toBe(v.expected_pass);
        expect(result.totalCredits).toBe(BigInt(v.expected!.total_credits));
        expect(result.totalDebits).toBe(BigInt(v.expected!.total_debits));
        expect(result.remaining).toBe(BigInt(v.expected!.remaining));
      });
    }
  });

  describe('I-3: Redis.committed ≈ Postgres committed', () => {
    for (const v of vectors.filter(v => v.invariant_id === 'I-3')) {
      it(`${v.id}: ${v.description}`, () => {
        const result = checkI3(
          BigInt(v.input.redis_committed_cents!),
          BigInt(v.input.pg_committed_micro!),
          BigInt(v.input.limit_micro!),
          v.input.drift_tolerance_percent!,
        );
        expect(result.pass).toBe(v.expected_pass);
        expect(result.driftMicro).toBe(BigInt(v.derived!.drift_micro));
        expect(result.toleranceMicro).toBe(BigInt(v.derived!.tolerance_micro));
      });
    }
  });

  describe('I-4: Fence tokens strictly monotonic', () => {
    it('CI-011: monotonic sequence passes', () => {
      const v = vectors.find(v => v.id === 'CI-011')!;
      expect(checkI4Monotonic(v.input.fence_sequence!)).toBe(true);
    });

    it('CI-012: stale fence token rejected', () => {
      const v = vectors.find(v => v.id === 'CI-012')!;
      expect(checkI4Advance(
        BigInt(v.input.last_fence_token!),
        BigInt(v.input.attempted_fence_token!),
      )).toBe(false);
    });

    it('CI-013: duplicate fence token rejected', () => {
      const v = vectors.find(v => v.id === 'CI-013')!;
      expect(checkI4Advance(
        BigInt(v.input.last_fence_token!),
        BigInt(v.input.attempted_fence_token!),
      )).toBe(false);
    });
  });

  describe('I-5: Finalization idempotency', () => {
    it('CI-014: first finalization succeeds', () => {
      const v = vectors.find(v => v.id === 'CI-014')!;
      expect(checkI5(v.input.finalization_id!, v.input.existing_ids!)).toBe(v.expected_result);
    });

    it('CI-015: duplicate finalization returns DUPLICATE', () => {
      const v = vectors.find(v => v.id === 'CI-015')!;
      expect(checkI5(v.input.finalization_id!, v.input.existing_ids!)).toBe(v.expected_result);
    });
  });
});
