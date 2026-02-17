/**
 * Branded Type Tests (Task 2.5, Sprint 296)
 *
 * Verifies compile-time branded type safety and runtime constructor validation.
 *
 * SDD refs: §3.4 Branded Types
 * Sprint refs: Task 2.5
 */

import { describe, it, expect } from 'vitest';
import {
  microUSD,
  basisPoints,
  accountId,
  bpsShare,
  addMicroUSD,
  subtractMicroUSD,
  assertMicroUSD,
  assertBpsSum,
} from '../../../src/packages/core/protocol/arrakis-arithmetic.js';
import type {
  MicroUSD,
  BasisPoints,
  AccountId,
} from '../../../src/packages/core/protocol/arrakis-arithmetic.js';

// =============================================================================
// Compile-Time Safety
// =============================================================================

describe('Branded Types — Compile-Time Safety', () => {
  it('plain bigint not assignable to MicroUSD', () => {
    const raw = 100n;
    // @ts-expect-error — plain bigint should not be assignable to MicroUSD
    const _m: MicroUSD = raw;
    // Suppress unused variable
    void _m;
  });

  it('plain bigint not assignable to BasisPoints', () => {
    const raw = 5000n;
    // @ts-expect-error — plain bigint should not be assignable to BasisPoints
    const _b: BasisPoints = raw;
    void _b;
  });

  it('plain string not assignable to AccountId', () => {
    const raw = 'acct-123';
    // @ts-expect-error — plain string should not be assignable to AccountId
    const _a: AccountId = raw;
    void _a;
  });
});

// =============================================================================
// Constructor Validation
// =============================================================================

describe('Branded Types — Constructor Validation', () => {
  describe('microUSD()', () => {
    it('accepts zero', () => {
      expect(microUSD(0n)).toBe(0n);
    });

    it('accepts positive value', () => {
      expect(microUSD(1_000_000n)).toBe(1_000_000n);
    });

    it('rejects negative value', () => {
      expect(() => microUSD(-1n)).toThrow(RangeError);
      expect(() => microUSD(-1n)).toThrow('non-negative');
    });
  });

  describe('basisPoints()', () => {
    it('accepts zero', () => {
      expect(basisPoints(0n)).toBe(0n);
    });

    it('accepts 10000 (100%)', () => {
      expect(basisPoints(10000n)).toBe(10000n);
    });

    it('rejects values above 10000', () => {
      expect(() => basisPoints(10001n)).toThrow(RangeError);
      expect(() => basisPoints(10001n)).toThrow('BasisPoints');
    });

    it('rejects negative values', () => {
      expect(() => basisPoints(-1n)).toThrow(RangeError);
    });
  });

  describe('accountId()', () => {
    it('accepts non-empty string', () => {
      expect(accountId('acct-123')).toBe('acct-123');
    });

    it('rejects empty string', () => {
      expect(() => accountId('')).toThrow(RangeError);
      expect(() => accountId('')).toThrow('non-empty');
    });
  });
});

// =============================================================================
// Branded Arithmetic Integration
// =============================================================================

describe('Branded Types — Arithmetic Integration', () => {
  it('bpsShare with branded args returns MicroUSD', () => {
    const part = microUSD(500_000n);
    const whole = microUSD(1_000_000n);
    const result = bpsShare(part, whole);
    // bpsShare(part, whole) = (part * 10000) / whole = 5000 (50% in BPS)
    expect(result).toBe(5000n);
  });

  it('addMicroUSD with branded args returns MicroUSD', () => {
    const a = microUSD(100n);
    const b = microUSD(200n);
    const result = addMicroUSD(a, b);
    expect(result).toBe(300n);
    const _typed: MicroUSD = result;
    void _typed;
  });

  it('subtractMicroUSD with branded args returns MicroUSD', () => {
    const a = microUSD(500n);
    const b = microUSD(200n);
    const result = subtractMicroUSD(a, b);
    expect(result).toBe(300n);
    const _typed: MicroUSD = result;
    void _typed;
  });

  it('assertMicroUSD accepts branded MicroUSD', () => {
    const val = microUSD(1000n);
    expect(() => assertMicroUSD(val)).not.toThrow();
  });

  it('assertBpsSum with branded BasisPoints', () => {
    const a = basisPoints(7000n);
    const b = basisPoints(3000n);
    expect(() => assertBpsSum(a, b)).not.toThrow();
  });

  it('unbranded overloads still work for backward compatibility', () => {
    // Plain bigint args should still compile and work
    expect(addMicroUSD(100n, 200n)).toBe(300n);
    expect(subtractMicroUSD(500n, 200n)).toBe(300n);
    expect(bpsShare(2_500n, 10_000n)).toBe(2500n);
    expect(() => assertBpsSum(5000n, 5000n)).not.toThrow();
  });
});
