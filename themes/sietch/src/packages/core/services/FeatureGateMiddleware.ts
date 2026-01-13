/**
 * FeatureGateMiddleware - Service Layer Feature Gating
 *
 * Sprint 60: Verification Tiers - Feature Gating
 *
 * Provides middleware functions for gating features based on verification tier.
 * Designed to be used at the service layer to enforce feature access control
 * before any business logic executes.
 *
 * Usage:
 * ```typescript
 * const gate = createFeatureGate(tiersService);
 *
 * // In service method
 * const result = await gate.requireFeature('full_profile', memberStatus);
 * if (!result.proceed) {
 *   return result.error;
 * }
 *
 * // Proceed with business logic
 * ```
 *
 * @module packages/core/services/FeatureGateMiddleware
 */

import type {
  VerificationTiersService,
  VerificationTier,
  FeatureId,
  MemberVerificationStatus,
  FeatureGateContext,
  FeatureGateResult,
  FeatureGateConfig,
  TierFeature,
} from './VerificationTiersService.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Feature gate options for batch checking
 */
export interface BatchFeatureGateOptions {
  /** Features to check */
  features: FeatureId[];
  /** Member's verification status */
  status: MemberVerificationStatus;
  /** Whether all features must be accessible (AND) or any (OR) */
  mode: 'all' | 'any';
}

/**
 * Result of batch feature check
 */
export interface BatchFeatureGateResult {
  /** Whether the check passed */
  passed: boolean;
  /** Individual results for each feature */
  results: Map<FeatureId, FeatureGateResult>;
  /** Features that were blocked */
  blockedFeatures: FeatureId[];
  /** Features that were allowed */
  allowedFeatures: FeatureId[];
}

/**
 * Feature restriction info for partial access
 */
export interface FeatureRestriction {
  /** Feature being restricted */
  featureId: FeatureId;
  /** Current tier */
  tier: VerificationTier;
  /** Is feature blurred? */
  blurred: boolean;
  /** Is feature locked? */
  locked: boolean;
  /** Custom message */
  message?: string;
}

// =============================================================================
// FeatureGate Class
// =============================================================================

/**
 * FeatureGate
 *
 * Service-layer middleware for enforcing verification tier requirements
 * on feature access. Provides multiple checking modes:
 * - requireFeature: Strict blocking
 * - checkFeature: Non-blocking check with result
 * - getRestrictions: Get restrictions for partial access
 */
export class FeatureGate {
  private tiersService: VerificationTiersService;

  constructor(tiersService: VerificationTiersService) {
    this.tiersService = tiersService;
  }

  // ===========================================================================
  // Core Gating Methods
  // ===========================================================================

  /**
   * Require a feature - blocks if not accessible
   *
   * @param featureId - Feature to check
   * @param status - Member's verification status
   * @param config - Optional configuration
   * @returns Gate result with proceed flag and context/error
   */
  requireFeature(
    featureId: FeatureId,
    status: MemberVerificationStatus,
    config?: Partial<FeatureGateConfig>
  ): FeatureGateResult {
    const accessResult = this.tiersService.canAccess({ featureId, status });
    const tier = this.tiersService.getMemberTier(status);

    if (accessResult.allowed) {
      return {
        proceed: true,
        context: {
          communityId: status.communityId,
          memberId: status.memberId,
          status,
          tier,
        },
      };
    }

    // Access denied
    const errorMessage =
      config?.errorMessage ||
      `This feature requires ${this.tiersService.getTierDisplayName(accessResult.requiredTier)} tier`;

    return {
      proceed: false,
      error: {
        code: this.getErrorCode(tier, accessResult.requiredTier),
        message: errorMessage,
        requiredTier: accessResult.requiredTier,
        upgradeAction: accessResult.upgradeAction,
      },
    };
  }

  /**
   * Check feature access without blocking
   *
   * @param featureId - Feature to check
   * @param status - Member's verification status
   * @returns Whether feature is accessible
   */
  checkFeature(featureId: FeatureId, status: MemberVerificationStatus): boolean {
    const accessResult = this.tiersService.canAccess({ featureId, status });
    return accessResult.allowed;
  }

  /**
   * Check multiple features at once
   *
   * @param options - Batch check options
   * @returns Batch result with individual feature results
   */
  checkFeatures(options: BatchFeatureGateOptions): BatchFeatureGateResult {
    const { features, status, mode } = options;
    const results = new Map<FeatureId, FeatureGateResult>();
    const blockedFeatures: FeatureId[] = [];
    const allowedFeatures: FeatureId[] = [];

    for (const featureId of features) {
      const result = this.requireFeature(featureId, status);
      results.set(featureId, result);

      if (result.proceed) {
        allowedFeatures.push(featureId);
      } else {
        blockedFeatures.push(featureId);
      }
    }

    const passed =
      mode === 'all' ? blockedFeatures.length === 0 : allowedFeatures.length > 0;

    return {
      passed,
      results,
      blockedFeatures,
      allowedFeatures,
    };
  }

  // ===========================================================================
  // Restriction Methods
  // ===========================================================================

  /**
   * Get restrictions for a feature at the current tier
   *
   * For features that are partially accessible (with restrictions),
   * returns the restriction details.
   *
   * @param featureId - Feature to check
   * @param status - Member's verification status
   * @returns Restriction info if any, null if fully accessible
   */
  getRestrictions(
    featureId: FeatureId,
    status: MemberVerificationStatus
  ): FeatureRestriction | null {
    const tier = this.tiersService.getMemberTier(status);
    const tierFeatures = this.tiersService.getFeatures(tier);

    const feature = tierFeatures.features.find((f) => f.featureId === featureId);

    if (!feature) {
      // Feature not available at this tier - return locked restriction
      return {
        featureId,
        tier,
        blurred: false,
        locked: true,
        message: `Requires ${this.getRequiredTierName(featureId)} to access`,
      };
    }

    if (!feature.restrictions) {
      // No restrictions - fully accessible
      return null;
    }

    return {
      featureId,
      tier,
      blurred: feature.restrictions.blurred ?? false,
      locked: feature.restrictions.locked ?? false,
      message: feature.restrictions.message,
    };
  }

  /**
   * Check if a feature has restrictions at the current tier
   *
   * @param featureId - Feature to check
   * @param status - Member's verification status
   * @returns True if feature has restrictions
   */
  hasRestrictions(featureId: FeatureId, status: MemberVerificationStatus): boolean {
    const restriction = this.getRestrictions(featureId, status);
    return restriction !== null;
  }

  // ===========================================================================
  // Context Builders
  // ===========================================================================

  /**
   * Build feature gate context from verification status
   *
   * @param status - Member's verification status
   * @returns Feature gate context
   */
  buildContext(status: MemberVerificationStatus): FeatureGateContext {
    return {
      communityId: status.communityId,
      memberId: status.memberId,
      status,
      tier: this.tiersService.getMemberTier(status),
    };
  }

  /**
   * Get all accessible features for a member
   *
   * @param status - Member's verification status
   * @returns Array of accessible feature IDs
   */
  getAccessibleFeatures(status: MemberVerificationStatus): FeatureId[] {
    const tier = this.tiersService.getMemberTier(status);
    const tierFeatures = this.tiersService.getFeatures(tier);
    return tierFeatures.features.filter((f) => f.enabled).map((f) => f.featureId);
  }

  /**
   * Get features that are locked for a member
   *
   * @param status - Member's verification status
   * @returns Array of locked feature IDs with unlock info
   */
  getLockedFeatures(
    status: MemberVerificationStatus
  ): Array<{ featureId: FeatureId; requiredTier: VerificationTier; upgradeAction: string }> {
    const allFeatureAccess = this.tiersService.getAllFeatureAccess(status);
    const locked: Array<{
      featureId: FeatureId;
      requiredTier: VerificationTier;
      upgradeAction: string;
    }> = [];

    for (const [featureId, result] of allFeatureAccess) {
      if (!result.allowed) {
        locked.push({
          featureId,
          requiredTier: result.requiredTier,
          upgradeAction: result.upgradeAction || 'Upgrade your tier',
        });
      }
    }

    return locked;
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Get appropriate error code based on tier comparison
   */
  private getErrorCode(
    currentTier: VerificationTier,
    requiredTier: VerificationTier
  ): 'FEATURE_LOCKED' | 'TIER_REQUIRED' | 'NOT_VERIFIED' {
    if (currentTier === 'incumbent_only') {
      if (requiredTier === 'arrakis_basic') {
        return 'NOT_VERIFIED';
      }
      return 'FEATURE_LOCKED';
    }

    if (currentTier === 'arrakis_basic' && requiredTier === 'arrakis_full') {
      return 'TIER_REQUIRED';
    }

    return 'FEATURE_LOCKED';
  }

  /**
   * Get the required tier display name for a feature
   */
  private getRequiredTierName(featureId: FeatureId): string {
    const accessResult = this.tiersService.canAccess({
      featureId,
      status: {
        communityId: '',
        memberId: '',
        hasIncumbentAccess: false,
        hasArrakisWallet: false,
        isArrakisVerified: false,
      },
    });
    return this.tiersService.getTierDisplayName(accessResult.requiredTier);
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new FeatureGate instance
 *
 * @param tiersService - VerificationTiersService instance
 * @returns FeatureGate instance
 */
export function createFeatureGate(tiersService: VerificationTiersService): FeatureGate {
  return new FeatureGate(tiersService);
}

// =============================================================================
// Decorator-style Helpers
// =============================================================================

/**
 * Create a feature guard function for a specific feature
 *
 * @param gate - FeatureGate instance
 * @param featureId - Feature to guard
 * @param config - Optional configuration
 * @returns Guard function that checks access
 */
export function createFeatureGuard(
  gate: FeatureGate,
  featureId: FeatureId,
  config?: Partial<FeatureGateConfig>
): (status: MemberVerificationStatus) => FeatureGateResult {
  return (status: MemberVerificationStatus) => gate.requireFeature(featureId, status, config);
}

/**
 * Create a multi-feature guard function
 *
 * @param gate - FeatureGate instance
 * @param features - Features to guard
 * @param mode - Check mode ('all' or 'any')
 * @returns Guard function that checks access to multiple features
 */
export function createMultiFeatureGuard(
  gate: FeatureGate,
  features: FeatureId[],
  mode: 'all' | 'any' = 'all'
): (status: MemberVerificationStatus) => BatchFeatureGateResult {
  return (status: MemberVerificationStatus) =>
    gate.checkFeatures({ features, status, mode });
}
