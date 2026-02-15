/**
 * Protocol Adoption Tests (Sprint 10, Task 1.5)
 *
 * Verifies vendored protocol types, arithmetic helpers, state machines,
 * and compatibility checks work correctly after adoption.
 */

import { describe, it, expect } from 'vitest';

// Protocol arithmetic
import {
  dollarsToMicro,
  microToDollarsDisplay,
  assertMicroUSD,
  serializeBigInt,
  microUsdSchema,
  bpsShare,
  assertBpsSum,
  TOTAL_BPS,
  MICRO_USD_PER_DOLLAR,
} from '../../../src/packages/core/protocol/arithmetic.js';

// Protocol compatibility
import {
  PROTOCOL_VERSION,
  validateCompatibility,
} from '../../../src/packages/core/protocol/compatibility.js';

// Protocol state machines
import {
  RESERVATION_MACHINE,
  REVENUE_RULE_MACHINE,
  PAYMENT_MACHINE,
  isValidTransition,
  isTerminal,
} from '../../../src/packages/core/protocol/state-machines.js';

// Type re-exports from ports (verify aliasing works)
import type { EntityType, SourceType, BillingMode } from '../../../src/packages/core/ports/ICreditLedgerService.js';
import type { RuleStatus } from '../../../src/packages/core/ports/IRevenueRulesService.js';

// =============================================================================
// Arithmetic Tests
// =============================================================================

describe('protocol/arithmetic', () => {
  describe('dollarsToMicro', () => {
    it('converts whole dollars', () => {
      expect(dollarsToMicro(1)).toBe(1_000_000n);
      expect(dollarsToMicro(100)).toBe(100_000_000n);
    });

    it('converts fractional dollars', () => {
      expect(dollarsToMicro(1.50)).toBe(1_500_000n);
      expect(dollarsToMicro(0.01)).toBe(10_000n);
      expect(dollarsToMicro(0.001)).toBe(1_000n);
    });

    it('handles zero', () => {
      expect(dollarsToMicro(0)).toBe(0n);
    });

    it('rejects NaN', () => {
      expect(() => dollarsToMicro(NaN)).toThrow(RangeError);
    });

    it('rejects Infinity', () => {
      expect(() => dollarsToMicro(Infinity)).toThrow(RangeError);
      expect(() => dollarsToMicro(-Infinity)).toThrow(RangeError);
    });

    it('rejects unsafe integer results', () => {
      // Number.MAX_SAFE_INTEGER / 1_000_000 ≈ 9_007_199_254.740_992
      expect(() => dollarsToMicro(9_999_999_999_999)).toThrow(RangeError);
    });
  });

  describe('microToDollarsDisplay', () => {
    it('formats whole dollars', () => {
      expect(microToDollarsDisplay(1_000_000n)).toBe('$1.00');
      expect(microToDollarsDisplay(100_000_000n)).toBe('$100.00');
    });

    it('formats cents correctly', () => {
      expect(microToDollarsDisplay(1_500_000n)).toBe('$1.50');
      expect(microToDollarsDisplay(10_000n)).toBe('$0.01');
    });

    it('formats zero', () => {
      expect(microToDollarsDisplay(0n)).toBe('$0.00');
    });

    it('formats negative values', () => {
      expect(microToDollarsDisplay(-1_500_000n)).toBe('-$1.50');
    });

    it('rounds to nearest cent', () => {
      // 1.005 USD = 1_005_000 micro → should round to $1.01
      expect(microToDollarsDisplay(1_005_000n)).toBe('$1.01');
    });

    it('handles large values without precision loss', () => {
      // $1,000,000 — would overflow Number precision in old implementation
      const oneMillion = 1_000_000_000_000n;
      expect(microToDollarsDisplay(oneMillion)).toBe('$1000000.00');
    });
  });

  describe('assertMicroUSD', () => {
    it('accepts valid positive values', () => {
      expect(() => assertMicroUSD(0n)).not.toThrow();
      expect(() => assertMicroUSD(1_000_000n)).not.toThrow();
    });

    it('rejects negative values', () => {
      expect(() => assertMicroUSD(-1n)).toThrow(RangeError);
    });

    it('rejects values exceeding ceiling', () => {
      // Default ceiling is $1M = 1_000_000_000_000 micro
      expect(() => assertMicroUSD(1_000_000_000_001n)).toThrow(RangeError);
    });
  });

  describe('serializeBigInt', () => {
    it('converts BigInt to string', () => {
      expect(serializeBigInt(5_000_000n)).toBe('5000000');
    });

    it('handles nested objects', () => {
      const result = serializeBigInt({
        amount: 5_000_000n,
        name: 'test',
        nested: { value: 100n },
      });
      expect(result).toEqual({
        amount: '5000000',
        name: 'test',
        nested: { value: '100' },
      });
    });

    it('handles arrays', () => {
      expect(serializeBigInt([1n, 2n, 3n])).toEqual(['1', '2', '3']);
    });

    it('passes through null/undefined', () => {
      expect(serializeBigInt(null)).toBeNull();
      expect(serializeBigInt(undefined)).toBeUndefined();
    });
  });

  describe('microUsdSchema', () => {
    it('parses string to BigInt', () => {
      expect(microUsdSchema.parse('5000000')).toBe(5_000_000n);
    });

    it('parses safe integer number to BigInt', () => {
      expect(microUsdSchema.parse(5000000)).toBe(5_000_000n);
    });

    it('rejects negative values', () => {
      expect(() => microUsdSchema.parse('-1')).toThrow();
    });

    it('rejects non-numeric strings', () => {
      expect(() => microUsdSchema.parse('abc')).toThrow();
    });

    it('rejects unsafe number values', () => {
      expect(() => microUsdSchema.parse(Number.MAX_SAFE_INTEGER + 1)).toThrow();
    });
  });

  describe('BPS arithmetic', () => {
    it('calculates basis point share', () => {
      // 25% of $1
      expect(bpsShare(1_000_000n, 2500n)).toBe(250_000n);
    });

    it('handles zero BPS', () => {
      expect(bpsShare(1_000_000n, 0n)).toBe(0n);
    });

    it('handles 100% BPS', () => {
      expect(bpsShare(1_000_000n, TOTAL_BPS)).toBe(1_000_000n);
    });

    it('assertBpsSum passes for valid split', () => {
      expect(() => assertBpsSum(2500n, 2500n, 5000n)).not.toThrow();
    });

    it('assertBpsSum rejects invalid split', () => {
      expect(() => assertBpsSum(2500n, 2500n, 4000n)).toThrow(RangeError);
    });

    it('TOTAL_BPS is 10000', () => {
      expect(TOTAL_BPS).toBe(10000n);
    });

    it('MICRO_USD_PER_DOLLAR is 1_000_000', () => {
      expect(MICRO_USD_PER_DOLLAR).toBe(1_000_000n);
    });
  });
});

// =============================================================================
// Compatibility Tests
// =============================================================================

describe('protocol/compatibility', () => {
  it('exports a valid semver protocol version', () => {
    expect(PROTOCOL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  describe('validateCompatibility', () => {
    it('reports exact match', () => {
      const result = validateCompatibility('4.6.0', '4.6.0');
      expect(result.compatible).toBe(true);
      expect(result.level).toBe('exact');
    });

    it('allows patch difference', () => {
      const result = validateCompatibility('4.6.0', '4.6.1');
      expect(result.compatible).toBe(true);
    });

    it('allows minor version difference', () => {
      const result = validateCompatibility('4.6.0', '4.7.0');
      expect(result.compatible).toBe(true);
      expect(result.level).toBe('minor_compatible');
    });

    it('rejects major version mismatch', () => {
      const result = validateCompatibility('4.6.0', '5.0.0');
      expect(result.compatible).toBe(false);
      expect(result.level).toBe('incompatible');
    });

    it('rejects invalid version format', () => {
      const result = validateCompatibility('4.6.0', 'invalid');
      expect(result.compatible).toBe(false);
      expect(result.level).toBe('incompatible');
    });
  });
});

// =============================================================================
// State Machine Tests
// =============================================================================

describe('protocol/state-machines', () => {
  describe('RESERVATION_MACHINE', () => {
    it('has correct initial state', () => {
      expect(RESERVATION_MACHINE.initial).toBe('pending');
    });

    it('allows pending → finalized', () => {
      expect(isValidTransition(RESERVATION_MACHINE, 'pending', 'finalized')).toBe(true);
    });

    it('allows pending → released', () => {
      expect(isValidTransition(RESERVATION_MACHINE, 'pending', 'released')).toBe(true);
    });

    it('allows pending → expired', () => {
      expect(isValidTransition(RESERVATION_MACHINE, 'pending', 'expired')).toBe(true);
    });

    it('rejects finalized → pending', () => {
      expect(isValidTransition(RESERVATION_MACHINE, 'finalized', 'pending')).toBe(false);
    });

    it('identifies terminal states', () => {
      expect(isTerminal(RESERVATION_MACHINE, 'finalized')).toBe(true);
      expect(isTerminal(RESERVATION_MACHINE, 'released')).toBe(true);
      expect(isTerminal(RESERVATION_MACHINE, 'expired')).toBe(true);
      expect(isTerminal(RESERVATION_MACHINE, 'pending')).toBe(false);
    });
  });

  describe('REVENUE_RULE_MACHINE', () => {
    it('has correct initial state', () => {
      expect(REVENUE_RULE_MACHINE.initial).toBe('draft');
    });

    it('allows draft → pending_approval', () => {
      expect(isValidTransition(REVENUE_RULE_MACHINE, 'draft', 'pending_approval')).toBe(true);
    });

    it('allows pending_approval → cooling_down', () => {
      expect(isValidTransition(REVENUE_RULE_MACHINE, 'pending_approval', 'cooling_down')).toBe(true);
    });

    it('allows cooling_down → active', () => {
      expect(isValidTransition(REVENUE_RULE_MACHINE, 'cooling_down', 'active')).toBe(true);
    });

    it('rejects skipping cooling_down', () => {
      expect(isValidTransition(REVENUE_RULE_MACHINE, 'pending_approval', 'active')).toBe(false);
    });

    it('identifies terminal states', () => {
      expect(isTerminal(REVENUE_RULE_MACHINE, 'superseded')).toBe(true);
      expect(isTerminal(REVENUE_RULE_MACHINE, 'rejected')).toBe(true);
      expect(isTerminal(REVENUE_RULE_MACHINE, 'active')).toBe(false);
    });
  });

  describe('PAYMENT_MACHINE', () => {
    it('has correct initial state', () => {
      expect(PAYMENT_MACHINE.initial).toBe('waiting');
    });

    it('allows waiting → confirming', () => {
      expect(isValidTransition(PAYMENT_MACHINE, 'waiting', 'confirming')).toBe(true);
    });

    it('allows forward jumps (waiting → finished)', () => {
      expect(isValidTransition(PAYMENT_MACHINE, 'waiting', 'finished')).toBe(true);
    });

    it('allows finished → refunded', () => {
      expect(isValidTransition(PAYMENT_MACHINE, 'finished', 'refunded')).toBe(true);
    });

    it('rejects regression (finished → confirming)', () => {
      expect(isValidTransition(PAYMENT_MACHINE, 'finished', 'confirming')).toBe(false);
    });

    it('identifies terminal states', () => {
      expect(isTerminal(PAYMENT_MACHINE, 'refunded')).toBe(true);
      expect(isTerminal(PAYMENT_MACHINE, 'failed')).toBe(true);
      expect(isTerminal(PAYMENT_MACHINE, 'expired')).toBe(true);
      expect(isTerminal(PAYMENT_MACHINE, 'waiting')).toBe(false);
    });
  });
});

// =============================================================================
// Type Re-export Verification (compile-time only)
// =============================================================================

describe('protocol type re-exports', () => {
  it('EntityType from ICreditLedgerService matches protocol', () => {
    // This is a compile-time check — if the type alias breaks, tsc catches it.
    const agent: EntityType = 'agent';
    const person: EntityType = 'person';
    expect(agent).toBe('agent');
    expect(person).toBe('person');
  });

  it('BillingMode from ICreditLedgerService matches protocol', () => {
    const mode: BillingMode = 'shadow';
    expect(mode).toBe('shadow');
  });

  it('RuleStatus from IRevenueRulesService matches protocol', () => {
    const status: RuleStatus = 'draft';
    expect(status).toBe('draft');
  });
});
