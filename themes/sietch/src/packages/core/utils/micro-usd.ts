/**
 * BigInt Safety Utilities for Micro-USD Precision
 *
 * FACADE: Re-exports from protocol/arrakis-arithmetic.ts (canonical @0xhoneyjar/loa-hounfour v7.0.0).
 * Existing imports continue to work. New code should import from
 * '../protocol/arrakis-arithmetic.js' directly.
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
  multiplyBPS,
  bpsShare,
  assertBpsSum,
  TOTAL_BPS,
} from '../protocol/arrakis-arithmetic.js';
