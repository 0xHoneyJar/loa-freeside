/**
 * BigInt Safety Utilities for Micro-USD Precision
 *
 * FACADE: Re-exports from protocol/arithmetic.ts (vendored loa-hounfour).
 * Existing imports continue to work. New code should import from
 * '../protocol/arithmetic.js' directly.
 *
 * SDD refs: §2.1 Vendored Protocol Types
 */

export {
  assertMicroUSD,
  microUsdSchema,
  microUsdWithCeilingSchema,
  serializeBigInt,
  dollarsToMicro,
  microToDollarsDisplay,
  MICRO_USD_PER_DOLLAR,
  bpsShare,
  assertBpsSum,
  TOTAL_BPS,
} from '../protocol/arithmetic.js';
