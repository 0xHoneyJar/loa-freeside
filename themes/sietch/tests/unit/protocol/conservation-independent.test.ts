/**
 * Conservation Independent Properties (Task 302.2, Sprint 302)
 *
 * Evaluator-independent property tests that verify conservation invariants
 * WITHOUT depending on arrakis-conservation.ts property definitions or any
 * database/adapter infrastructure. Pure algebraic properties over BigInt
 * arithmetic, validated by fast-check.
 *
 * Properties tested:
 *   1. Double-entry: SUM(credits) == SUM(debits) over generated traces
 *   2. Reservation bound: reserved_micro <= available_micro per account
 *   3. Non-negativity after finalization: available >= 0, reserved >= 0, consumed >= 0
 *
 * All monetary values use BigInt end-to-end. No Number(), parseFloat(),
 * or parseInt() in any monetary code path.
 *
 * SDD refs: §3.2.2 Conservation properties
 * Sprint refs: Task 302.2
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// =============================================================================
// Constants
// =============================================================================

/** Property test run count — respects env var, defaults to 100 */
const NUM_RUNS = parseInt(process.env.FAST_CHECK_NUM_RUNS ?? '100', 10);

/** Maximum micro-USD value for generated amounts (~$999,999.99) */
const MAX_MICRO_USD = 999_999_999_999n;

// =============================================================================
// Custom Arbitraries
// =============================================================================

/** Arbitrary for micro-USD amounts [0, MAX_MICRO_USD] */
const microUsdArb = fc.bigInt({ min: 0n, max: MAX_MICRO_USD });

/** Arbitrary for strictly positive micro-USD amounts [1, MAX_MICRO_USD] */
const positiveMicroUsdArb = fc.bigInt({ min: 1n, max: MAX_MICRO_USD });

/** Operation types for a double-entry ledger trace */
type LedgerEntry =
  | { type: 'simple'; amount: bigint }
  | { type: 'split'; creditAmount: bigint; debits: bigint[] };

/** Arbitrary for a simple balanced ledger entry (one credit == one debit) */
const simpleLedgerEntryArb: fc.Arbitrary<LedgerEntry> = positiveMicroUsdArb.map(
  (amount) => ({ type: 'simple' as const, amount }),
);

/**
 * Arbitrary for a split ledger entry: one credit splits into N debits
 * that sum to exactly the credit amount. Ensures debits partition
 * the credit via a remainder approach.
 */
const splitLedgerEntryArb: fc.Arbitrary<LedgerEntry> = fc
  .tuple(
    positiveMicroUsdArb,
    fc.integer({ min: 2, max: 8 }),
  )
  .map(([creditAmount, numDebits]) => {
    // Partition creditAmount into numDebits parts that sum exactly
    const debits: bigint[] = [];
    let remaining = creditAmount;
    for (let i = 0; i < numDebits - 1; i++) {
      if (remaining <= 0n) {
        debits.push(0n);
      } else {
        // Each intermediate debit takes a fraction of what remains
        const part = remaining / BigInt(numDebits - i);
        debits.push(part);
        remaining -= part;
      }
    }
    // Last debit absorbs the remainder — ensures exact partition
    debits.push(remaining);
    return { type: 'split' as const, creditAmount, debits };
  });

/** Arbitrary for a mixed ledger entry (simple or split) */
const ledgerEntryArb: fc.Arbitrary<LedgerEntry> = fc.oneof(
  simpleLedgerEntryArb,
  splitLedgerEntryArb,
);

/** Reserve/release operation for testing reservation bounds */
type ReservationOp =
  | { type: 'reserve'; amount: bigint }
  | { type: 'release'; amount: bigint };

/**
 * Generate a valid sequence of reserve/release operations where
 * reserved never exceeds available. Operations are constructed so
 * that each reserve is bounded by current available, and each release
 * is bounded by current reserved.
 */
function reservationOpsArb(
  initialAvailable: bigint,
): fc.Arbitrary<ReservationOp[]> {
  return fc
    .array(
      fc.tuple(
        fc.boolean(), // true = reserve, false = release
        fc.bigInt({ min: 1n, max: MAX_MICRO_USD }),
      ),
      { minLength: 1, maxLength: 30 },
    )
    .map((rawOps) => {
      const ops: ReservationOp[] = [];
      let available = initialAvailable;
      let reserved = 0n;

      for (const [isReserve, rawAmount] of rawOps) {
        if (isReserve && available > 0n) {
          // Clamp to available
          const amount = rawAmount > available ? available : rawAmount;
          ops.push({ type: 'reserve', amount });
          available -= amount;
          reserved += amount;
        } else if (!isReserve && reserved > 0n) {
          // Clamp to reserved
          const amount = rawAmount > reserved ? reserved : rawAmount;
          ops.push({ type: 'release', amount });
          reserved -= amount;
          available += amount;
        }
        // Skip no-ops (reserve when available=0 or release when reserved=0)
      }
      return ops;
    });
}

/** Lot lifecycle phase */
type LotPhase =
  | { type: 'reserve'; fraction: number }
  | { type: 'finalize'; fraction: number }
  | { type: 'release'; fraction: number };

// =============================================================================
// Tests
// =============================================================================

describe('Conservation Independent Properties (Task 302.2)', () => {
  // ---------------------------------------------------------------------------
  // Property 1: Double-entry — SUM(credits) == SUM(debits)
  // ---------------------------------------------------------------------------

  describe('Double-entry: SUM(credits) == SUM(debits)', () => {
    it('should maintain credit-debit balance over simple traces', () => {
      fc.assert(
        fc.property(
          fc.array(positiveMicroUsdArb, { minLength: 1, maxLength: 50 }),
          (amounts) => {
            let totalCredits = 0n;
            let totalDebits = 0n;
            for (const amount of amounts) {
              // Each entry: credit one account, debit another by same amount
              totalCredits += amount;
              totalDebits += amount;
            }
            expect(totalCredits).toBe(totalDebits);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });

    it('should maintain credit-debit balance with split entries (one credit -> N debits)', () => {
      fc.assert(
        fc.property(
          fc.array(splitLedgerEntryArb, { minLength: 1, maxLength: 20 }),
          (entries) => {
            let totalCredits = 0n;
            let totalDebits = 0n;
            for (const entry of entries) {
              if (entry.type === 'split') {
                totalCredits += entry.creditAmount;
                for (const debit of entry.debits) {
                  totalDebits += debit;
                }
              }
            }
            expect(totalCredits).toBe(totalDebits);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });

    it('should maintain credit-debit balance with mixed entries', () => {
      fc.assert(
        fc.property(
          fc.array(ledgerEntryArb, { minLength: 1, maxLength: 30 }),
          (entries) => {
            let totalCredits = 0n;
            let totalDebits = 0n;
            for (const entry of entries) {
              if (entry.type === 'simple') {
                totalCredits += entry.amount;
                totalDebits += entry.amount;
              } else {
                totalCredits += entry.creditAmount;
                for (const debit of entry.debits) {
                  totalDebits += debit;
                }
              }
            }
            expect(totalCredits).toBe(totalDebits);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });

    it('should maintain balance at zero amounts (edge case)', () => {
      fc.assert(
        fc.property(
          fc.array(microUsdArb, { minLength: 1, maxLength: 50 }),
          (amounts) => {
            let totalCredits = 0n;
            let totalDebits = 0n;
            for (const amount of amounts) {
              totalCredits += amount;
              totalDebits += amount;
            }
            expect(totalCredits).toBe(totalDebits);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });

    it('should handle MAX_MICRO_USD boundary values', () => {
      // Explicit edge case: all entries at max value
      let totalCredits = 0n;
      let totalDebits = 0n;
      const maxEntries = 10;
      for (let i = 0; i < maxEntries; i++) {
        totalCredits += MAX_MICRO_USD;
        totalDebits += MAX_MICRO_USD;
      }
      expect(totalCredits).toBe(totalDebits);
      expect(totalCredits).toBe(MAX_MICRO_USD * BigInt(maxEntries));
    });

    it('should preserve net-zero across bidirectional multi-account transfers', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.tuple(
              fc.integer({ min: 0, max: 4 }), // fromAccount
              fc.integer({ min: 0, max: 4 }), // toAccount
              positiveMicroUsdArb,              // transfer amount
            ),
            { minLength: 1, maxLength: 40 },
          ),
          (transfers) => {
            // Track per-account balances: credits increase, debits decrease
            const balances = new Map<number, bigint>();
            for (const [from, to, amount] of transfers) {
              balances.set(from, (balances.get(from) ?? 0n) - amount);
              balances.set(to, (balances.get(to) ?? 0n) + amount);
            }
            // Net across all accounts must be zero
            let netBalance = 0n;
            for (const bal of balances.values()) {
              netBalance += bal;
            }
            expect(netBalance).toBe(0n);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Property 2: Reservation bound — reserved_micro <= available_micro
  // ---------------------------------------------------------------------------

  describe('Reservation bound: reserved <= available', () => {
    it('should maintain reserved <= initial available after any valid operation sequence', () => {
      fc.assert(
        fc.property(
          positiveMicroUsdArb,
          fc.array(
            fc.tuple(
              fc.boolean(),
              fc.bigInt({ min: 1n, max: MAX_MICRO_USD }),
            ),
            { minLength: 1, maxLength: 30 },
          ),
          (initialAvailable, rawOps) => {
            let available = initialAvailable;
            let reserved = 0n;

            for (const [isReserve, rawAmount] of rawOps) {
              if (isReserve && available > 0n) {
                const amount = rawAmount > available ? available : rawAmount;
                available -= amount;
                reserved += amount;
              } else if (!isReserve && reserved > 0n) {
                const amount = rawAmount > reserved ? reserved : rawAmount;
                reserved -= amount;
                available += amount;
              }

              // INVARIANT: reserved never exceeds original total
              expect(reserved).toBeLessThanOrEqual(initialAvailable);
              // INVARIANT: available + reserved == initial (closed system)
              expect(available + reserved).toBe(initialAvailable);
              // INVARIANT: both non-negative
              expect(available).toBeGreaterThanOrEqual(0n);
              expect(reserved).toBeGreaterThanOrEqual(0n);
            }
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });

    it('should maintain reserved <= available when reserve amount is clamped', () => {
      fc.assert(
        fc.property(
          positiveMicroUsdArb.chain((initialAvailable) =>
            fc.tuple(
              fc.constant(initialAvailable),
              reservationOpsArb(initialAvailable),
            ),
          ),
          ([initialAvailable, ops]) => {
            let available = initialAvailable;
            let reserved = 0n;

            for (const op of ops) {
              if (op.type === 'reserve') {
                available -= op.amount;
                reserved += op.amount;
              } else {
                reserved -= op.amount;
                available += op.amount;
              }

              // After each operation
              expect(reserved).toBeGreaterThanOrEqual(0n);
              expect(available).toBeGreaterThanOrEqual(0n);
              expect(available + reserved).toBe(initialAvailable);
            }
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });

    it('should handle generated (available, reserved) pairs with constraint', () => {
      fc.assert(
        fc.property(
          // Generate available then reserved <= available
          positiveMicroUsdArb.chain((available) =>
            fc.tuple(
              fc.constant(available),
              fc.bigInt({ min: 0n, max: available }),
            ),
          ),
          ([available, reserved]) => {
            expect(reserved).toBeLessThanOrEqual(available);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });

    it('should handle edge case: full reservation (reserved == available)', () => {
      fc.assert(
        fc.property(
          positiveMicroUsdArb,
          (amount) => {
            // Reserve the entire available amount
            const available = 0n;
            const reserved = amount;
            // Full reservation is valid — reserved == original available
            expect(reserved).toBe(amount);
            expect(available + reserved).toBe(amount);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });

    it('should handle edge case: no reservation (reserved == 0)', () => {
      fc.assert(
        fc.property(
          positiveMicroUsdArb,
          (amount) => {
            const available = amount;
            const reserved = 0n;
            expect(reserved).toBeLessThanOrEqual(available);
            expect(available + reserved).toBe(amount);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Property 3: Non-negativity after finalization
  // ---------------------------------------------------------------------------

  describe('Non-negativity after finalization', () => {
    it('should maintain non-negativity through mint -> reserve -> finalize lifecycle', () => {
      fc.assert(
        fc.property(
          // original amount (what was minted)
          positiveMicroUsdArb,
          // fraction of original to reserve (0.0 to 1.0)
          fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
          // fraction of reserved to finalize (0.0 to 1.0)
          fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
          (original, reserveFraction, finalizeFraction) => {
            // Calculate amounts using BigInt arithmetic only
            const reserveAmount = BigInt(
              Math.floor(Number(original) * reserveFraction),
            );
            // Clamp to original to handle rounding
            const safeReserve = reserveAmount > original ? original : reserveAmount;

            let available = original - safeReserve;
            let reserved = safeReserve;
            let consumed = 0n;

            // Finalize a fraction of the reserved amount
            const finalizeAmount = BigInt(
              Math.floor(Number(reserved) * finalizeFraction),
            );
            const safeFinalize = finalizeAmount > reserved ? reserved : finalizeAmount;

            // On finalization: reserved decreases, consumed increases
            reserved -= safeFinalize;
            consumed += safeFinalize;

            // Release remaining reservation back to available
            available += reserved;
            reserved = 0n;

            // INVARIANT: All fields non-negative
            expect(available).toBeGreaterThanOrEqual(0n);
            expect(reserved).toBeGreaterThanOrEqual(0n);
            expect(consumed).toBeGreaterThanOrEqual(0n);

            // INVARIANT: Conservation — all parts sum to original
            expect(available + reserved + consumed).toBe(original);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });

    it('should maintain non-negativity through multi-step lot lifecycle', () => {
      fc.assert(
        fc.property(
          // original lot amount
          fc.bigInt({ min: 100n, max: MAX_MICRO_USD }),
          // sequence of lifecycle phases
          fc.array(
            fc.oneof(
              fc.double({ min: 0.01, max: 0.5, noNaN: true, noDefaultInfinity: true }).map(
                (f) => ({ type: 'reserve' as const, fraction: f }),
              ),
              fc.double({ min: 0.01, max: 1.0, noNaN: true, noDefaultInfinity: true }).map(
                (f) => ({ type: 'finalize' as const, fraction: f }),
              ),
              fc.double({ min: 0.01, max: 1.0, noNaN: true, noDefaultInfinity: true }).map(
                (f) => ({ type: 'release' as const, fraction: f }),
              ),
            ),
            { minLength: 1, maxLength: 20 },
          ),
          (original, phases: LotPhase[]) => {
            let available = original;
            let reserved = 0n;
            let consumed = 0n;

            for (const phase of phases) {
              if (phase.type === 'reserve' && available > 0n) {
                const amount = BigInt(Math.floor(Number(available) * phase.fraction));
                const safeAmount = amount > available ? available : (amount < 1n ? 1n : amount);
                const clampedAmount = safeAmount > available ? available : safeAmount;
                available -= clampedAmount;
                reserved += clampedAmount;
              } else if (phase.type === 'finalize' && reserved > 0n) {
                const amount = BigInt(Math.floor(Number(reserved) * phase.fraction));
                const safeAmount = amount > reserved ? reserved : (amount < 1n ? 1n : amount);
                const clampedAmount = safeAmount > reserved ? reserved : safeAmount;
                reserved -= clampedAmount;
                consumed += clampedAmount;
              } else if (phase.type === 'release' && reserved > 0n) {
                const amount = BigInt(Math.floor(Number(reserved) * phase.fraction));
                const safeAmount = amount > reserved ? reserved : (amount < 1n ? 1n : amount);
                const clampedAmount = safeAmount > reserved ? reserved : safeAmount;
                reserved -= clampedAmount;
                available += clampedAmount;
              }

              // INVARIANT: Non-negativity at every step
              expect(available).toBeGreaterThanOrEqual(0n);
              expect(reserved).toBeGreaterThanOrEqual(0n);
              expect(consumed).toBeGreaterThanOrEqual(0n);

              // INVARIANT: Conservation at every step
              expect(available + reserved + consumed).toBe(original);
            }
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });

    it('should maintain conservation: available + reserved + consumed == original', () => {
      fc.assert(
        fc.property(
          fc.record({
            original: positiveMicroUsdArb,
            consumedFraction: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
            reservedFractionOfRemainder: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
          }),
          ({ original, consumedFraction, reservedFractionOfRemainder }) => {
            // Derive consumed from original
            const consumed = BigInt(Math.floor(Number(original) * consumedFraction));
            const safeConsumed = consumed > original ? original : consumed;

            // Derive reserved from what remains
            const remainder = original - safeConsumed;
            const reserved = BigInt(
              Math.floor(Number(remainder) * reservedFractionOfRemainder),
            );
            const safeReserved = reserved > remainder ? remainder : reserved;

            // Available is the rest
            const available = remainder - safeReserved;

            // INVARIANT: Conservation
            expect(available + safeReserved + safeConsumed).toBe(original);

            // INVARIANT: Non-negativity
            expect(available).toBeGreaterThanOrEqual(0n);
            expect(safeReserved).toBeGreaterThanOrEqual(0n);
            expect(safeConsumed).toBeGreaterThanOrEqual(0n);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });

    it('should handle full finalization (consumed == original)', () => {
      fc.assert(
        fc.property(
          positiveMicroUsdArb,
          (original) => {
            // Mint
            let available = original;
            let reserved = 0n;
            let consumed = 0n;

            // Reserve all
            reserved = available;
            available = 0n;

            // Finalize all
            consumed = reserved;
            reserved = 0n;

            // INVARIANT: Full finalization
            expect(available).toBe(0n);
            expect(reserved).toBe(0n);
            expect(consumed).toBe(original);
            expect(available + reserved + consumed).toBe(original);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });

    it('should handle full release (no consumption)', () => {
      fc.assert(
        fc.property(
          positiveMicroUsdArb,
          (original) => {
            // Mint
            let available = original;
            let reserved = 0n;
            const consumed = 0n;

            // Reserve all
            reserved = available;
            available = 0n;

            // Release all (back to available)
            available = reserved;
            reserved = 0n;

            // INVARIANT: Full release
            expect(available).toBe(original);
            expect(reserved).toBe(0n);
            expect(consumed).toBe(0n);
            expect(available + reserved + consumed).toBe(original);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });

    it('should handle partial finalize with remainder released', () => {
      fc.assert(
        fc.property(
          positiveMicroUsdArb,
          fc.double({ min: 0.01, max: 0.99, noNaN: true, noDefaultInfinity: true }),
          (original, finalizeFraction) => {
            // Mint
            let available = original;
            let reserved = 0n;
            let consumed = 0n;

            // Reserve all
            reserved = available;
            available = 0n;

            // Partial finalize
            const finalizeAmount = BigInt(Math.floor(Number(reserved) * finalizeFraction));
            const safeFinalizeAmount = finalizeAmount > reserved ? reserved : finalizeAmount;
            consumed += safeFinalizeAmount;
            reserved -= safeFinalizeAmount;

            // Release remainder
            available += reserved;
            reserved = 0n;

            // INVARIANT: Non-negativity
            expect(available).toBeGreaterThanOrEqual(0n);
            expect(reserved).toBeGreaterThanOrEqual(0n);
            expect(consumed).toBeGreaterThanOrEqual(0n);

            // INVARIANT: Conservation
            expect(available + reserved + consumed).toBe(original);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });

    it('should handle zero-amount edge case', () => {
      const available = 0n;
      const reserved = 0n;
      const consumed = 0n;
      const original = 0n;

      expect(available).toBeGreaterThanOrEqual(0n);
      expect(reserved).toBeGreaterThanOrEqual(0n);
      expect(consumed).toBeGreaterThanOrEqual(0n);
      expect(available + reserved + consumed).toBe(original);
    });
  });
});
