/**
 * Feature Matrix Definition (v4.0 - Sprint 25)
 *
 * Defines the feature-to-tier mapping for all gated features.
 * Used by GatekeeperService to enforce subscription-based access control.
 *
 * Tier hierarchy: enterprise > elite > exclusive > premium > basic > starter
 */

import type { Feature, SubscriptionTier } from '../../types/billing.js';

// =============================================================================
// Feature Matrix
// =============================================================================

/**
 * Map of features to the minimum tier required to access them
 *
 * Features are inherited: if a feature requires 'premium', then
 * exclusive, elite, and enterprise tiers also have access.
 */
export const FEATURE_MATRIX: Record<Feature, SubscriptionTier> = {
  // Starter tier (Free) - Core features
  discord_bot: 'starter',
  basic_onboarding: 'starter',
  member_profiles: 'starter',

  // Basic tier ($29/mo) - Enhanced features
  stats_leaderboard: 'basic',
  position_alerts: 'basic',
  custom_nym: 'basic',

  // Premium tier ($99/mo) - Advanced features
  nine_tier_system: 'premium',
  custom_pfp: 'premium',
  weekly_digest: 'premium',
  activity_tracking: 'premium',
  score_badge: 'premium', // Free for Premium+, purchasable for lower tiers

  // Exclusive tier ($199/mo) - Premium features
  admin_analytics: 'exclusive',
  naib_dynamics: 'exclusive',
  water_sharer_badge: 'exclusive',

  // Elite tier ($449/mo) - Enterprise-lite features
  custom_branding: 'elite',
  priority_support: 'elite',
  api_access: 'elite',

  // Enterprise tier (Custom) - All features
  white_label: 'enterprise',
  dedicated_support: 'enterprise',
  custom_integrations: 'enterprise',
};

// =============================================================================
// Member Limits by Tier
// =============================================================================

/**
 * Maximum verified members allowed per tier
 */
export const MEMBER_LIMITS: Record<SubscriptionTier, number> = {
  starter: 100, // Free tier
  basic: 500,
  premium: 1000,
  exclusive: 2500,
  elite: 10000,
  enterprise: Infinity, // Unlimited
};

// =============================================================================
// Tier Display Information
// =============================================================================

/**
 * Human-readable tier information for UI display
 */
export const TIER_INFO: Record<
  SubscriptionTier,
  {
    name: string;
    description: string;
    price: number; // Monthly price in USD (0 for free/custom)
  }
> = {
  starter: {
    name: 'Starter',
    description: 'Free tier with basic features',
    price: 0,
  },
  basic: {
    name: 'Basic',
    description: 'Essential features for growing communities',
    price: 29,
  },
  premium: {
    name: 'Premium',
    description: 'Advanced features for engaged communities',
    price: 99,
  },
  exclusive: {
    name: 'Exclusive',
    description: 'Premium features for established communities',
    price: 199,
  },
  elite: {
    name: 'Elite',
    description: 'Enterprise-grade features for large communities',
    price: 449,
  },
  enterprise: {
    name: 'Enterprise',
    description: 'Custom solutions with unlimited scale',
    price: 0, // Contact for pricing
  },
};

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check if a tier satisfies a minimum tier requirement
 *
 * @param currentTier - Tier to check
 * @param requiredTier - Minimum tier required
 * @returns True if currentTier >= requiredTier
 */
export function tierSatisfiesRequirement(
  currentTier: SubscriptionTier,
  requiredTier: SubscriptionTier
): boolean {
  const tierHierarchy: Record<SubscriptionTier, number> = {
    starter: 0,
    basic: 1,
    premium: 2,
    exclusive: 3,
    elite: 4,
    enterprise: 5,
  };

  return tierHierarchy[currentTier] >= tierHierarchy[requiredTier];
}

/**
 * Get all features available for a given tier
 *
 * @param tier - Subscription tier
 * @returns Array of features available to this tier
 */
export function getFeaturesForTier(tier: SubscriptionTier): Feature[] {
  const features: Feature[] = [];

  for (const [feature, requiredTier] of Object.entries(FEATURE_MATRIX)) {
    if (tierSatisfiesRequirement(tier, requiredTier)) {
      features.push(feature as Feature);
    }
  }

  return features;
}

/**
 * Get the required tier for a specific feature
 *
 * @param feature - Feature to check
 * @returns Minimum tier required for this feature
 */
export function getRequiredTierForFeature(feature: Feature): SubscriptionTier {
  return FEATURE_MATRIX[feature];
}

/**
 * Get member limit for a tier
 *
 * @param tier - Subscription tier
 * @returns Maximum members allowed
 */
export function getMemberLimitForTier(tier: SubscriptionTier): number {
  return MEMBER_LIMITS[tier];
}
