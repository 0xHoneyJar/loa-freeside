/**
 * Arithmetic Guard Tests
 *
 * Tests for SafeArithmeticError and guarded BigInt operations.
 * Verifies overflow, underflow, division-by-zero, and BPS range guards.
 *
 * Sprint refs: Task 1.8
 */

import { describe, it, expect } from 'vitest';
import {
  addMicroUSD,
  subtractMicroUSD,
  multiplyBPS,
  divideWithFloor,
  SafeArithmeticError,
  MAX_MICRO_USD,
} from '../../../../src/packages/core/protocol/arrakis-arithmetic.js';

// =============================================================================
// SafeArithmeticError
// =============================================================================

describe('SafeArithmeticError', () => {
  it('includes operation name and operands', () => {
    const err = new SafeArithmeticError('testOp', [1n, 2n], 'test message');
    expect(err.name).toBe('SafeArithmeticError');
    expect(err.operation).toBe('testOp');
    expect(err.operands).toEqual([1n, 2n]);
    expect(err.message).toContain('testOp');
    expect(err.message).toContain('1');
    expect(err.message).toContain('2');
    expect(err instanceof Error).toBe(true);
  });
});

// =============================================================================
// addMicroUSD
// =============================================================================

describe('addMicroUSD', () => {
  it('adds two valid micro-USD amounts', () => {
    expect(addMicroUSD(100n, 200n)).toBe(300n);
    expect(addMicroUSD(0n, 0n)).toBe(0n);
    expect(addMicroUSD(MAX_MICRO_USD - 1n, 1n)).toBe(MAX_MICRO_USD);
  });

  it('throws on negative first operand', () => {
    expect(() => addMicroUSD(-1n, 100n)).toThrow(SafeArithmeticError);
  });

  it('throws on negative second operand', () => {
    expect(() => addMicroUSD(100n, -1n)).toThrow(SafeArithmeticError);
  });

  it('throws when result exceeds MAX_MICRO_USD', () => {
    expect(() => addMicroUSD(MAX_MICRO_USD, 1n)).toThrow(SafeArithmeticError);
  });
});

// =============================================================================
// subtractMicroUSD
// =============================================================================

describe('subtractMicroUSD', () => {
  it('subtracts two valid amounts', () => {
    expect(subtractMicroUSD(300n, 100n)).toBe(200n);
    expect(subtractMicroUSD(100n, 100n)).toBe(0n);
    expect(subtractMicroUSD(100n, 0n)).toBe(100n);
  });

  it('throws when result would be negative', () => {
    expect(() => subtractMicroUSD(100n, 200n)).toThrow(SafeArithmeticError);
  });

  it('throws on negative first operand', () => {
    expect(() => subtractMicroUSD(-1n, 100n)).toThrow(SafeArithmeticError);
  });

  it('throws on negative second operand (prevents addition bypass)', () => {
    expect(() => subtractMicroUSD(100n, -1n)).toThrow(SafeArithmeticError);
  });
});

// =============================================================================
// multiplyBPS
// =============================================================================

describe('multiplyBPS', () => {
  it('calculates correct BPS share', () => {
    expect(multiplyBPS(1_000_000n, 2500n)).toBe(250_000n); // 25% of $1
    expect(multiplyBPS(1_000_000n, 10000n)).toBe(1_000_000n); // 100%
    expect(multiplyBPS(1_000_000n, 0n)).toBe(0n); // 0%
  });

  it('throws on negative BPS', () => {
    expect(() => multiplyBPS(1_000_000n, -1n)).toThrow(SafeArithmeticError);
  });

  it('throws on BPS > 10000', () => {
    expect(() => multiplyBPS(1_000_000n, 10001n)).toThrow(SafeArithmeticError);
  });
});

// =============================================================================
// divideWithFloor
// =============================================================================

describe('divideWithFloor', () => {
  it('performs floor division for positive values', () => {
    expect(divideWithFloor(7n, 2n)).toBe(3n);
    expect(divideWithFloor(10n, 5n)).toBe(2n);
    expect(divideWithFloor(1n, 3n)).toBe(0n);
  });

  it('performs true floor division for negative values', () => {
    // -7 / 2 = -3.5 → floor = -4 (not -3 which is truncation)
    expect(divideWithFloor(-7n, 2n)).toBe(-4n);
    // 7 / -2 = -3.5 → floor = -4
    expect(divideWithFloor(7n, -2n)).toBe(-4n);
    // -7 / -2 = 3.5 → floor = 3 (both negative = positive result, truncation = floor)
    expect(divideWithFloor(-7n, -2n)).toBe(3n);
  });

  it('throws on division by zero', () => {
    expect(() => divideWithFloor(100n, 0n)).toThrow(SafeArithmeticError);
  });
});
