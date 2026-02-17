/**
 * Vendored loa-hounfour Arithmetic Helpers
 *
 * BigInt micro-USD arithmetic utilities shared between arrakis and loa-finn.
 * All monetary values use micro-USD (1 USD = 1,000,000 micro-USD).
 *
 * Numeric precision bounds:
 * - SQLite INTEGER: signed 64-bit (max 9.2 × 10^18)
 * - Redis INCRBY: signed 64-bit
 * - JavaScript BigInt: unlimited precision
 * - JS Number.MAX_SAFE_INTEGER: 2^53-1 (≈ $9.007 trillion in micro-USD)
 *
 * Vendored from: loa-hounfour (pinned commit — see VENDORED.md)
 *
 * @module packages/core/protocol/arithmetic
 */

import { z } from 'zod';

// =============================================================================
// Branded Types (Cycle-033, FR-4)
// =============================================================================

/**
 * Compile-time branded micro-USD type.
 * Prevents accidental assignment of raw bigint to monetary fields.
 */
export type MicroUSD = bigint & { readonly __brand: 'micro_usd' };

/**
 * Compile-time branded basis-points type.
 * Prevents accidental assignment of raw bigint to BPS fields.
 */
export type BasisPoints = bigint & { readonly __brand: 'basis_points' };

/**
 * Compile-time branded account identifier.
 * Prevents accidental assignment of raw strings to account ID fields.
 */
export type AccountId = string & { readonly __brand: 'account_id' };

/**
 * Construct a validated MicroUSD value.
 * @throws {RangeError} if value is negative
 */
export function microUSD(value: bigint): MicroUSD {
  if (value < 0n) {
    throw new RangeError(`MicroUSD must be non-negative, got ${value}`);
  }
  return value as MicroUSD;
}

/**
 * Construct a validated BasisPoints value.
 * @throws {RangeError} if value not in [0, 10000]
 */
export function basisPoints(value: bigint): BasisPoints {
  if (value < 0n || value > 10000n) {
    throw new RangeError(`BasisPoints must be in [0, 10000], got ${value}`);
  }
  return value as BasisPoints;
}

/**
 * Construct a validated AccountId value.
 * @throws {RangeError} if value is empty
 */
export function accountId(value: string): AccountId {
  if (!value) {
    throw new RangeError('AccountId must be non-empty');
  }
  return value as AccountId;
}

// =============================================================================
// Constants
// =============================================================================

/** 1 USD expressed in micro-USD */
export const MICRO_USD_PER_DOLLAR = 1_000_000n;

/** Default ceiling: $1,000,000 in micro-USD */
const DEFAULT_CEILING_MICRO = 1_000_000_000_000n; // $1M

/** PRD-defined maximum: $1,000,000,000 (1 billion USD) in micro-USD */
export const MAX_MICRO_USD = 1_000_000_000_000_000n; // $1B

// =============================================================================
// SafeArithmeticError
// =============================================================================

/**
 * Error thrown when a guarded arithmetic operation detects an invariant violation.
 * Includes operation name and operands for diagnostics.
 */
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
// Guarded Arithmetic Operations
// =============================================================================

/**
 * Safe addition of two micro-USD values.
 * @throws {SafeArithmeticError} if either input < 0 or result > MAX_MICRO_USD
 */
export function addMicroUSD(a: MicroUSD, b: MicroUSD): MicroUSD;
export function addMicroUSD(a: bigint, b: bigint): bigint;
export function addMicroUSD(a: bigint, b: bigint): bigint {
  if (a < 0n) throw new SafeArithmeticError('addMicroUSD', [a, b], `first operand is negative: ${a}`);
  if (b < 0n) throw new SafeArithmeticError('addMicroUSD', [a, b], `second operand is negative: ${b}`);
  const result = a + b;
  if (result > MAX_MICRO_USD) {
    throw new SafeArithmeticError('addMicroUSD', [a, b], `result ${result} exceeds MAX_MICRO_USD ${MAX_MICRO_USD}`);
  }
  return result;
}

/**
 * Safe subtraction of two micro-USD values.
 * @throws {SafeArithmeticError} if result < 0
 */
export function subtractMicroUSD(a: MicroUSD, b: MicroUSD): MicroUSD;
export function subtractMicroUSD(a: bigint, b: bigint): bigint;
export function subtractMicroUSD(a: bigint, b: bigint): bigint {
  if (a < 0n) throw new SafeArithmeticError('subtractMicroUSD', [a, b], `first operand is negative: ${a}`);
  if (b < 0n) throw new SafeArithmeticError('subtractMicroUSD', [a, b], `second operand is negative: ${b}`);
  const result = a - b;
  if (result < 0n) {
    throw new SafeArithmeticError('subtractMicroUSD', [a, b], `result would be negative: ${a} - ${b} = ${result}`);
  }
  return result;
}

/**
 * Safe BPS multiplication.
 * @throws {SafeArithmeticError} if bps not in [0, 10000]
 */
export function multiplyBPS(amount: bigint, bps: bigint): bigint {
  if (bps < 0n) throw new SafeArithmeticError('multiplyBPS', [amount, bps], `bps is negative: ${bps}`);
  if (bps > TOTAL_BPS) throw new SafeArithmeticError('multiplyBPS', [amount, bps], `bps exceeds 10000: ${bps}`);
  return (amount * bps) / TOTAL_BPS;
}

/**
 * Safe integer division with floor (BigInt division is floor by default).
 * @throws {SafeArithmeticError} if divisor is 0
 */
export function divideWithFloor(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new SafeArithmeticError('divideWithFloor', [a, b], 'division by zero');
  const q = a / b;
  const r = a % b;
  // BigInt division truncates toward zero; adjust to true floor for negative results
  if (r !== 0n && ((a < 0n && b > 0n) || (a > 0n && b < 0n))) {
    return q - 1n;
  }
  return q;
}

// =============================================================================
// Conversion Functions
// =============================================================================

/**
 * Convert a dollar amount to micro-USD.
 * Uses Math.round to avoid floating-point precision issues.
 *
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
 *
 * @example microToDollarsDisplay(1500000n) // => '$1.50'
 */
export function microToDollarsDisplay(micro: bigint): string {
  const sign = micro < 0n ? '-' : '';
  const abs = micro < 0n ? -micro : micro;
  let dollars = abs / MICRO_USD_PER_DOLLAR;
  const remainder = abs % MICRO_USD_PER_DOLLAR;
  // Round to nearest cent: divide remainder by 10000 with rounding
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

/**
 * Get the configurable ceiling for micro-USD values.
 */
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
 * Rejects negative values and values exceeding the configurable ceiling.
 *
 * @throws {RangeError} if value is negative or exceeds ceiling
 */
export function assertMicroUSD(value: MicroUSD): void;
export function assertMicroUSD(value: bigint): void;
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

// =============================================================================
// Zod Schemas
// =============================================================================

/**
 * Zod schema for validating micro-USD amounts from string input.
 * Accepts string or number input, coerces to bigint.
 */
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

/**
 * Zod schema for validating micro-USD with ceiling check.
 */
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
 * Required for JSON.stringify since BigInt is not JSON-serializable.
 *
 * @example serializeBigInt({ amount: 5000000n }) // => { amount: '5000000' }
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

// =============================================================================
// BPS (Basis Points) Arithmetic
// =============================================================================

/** Total basis points representing 100% */
export const TOTAL_BPS = 10000n;

/**
 * Calculate a basis-point share of a micro-USD amount.
 * Uses integer division (truncation toward zero).
 *
 * @example bpsShare(1000000n, 2500n) // => 250000n (25% of $1)
 */
export function bpsShare(amountMicro: MicroUSD, bps: BasisPoints): MicroUSD;
export function bpsShare(amountMicro: bigint, bps: bigint): bigint;
export function bpsShare(amountMicro: bigint, bps: bigint): bigint {
  return (amountMicro * bps) / TOTAL_BPS;
}

/**
 * Validate that basis point values sum to 10000 (100%).
 *
 * @throws {RangeError} if values don't sum to 10000
 */
export function assertBpsSum(...values: BasisPoints[]): void;
export function assertBpsSum(...values: bigint[]): void;
export function assertBpsSum(...values: bigint[]): void {
  const total = values.reduce((sum, v) => sum + v, 0n);
  if (total !== TOTAL_BPS) {
    throw new RangeError(
      `Basis points must sum to ${TOTAL_BPS}, got ${total}`
    );
  }
}
