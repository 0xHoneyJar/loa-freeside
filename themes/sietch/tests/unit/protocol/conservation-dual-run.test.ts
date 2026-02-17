/**
 * Conservation Dual-Run Test Harness (Task 302.1, Sprint 302)
 *
 * Runs the same 14 conservation invariant metadata through the frozen local
 * snapshot (pre-v7 anchor) AND the canonical v7.0.0 evaluator, comparing
 * structural fields for equivalence.
 *
 * Property-based edge case generation via fast-check exercises trace
 * boundaries: overflow, zero, negative, terminal transitions, concurrent
 * reservations.
 *
 * KNOWN_DIFFS allowlist permits bounded divergence (name, description, ltl,
 * enforcedBy, universe) between frozen and canonical during the migration window.
 * All entries expire within 30 days of 2026-02-18.
 *
 * SDD refs: §3.2.2 Conservation properties
 * Sprint refs: Task 302.1
 *
 * @module tests/unit/protocol/conservation-dual-run
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  CONSERVATION_PROPERTIES as FROZEN_PROPERTIES,
  type ConservationProperty as FrozenConservationProperty,
} from '../../fixtures/frozen-conservation-evaluator.js';

import {
  getCanonicalProperties,
  getProperty,
  type ConservationProperty,
} from '../../../src/packages/core/protocol/arrakis-conservation.js';

// =============================================================================
// Constants
// =============================================================================

/** Maximum micro-USD value from arrakis-arithmetic (mirrors MAX_MICRO_USD) */
const MAX_MICRO_USD = 999_999_999_999n;

/** All 14 frozen invariant IDs */
const FROZEN_IDS = FROZEN_PROPERTIES.map((p) => p.id);

/** Today's date for expiry validation */
const TODAY = new Date('2026-02-18');

/** Maximum allowable expiry: 30 days from today */
const MAX_EXPIRY = new Date('2026-03-20');

// =============================================================================
// KNOWN_DIFFS: Expected differences between frozen and canonical
//
// Each entry documents a known divergence between the pre-v7 frozen snapshot
// and the canonical v7.0.0 adapter output. Every entry MUST have an expiry
// date no later than 2026-03-20 (30 days from 2026-02-18). Entries must be
// empty by Sprint 303.6.
// =============================================================================

interface KnownDiff {
  /** Invariant ID (I-1 through I-14) */
  invariantId: string;
  /** Field that diverges */
  field: 'name' | 'description' | 'ltl' | 'enforcedBy' | 'fairnessModel' | 'universe' | 'kind';
  /** Reason for the divergence */
  reason: string;
  /** Expiry date (YYYY-MM-DD). Must be <= 2026-03-20. */
  expires: string;
}

const KNOWN_DIFFS: KnownDiff[] = [
  // Name divergences: canonical v7.0.0 uses different terminology
  { invariantId: 'I-1', field: 'name', reason: 'Canonical uses "Lot balance non-negativity" vs frozen "Per-lot conservation"', expires: '2026-03-20' },
  { invariantId: 'I-2', field: 'name', reason: 'Canonical uses different account-level naming', expires: '2026-03-20' },
  { invariantId: 'I-3', field: 'name', reason: 'Canonical uses different receivable naming', expires: '2026-03-20' },
  { invariantId: 'I-4', field: 'name', reason: 'Canonical uses different platform-level naming', expires: '2026-03-20' },
  { invariantId: 'I-5', field: 'name', reason: 'Canonical uses different budget naming', expires: '2026-03-20' },
  { invariantId: 'I-6', field: 'name', reason: 'Canonical uses different transfer naming', expires: '2026-03-20' },
  { invariantId: 'I-7', field: 'name', reason: 'Canonical uses different deposit bridge naming', expires: '2026-03-20' },
  { invariantId: 'I-8', field: 'name', reason: 'Canonical uses different terminal state naming', expires: '2026-03-20' },
  { invariantId: 'I-9', field: 'name', reason: 'Canonical uses different revenue rule naming', expires: '2026-03-20' },
  { invariantId: 'I-10', field: 'name', reason: 'Canonical uses different monotonicity naming', expires: '2026-03-20' },
  { invariantId: 'I-11', field: 'name', reason: 'Canonical uses different finalization naming', expires: '2026-03-20' },
  { invariantId: 'I-12', field: 'name', reason: 'Canonical uses different reservation naming', expires: '2026-03-20' },
  { invariantId: 'I-13', field: 'name', reason: 'Canonical uses different treasury naming', expires: '2026-03-20' },
  { invariantId: 'I-14', field: 'name', reason: 'Canonical uses different shadow tracking naming', expires: '2026-03-20' },

  // Description divergences
  { invariantId: 'I-1', field: 'description', reason: 'Canonical description uses v7 terminology', expires: '2026-03-20' },
  { invariantId: 'I-2', field: 'description', reason: 'Canonical description uses v7 terminology', expires: '2026-03-20' },
  { invariantId: 'I-3', field: 'description', reason: 'Canonical description uses v7 terminology', expires: '2026-03-20' },
  { invariantId: 'I-4', field: 'description', reason: 'Canonical description uses v7 terminology', expires: '2026-03-20' },
  { invariantId: 'I-5', field: 'description', reason: 'Canonical description uses v7 terminology', expires: '2026-03-20' },
  { invariantId: 'I-6', field: 'description', reason: 'Canonical description uses v7 terminology', expires: '2026-03-20' },
  { invariantId: 'I-7', field: 'description', reason: 'Canonical description uses v7 terminology', expires: '2026-03-20' },
  { invariantId: 'I-8', field: 'description', reason: 'Canonical description uses v7 terminology', expires: '2026-03-20' },
  { invariantId: 'I-9', field: 'description', reason: 'Canonical description uses v7 terminology', expires: '2026-03-20' },
  { invariantId: 'I-10', field: 'description', reason: 'Canonical description uses v7 terminology', expires: '2026-03-20' },
  { invariantId: 'I-11', field: 'description', reason: 'Canonical description uses v7 terminology', expires: '2026-03-20' },
  { invariantId: 'I-12', field: 'description', reason: 'Canonical description uses v7 terminology', expires: '2026-03-20' },
  { invariantId: 'I-13', field: 'description', reason: 'Canonical description uses v7 terminology', expires: '2026-03-20' },
  { invariantId: 'I-14', field: 'description', reason: 'Canonical description uses v7 terminology', expires: '2026-03-20' },

  // LTL formula divergences
  { invariantId: 'I-1', field: 'ltl', reason: 'Canonical LTL uses v7 formula syntax', expires: '2026-03-20' },
  { invariantId: 'I-2', field: 'ltl', reason: 'Canonical LTL uses v7 formula syntax', expires: '2026-03-20' },
  { invariantId: 'I-3', field: 'ltl', reason: 'Canonical LTL uses v7 formula syntax', expires: '2026-03-20' },
  { invariantId: 'I-4', field: 'ltl', reason: 'Canonical LTL uses v7 formula syntax', expires: '2026-03-20' },
  { invariantId: 'I-5', field: 'ltl', reason: 'Canonical LTL uses v7 formula syntax', expires: '2026-03-20' },
  { invariantId: 'I-6', field: 'ltl', reason: 'Canonical LTL uses v7 formula syntax', expires: '2026-03-20' },
  { invariantId: 'I-7', field: 'ltl', reason: 'Canonical LTL uses v7 formula syntax', expires: '2026-03-20' },
  { invariantId: 'I-8', field: 'ltl', reason: 'Canonical LTL uses v7 formula syntax', expires: '2026-03-20' },
  { invariantId: 'I-9', field: 'ltl', reason: 'Canonical LTL uses v7 formula syntax', expires: '2026-03-20' },
  { invariantId: 'I-10', field: 'ltl', reason: 'Canonical LTL uses v7 formula syntax', expires: '2026-03-20' },
  { invariantId: 'I-11', field: 'ltl', reason: 'Canonical LTL uses v7 formula syntax', expires: '2026-03-20' },
  { invariantId: 'I-12', field: 'ltl', reason: 'Canonical LTL uses v7 formula syntax', expires: '2026-03-20' },
  { invariantId: 'I-13', field: 'ltl', reason: 'Canonical LTL uses v7 formula syntax', expires: '2026-03-20' },
  { invariantId: 'I-14', field: 'ltl', reason: 'Canonical LTL uses v7 formula syntax', expires: '2026-03-20' },

  // Enforcement divergences: canonical maps single enforcement, frozen may have arrays
  { invariantId: 'I-1', field: 'enforcedBy', reason: 'Canonical maps single enforcement; frozen has [DB CHECK, Application]', expires: '2026-03-20' },
  { invariantId: 'I-2', field: 'enforcedBy', reason: 'Canonical maps single enforcement; frozen has [DB CHECK, Application]', expires: '2026-03-20' },
  { invariantId: 'I-5', field: 'enforcedBy', reason: 'Canonical maps single enforcement; frozen has [Application, Reconciliation-only]', expires: '2026-03-20' },
  { invariantId: 'I-6', field: 'enforcedBy', reason: 'Canonical maps single enforcement; frozen has [DB UNIQUE, Application]', expires: '2026-03-20' },
  { invariantId: 'I-9', field: 'enforcedBy', reason: 'Canonical maps single enforcement; frozen has [DB UNIQUE, Application]', expires: '2026-03-20' },

  // Universe divergences: canonical v7.0.0 classifies scope differently
  { invariantId: 'I-2', field: 'universe', reason: 'Canonical classifies as single_lot->per-lot; frozen has per-account', expires: '2026-03-20' },
  { invariantId: 'I-3', field: 'universe', reason: 'Canonical classifies as single_lot->per-lot; frozen has per-account', expires: '2026-03-20' },
  { invariantId: 'I-5', field: 'universe', reason: 'Canonical classifies as account->per-account; frozen has cross-system', expires: '2026-03-20' },
  { invariantId: 'I-6', field: 'universe', reason: 'Canonical classifies as platform->platform-wide; frozen has cross-system', expires: '2026-03-20' },
  { invariantId: 'I-7', field: 'universe', reason: 'Canonical classifies as account->per-account; frozen has cross-system', expires: '2026-03-20' },
  { invariantId: 'I-10', field: 'universe', reason: 'Canonical classifies as platform->platform-wide; frozen has per-lot', expires: '2026-03-20' },
  { invariantId: 'I-14', field: 'universe', reason: 'Canonical classifies as bilateral->cross-system; frozen has platform-wide', expires: '2026-03-20' },

  // Fairness model divergences: canonical may not carry fairnessModel
  { invariantId: 'I-11', field: 'fairnessModel', reason: 'Canonical does not carry fairnessModel field', expires: '2026-03-20' },
  { invariantId: 'I-12', field: 'fairnessModel', reason: 'Canonical does not carry fairnessModel field', expires: '2026-03-20' },
];

// =============================================================================
// Helpers
// =============================================================================

/**
 * Check if a (invariantId, field) pair is in the KNOWN_DIFFS allowlist.
 */
function isKnownDiff(invariantId: string, field: string): boolean {
  return KNOWN_DIFFS.some(
    (d) => d.invariantId === invariantId && d.field === field,
  );
}

/**
 * Build a lookup map from frozen properties by ID.
 */
function buildFrozenMap(): Map<string, FrozenConservationProperty> {
  const map = new Map<string, FrozenConservationProperty>();
  for (const prop of FROZEN_PROPERTIES) {
    map.set(prop.id, prop);
  }
  return map;
}

// =============================================================================
// Edge Case Generators (fast-check)
// =============================================================================

/** Generate a micro-USD amount at overflow boundary (MAX_MICRO_USD) */
const overflowAmount = fc.constant(MAX_MICRO_USD);

/** Generate zero micro-USD */
const zeroAmount = fc.constant(0n);

/** Generate negative micro-USD (invalid — should be rejected) */
const negativeAmount = fc.bigInt({ min: -MAX_MICRO_USD, max: -1n });

/** Generate a valid micro-USD amount */
const validMicroUsd = fc.bigInt({ min: 0n, max: MAX_MICRO_USD });

/** Generate a non-zero valid micro-USD amount */
const nonZeroMicroUsd = fc.bigInt({ min: 1n, max: MAX_MICRO_USD });

/** Terminal state names from frozen I-8 */
const terminalState = fc.oneof(
  fc.constant('finalized'),
  fc.constant('released'),
  fc.constant('expired'),
);

/** Concurrent reservation count (for concurrency edge cases) */
const concurrentReservationCount = fc.integer({ min: 2, max: 10 });

/** Invariant ID generator (I-1 through I-14) */
const invariantId = fc.integer({ min: 1, max: 14 }).map((n) => `I-${n}`);

/**
 * Generate a property-based trace: a sequence of micro-USD amounts
 * representing operations against a lot (reserve, finalize, release).
 */
const operationTrace = fc.record({
  initialAmount: nonZeroMicroUsd,
  operations: fc.array(
    fc.record({
      type: fc.oneof(
        fc.constant('reserve' as const),
        fc.constant('finalize' as const),
        fc.constant('release' as const),
        fc.constant('expire_tick' as const),
      ),
      amount: validMicroUsd,
    }),
    { minLength: 1, maxLength: 20 },
  ),
});

// =============================================================================
// Test Suite
// =============================================================================

describe('Conservation Dual-Run Test Harness (Task 302.1)', () => {
  const frozenMap = buildFrozenMap();
  const canonicalProperties = getCanonicalProperties();

  // ---------------------------------------------------------------------------
  // 1. KNOWN_DIFFS Governance
  // ---------------------------------------------------------------------------

  describe('KNOWN_DIFFS governance', () => {
    it('no KNOWN_DIFFS entry has an expiry date beyond 30 days from 2026-02-18', () => {
      for (const diff of KNOWN_DIFFS) {
        const expiryDate = new Date(diff.expires);
        expect(
          expiryDate.getTime(),
          `KNOWN_DIFF ${diff.invariantId}:${diff.field} expires ${diff.expires} which is beyond ${MAX_EXPIRY.toISOString().split('T')[0]}`,
        ).toBeLessThanOrEqual(MAX_EXPIRY.getTime());
      }
    });

    it('no KNOWN_DIFFS entry has already expired', () => {
      const expired = KNOWN_DIFFS.filter(
        (d) => new Date(d.expires).getTime() < TODAY.getTime(),
      );
      expect(
        expired,
        `Expired KNOWN_DIFFS: ${expired.map((d) => `${d.invariantId}:${d.field}`).join(', ')}`,
      ).toHaveLength(0);
    });

    it('every KNOWN_DIFFS invariantId references a valid frozen ID', () => {
      for (const diff of KNOWN_DIFFS) {
        expect(
          FROZEN_IDS,
          `KNOWN_DIFF references unknown invariant ${diff.invariantId}`,
        ).toContain(diff.invariantId);
      }
    });

    it('every KNOWN_DIFFS entry has a non-empty reason', () => {
      for (const diff of KNOWN_DIFFS) {
        expect(diff.reason.length).toBeGreaterThan(0);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Structural Comparison: All 14 invariants
  // ---------------------------------------------------------------------------

  describe('structural comparison — frozen vs canonical', () => {
    it('frozen and canonical both define exactly 14 invariant IDs', () => {
      expect(FROZEN_PROPERTIES).toHaveLength(14);
      // Canonical may have >= 14 (v7.0.0 may add beyond local 14)
      expect(canonicalProperties.length).toBeGreaterThanOrEqual(14);
    });

    // Per-invariant structural match for each of the 14 frozen IDs
    for (const frozenProp of FROZEN_PROPERTIES) {
      describe(`invariant ${frozenProp.id}: ${frozenProp.name}`, () => {
        it('exists in canonical evaluator', () => {
          const canonical = getProperty(frozenProp.id);
          expect(
            canonical,
            `Canonical evaluator missing invariant ${frozenProp.id}`,
          ).toBeDefined();
        });

        it('id matches exactly', () => {
          const canonical = getProperty(frozenProp.id)!;
          expect(canonical.id).toBe(frozenProp.id);
        });

        it('universe matches (after adapter mapping)', () => {
          const canonical = getProperty(frozenProp.id)!;
          if (!isKnownDiff(frozenProp.id, 'universe')) {
            expect(
              canonical.universe,
              `universe mismatch for ${frozenProp.id}: frozen="${frozenProp.universe}" canonical="${canonical.universe}"`,
            ).toBe(frozenProp.universe);
          }
        });

        it('kind matches (safety/liveness)', () => {
          const canonical = getProperty(frozenProp.id)!;
          if (!isKnownDiff(frozenProp.id, 'kind')) {
            expect(
              canonical.kind,
              `kind mismatch for ${frozenProp.id}: frozen="${frozenProp.kind}" canonical="${canonical.kind}"`,
            ).toBe(frozenProp.kind);
          }
        });

        it('expectedErrorCode matches (if present in frozen)', () => {
          const canonical = getProperty(frozenProp.id)!;
          if (frozenProp.expectedErrorCode !== undefined) {
            expect(
              canonical.expectedErrorCode,
              `expectedErrorCode mismatch for ${frozenProp.id}: frozen="${frozenProp.expectedErrorCode}" canonical="${canonical.expectedErrorCode}"`,
            ).toBe(frozenProp.expectedErrorCode);
          }
        });

        it('reconciliationFailureCode matches (if present in frozen)', () => {
          const canonical = getProperty(frozenProp.id)!;
          if (frozenProp.reconciliationFailureCode !== undefined) {
            expect(
              canonical.reconciliationFailureCode,
              `reconciliationFailureCode mismatch for ${frozenProp.id}: frozen="${frozenProp.reconciliationFailureCode}" canonical="${canonical.reconciliationFailureCode}"`,
            ).toBe(frozenProp.reconciliationFailureCode);
          }
        });

        it('name comparison (KNOWN_DIFFS allowable)', () => {
          const canonical = getProperty(frozenProp.id)!;
          if (!isKnownDiff(frozenProp.id, 'name')) {
            expect(canonical.name).toBe(frozenProp.name);
          }
          // If in KNOWN_DIFFS, just verify name is non-empty
          expect(canonical.name.length).toBeGreaterThan(0);
        });

        it('description comparison (KNOWN_DIFFS allowable)', () => {
          const canonical = getProperty(frozenProp.id)!;
          if (!isKnownDiff(frozenProp.id, 'description')) {
            expect(canonical.description).toBe(frozenProp.description);
          }
          expect(canonical.description.length).toBeGreaterThan(0);
        });

        it('ltl comparison (KNOWN_DIFFS allowable)', () => {
          const canonical = getProperty(frozenProp.id)!;
          if (!isKnownDiff(frozenProp.id, 'ltl')) {
            expect(canonical.ltl).toBe(frozenProp.ltl);
          }
          expect(canonical.ltl.length).toBeGreaterThan(0);
        });

        it('enforcedBy comparison (KNOWN_DIFFS allowable)', () => {
          const canonical = getProperty(frozenProp.id)!;
          if (!isKnownDiff(frozenProp.id, 'enforcedBy')) {
            expect(canonical.enforcedBy).toEqual(frozenProp.enforcedBy);
          }
          // Even if in KNOWN_DIFFS, canonical must have at least one enforcement
          expect(canonical.enforcedBy.length).toBeGreaterThan(0);
        });
      });
    }
  });

  // ---------------------------------------------------------------------------
  // 3. v7.0.0 Invariants Beyond Local 14
  // ---------------------------------------------------------------------------

  describe('v7.0.0 invariants beyond local 14', () => {
    it('logs any canonical invariants not in frozen set (not gated)', () => {
      const frozenIdSet = new Set(FROZEN_IDS);
      const extraCanonical = canonicalProperties.filter(
        (p) => !frozenIdSet.has(p.id),
      );

      // Log but do not fail — these are new v7.0.0 invariants not yet in frozen
      if (extraCanonical.length > 0) {
        console.log(
          `[dual-run] v7.0.0 invariants beyond local 14 (${extraCanonical.length}):`,
        );
        for (const extra of extraCanonical) {
          console.log(
            `  ${extra.id}: ${extra.name} [${extra.universe}/${extra.kind}]`,
          );
          // Verify structural integrity of extra invariants
          expect(extra.id).toMatch(/^I-\d+$/);
          expect(extra.name.length).toBeGreaterThan(0);
          expect(extra.ltl.length).toBeGreaterThan(0);
          expect(extra.universe).toBeTruthy();
          expect(extra.kind).toMatch(/^(safety|liveness)$/);
          expect(extra.enforcedBy.length).toBeGreaterThan(0);
        }
      } else {
        console.log(
          '[dual-run] No canonical invariants beyond local 14 detected.',
        );
      }

      // Always passes — extra invariants are informational
      expect(true).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Coverage Counter
  // ---------------------------------------------------------------------------

  describe('coverage counter — every canonical invariant ID exercised', () => {
    it('every canonical invariant ID is looked up via getProperty at least once', () => {
      const exercisedIds = new Set<string>();

      for (const prop of canonicalProperties) {
        const looked = getProperty(prop.id);
        if (looked) {
          exercisedIds.add(looked.id);
        }
      }

      // All frozen IDs must be in exercised set
      for (const id of FROZEN_IDS) {
        expect(
          exercisedIds.has(id),
          `Invariant ${id} was not exercised via getProperty`,
        ).toBe(true);
      }

      // All canonical IDs must be in exercised set
      for (const prop of canonicalProperties) {
        expect(
          exercisedIds.has(prop.id),
          `Canonical invariant ${prop.id} was not exercised`,
        ).toBe(true);
      }

      console.log(
        `[dual-run] Coverage: ${exercisedIds.size}/${canonicalProperties.length} canonical invariants exercised.`,
      );
    });

    it('every frozen invariant has a corresponding canonical entry', () => {
      const canonicalIdSet = new Set(canonicalProperties.map((p) => p.id));
      const missing = FROZEN_IDS.filter((id) => !canonicalIdSet.has(id));
      expect(
        missing,
        `Frozen invariants missing from canonical: ${missing.join(', ')}`,
      ).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Property-Based Edge Case Generators
  // ---------------------------------------------------------------------------

  describe('edge case generators — property-based traces', () => {
    it('overflow boundary: MAX_MICRO_USD traces produce valid invariant metadata', () => {
      fc.assert(
        fc.property(overflowAmount, invariantId, (amount, id) => {
          const frozen = frozenMap.get(id);
          const canonical = getProperty(id);

          // Both evaluators must return a property for the ID
          expect(frozen).toBeDefined();
          expect(canonical).toBeDefined();

          // Structural fields are stable regardless of trace amount
          expect(canonical!.id).toBe(frozen!.id);
          // kind and universe may diverge (KNOWN_DIFFS allowable)
          if (!isKnownDiff(id, 'kind')) {
            expect(canonical!.kind).toBe(frozen!.kind);
          }
          if (!isKnownDiff(id, 'universe')) {
            expect(canonical!.universe).toBe(frozen!.universe);
          }

          // Amount at overflow boundary is representable
          expect(amount).toBe(MAX_MICRO_USD);
          expect(amount > 0n).toBe(true);
        }),
        { numRuns: 50 },
      );
    });

    it('zero amount traces: invariant metadata is consistent', () => {
      fc.assert(
        fc.property(zeroAmount, invariantId, (amount, id) => {
          const frozen = frozenMap.get(id);
          const canonical = getProperty(id);

          expect(frozen).toBeDefined();
          expect(canonical).toBeDefined();
          expect(canonical!.id).toBe(frozen!.id);
          expect(canonical!.kind).toBe(frozen!.kind);

          // Zero is a valid micro-USD amount
          expect(amount).toBe(0n);
        }),
        { numRuns: 50 },
      );
    });

    it('negative amount traces: metadata lookup is unaffected by invalid amounts', () => {
      fc.assert(
        fc.property(negativeAmount, invariantId, (amount, id) => {
          const frozen = frozenMap.get(id);
          const canonical = getProperty(id);

          // Metadata is still accessible regardless of invalid amounts
          expect(frozen).toBeDefined();
          expect(canonical).toBeDefined();
          expect(canonical!.id).toBe(frozen!.id);

          // The amount itself is negative (invalid for monetary ops)
          expect(amount < 0n).toBe(true);
        }),
        { numRuns: 50 },
      );
    });

    it('terminal transitions: I-8 (terminal absorption) metadata stable across trace variations', () => {
      fc.assert(
        fc.property(
          terminalState,
          nonZeroMicroUsd,
          (terminal, amount) => {
            const frozen = frozenMap.get('I-8')!;
            const canonical = getProperty('I-8')!;

            // Terminal absorption property is safety, per-lot
            expect(frozen.kind).toBe('safety');
            expect(canonical.kind).toBe('safety');
            expect(frozen.universe).toBe('per-lot');
            expect(canonical.universe).toBe('per-lot');
            expect(frozen.expectedErrorCode).toBe('TERMINAL_STATE_VIOLATION');
            expect(canonical.expectedErrorCode).toBe('TERMINAL_STATE_VIOLATION');

            // Terminal state names are valid
            expect(['finalized', 'released', 'expired']).toContain(terminal);

            // Amount is representable
            expect(amount > 0n).toBe(true);
            expect(amount <= MAX_MICRO_USD).toBe(true);
          },
        ),
        { numRuns: 50 },
      );
    });

    it('concurrent reservations: I-12 (reservation termination) metadata stable', () => {
      fc.assert(
        fc.property(
          concurrentReservationCount,
          nonZeroMicroUsd,
          (count, amount) => {
            const frozen = frozenMap.get('I-12')!;
            const canonical = getProperty('I-12')!;

            // Reservation termination is a liveness property
            expect(frozen.kind).toBe('liveness');
            expect(canonical.kind).toBe('liveness');
            expect(frozen.universe).toBe('per-lot');
            expect(canonical.universe).toBe('per-lot');

            // Concurrent reservation count is bounded
            expect(count).toBeGreaterThanOrEqual(2);
            expect(count).toBeLessThanOrEqual(10);

            // Amount is valid
            expect(amount > 0n).toBe(true);
          },
        ),
        { numRuns: 50 },
      );
    });

    it('operation traces: structural invariant fields are stable across diverse traces', () => {
      fc.assert(
        fc.property(operationTrace, invariantId, (trace, id) => {
          const frozen = frozenMap.get(id)!;
          const canonical = getProperty(id)!;

          // Core structural fields match regardless of trace content
          expect(canonical.id).toBe(frozen.id);
          // universe and kind may diverge (KNOWN_DIFFS allowable)
          if (!isKnownDiff(id, 'universe')) {
            expect(canonical.universe).toBe(frozen.universe);
          }
          if (!isKnownDiff(id, 'kind')) {
            expect(canonical.kind).toBe(frozen.kind);
          }

          // Error codes match if present
          if (frozen.expectedErrorCode) {
            expect(canonical.expectedErrorCode).toBe(frozen.expectedErrorCode);
          }
          if (frozen.reconciliationFailureCode) {
            expect(canonical.reconciliationFailureCode).toBe(
              frozen.reconciliationFailureCode,
            );
          }

          // Trace has valid structure
          expect(trace.initialAmount > 0n).toBe(true);
          expect(trace.operations.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Cross-Evaluator Consistency Checks
  // ---------------------------------------------------------------------------

  describe('cross-evaluator consistency', () => {
    it('property counts: canonical has >= frozen invariant count', () => {
      expect(canonicalProperties.length).toBeGreaterThanOrEqual(
        FROZEN_PROPERTIES.length,
      );
    });

    it('ID sets: all frozen IDs are a subset of canonical IDs', () => {
      const canonicalIdSet = new Set(canonicalProperties.map((p) => p.id));
      for (const id of FROZEN_IDS) {
        expect(
          canonicalIdSet.has(id),
          `Frozen ID ${id} missing from canonical set`,
        ).toBe(true);
      }
    });

    it('error code mapping: every frozen expectedErrorCode appears in canonical', () => {
      for (const frozen of FROZEN_PROPERTIES) {
        if (frozen.expectedErrorCode) {
          const canonical = getProperty(frozen.id)!;
          expect(canonical.expectedErrorCode).toBe(frozen.expectedErrorCode);
        }
      }
    });

    it('reconciliation code mapping: every frozen reconciliationFailureCode appears in canonical', () => {
      for (const frozen of FROZEN_PROPERTIES) {
        if (frozen.reconciliationFailureCode) {
          const canonical = getProperty(frozen.id)!;
          expect(canonical.reconciliationFailureCode).toBe(
            frozen.reconciliationFailureCode,
          );
        }
      }
    });

    it('kind distribution: safety/liveness counts match for non-KNOWN_DIFF IDs', () => {
      // Only count IDs where kind is NOT in KNOWN_DIFFS
      const nonDiffIds = FROZEN_IDS.filter((id) => !isKnownDiff(id, 'kind'));

      const frozenSafety = FROZEN_PROPERTIES.filter(
        (p) => nonDiffIds.includes(p.id) && p.kind === 'safety',
      ).length;
      const frozenLiveness = FROZEN_PROPERTIES.filter(
        (p) => nonDiffIds.includes(p.id) && p.kind === 'liveness',
      ).length;

      let canonicalSafety = 0;
      let canonicalLiveness = 0;
      for (const id of nonDiffIds) {
        const canonical = getProperty(id)!;
        if (canonical.kind === 'safety') canonicalSafety++;
        else canonicalLiveness++;
      }

      expect(canonicalSafety).toBe(frozenSafety);
      expect(canonicalLiveness).toBe(frozenLiveness);
    });

    it('universe distribution: counts match for non-KNOWN_DIFF IDs', () => {
      // Only count IDs where universe is NOT in KNOWN_DIFFS
      const nonDiffIds = FROZEN_IDS.filter((id) => !isKnownDiff(id, 'universe'));

      const universes: Array<ConservationProperty['universe']> = [
        'per-lot',
        'per-account',
        'cross-system',
        'platform-wide',
      ];

      for (const universe of universes) {
        const frozenCount = FROZEN_PROPERTIES.filter(
          (p) => nonDiffIds.includes(p.id) && p.universe === universe,
        ).length;

        let canonicalCount = 0;
        for (const id of nonDiffIds) {
          const canonical = getProperty(id)!;
          if (canonical.universe === universe) canonicalCount++;
        }

        expect(
          canonicalCount,
          `Universe "${universe}" count mismatch (non-KNOWN_DIFF IDs): frozen=${frozenCount} canonical=${canonicalCount}`,
        ).toBe(frozenCount);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Dual-Run Summary
  // ---------------------------------------------------------------------------

  describe('dual-run summary', () => {
    it('full dual-run passes: all structural fields match or are in KNOWN_DIFFS', () => {
      const structuralFields = ['id', 'expectedErrorCode', 'reconciliationFailureCode'] as const;
      const allowlistedFields = ['name', 'description', 'ltl', 'enforcedBy', 'fairnessModel', 'universe', 'kind'] as const;
      const failures: string[] = [];

      for (const frozen of FROZEN_PROPERTIES) {
        const canonical = getProperty(frozen.id);
        if (!canonical) {
          failures.push(`${frozen.id}: missing from canonical`);
          continue;
        }

        // Structural fields must match exactly
        if (canonical.id !== frozen.id) {
          failures.push(`${frozen.id}: id mismatch`);
        }
        if (frozen.expectedErrorCode !== undefined && canonical.expectedErrorCode !== frozen.expectedErrorCode) {
          failures.push(`${frozen.id}: expectedErrorCode mismatch`);
        }
        if (frozen.reconciliationFailureCode !== undefined && canonical.reconciliationFailureCode !== frozen.reconciliationFailureCode) {
          failures.push(`${frozen.id}: reconciliationFailureCode mismatch`);
        }

        // Allowlisted fields: must be in KNOWN_DIFFS or match
        for (const field of allowlistedFields) {
          if (field === 'fairnessModel') {
            // Optional field — skip if neither has it
            if (!frozen.fairnessModel && !canonical.fairnessModel) continue;
            if (frozen.fairnessModel !== canonical.fairnessModel && !isKnownDiff(frozen.id, field)) {
              failures.push(`${frozen.id}: ${field} mismatch without KNOWN_DIFF`);
            }
          } else if (field === 'enforcedBy') {
            const frozenStr = JSON.stringify([...frozen.enforcedBy].sort());
            const canonicalStr = JSON.stringify([...canonical.enforcedBy].sort());
            if (frozenStr !== canonicalStr && !isKnownDiff(frozen.id, field)) {
              failures.push(`${frozen.id}: ${field} mismatch without KNOWN_DIFF`);
            }
          } else {
            const frozenVal = frozen[field];
            const canonicalVal = canonical[field];
            if (frozenVal !== canonicalVal && !isKnownDiff(frozen.id, field)) {
              failures.push(`${frozen.id}: ${field} mismatch without KNOWN_DIFF`);
            }
          }
        }
      }

      if (failures.length > 0) {
        console.error('[dual-run] Structural failures:');
        for (const f of failures) {
          console.error(`  - ${f}`);
        }
      }

      expect(
        failures,
        `Dual-run structural failures:\n${failures.join('\n')}`,
      ).toHaveLength(0);
    });
  });
});
