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
    description: '$5 credit pack — great for trying out the platform',
  },
  {
    id: 'builder',
    name: 'Builder',
    priceMicro: 10_000_000n, // $10
    description: '$10 credit pack — for regular builders',
  },
  {
    id: 'pro',
    name: 'Pro',
    priceMicro: 25_000_000n, // $25
    description: '$25 credit pack — best value for power users',
  },
];

/** Default markup factor (1.0 = at-cost, no markup) */
export const DEFAULT_MARKUP_FACTOR = 1.0;

// =============================================================================
// Functions
// =============================================================================

/**
 * Look up a tier by ID and calculate credits at the given markup.
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

  const creditsMicro = calculateCredits(tier.priceMicro, markupFactor);
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
      const credits = calculateCredits(tier.priceMicro, markupFactor);
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
