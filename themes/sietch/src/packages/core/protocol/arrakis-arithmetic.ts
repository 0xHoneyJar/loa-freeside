/**
 * Arrakis Arithmetic Extension Module
 *
 * Imports canonical branded types from @0xhoneyjar/loa-hounfour v7.0.0
 * and provides arrakis-specific arithmetic helpers not in the canonical package.
 *
 * Canonical re-exports: MicroUSD, BasisPoints, AccountId, microUSD, basisPoints,
 *   accountId, addMicroUSD, subtractMicroUSD, multiplyBPS, bpsShare,
 *   serializeMicroUSD, deserializeMicroUSD, serializeBasisPoints, deserializeBasisPoints
 *
 * Arrakis-specific: MICRO_USD_PER_DOLLAR, MAX_MICRO_USD, TOTAL_BPS,
 *   SafeArithmeticError, dollarsToMicro, microToDollarsDisplay, assertMicroUSD,
 *   assertBpsSum, divideWithFloor, serializeBigInt, microUsdSchema,
 *   microUsdWithCeilingSchema
 *
 * Task: 300.4 (Sprint 300, cycle-034)
 * SDD ref: §3.4
 */

import { z } from 'zod';

// =============================================================================
// Canonical Re-exports from @0xhoneyjar/loa-hounfour v7.0.0
// =============================================================================

export {
  type BrandedMicroUSD as MicroUSD,
  type BasisPoints,
  type AccountId,
  microUSD,
  basisPoints,
  accountId,
  addMicroUSD,
  subtractMicroUSD,
  multiplyBPS,
  bpsShare,
  serializeMicroUSD,
  deserializeMicroUSD,
  serializeBasisPoints,
  deserializeBasisPoints,
} from '@0xhoneyjar/loa-hounfour/economy';

// =============================================================================
// Arrakis-Specific Constants
// =============================================================================

/** 1 USD expressed in micro-USD */
export const MICRO_USD_PER_DOLLAR = 1_000_000n;

/** Default ceiling: $1,000,000 in micro-USD */
const DEFAULT_CEILING_MICRO = 1_000_000_000_000n; // $1M

/** PRD-defined maximum: $1,000,000,000 (1 billion USD) in micro-USD */
export const MAX_MICRO_USD = 1_000_000_000_000_000n; // $1B

/** Total basis points representing 100% */
export const TOTAL_BPS = 10000n;

// =============================================================================
// SafeArithmeticError
// =============================================================================

export class SafeArithmeticError extends Error {
  readonly operation: string;
  readonly operands: readonly bigint[];

  constructor(operation: string, operands: readonly bigint[], message: string) {
    super(`SafeArithmeticError [${operation}]: ${message} (operands: ${operands.map(String).join(', ')})`);
    this.name = 'SafeArithmeticError';
    this.operation = operation;
    this.operands = operands;
  }
}

// =============================================================================
// Arrakis-Specific Arithmetic Helpers
// =============================================================================

/**
 * Safe integer division with floor.
 * @throws {SafeArithmeticError} if divisor is 0
 */
export function divideWithFloor(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new SafeArithmeticError('divideWithFloor', [a, b], 'division by zero');
  const q = a / b;
  const r = a % b;
  if (r !== 0n && ((a < 0n && b > 0n) || (a > 0n && b < 0n))) {
    return q - 1n;
  }
  return q;
}

/**
 * Convert a dollar amount to micro-USD.
 * @example dollarsToMicro(1.50) // => 1500000n
 */
export function dollarsToMicro(dollars: number): bigint {
  if (!Number.isFinite(dollars)) {
    throw new RangeError(`dollars must be a finite number, got ${dollars}`);
  }
  const micro = Math.round(dollars * 1_000_000);
  if (!Number.isSafeInteger(micro)) {
    throw new RangeError(
      `dollars value is too large or imprecise to convert safely: ${dollars}`
    );
  }
  return BigInt(micro);
}

/**
 * Convert micro-USD to a display-friendly dollar string.
 * For display only — never use the result in financial calculations.
 * @example microToDollarsDisplay(1500000n) // => '$1.50'
 */
export function microToDollarsDisplay(micro: bigint): string {
  const sign = micro < 0n ? '-' : '';
  const abs = micro < 0n ? -micro : micro;
  let dollars = abs / MICRO_USD_PER_DOLLAR;
  const remainder = abs % MICRO_USD_PER_DOLLAR;
  let cents = (remainder + 5_000n) / 10_000n;
  if (cents === 100n) {
    dollars += 1n;
    cents = 0n;
  }
  return `${sign}$${dollars.toString()}.${cents.toString().padStart(2, '0')}`;
}

// =============================================================================
// Validation
// =============================================================================

function getCeilingMicro(): bigint {
  const envCeiling = process.env.BILLING_CEILING_MICRO;
  if (envCeiling) {
    try {
      const parsed = BigInt(envCeiling);
      if (parsed > 0n) return parsed;
    } catch {
      // Invalid env var — fall through to default
    }
  }
  return DEFAULT_CEILING_MICRO;
}

/**
 * Assert that a BigInt value is a valid micro-USD amount.
 * @throws {RangeError} if value is negative or exceeds ceiling
 */
export function assertMicroUSD(value: bigint): void {
  if (value < 0n) {
    throw new RangeError(`micro-USD value must be non-negative, got ${value}`);
  }
  const ceiling = getCeilingMicro();
  if (value > ceiling) {
    throw new RangeError(
      `micro-USD value ${value} exceeds ceiling ${ceiling} (${microToDollarsDisplay(ceiling)})`
    );
  }
}

/**
 * Validate that basis point values sum to 10000 (100%).
 * @throws {RangeError} if values don't sum to 10000
 */
export function assertBpsSum(...values: bigint[]): void {
  const total = values.reduce((sum, v) => sum + v, 0n);
  if (total !== TOTAL_BPS) {
    throw new RangeError(
      `Basis points must sum to ${TOTAL_BPS}, got ${total}`
    );
  }
}

// =============================================================================
// Zod Schemas
// =============================================================================

export const microUsdSchema = z
  .union([z.string(), z.number()])
  .transform((val) => {
    if (typeof val === 'number') {
      if (!Number.isFinite(val) || !Number.isSafeInteger(val)) {
        throw new Error(`Number "${val}" is not a safe integer micro-USD amount`);
      }
    }
    try {
      return BigInt(val);
    } catch {
      throw new Error(`Cannot convert "${val}" to BigInt`);
    }
  })
  .refine((val) => val >= 0n, { message: 'micro-USD value must be non-negative' });

export const microUsdWithCeilingSchema = microUsdSchema
  .refine(
    (val) => val <= getCeilingMicro(),
    { message: 'micro-USD value exceeds ceiling' }
  );

// =============================================================================
// Serialization
// =============================================================================

/**
 * Recursively serialize all BigInt values in an object to strings.
 */
export function serializeBigInt<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return obj.toString() as unknown as T;
  if (Array.isArray(obj)) return obj.map(serializeBigInt) as unknown as T;
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = serializeBigInt(value);
    }
    return result as T;
  }
  return obj;
}
