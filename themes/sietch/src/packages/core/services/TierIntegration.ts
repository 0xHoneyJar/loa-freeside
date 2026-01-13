/**
 * TierIntegration - Integration Utilities for Verification Tiers
 *
 * Sprint 60: Verification Tiers - Feature Gating
 *
 * Provides integration utilities for connecting the VerificationTiersService
 * with profile and leaderboard endpoints. These utilities help existing
 * services enforce tier-based feature gating without major refactoring.
 *
 * Usage:
 * ```typescript
 * // In profile service
 * const integration = createTierIntegration(storage);
 * const gatedProfile = await integration.gateProfileView(memberId, communityId, profile);
 * ```
 *
 * @module packages/core/services/TierIntegration
 */

import type { ICoexistenceStorage } from '../ports/ICoexistenceStorage.js';
import {
  VerificationTiersService,
  createVerificationTiersService,
  type VerificationTier,
  type FeatureId,
  type MemberVerificationStatus,
} from './VerificationTiersService.js';
import { FeatureGate, createFeatureGate } from './FeatureGateMiddleware.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Profile data that can be gated
 */
export interface GatedProfile {
  /** Profile owner's member ID */
  memberId: string;
  /** Pseudonym (always visible) */
  nym: string;
  /** Profile picture URL */
  pfpUrl?: string | null;
  /** Current tier (naib/fedaykin) - gated */
  tier?: string;
  /** Badge count - gated */
  badgeCount?: number;
  /** Badges list - gated */
  badges?: unknown[];
  /** Conviction score - gated */
  convictionScore?: number;
  /** Activity stats - gated */
  activityStats?: unknown;
  /** Directory listing - gated */
  directoryListing?: boolean;
  /** Whether profile is blurred (for glimpse mode) */
  isBlurred?: boolean;
  /** Access restrictions message */
  restrictionMessage?: string;
}

/**
 * Leaderboard entry that can be gated
 */
export interface GatedLeaderboardEntry {
  /** Rank position */
  rank: number;
  /** Member ID */
  memberId: string;
  /** Pseudonym */
  nym: string;
  /** Profile picture */
  pfpUrl?: string | null;
  /** Badge count - always visible on leaderboard */
  badgeCount: number;
  /** Wallet address - gated by tier */
  walletAddress?: string;
  /** Whether wallet is hidden */
  walletHidden: boolean;
  /** Tier - gated */
  tier?: string;
}

/**
 * Result from profile view gate
 */
export interface ProfileGateResult {
  /** Whether full access is granted */
  fullAccess: boolean;
  /** Member's verification tier */
  tier: VerificationTier;
  /** Gated profile data */
  profile: GatedProfile;
  /** Features that are locked */
  lockedFeatures: FeatureId[];
  /** Upgrade action to get more access */
  upgradeAction?: string;
}

/**
 * Result from leaderboard gate
 */
export interface LeaderboardGateResult {
  /** Member's verification tier */
  tier: VerificationTier;
  /** Gated leaderboard entries */
  entries: GatedLeaderboardEntry[];
  /** Whether wallet addresses are visible */
  walletsVisible: boolean;
  /** Upgrade action to see wallets */
  upgradeAction?: string;
}

// =============================================================================
// TierIntegration Class
// =============================================================================

/**
 * TierIntegration
 *
 * Integration layer that connects verification tiers with existing
 * profile and leaderboard services. Provides methods for gating
 * data based on the viewer's verification tier.
 */
export class TierIntegration {
  private tiersService: VerificationTiersService;
  private gate: FeatureGate;
  private storage: ICoexistenceStorage;

  constructor(storage: ICoexistenceStorage) {
    this.storage = storage;
    this.tiersService = createVerificationTiersService(storage);
    this.gate = createFeatureGate(this.tiersService);
  }

  // ===========================================================================
  // Profile Integration (TASK-60.7)
  // ===========================================================================

  /**
   * Gate profile view based on viewer's verification tier
   *
   * @param viewerStatus - Viewer's verification status
   * @param profile - Full profile data
   * @returns Gated profile with appropriate restrictions
   */
  gateProfileView(
    viewerStatus: MemberVerificationStatus,
    profile: GatedProfile
  ): ProfileGateResult {
    const tier = this.tiersService.getMemberTier(viewerStatus);
    const lockedFeatures: FeatureId[] = [];
    const gatedProfile = { ...profile };

    // Check full_profile access
    const fullProfileAccess = this.gate.checkFeature('full_profile', viewerStatus);
    if (!fullProfileAccess) {
      lockedFeatures.push('full_profile');
    }

    // Check profile_view access (Tier 2+)
    const profileViewAccess = this.gate.checkFeature('profile_view', viewerStatus);
    if (!profileViewAccess) {
      // Tier 1: Very limited view
      gatedProfile.tier = undefined;
      gatedProfile.badgeCount = undefined;
      gatedProfile.badges = undefined;
      gatedProfile.convictionScore = undefined;
      gatedProfile.activityStats = undefined;
      gatedProfile.isBlurred = true;
      gatedProfile.restrictionMessage = 'Connect wallet to view full profile';
      lockedFeatures.push('profile_view');
    } else if (!fullProfileAccess) {
      // Tier 2: Preview access with restrictions
      const restrictions = this.gate.getRestrictions('badge_preview', viewerStatus);
      if (restrictions?.blurred) {
        gatedProfile.badges = undefined; // Hide badge details
        gatedProfile.isBlurred = true;
      }

      // Activity stats only for full tier
      if (!this.gate.checkFeature('activity_tracking', viewerStatus)) {
        gatedProfile.activityStats = undefined;
        lockedFeatures.push('activity_tracking');
      }

      // Conviction history only for full tier
      if (!this.gate.checkFeature('conviction_history', viewerStatus)) {
        lockedFeatures.push('conviction_history');
      }

      gatedProfile.restrictionMessage = 'Complete verification for full access';
    }

    // Check directory_listing access
    if (!this.gate.checkFeature('directory_listing', viewerStatus)) {
      gatedProfile.directoryListing = false;
      lockedFeatures.push('directory_listing');
    }

    // Get upgrade action
    const tierFeatures = this.tiersService.getFeatures(tier);
    const upgradeAction = tierFeatures.upgradeTo?.action;

    return {
      fullAccess: fullProfileAccess,
      tier,
      profile: gatedProfile,
      lockedFeatures,
      upgradeAction,
    };
  }

  /**
   * Check if viewer can see another member's full profile
   *
   * @param viewerStatus - Viewer's verification status
   * @returns True if full profile is accessible
   */
  canViewFullProfile(viewerStatus: MemberVerificationStatus): boolean {
    return this.gate.checkFeature('full_profile', viewerStatus);
  }

  /**
   * Check if viewer can see their own profile preview
   * (always allowed for their own profile)
   *
   * @param viewerStatus - Viewer's verification status
   * @param profileOwnerId - Profile owner's member ID
   * @returns True if profile view is accessible
   */
  canViewProfile(
    viewerStatus: MemberVerificationStatus,
    profileOwnerId: string
  ): boolean {
    // Users can always view their own profile
    if (viewerStatus.memberId === profileOwnerId) {
      return true;
    }
    // Others need profile_view feature
    return this.gate.checkFeature('profile_view', viewerStatus);
  }

  // ===========================================================================
  // Leaderboard Integration (TASK-60.8)
  // ===========================================================================

  /**
   * Gate leaderboard entries based on viewer's verification tier
   *
   * @param viewerStatus - Viewer's verification status
   * @param entries - Full leaderboard entries
   * @returns Gated leaderboard with appropriate restrictions
   */
  gateLeaderboard(
    viewerStatus: MemberVerificationStatus,
    entries: Array<{
      rank: number;
      memberId: string;
      nym: string;
      pfpUrl?: string | null;
      badgeCount: number;
      walletAddress?: string;
      tier?: string;
    }>
  ): LeaderboardGateResult {
    const tier = this.tiersService.getMemberTier(viewerStatus);

    // Check if wallet addresses should be visible
    const walletsVisible = this.gate.checkFeature(
      'leaderboard_wallet_visible',
      viewerStatus
    );

    // Gate each entry
    const gatedEntries: GatedLeaderboardEntry[] = entries.map((entry) => ({
      rank: entry.rank,
      memberId: entry.memberId,
      nym: entry.nym,
      pfpUrl: entry.pfpUrl,
      badgeCount: entry.badgeCount,
      walletAddress: walletsVisible ? entry.walletAddress : undefined,
      walletHidden: !walletsVisible,
      tier: this.gate.checkFeature('tier_preview', viewerStatus) ? entry.tier : undefined,
    }));

    // Get upgrade action if wallets are hidden
    let upgradeAction: string | undefined;
    if (!walletsVisible) {
      upgradeAction = 'Complete verification to see wallet addresses';
    }

    return {
      tier,
      entries: gatedEntries,
      walletsVisible,
      upgradeAction,
    };
  }

  /**
   * Get viewer's own leaderboard position with conviction info
   *
   * @param viewerStatus - Viewer's verification status
   * @param position - Current leaderboard position
   * @param totalMembers - Total members in community
   * @returns Position info with tier-appropriate details
   */
  getLeaderboardPosition(
    viewerStatus: MemberVerificationStatus,
    position: number,
    totalMembers: number
  ): {
    position: number;
    percentile: number;
    convictionScore?: number;
    tier: VerificationTier;
    canSeeConviction: boolean;
  } {
    const tier = this.tiersService.getMemberTier(viewerStatus);
    const percentile = Math.round(((totalMembers - position + 1) / totalMembers) * 100);

    // Check if conviction preview is available
    const canSeeConviction = this.gate.checkFeature('conviction_preview', viewerStatus);

    return {
      position,
      percentile,
      tier,
      canSeeConviction,
    };
  }

  // ===========================================================================
  // Status Helpers
  // ===========================================================================

  /**
   * Build verification status from member data
   *
   * @param communityId - Community UUID
   * @param memberId - Discord member ID
   * @param memberData - Additional member data
   * @returns MemberVerificationStatus
   */
  buildVerificationStatus(
    communityId: string,
    memberId: string,
    memberData: {
      hasIncumbentAccess?: boolean;
      walletAddress?: string | null;
      isVerified?: boolean;
      walletConnectedAt?: Date | null;
    }
  ): MemberVerificationStatus {
    return {
      communityId,
      memberId,
      hasIncumbentAccess: memberData.hasIncumbentAccess ?? false,
      hasArrakisWallet: !!memberData.walletAddress,
      isArrakisVerified: memberData.isVerified ?? false,
      walletAddress: memberData.walletAddress ?? undefined,
      walletConnectedAt: memberData.walletConnectedAt ?? undefined,
    };
  }

  /**
   * Get the verification tiers service for direct access
   */
  getTiersService(): VerificationTiersService {
    return this.tiersService;
  }

  /**
   * Get the feature gate for direct access
   */
  getFeatureGate(): FeatureGate {
    return this.gate;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new TierIntegration instance
 *
 * @param storage - Coexistence storage adapter
 * @returns TierIntegration instance
 */
export function createTierIntegration(storage: ICoexistenceStorage): TierIntegration {
  return new TierIntegration(storage);
}
