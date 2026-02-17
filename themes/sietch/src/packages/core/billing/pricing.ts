/**
 * Cost→Price Markup Calculator
 *
 * Converts a credit pack price (in micro-USD) to the number of credits
 * the buyer receives. The markup factor controls the exchange rate:
 * higher markup = fewer credits per dollar.
 *
 * Uses floor rounding via divideWithFloor from the protocol arithmetic
 * module — the buyer never receives fractional micro-USD credits.
 *
 * Sprint refs: Task 4.2
 *
 * @module packages/core/billing/pricing
 */

import {
  divideWithFloor,
  MAX_MICRO_USD,
  SafeArithmeticError,
} from '../protocol/arrakis-arithmetic.js';

/** Minimum credit issuance: 0.001 USD in micro-USD */
export const MIN_CREDIT_ISSUANCE = 1000n;

/** Minimum markup factor (1.0 = at-cost) */
const MIN_MARKUP = 1.0;

/** Maximum markup factor (10x) */
const MAX_MARKUP = 10.0;

/**
 * Calculate the credits (in micro-USD) a buyer receives for a given price.
 *
 * credits = floor(priceMicro / markupFactor)
 *
 * @param priceMicro - Pack price in micro-USD (must be > 0 and <= MAX_MICRO_USD)
 * @param markupFactor - Multiplier >= 1.0 and <= 10.0
 * @returns Credits in micro-USD (always >= MIN_CREDIT_ISSUANCE)
 *
 * @throws {SafeArithmeticError} if markupFactor out of range
 * @throws {SafeArithmeticError} if priceMicro out of range
 * @throws {SafeArithmeticError} if result below MIN_CREDIT_ISSUANCE
 */
export function calculateCredits(priceMicro: bigint, markupFactor: number): bigint {
  if (priceMicro <= 0n) {
    throw new SafeArithmeticError(
      'calculateCredits',
      [priceMicro],
      `priceMicro must be > 0, got ${priceMicro}`,
    );
  }
  if (priceMicro > MAX_MICRO_USD) {
    throw new SafeArithmeticError(
      'calculateCredits',
      [priceMicro],
      `priceMicro exceeds MAX_MICRO_USD (${MAX_MICRO_USD})`,
    );
  }
  if (!Number.isFinite(markupFactor) || markupFactor < MIN_MARKUP || markupFactor > MAX_MARKUP) {
    throw new SafeArithmeticError(
      'calculateCredits',
      [priceMicro],
      `markupFactor must be >= ${MIN_MARKUP} and <= ${MAX_MARKUP}, got ${markupFactor}`,
    );
  }

  // Convert markup to integer arithmetic: multiply priceMicro by 1_000_000
  // then divide by (markupFactor * 1_000_000) for precision
  const scaleFactor = 1_000_000n;
  const markupScaled = BigInt(Math.round(markupFactor * 1_000_000));
  const credits = divideWithFloor(priceMicro * scaleFactor, markupScaled);

  if (credits < MIN_CREDIT_ISSUANCE) {
    throw new SafeArithmeticError(
      'calculateCredits',
      [priceMicro, credits],
      `result ${credits} is below MIN_CREDIT_ISSUANCE (${MIN_CREDIT_ISSUANCE})`,
    );
  }

  return credits;
}
