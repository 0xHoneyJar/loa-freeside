/**
 * FeatureGate Implementation
 *
 * Sprint S-25: Shadow Sync Job & Verification Tiers
 *
 * Implements IFeatureGate for tier-based feature access control.
 * Enforces verification tier restrictions at the service layer.
 *
 * @see SDD §7.1 Shadow Mode Architecture
 */

import type { Logger } from 'pino';
import type {
  IFeatureGate,
  FeatureAccessResult,
  FeatureAccessContext,
  FeatureOverride,
  FeatureGateMiddleware,
  FeatureAccessDeniedError,
} from '@freeside/core/ports';
import {
  type Feature,
  type VerificationTier,
  type FeatureSet,
  FEATURE_SETS,
  getFeaturesForTier,
  isFeatureAvailable,
  getMinimumTierForFeature,
  compareTiers,
} from '@freeside/core/domain';

// =============================================================================
// Dependency Interfaces
// =============================================================================

/**
 * Community repository interface for tier lookups.
 */
export interface ICommunityTierRepository {
  /**
   * Get verification tier for a community.
   */
  getVerificationTier(communityId: string): Promise<VerificationTier | null>;
}

/**
 * Override store interface for persistent overrides.
 */
export interface IFeatureOverrideStore {
  /**
   * Get override for a community and feature.
   */
  getOverride(communityId: string, feature: Feature): Promise<FeatureOverride | null>;

  /**
   * Get all overrides for a community.
   */
  getOverrides(communityId: string): Promise<FeatureOverride[]>;

  /**
   * Save an override.
   */
  saveOverride(override: FeatureOverride): Promise<FeatureOverride>;

  /**
   * Delete an override.
   */
  deleteOverride(communityId: string, feature: Feature): Promise<boolean>;

  /**
   * Delete all expired overrides.
   */
  deleteExpiredOverrides(): Promise<number>;
}

// =============================================================================
// In-Memory Override Store (Default Implementation)
// =============================================================================

/**
 * Simple in-memory override store for development/testing.
 */
export class InMemoryFeatureOverrideStore implements IFeatureOverrideStore {
  private overrides = new Map<string, FeatureOverride>();

  private key(communityId: string, feature: Feature): string {
    return `${communityId}:${feature}`;
  }

  async getOverride(
    communityId: string,
    feature: Feature
  ): Promise<FeatureOverride | null> {
    const override = this.overrides.get(this.key(communityId, feature));
    if (!override) return null;

    // Check expiration
    if (override.expiresAt && override.expiresAt < new Date()) {
      this.overrides.delete(this.key(communityId, feature));
      return null;
    }

    return override;
  }

  async getOverrides(communityId: string): Promise<FeatureOverride[]> {
    const results: FeatureOverride[] = [];
    const now = new Date();

    for (const [key, override] of this.overrides) {
      if (!key.startsWith(`${communityId}:`)) continue;

      // Skip expired
      if (override.expiresAt && override.expiresAt < now) {
        this.overrides.delete(key);
        continue;
      }

      results.push(override);
    }

    return results;
  }

  async saveOverride(override: FeatureOverride): Promise<FeatureOverride> {
    this.overrides.set(this.key(override.communityId, override.feature), override);
    return override;
  }

  async deleteOverride(communityId: string, feature: Feature): Promise<boolean> {
    return this.overrides.delete(this.key(communityId, feature));
  }

  async deleteExpiredOverrides(): Promise<number> {
    const now = new Date();
    let deleted = 0;

    for (const [key, override] of this.overrides) {
      if (override.expiresAt && override.expiresAt < now) {
        this.overrides.delete(key);
        deleted++;
      }
    }

    return deleted;
  }
}

// =============================================================================
// FeatureGate Implementation
// =============================================================================

/**
 * Feature gate options.
 */
export interface FeatureGateOptions {
  /** Cache TTL for tier lookups in ms (default: 60000) */
  cacheTtlMs?: number;
  /** Whether to throw on access denied or return result (default: false) */
  throwOnDenied?: boolean;
}

/**
 * FeatureGate enforces tier-based feature access control.
 */
export class FeatureGate implements IFeatureGate {
  private readonly communities: ICommunityTierRepository;
  private readonly overrides: IFeatureOverrideStore;
  private readonly log: Logger;
  private readonly options: Required<FeatureGateOptions>;

  // Simple in-memory cache for tier lookups
  private tierCache = new Map<string, { tier: VerificationTier; expiresAt: number }>();

  constructor(
    communities: ICommunityTierRepository,
    overrides: IFeatureOverrideStore,
    logger: Logger,
    options?: FeatureGateOptions
  ) {
    this.communities = communities;
    this.overrides = overrides;
    this.log = logger.child({ component: 'FeatureGate' });
    this.options = {
      cacheTtlMs: options?.cacheTtlMs ?? 60000,
      throwOnDenied: options?.throwOnDenied ?? false,
    };
  }

  // ===========================================================================
  // Access Control
  // ===========================================================================

  /**
   * Check if a feature is accessible for a community.
   */
  async checkAccess(context: FeatureAccessContext): Promise<FeatureAccessResult> {
    const { communityId, feature } = context;

    // Get current tier
    const currentTier = await this.getTier(communityId);
    if (!currentTier) {
      return {
        allowed: false,
        currentTier: 'incumbent_only',
        requiredTier: getMinimumTierForFeature(feature),
        denialReason: 'Community not found or not configured',
      };
    }

    // Check for override first
    const override = await this.overrides.getOverride(communityId, feature);
    if (override) {
      this.log.debug(
        { communityId, feature, action: override.action, reason: override.reason },
        'Feature override applied'
      );

      return {
        allowed: override.action === 'allow',
        currentTier,
        requiredTier: getMinimumTierForFeature(feature),
        denialReason:
          override.action === 'deny'
            ? `Feature denied by override: ${override.reason}`
            : undefined,
      };
    }

    // Check tier-based access
    const requiredTier = getMinimumTierForFeature(feature);
    const allowed = isFeatureAvailable(feature, currentTier);

    const result: FeatureAccessResult = {
      allowed,
      currentTier,
      requiredTier,
    };

    if (!allowed && requiredTier) {
      result.denialReason = `Feature '${feature}' requires tier '${requiredTier}'`;
      result.upgradeSuggestion = this.getUpgradeSuggestion(currentTier, requiredTier);
    }

    return result;
  }

  /**
   * Check if multiple features are accessible.
   */
  async checkMultiple(
    communityId: string,
    features: Feature[]
  ): Promise<Map<Feature, FeatureAccessResult>> {
    const results = new Map<Feature, FeatureAccessResult>();

    // Get tier once for efficiency
    const currentTier = await this.getTier(communityId);

    // Get all overrides for community
    const overrides = await this.overrides.getOverrides(communityId);
    const overrideMap = new Map(
      overrides.map((o) => [o.feature, o])
    );

    for (const feature of features) {
      // Check override
      const override = overrideMap.get(feature);
      if (override) {
        results.set(feature, {
          allowed: override.action === 'allow',
          currentTier: currentTier ?? 'incumbent_only',
          requiredTier: getMinimumTierForFeature(feature),
          denialReason:
            override.action === 'deny'
              ? `Feature denied by override: ${override.reason}`
              : undefined,
        });
        continue;
      }

      // Check tier-based access
      if (!currentTier) {
        results.set(feature, {
          allowed: false,
          currentTier: 'incumbent_only',
          requiredTier: getMinimumTierForFeature(feature),
          denialReason: 'Community not found or not configured',
        });
        continue;
      }

      const requiredTier = getMinimumTierForFeature(feature);
      const allowed = isFeatureAvailable(feature, currentTier);

      results.set(feature, {
        allowed,
        currentTier,
        requiredTier,
        denialReason: allowed
          ? undefined
          : `Feature '${feature}' requires tier '${requiredTier}'`,
        upgradeSuggestion:
          allowed || !requiredTier
            ? undefined
            : this.getUpgradeSuggestion(currentTier, requiredTier),
      });
    }

    return results;
  }

  /**
   * Guard method that throws if feature is not accessible.
   */
  async requireAccess(context: FeatureAccessContext): Promise<void> {
    const result = await this.checkAccess(context);

    if (!result.allowed) {
      const error = new FeatureAccessDeniedErrorImpl(
        context.feature,
        result.currentTier,
        result.requiredTier,
        result.denialReason
      );

      this.log.warn(
        { communityId: context.communityId, feature: context.feature, reason: result.denialReason },
        'Feature access denied'
      );

      throw error;
    }
  }

  // ===========================================================================
  // Tier Operations
  // ===========================================================================

  /**
   * Get current verification tier for a community.
   */
  async getTier(communityId: string): Promise<VerificationTier | null> {
    // Check cache first
    const cached = this.tierCache.get(communityId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.tier;
    }

    // Fetch from repository
    const tier = await this.communities.getVerificationTier(communityId);
    if (!tier) {
      this.tierCache.delete(communityId);
      return null;
    }

    // Cache result
    this.tierCache.set(communityId, {
      tier,
      expiresAt: Date.now() + this.options.cacheTtlMs,
    });

    return tier;
  }

  /**
   * Get feature set for a tier.
   */
  getFeatureSet(tier: VerificationTier): FeatureSet {
    return FEATURE_SETS[tier];
  }

  /**
   * Get all features available for a community based on current tier.
   */
  async getAvailableFeatures(communityId: string): Promise<Feature[]> {
    const tier = await this.getTier(communityId);
    if (!tier) return [];
    return getFeaturesForTier(tier);
  }

  /**
   * Get features locked for a community (available at higher tiers).
   */
  async getLockedFeatures(
    communityId: string
  ): Promise<Array<{ feature: Feature; requiredTier: VerificationTier }>> {
    const currentTier = await this.getTier(communityId);
    if (!currentTier) return [];

    const availableFeatures = new Set(getFeaturesForTier(currentTier));
    const locked: Array<{ feature: Feature; requiredTier: VerificationTier }> = [];

    // Check all features from all tiers
    const allFeatures = getFeaturesForTier('arrakis_full');

    for (const feature of allFeatures) {
      if (!availableFeatures.has(feature)) {
        const requiredTier = getMinimumTierForFeature(feature);
        if (requiredTier) {
          locked.push({ feature, requiredTier });
        }
      }
    }

    return locked;
  }

  // ===========================================================================
  // Override Management
  // ===========================================================================

  /**
   * Add a feature override for a community.
   */
  async addOverride(
    override: Omit<FeatureOverride, 'createdAt'>
  ): Promise<FeatureOverride> {
    const fullOverride: FeatureOverride = {
      ...override,
      createdAt: new Date(),
    };

    const saved = await this.overrides.saveOverride(fullOverride);

    this.log.info(
      {
        communityId: override.communityId,
        feature: override.feature,
        action: override.action,
        reason: override.reason,
        expiresAt: override.expiresAt,
      },
      'Feature override added'
    );

    return saved;
  }

  /**
   * Remove a feature override.
   */
  async removeOverride(communityId: string, feature: Feature): Promise<boolean> {
    const removed = await this.overrides.deleteOverride(communityId, feature);

    if (removed) {
      this.log.info(
        { communityId, feature },
        'Feature override removed'
      );
    }

    return removed;
  }

  /**
   * Get all overrides for a community.
   */
  async getOverrides(communityId: string): Promise<FeatureOverride[]> {
    return this.overrides.getOverrides(communityId);
  }

  /**
   * Clean up expired overrides.
   */
  async cleanupExpiredOverrides(): Promise<number> {
    const deleted = await this.overrides.deleteExpiredOverrides();

    if (deleted > 0) {
      this.log.info({ deleted }, 'Cleaned up expired feature overrides');
    }

    return deleted;
  }

  // ===========================================================================
  // Middleware Support
  // ===========================================================================

  /**
   * Create middleware function for Express/Koa style handlers.
   */
  createMiddleware(feature: Feature): FeatureGateMiddleware {
    return async (
      communityId: string,
      guildId: string,
      next: () => Promise<void>
    ): Promise<void> => {
      await this.requireAccess({
        communityId,
        guildId,
        feature,
      });

      await next();
    };
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Get upgrade suggestion based on tier gap.
   */
  private getUpgradeSuggestion(
    currentTier: VerificationTier,
    requiredTier: VerificationTier
  ): string {
    const tierNames: Record<VerificationTier, string> = {
      incumbent_only: 'Shadow Mode',
      arrakis_basic: 'Parallel Mode',
      arrakis_full: 'Full Mode',
    };

    if (currentTier === 'incumbent_only' && requiredTier === 'arrakis_basic') {
      return 'Complete 14 days of shadow mode with 95% accuracy to unlock Parallel Mode features';
    }

    if (currentTier === 'incumbent_only' && requiredTier === 'arrakis_full') {
      return 'Progress through Parallel Mode first, then complete 30 days with 98% accuracy';
    }

    if (currentTier === 'arrakis_basic' && requiredTier === 'arrakis_full') {
      return 'Complete 30 days in Parallel Mode with 98% accuracy to unlock Full Mode features';
    }

    return `Upgrade from ${tierNames[currentTier]} to ${tierNames[requiredTier]} to access this feature`;
  }

  /**
   * Invalidate tier cache for a community.
   * Call this when tier is updated externally.
   */
  invalidateCache(communityId: string): void {
    this.tierCache.delete(communityId);
  }

  /**
   * Clear all cached tiers.
   */
  clearCache(): void {
    this.tierCache.clear();
  }
}

// =============================================================================
// Error Implementation
// =============================================================================

/**
 * Error thrown when feature access is denied.
 */
class FeatureAccessDeniedErrorImpl extends Error implements FeatureAccessDeniedError {
  readonly feature: Feature;
  readonly currentTier: VerificationTier;
  readonly requiredTier: VerificationTier | null;

  constructor(
    feature: Feature,
    currentTier: VerificationTier,
    requiredTier: VerificationTier | null,
    message?: string
  ) {
    super(
      message ??
        `Feature '${feature}' requires tier '${requiredTier}', current tier is '${currentTier}'`
    );
    this.name = 'FeatureAccessDeniedError';
    this.feature = feature;
    this.currentTier = currentTier;
    this.requiredTier = requiredTier;
  }
}

// Re-export error for external use
export { FeatureAccessDeniedErrorImpl as FeatureAccessDeniedError };

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a FeatureGate instance with default in-memory override store.
 */
export function createFeatureGate(
  communities: ICommunityTierRepository,
  logger: Logger,
  options?: FeatureGateOptions
): FeatureGate {
  return new FeatureGate(
    communities,
    new InMemoryFeatureOverrideStore(),
    logger,
    options
  );
}

/**
 * Create a FeatureGate instance with custom override store.
 */
export function createFeatureGateWithStore(
  communities: ICommunityTierRepository,
  overrides: IFeatureOverrideStore,
  logger: Logger,
  options?: FeatureGateOptions
): FeatureGate {
  return new FeatureGate(communities, overrides, logger, options);
}
