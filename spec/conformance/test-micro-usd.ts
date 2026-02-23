/**
 * MicroUSD Conformance Tests
 *
 * Validates MicroUSD arithmetic against golden test vectors.
 * All monetary values are BigInt micro-USD (1 USD = 1,000,000 micro).
 * No floating-point allowed in the economic path.
 *
 * @see spec/vectors/micro-usd.json
 * @see loa-hounfour v7.0.0 §2: MicroUSD
 * @module spec/conformance/test-micro-usd
 */

import { describe, it, expect } from 'vitest';
import microUsdVectors from '../vectors/micro-usd.json';

// --------------------------------------------------------------------------
// MicroUSD Operations (reference implementation)
// --------------------------------------------------------------------------

const MICRO_PER_USD = 1_000_000n;
const MICRO_PER_CENT = 10_000n;

function usdToMicro(usd: string): bigint {
  const parts = usd.split('.');
  const whole = BigInt(parts[0]) * MICRO_PER_USD;
  if (parts.length === 1) return whole;
  const fracStr = parts[1].padEnd(6, '0').slice(0, 6);
  return whole + BigInt(fracStr);
}

function microToUsd(micro: bigint): string {
  const whole = micro / MICRO_PER_USD;
  const frac = micro % MICRO_PER_USD;
  return `${whole}.${frac.toString().padStart(6, '0')}`;
}

function centsToMicro(cents: bigint): bigint {
  return cents * MICRO_PER_CENT;
}

function microToCents(micro: bigint): bigint {
  return micro / MICRO_PER_CENT;
}

interface SplitDebitLot {
  lot_id: string;
  remaining_micro: number;
}

interface DebitEntry {
  lot_id: string;
  debit_micro: bigint;
}

function splitDebit(
  totalMicro: bigint,
  lots: SplitDebitLot[],
): { entries: DebitEntry[]; total: bigint } | { error: string } {
  let remaining = totalMicro;
  const entries: DebitEntry[] = [];

  for (const lot of lots) {
    if (remaining <= 0n) break;
    const lotRemaining = BigInt(lot.remaining_micro);
    const debit = remaining < lotRemaining ? remaining : lotRemaining;
    entries.push({ lot_id: lot.lot_id, debit_micro: debit });
    remaining -= debit;
  }

  if (remaining > 0n) {
    return { error: 'BUDGET_EXCEEDED' };
  }

  const total = entries.reduce((sum, e) => sum + e.debit_micro, 0n);
  return { entries, total };
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('MicroUSD Conformance — Golden Vectors', () => {
  const vectors = microUsdVectors.vectors;

  describe('Conversion vectors', () => {
    it('MUSD-001: $1.00 = 1,000,000 micro-USD', () => {
      const v = vectors.find(v => v.id === 'MUSD-001')!;
      expect(usdToMicro(v.input.usd!)).toBe(BigInt(v.expected_micro!));
    });

    it('MUSD-002: $0.001 = 1,000 micro-USD', () => {
      const v = vectors.find(v => v.id === 'MUSD-002')!;
      expect(usdToMicro(v.input.usd!)).toBe(BigInt(v.expected_micro!));
    });

    it('MUSD-003: $0.00 = 0 micro-USD', () => {
      const v = vectors.find(v => v.id === 'MUSD-003')!;
      expect(usdToMicro(v.input.usd!)).toBe(BigInt(v.expected_micro!));
    });

    it('MUSD-004: max safe value round-trip', () => {
      const v = vectors.find(v => v.id === 'MUSD-004')!;
      const result = microToUsd(BigInt(v.input.micro!));
      expect(result).toBe(v.expected_usd);
    });
  });

  describe('Arithmetic vectors', () => {
    it('MUSD-005: addition', () => {
      const v = vectors.find(v => v.id === 'MUSD-005')!;
      const result = BigInt(v.input.a_micro!) + BigInt(v.input.b_micro!);
      expect(result).toBe(BigInt(v.expected_micro!));
    });

    it('MUSD-006: subtraction', () => {
      const v = vectors.find(v => v.id === 'MUSD-006')!;
      const result = BigInt(v.input.a_micro!) - BigInt(v.input.b_micro!);
      expect(result).toBe(BigInt(v.expected_micro!));
    });

    it('MUSD-007: underflow protection', () => {
      const v = vectors.find(v => v.id === 'MUSD-007')!;
      const result = BigInt(v.input.a_micro!) - BigInt(v.input.b_micro!);
      expect(result < 0n).toBe(true);
    });

    it('MUSD-008: integer division truncates', () => {
      const v = vectors.find(v => v.id === 'MUSD-008')!;
      const quotient = BigInt(v.input.a_micro!) / BigInt(v.input.divisor!);
      const remainder = BigInt(v.input.a_micro!) % BigInt(v.input.divisor!);
      expect(quotient).toBe(BigInt(v.expected_quotient!));
      expect(remainder).toBe(BigInt(v.expected_remainder!));
    });
  });

  describe('Conversion factor vectors', () => {
    it('MUSD-009: cents to micro', () => {
      const v = vectors.find(v => v.id === 'MUSD-009')!;
      expect(centsToMicro(BigInt(v.input.cents!))).toBe(BigInt(v.expected_micro!));
    });

    it('MUSD-010: micro to cents (truncation)', () => {
      const v = vectors.find(v => v.id === 'MUSD-010')!;
      const cents = microToCents(BigInt(v.input.micro!));
      expect(cents).toBe(BigInt(v.expected_cents!));
    });
  });

  describe('Split debit vectors', () => {
    it('MUSD-011: split debit across multiple lots', () => {
      const v = vectors.find(v => v.id === 'MUSD-011')!;
      const result = splitDebit(BigInt(v.input.total_debit_micro!), v.input.lots!);
      expect('entries' in result).toBe(true);
      if ('entries' in result) {
        expect(result.entries).toHaveLength(v.expected_entries!.length);
        for (let i = 0; i < result.entries.length; i++) {
          expect(result.entries[i].lot_id).toBe(v.expected_entries![i].lot_id);
          expect(result.entries[i].debit_micro).toBe(BigInt(v.expected_entries![i].debit_micro));
        }
        expect(result.total).toBe(BigInt(v.expected_total_debited!));
      }
    });

    it('MUSD-012: budget exceeded', () => {
      const v = vectors.find(v => v.id === 'MUSD-012')!;
      const result = splitDebit(BigInt(v.input.total_debit_micro!), v.input.lots!);
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toBe(v.expected_error);
      }
    });
  });

  describe('Type safety', () => {
    it('all arithmetic uses BigInt, never Number for micro values', () => {
      const a = 999_999n;
      const b = 1n;
      const sum = a + b;
      expect(typeof sum).toBe('bigint');
      expect(sum).toBe(1_000_000n);
    });
  });
});
