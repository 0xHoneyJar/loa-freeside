/**
 * Gatekeeper Service (v4.0 - Sprint 28)
 *
 * Central feature access control service implementing:
 * - Redis-cached entitlement checking (5-minute TTL)
 * - SQLite fallback when Redis unavailable
 * - Three-tier entitlement lookup: waiver → subscription → free
 * - Community boost level integration for enhanced perks
 * - Grace period handling
 * - Upgrade URL generation for denied features
 *
 * This service is the single source of truth for feature access decisions.
 */

import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { redisService } from '../cache/RedisService.js';
import {
  getEffectiveTier,
  getSubscriptionByCommunityId,
  getActiveFeeWaiver,
} from '../../db/billing-queries.js';
import {
  FEATURE_MATRIX,
  MEMBER_LIMITS,
  TIER_INFO,
  tierSatisfiesRequirement,
  getFeaturesForTier,
  getRequiredTierForFeature,
  getMemberLimitForTier,
} from './featureMatrix.js';
import type {
  Feature,
  SubscriptionTier,
  Entitlements,
  AccessResult,
  TierInfo,
  EntitlementSource,
  BoostLevel,
} from '../../types/billing.js';
import { getCommunityBoostLevel } from '../../db/boost-queries.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for checking feature access
 */
export interface CheckAccessParams {
  /** Community to check access for */
  communityId: string;
  /** Feature to check */
  feature: Feature;
}

/**
 * Parameters for getting current tier
 */
export interface GetTierParams {
  /** Community to check */
  communityId: string;
}

// =============================================================================
// Gatekeeper Service Class
// =============================================================================

class GatekeeperService {
  // ---------------------------------------------------------------------------
  // Feature Access Checking
  // ---------------------------------------------------------------------------

  /**
   * Check if a community has access to a specific feature
   *
   * This is the primary entrypoint for feature gating.
   * Uses cached entitlements when available, falls back to database lookup.
   *
   * @param params - Access check parameters
   * @returns Access result with canAccess boolean and context
   */
  async checkAccess(params: CheckAccessParams): Promise<AccessResult> {
    const { communityId, feature } = params;

    // Get entitlements (from cache or database)
    const entitlements = await this.getEntitlements(communityId);

    // Get required tier for this feature
    const requiredTier = getRequiredTierForFeature(feature);

    // Check if current tier satisfies requirement
    const canAccess = tierSatisfiesRequirement(entitlements.tier, requiredTier);

    logger.debug(
      {
        communityId,
        feature,
        currentTier: entitlements.tier,
        requiredTier,
        canAccess,
      },
      'Feature access check'
    );

    // Build result
    const result: AccessResult = {
      canAccess,
      tier: entitlements.tier,
      requiredTier,
      inGracePeriod: entitlements.inGracePeriod,
    };

    // If access denied, add upgrade URL and reason
    if (!canAccess) {
      result.upgradeUrl = this.getUpgradeUrl(communityId, requiredTier);
      result.reason = this.getDenialReason(
        entitlements.tier,
        requiredTier,
        feature
      );
    }

    return result;
  }

  /**
   * Check if a community has access to multiple features at once
   *
   * More efficient than calling checkAccess multiple times.
   *
   * @param communityId - Community to check
   * @param features - Features to check
   * @returns Map of feature to access result
   */
  async checkMultipleAccess(
    communityId: string,
    features: Feature[]
  ): Promise<Map<Feature, AccessResult>> {
    const entitlements = await this.getEntitlements(communityId);
    const results = new Map<Feature, AccessResult>();

    for (const feature of features) {
      const requiredTier = getRequiredTierForFeature(feature);
      const canAccess = tierSatisfiesRequirement(entitlements.tier, requiredTier);

      results.set(feature, {
        canAccess,
        tier: entitlements.tier,
        requiredTier,
        inGracePeriod: entitlements.inGracePeriod,
        upgradeUrl: canAccess
          ? undefined
          : this.getUpgradeUrl(communityId, requiredTier),
        reason: canAccess
          ? undefined
          : this.getDenialReason(entitlements.tier, requiredTier, feature),
      });
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Tier Information
  // ---------------------------------------------------------------------------

  /**
   * Get current tier information for a community
   *
   * @param params - Tier lookup parameters
   * @returns Tier information with source
   */
  async getCurrentTier(params: GetTierParams): Promise<TierInfo> {
    const { communityId } = params;

    const entitlements = await this.getEntitlements(communityId);

    return {
      tier: entitlements.tier,
      name: TIER_INFO[entitlements.tier].name,
      price: TIER_INFO[entitlements.tier].price,
      maxMembers: entitlements.maxMembers,
      source: entitlements.source,
      inGracePeriod: entitlements.inGracePeriod,
    };
  }

  // ---------------------------------------------------------------------------
  // Entitlement Lookup (Cache + Database)
  // ---------------------------------------------------------------------------

  /**
   * Get full entitlements for a community
   *
   * Flow:
   * 1. Check Redis cache (5-minute TTL)
   * 2. If cache miss, lookup from database
   * 3. Store result in Redis for next request
   * 4. Return entitlements
   *
   * @param communityId - Community to get entitlements for
   * @returns Full entitlement object
   */
  async getEntitlements(communityId: string): Promise<Entitlements> {
    // Step 1: Try Redis cache first
    try {
      const cached = await redisService.getEntitlements(communityId);
      if (cached) {
        logger.debug({ communityId }, 'Entitlements cache hit');
        return cached;
      }
    } catch (error) {
      logger.warn(
        { communityId, error: (error as Error).message },
        'Redis cache read failed, falling back to database'
      );
    }

    // Step 2: Cache miss, lookup from database
    logger.debug({ communityId }, 'Entitlements cache miss, looking up from database');
    const entitlements = await this.lookupEntitlementsFromDatabase(communityId);

    // Step 3: Cache result for next request
    try {
      await redisService.setEntitlements(communityId, entitlements);
    } catch (error) {
      logger.warn(
        { communityId, error: (error as Error).message },
        'Failed to cache entitlements in Redis'
      );
    }

    return entitlements;
  }

  /**
   * Lookup entitlements from database
   *
   * Priority: Active waiver > Active subscription > Free tier
   */
  private async lookupEntitlementsFromDatabase(
    communityId: string
  ): Promise<Entitlements> {
    // Check for active fee waiver first (highest priority)
    const waiver = getActiveFeeWaiver(communityId);
    if (waiver) {
      logger.debug({ communityId, tier: waiver.tier }, 'Using fee waiver');
      return this.buildEntitlements(
        communityId,
        waiver.tier,
        'waiver',
        false,
        undefined
      );
    }

    // Check for subscription
    const subscription = getSubscriptionByCommunityId(communityId);

    if (subscription) {
      // Active subscription
      if (subscription.status === 'active') {
        logger.debug(
          { communityId, tier: subscription.tier },
          'Using active subscription'
        );
        return this.buildEntitlements(
          communityId,
          subscription.tier,
          'subscription',
          false,
          undefined
        );
      }

      // Subscription in grace period
      if (
        subscription.status === 'past_due' &&
        subscription.graceUntil &&
        subscription.graceUntil > new Date()
      ) {
        logger.debug(
          {
            communityId,
            tier: subscription.tier,
            graceUntil: subscription.graceUntil,
          },
          'Using subscription in grace period'
        );
        return this.buildEntitlements(
          communityId,
          subscription.tier,
          'subscription',
          true,
          subscription.graceUntil
        );
      }
    }

    // Default to free tier
    logger.debug({ communityId }, 'Using free tier (starter)');
    return this.buildEntitlements(communityId, 'starter', 'free', false, undefined);
  }

  /**
   * Build entitlements object from tier and source
   */
  private buildEntitlements(
    communityId: string,
    tier: SubscriptionTier,
    source: EntitlementSource,
    inGracePeriod: boolean,
    graceUntil?: Date
  ): Entitlements {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes

    return {
      communityId,
      tier,
      maxMembers: getMemberLimitForTier(tier),
      features: getFeaturesForTier(tier),
      source,
      inGracePeriod,
      graceUntil,
      cachedAt: now,
      expiresAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Cache Invalidation
  // ---------------------------------------------------------------------------

  /**
   * Invalidate cached entitlements for a community
   *
   * Should be called whenever:
   * - Subscription is created/updated/canceled
   * - Fee waiver is granted/revoked
   * - Payment succeeds/fails
   *
   * @param communityId - Community to invalidate cache for
   */
  async invalidateCache(communityId: string): Promise<void> {
    try {
      await redisService.invalidateEntitlements(communityId);
      logger.info({ communityId }, 'Invalidated entitlements cache');
    } catch (error) {
      logger.warn(
        { communityId, error: (error as Error).message },
        'Failed to invalidate entitlements cache'
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Helper Methods
  // ---------------------------------------------------------------------------

  /**
   * Generate upgrade URL for a denied feature
   */
  private getUpgradeUrl(
    communityId: string,
    requiredTier: SubscriptionTier
  ): string {
    // In production, this would link to Stripe Checkout with pre-selected tier
    const baseUrl = process.env.UPGRADE_URL || 'https://sietch.io/upgrade';
    return `${baseUrl}?tier=${requiredTier}&community=${communityId}`;
  }

  /**
   * Generate human-readable denial reason
   */
  private getDenialReason(
    currentTier: SubscriptionTier,
    requiredTier: SubscriptionTier,
    feature: Feature
  ): string {
    const currentTierName = TIER_INFO[currentTier].name;
    const requiredTierName = TIER_INFO[requiredTier].name;

    return `Feature '${feature}' requires ${requiredTierName} tier. Your current tier is ${currentTierName}.`;
  }

  // ---------------------------------------------------------------------------
  // Convenience Methods
  // ---------------------------------------------------------------------------

  /**
   * Check if a community can add more members (member limit check)
   *
   * @param communityId - Community to check
   * @param currentMemberCount - Current number of members
   * @returns Whether more members can be added
   */
  async canAddMembers(
    communityId: string,
    currentMemberCount: number
  ): Promise<boolean> {
    const entitlements = await this.getEntitlements(communityId);
    return currentMemberCount < entitlements.maxMembers;
  }

  /**
   * Get the member limit for a community
   *
   * @param communityId - Community to check
   * @returns Maximum members allowed
   */
  async getMemberLimit(communityId: string): Promise<number> {
    const entitlements = await this.getEntitlements(communityId);
    return entitlements.maxMembers;
  }

  /**
   * Check if community is in grace period
   *
   * @param communityId - Community to check
   * @returns Whether in grace period
   */
  async isInGracePeriod(communityId: string): Promise<boolean> {
    const entitlements = await this.getEntitlements(communityId);
    return entitlements.inGracePeriod;
  }

  /**
   * Get all features available to a community
   *
   * @param communityId - Community to check
   * @returns Array of available features
   */
  async getAvailableFeatures(communityId: string): Promise<Feature[]> {
    const entitlements = await this.getEntitlements(communityId);
    return entitlements.features;
  }

  /**
   * Check if billing/gatekeeper is enabled
   *
   * @returns Whether gatekeeper enforcement is active
   */
  isEnabled(): boolean {
    return config.features?.gatekeeperEnabled ?? true;
  }

  // ---------------------------------------------------------------------------
  // Boost Integration (Sprint 28)
  // ---------------------------------------------------------------------------

  /**
   * Get boost level for a community
   *
   * @param communityId - Community to check
   * @returns Current boost level (0-3)
   */
  getBoostLevel(communityId: string): BoostLevel | 0 {
    try {
      return getCommunityBoostLevel(communityId);
    } catch (error) {
      logger.warn(
        { communityId, error: (error as Error).message },
        'Failed to get boost level, returning 0'
      );
      return 0;
    }
  }

  /**
   * Check if community has minimum boost level
   *
   * @param communityId - Community to check
   * @param minLevel - Minimum level required
   * @returns Whether boost level is sufficient
   */
  hasBoostLevel(communityId: string, minLevel: BoostLevel): boolean {
    const currentLevel = this.getBoostLevel(communityId);
    return currentLevel >= minLevel;
  }

  /**
   * Get enhanced entitlements including boost perks
   *
   * Combines subscription/waiver entitlements with boost-based perks.
   *
   * @param communityId - Community to check
   * @returns Entitlements with boost information
   */
  async getEnhancedEntitlements(communityId: string): Promise<Entitlements & { boostLevel: BoostLevel | 0 }> {
    const entitlements = await this.getEntitlements(communityId);
    const boostLevel = this.getBoostLevel(communityId);

    return {
      ...entitlements,
      boostLevel,
    };
  }
}

// =============================================================================
// Export Singleton
// =============================================================================

export const gatekeeperService = new GatekeeperService();
