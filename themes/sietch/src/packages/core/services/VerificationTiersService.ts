/**
 * VerificationTiersService - Feature Gating Based on Verification Status
 *
 * Sprint 60: Verification Tiers - Feature Gating
 *
 * Implements a three-tier verification system that gates features based on
 * the user's verification status in the coexistence context:
 *
 * - Tier 1 (incumbent_only): Users only verified via incumbent (Collab.Land, etc.)
 *   - Shadow tracking, public leaderboard (wallet hidden)
 *
 * - Tier 2 (arrakis_basic): Users with wallet connected but not fully verified
 *   - Tier 1 + profile view, conviction score preview
 *
 * - Tier 3 (arrakis_full): Fully verified Arrakis users
 *   - Full badges, tier progression, all social features
 *
 * @module packages/core/services/VerificationTiersService
 */

import type { ICoexistenceStorage } from '../ports/ICoexistenceStorage.js';

// =============================================================================
// Types (TASK-60.1, TASK-60.2)
// =============================================================================

/**
 * Verification tier levels
 *
 * These represent the user's progression through the Arrakis verification system
 * while coexisting with incumbent token-gating solutions.
 */
export type VerificationTier = 'incumbent_only' | 'arrakis_basic' | 'arrakis_full';

/**
 * Feature identifiers that can be gated by verification tier
 */
export type FeatureId =
  // Tier 1 features (incumbent_only)
  | 'shadow_tracking'
  | 'public_leaderboard'
  | 'leaderboard_position'
  // Tier 2 features (arrakis_basic)
  | 'profile_view'
  | 'conviction_preview'
  | 'tier_preview'
  | 'badge_preview'
  // Tier 3 features (arrakis_full)
  | 'full_profile'
  | 'badge_showcase'
  | 'tier_progression'
  | 'social_features'
  | 'water_sharing'
  | 'directory_listing'
  | 'activity_tracking'
  | 'conviction_history'
  | 'leaderboard_wallet_visible';

/**
 * Feature configuration for a specific tier
 */
export interface TierFeature {
  /** Feature identifier */
  featureId: FeatureId;
  /** Whether the feature is enabled at this tier */
  enabled: boolean;
  /** Optional restrictions or limitations */
  restrictions?: {
    /** Whether data is blurred/hidden */
    blurred?: boolean;
    /** Whether data is locked (visible but not actionable) */
    locked?: boolean;
    /** Custom restriction message */
    message?: string;
  };
}

/**
 * Complete feature set for a verification tier
 */
export interface TierFeatures {
  /** Verification tier */
  tier: VerificationTier;
  /** Display name for the tier */
  displayName: string;
  /** Description of the tier */
  description: string;
  /** Features available at this tier */
  features: TierFeature[];
  /** Upgrade path information */
  upgradeTo?: {
    tier: VerificationTier;
    displayName: string;
    action: string;
  };
}

/**
 * Member verification status for tier determination
 */
export interface MemberVerificationStatus {
  /** Community ID */
  communityId: string;
  /** Member's Discord ID */
  memberId: string;
  /** Whether member has incumbent-granted roles */
  hasIncumbentAccess: boolean;
  /** Whether member has connected an Arrakis wallet */
  hasArrakisWallet: boolean;
  /** Whether member has completed full Arrakis verification */
  isArrakisVerified: boolean;
  /** Wallet address if connected */
  walletAddress?: string;
  /** When wallet was connected */
  walletConnectedAt?: Date;
}

/**
 * Options for feature access check
 */
export interface CanAccessOptions {
  /** Feature to check access for */
  featureId: FeatureId;
  /** Member's verification status */
  status: MemberVerificationStatus;
}

/**
 * Result of feature access check
 */
export interface CanAccessResult {
  /** Whether access is allowed */
  allowed: boolean;
  /** Current tier */
  tier: VerificationTier;
  /** Required tier for this feature */
  requiredTier: VerificationTier;
  /** Reason if denied */
  reason?: string;
  /** Action to gain access */
  upgradeAction?: string;
}

// =============================================================================
// Feature Matrix Constants
// =============================================================================

/**
 * Features available at Tier 1 (incumbent_only)
 */
const TIER_1_FEATURES: TierFeature[] = [
  { featureId: 'shadow_tracking', enabled: true },
  { featureId: 'public_leaderboard', enabled: true },
  {
    featureId: 'leaderboard_position',
    enabled: true,
    restrictions: { message: 'Your wallet is hidden from others' },
  },
];

/**
 * Features available at Tier 2 (arrakis_basic)
 * Includes all Tier 1 features plus additional ones
 */
const TIER_2_FEATURES: TierFeature[] = [
  ...TIER_1_FEATURES,
  { featureId: 'profile_view', enabled: true },
  {
    featureId: 'conviction_preview',
    enabled: true,
    restrictions: { message: 'Preview only - full history requires verification' },
  },
  {
    featureId: 'tier_preview',
    enabled: true,
    restrictions: { message: 'Preview only - progression requires verification' },
  },
  {
    featureId: 'badge_preview',
    enabled: true,
    restrictions: { blurred: true, message: 'Connect wallet to unlock badges' },
  },
];

/**
 * Features available at Tier 3 (arrakis_full)
 * All features unlocked
 */
const TIER_3_FEATURES: TierFeature[] = [
  // Tier 1 features (unlocked)
  { featureId: 'shadow_tracking', enabled: true },
  { featureId: 'public_leaderboard', enabled: true },
  { featureId: 'leaderboard_position', enabled: true },
  { featureId: 'leaderboard_wallet_visible', enabled: true },
  // Tier 2 features (unlocked)
  { featureId: 'profile_view', enabled: true },
  { featureId: 'conviction_preview', enabled: true },
  { featureId: 'tier_preview', enabled: true },
  { featureId: 'badge_preview', enabled: true },
  // Tier 3 exclusive features
  { featureId: 'full_profile', enabled: true },
  { featureId: 'badge_showcase', enabled: true },
  { featureId: 'tier_progression', enabled: true },
  { featureId: 'social_features', enabled: true },
  { featureId: 'water_sharing', enabled: true },
  { featureId: 'directory_listing', enabled: true },
  { featureId: 'activity_tracking', enabled: true },
  { featureId: 'conviction_history', enabled: true },
];

/**
 * Map of feature ID to minimum required tier
 */
const FEATURE_TIER_REQUIREMENTS: Record<FeatureId, VerificationTier> = {
  // Tier 1 features
  shadow_tracking: 'incumbent_only',
  public_leaderboard: 'incumbent_only',
  leaderboard_position: 'incumbent_only',
  // Tier 2 features
  profile_view: 'arrakis_basic',
  conviction_preview: 'arrakis_basic',
  tier_preview: 'arrakis_basic',
  badge_preview: 'arrakis_basic',
  // Tier 3 features
  full_profile: 'arrakis_full',
  badge_showcase: 'arrakis_full',
  tier_progression: 'arrakis_full',
  social_features: 'arrakis_full',
  water_sharing: 'arrakis_full',
  directory_listing: 'arrakis_full',
  activity_tracking: 'arrakis_full',
  conviction_history: 'arrakis_full',
  leaderboard_wallet_visible: 'arrakis_full',
};

/**
 * Tier hierarchy for comparison (higher = more access)
 */
const TIER_HIERARCHY: Record<VerificationTier, number> = {
  incumbent_only: 1,
  arrakis_basic: 2,
  arrakis_full: 3,
};

// =============================================================================
// VerificationTiersService Implementation
// =============================================================================

/**
 * VerificationTiersService
 *
 * Provides feature gating based on user verification status in the
 * coexistence context. Stateless service that evaluates tier membership
 * and feature access.
 */
export class VerificationTiersService {
  private storage: ICoexistenceStorage;

  constructor(storage: ICoexistenceStorage) {
    this.storage = storage;
  }

  // ===========================================================================
  // Core Methods (TASK-60.3, TASK-60.4, TASK-60.5)
  // ===========================================================================

  /**
   * Get the verification tier for a member based on their status
   *
   * @param status - Member's verification status
   * @returns The member's current verification tier
   */
  getMemberTier(status: MemberVerificationStatus): VerificationTier {
    // Tier 3: Fully verified Arrakis user
    if (status.isArrakisVerified && status.hasArrakisWallet) {
      return 'arrakis_full';
    }

    // Tier 2: Has Arrakis wallet but not fully verified
    if (status.hasArrakisWallet) {
      return 'arrakis_basic';
    }

    // Tier 1: Only has incumbent access (or no access at all but in community)
    return 'incumbent_only';
  }

  /**
   * Get the features available for a verification tier
   *
   * @param tier - Verification tier
   * @returns Feature configuration for the tier
   */
  getFeatures(tier: VerificationTier): TierFeatures {
    switch (tier) {
      case 'incumbent_only':
        return {
          tier: 'incumbent_only',
          displayName: 'Basic Access',
          description: 'Token-verified via existing system. Connect your wallet to unlock more features.',
          features: TIER_1_FEATURES,
          upgradeTo: {
            tier: 'arrakis_basic',
            displayName: 'Arrakis Basic',
            action: 'Connect your wallet',
          },
        };

      case 'arrakis_basic':
        return {
          tier: 'arrakis_basic',
          displayName: 'Arrakis Basic',
          description: 'Wallet connected! Complete verification to unlock all features.',
          features: TIER_2_FEATURES,
          upgradeTo: {
            tier: 'arrakis_full',
            displayName: 'Arrakis Full',
            action: 'Complete verification',
          },
        };

      case 'arrakis_full':
        return {
          tier: 'arrakis_full',
          displayName: 'Arrakis Full',
          description: 'Fully verified Arrakis member with all features unlocked.',
          features: TIER_3_FEATURES,
        };

      default:
        // Type guard - should never reach here
        const _exhaustive: never = tier;
        throw new Error(`Unknown tier: ${_exhaustive}`);
    }
  }

  /**
   * Check if a member can access a specific feature
   *
   * @param options - Feature and member status
   * @returns Access result with reason if denied
   */
  canAccess(options: CanAccessOptions): CanAccessResult {
    const { featureId, status } = options;
    const memberTier = this.getMemberTier(status);
    const requiredTier = FEATURE_TIER_REQUIREMENTS[featureId];

    if (!requiredTier) {
      // Unknown feature - deny by default
      return {
        allowed: false,
        tier: memberTier,
        requiredTier: 'arrakis_full',
        reason: `Unknown feature: ${featureId}`,
      };
    }

    const memberTierLevel = TIER_HIERARCHY[memberTier];
    const requiredTierLevel = TIER_HIERARCHY[requiredTier];

    if (memberTierLevel >= requiredTierLevel) {
      return {
        allowed: true,
        tier: memberTier,
        requiredTier,
      };
    }

    // Access denied - provide upgrade path
    const upgradeInfo = this.getUpgradeInfo(memberTier, requiredTier);
    return {
      allowed: false,
      tier: memberTier,
      requiredTier,
      reason: `Requires ${this.getTierDisplayName(requiredTier)} tier`,
      upgradeAction: upgradeInfo.action,
    };
  }

  /**
   * Check if one tier is higher than another
   *
   * @param tier1 - First tier
   * @param tier2 - Second tier
   * @returns True if tier1 is higher than tier2
   */
  isTierHigher(tier1: VerificationTier, tier2: VerificationTier): boolean {
    return TIER_HIERARCHY[tier1] > TIER_HIERARCHY[tier2];
  }

  /**
   * Check if a tier meets the minimum required tier
   *
   * @param tier - Tier to check
   * @param required - Minimum required tier
   * @returns True if tier meets or exceeds the requirement
   */
  meetsTierRequirement(tier: VerificationTier, required: VerificationTier): boolean {
    return TIER_HIERARCHY[tier] >= TIER_HIERARCHY[required];
  }

  // ===========================================================================
  // Tier Upgrade Methods (TASK-60.10)
  // ===========================================================================

  /**
   * Determine the new tier after a wallet connection
   *
   * @param currentStatus - Current verification status
   * @param newWalletAddress - Newly connected wallet address
   * @returns Updated verification status with new tier
   */
  upgradeTierOnWalletConnect(
    currentStatus: MemberVerificationStatus,
    newWalletAddress: string
  ): MemberVerificationStatus {
    return {
      ...currentStatus,
      hasArrakisWallet: true,
      walletAddress: newWalletAddress,
      walletConnectedAt: new Date(),
    };
  }

  /**
   * Determine the new tier after full verification
   *
   * @param currentStatus - Current verification status
   * @returns Updated verification status with full tier
   */
  upgradeTierOnVerification(currentStatus: MemberVerificationStatus): MemberVerificationStatus {
    return {
      ...currentStatus,
      isArrakisVerified: true,
    };
  }

  // ===========================================================================
  // Feature Query Methods
  // ===========================================================================

  /**
   * Get all features with their access status for a member
   *
   * @param status - Member's verification status
   * @returns Map of feature ID to access result
   */
  getAllFeatureAccess(status: MemberVerificationStatus): Map<FeatureId, CanAccessResult> {
    const results = new Map<FeatureId, CanAccessResult>();

    for (const featureId of Object.keys(FEATURE_TIER_REQUIREMENTS) as FeatureId[]) {
      results.set(featureId, this.canAccess({ featureId, status }));
    }

    return results;
  }

  /**
   * Get features that would be unlocked by upgrading to a tier
   *
   * @param currentTier - Current tier
   * @param targetTier - Target tier
   * @returns Array of features that would be unlocked
   */
  getUnlockableFeatures(
    currentTier: VerificationTier,
    targetTier: VerificationTier
  ): FeatureId[] {
    const currentLevel = TIER_HIERARCHY[currentTier];
    const targetLevel = TIER_HIERARCHY[targetTier];

    if (targetLevel <= currentLevel) {
      return [];
    }

    const unlockable: FeatureId[] = [];
    for (const [featureId, requiredTier] of Object.entries(FEATURE_TIER_REQUIREMENTS) as [
      FeatureId,
      VerificationTier,
    ][]) {
      const requiredLevel = TIER_HIERARCHY[requiredTier];
      // Feature is unlocked if: required <= target AND required > current
      if (requiredLevel <= targetLevel && requiredLevel > currentLevel) {
        unlockable.push(featureId);
      }
    }

    return unlockable;
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Get display name for a tier
   */
  getTierDisplayName(tier: VerificationTier): string {
    switch (tier) {
      case 'incumbent_only':
        return 'Basic Access';
      case 'arrakis_basic':
        return 'Arrakis Basic';
      case 'arrakis_full':
        return 'Arrakis Full';
    }
  }

  /**
   * Get upgrade information between tiers
   */
  private getUpgradeInfo(
    fromTier: VerificationTier,
    toTier: VerificationTier
  ): { action: string; steps: string[] } {
    const fromLevel = TIER_HIERARCHY[fromTier];
    const toLevel = TIER_HIERARCHY[toTier];

    if (toLevel <= fromLevel) {
      return { action: 'No upgrade needed', steps: [] };
    }

    const steps: string[] = [];
    let action = '';

    if (fromLevel < 2 && toLevel >= 2) {
      steps.push('Connect your wallet');
      action = 'Connect your wallet';
    }

    if (fromLevel < 3 && toLevel >= 3) {
      steps.push('Complete verification');
      if (!action) {
        action = 'Complete verification';
      }
    }

    return { action, steps };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new VerificationTiersService instance
 *
 * @param storage - Coexistence storage adapter
 * @returns VerificationTiersService instance
 */
export function createVerificationTiersService(
  storage: ICoexistenceStorage
): VerificationTiersService {
  return new VerificationTiersService(storage);
}

// =============================================================================
// Middleware Types (TASK-60.6)
// =============================================================================

/**
 * Context for feature gating middleware
 */
export interface FeatureGateContext {
  /** Community ID */
  communityId: string;
  /** Member ID */
  memberId: string;
  /** Member's verification status */
  status: MemberVerificationStatus;
  /** Current tier */
  tier: VerificationTier;
}

/**
 * Result from feature gate middleware
 */
export interface FeatureGateResult {
  /** Whether request should proceed */
  proceed: boolean;
  /** Context if proceeding */
  context?: FeatureGateContext;
  /** Error response if blocked */
  error?: {
    code: 'FEATURE_LOCKED' | 'TIER_REQUIRED' | 'NOT_VERIFIED';
    message: string;
    requiredTier: VerificationTier;
    upgradeAction?: string;
  };
}

/**
 * Feature gate configuration
 */
export interface FeatureGateConfig {
  /** Feature being gated */
  featureId: FeatureId;
  /** Custom error message */
  errorMessage?: string;
  /** Whether to allow partial access with restrictions */
  allowRestricted?: boolean;
}

// =============================================================================
// Exports
// =============================================================================

export {
  TIER_1_FEATURES,
  TIER_2_FEATURES,
  TIER_3_FEATURES,
  FEATURE_TIER_REQUIREMENTS,
  TIER_HIERARCHY,
};
