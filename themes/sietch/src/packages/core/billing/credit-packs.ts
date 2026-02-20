/**
 * Credit Pack Tier Definitions
 *
 * Defines the available credit pack tiers with pricing.
 * Credits minted per pack = calculateCredits(tier.priceMicro, config.markupFactor).
 *
 * Sprint refs: Task 4.3
 *
 * @module packages/core/billing/credit-packs
 */

import { calculateCredits, MIN_CREDIT_ISSUANCE } from './pricing.js';

// =============================================================================
// Types
// =============================================================================

export interface CreditPackTier {
  /** Unique tier identifier */
  id: string;
  /** Display name */
  name: string;
  /** Price in micro-USD */
  priceMicro: bigint;
  /** Bonus in basis points (500 = 5%, 1000 = 10%). Applied after markup. */
  bonusBps: number;
  /** Human-readable description */
  description: string;
}

export interface CreditPackConfig {
  /** Markup factor for credits calculation (>= 1.0) */
  markupFactor: number;
  /** Available tiers */
  tiers: readonly CreditPackTier[];
}

export interface ResolvedCreditPack {
  /** Tier definition */
  tier: CreditPackTier;
  /** Credits the buyer receives (in micro-USD) */
  creditsMicro: bigint;
}

// =============================================================================
// Default Tiers
// =============================================================================

export const CREDIT_PACK_TIERS: readonly CreditPackTier[] = [
  {
    id: 'starter',
    name: 'Starter',
    priceMicro: 5_000_000n,  // $5
    bonusBps: 0,             // 0% bonus
    description: '$5 credit pack — great for trying out the platform',
  },
  {
    id: 'standard',
    name: 'Standard',
    priceMicro: 10_000_000n, // $10
    bonusBps: 500,           // 5% bonus → 10,500,000 micro-credits
    description: '$10 credit pack — 5% bonus for regular users',
  },
  {
    id: 'premium',
    name: 'Premium',
    priceMicro: 25_000_000n, // $25
    bonusBps: 1000,          // 10% bonus → 27,500,000 micro-credits
    description: '$25 credit pack — 10% bonus, best value for power users',
  },
];

/** Default markup factor (1.0 = at-cost, no markup) */
export const DEFAULT_MARKUP_FACTOR = 1.0;

// =============================================================================
// Functions
// =============================================================================

/**
 * Apply bonus basis points to base credits using pure BigInt arithmetic.
 * 500 bps = 5%, 1000 bps = 10%.
 *
 * Formula: base + floor(base * bonusBps / 10_000)
 */
function applyBonusBps(baseCreditsMicro: bigint, bonusBps: number): bigint {
  if (bonusBps <= 0) return baseCreditsMicro;
  const bonus = (baseCreditsMicro * BigInt(bonusBps)) / 10_000n;
  return baseCreditsMicro + bonus;
}

/**
 * Look up a tier by ID and calculate credits at the given markup,
 * then apply the tier's bonus basis points.
 *
 * @returns ResolvedCreditPack with tier + credits, or null if tier not found
 */
export function resolveCreditPack(
  packId: string,
  markupFactor: number,
  tiers: readonly CreditPackTier[] = CREDIT_PACK_TIERS,
): ResolvedCreditPack | null {
  const tier = tiers.find(t => t.id === packId);
  if (!tier) return null;

  const baseCreditsMicro = calculateCredits(tier.priceMicro, markupFactor);
  const creditsMicro = applyBonusBps(baseCreditsMicro, tier.bonusBps);
  return { tier, creditsMicro };
}

/**
 * Validate that all tiers produce valid credit amounts at the given markup.
 * Returns an array of error messages (empty = valid).
 */
export function validateTierConfig(
  markupFactor: number,
  tiers: readonly CreditPackTier[] = CREDIT_PACK_TIERS,
): string[] {
  const errors: string[] = [];

  for (const tier of tiers) {
    try {
      const baseCreditsMicro = calculateCredits(tier.priceMicro, markupFactor);
      const credits = applyBonusBps(baseCreditsMicro, tier.bonusBps);
      if (credits < MIN_CREDIT_ISSUANCE) {
        errors.push(
          `Tier "${tier.id}" yields ${credits} credits, below minimum ${MIN_CREDIT_ISSUANCE}`,
        );
      }
    } catch (e) {
      errors.push(`Tier "${tier.id}": ${(e as Error).message}`);
    }
  }

  return errors;
}
