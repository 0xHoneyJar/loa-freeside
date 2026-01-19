/**
 * GlimpseMode - Social Layer Preview for Coexistence
 *
 * Sprint 61: Glimpse Mode - Social Layer Preview
 *
 * Implements "Glimpse Mode" that shows blurred/locked previews of social features
 * to create awareness (not FOMO) and encourage organic migration to Arrakis.
 *
 * Key Principles:
 * - Informational only - no manipulation or harassment
 * - Clear value proposition without pressure
 * - Respects user autonomy in upgrade decision
 *
 * Components:
 * - Blurred profile cards for directory views
 * - Locked badge showcase with "ready to claim" counts
 * - Conviction rank position display
 * - Clear upgrade CTAs without aggressive language
 *
 * @module packages/adapters/coexistence/GlimpseMode
 */

import type { ICoexistenceStorage } from '../../core/ports/ICoexistenceStorage.js';
import {
  type VerificationTier,
  type MemberVerificationStatus,
  type FeatureId,
} from '../../core/services/VerificationTiersService.js';
import {
  TierIntegration,
  createTierIntegration,
  type GatedProfile,
  type GatedLeaderboardEntry,
} from '../../core/services/TierIntegration.js';

// =============================================================================
// Types (TASK-61.1)
// =============================================================================

/**
 * Glimpse profile view - blurred version for non-verified users
 */
export interface GlimpseProfile {
  /** Member ID */
  memberId: string;
  /** Pseudonym (always visible) */
  nym: string;
  /** Profile picture URL */
  pfpUrl?: string | null;
  /** Whether profile content is blurred */
  isBlurred: boolean;
  /** Blur intensity (0-100, where 100 is fully obscured) */
  blurIntensity: number;
  /** Visible preview data */
  preview: {
    /** Tier display (e.g., "Member") - visible but not detailed */
    tierLabel?: string;
    /** Badge count ready to claim */
    badgeCountPreview?: number;
    /** Conviction score percentile (e.g., "Top 15%") */
    convictionPercentile?: string;
    /** Activity level indicator */
    activityLevel?: 'low' | 'medium' | 'high';
  };
  /** Restriction details */
  restriction: {
    /** What feature is being restricted */
    feature: FeatureId;
    /** Human-readable message */
    message: string;
    /** CTA to unlock */
    unlockAction: string;
  };
}

/**
 * Locked badge showcase entry
 */
export interface LockedBadge {
  /** Badge ID */
  badgeId: string;
  /** Badge name (visible) */
  name: string;
  /** Badge emoji (visible) */
  emoji: string;
  /** Badge category */
  category: string;
  /** Whether badge is locked */
  isLocked: boolean;
  /** Unlock requirement description */
  unlockRequirement?: string;
}

/**
 * Badge showcase result for glimpse mode
 */
export interface GlimpseBadgeShowcase {
  /** Viewer's current tier */
  viewerTier: VerificationTier;
  /** Total badges earned (visible) */
  totalBadges: number;
  /** Badges ready to claim (teaser) */
  readyToClaim: number;
  /** Preview of locked badges */
  lockedBadges: LockedBadge[];
  /** Preview of unlocked badges (if Tier 2+) */
  unlockedBadges: LockedBadge[];
  /** Whether full showcase is accessible */
  fullAccessible: boolean;
  /** Unlock message */
  unlockMessage: string;
  /** CTA action */
  unlockAction: string;
}

/**
 * Own preview profile (what you'll get after upgrade)
 */
export interface OwnPreviewProfile {
  /** Member ID */
  memberId: string;
  /** Nym */
  nym: string;
  /** Profile picture */
  pfpUrl?: string | null;
  /** Current verification tier */
  currentTier: VerificationTier;
  /** Preview stats (what you'll see after upgrade) */
  previewStats: {
    /** Badge count waiting */
    badgeCount: number;
    /** Badges by category */
    badgesByCategory: Map<string, number>;
    /** Conviction rank position */
    convictionRank?: number;
    /** Conviction percentile */
    convictionPercentile?: string;
    /** Total members for context */
    totalMembers: number;
  };
  /** Features that will unlock */
  featuresToUnlock: Array<{
    featureId: FeatureId;
    displayName: string;
    description: string;
  }>;
  /** Next upgrade action */
  nextUpgradeAction: string;
  /** Next tier display name */
  nextTierName: string;
}

/**
 * Conviction rank result
 */
export interface ConvictionRankResult {
  /** Member's rank position (1-indexed) */
  position: number;
  /** Total members in ranking */
  totalMembers: number;
  /** Percentile (e.g., 85 means top 15%) */
  percentile: number;
  /** Formatted percentile string */
  percentileLabel: string;
  /** Whether detailed conviction is visible */
  detailedVisible: boolean;
  /** Conviction score (if visible) */
  convictionScore?: number;
  /** Upgrade action if not visible */
  upgradeAction?: string;
}

/**
 * Upgrade CTA configuration
 */
export interface UpgradeCTA {
  /** Unique CTA ID for tracking */
  ctaId: string;
  /** Current tier */
  currentTier: VerificationTier;
  /** Target tier */
  targetTier: VerificationTier;
  /** CTA title */
  title: string;
  /** CTA description */
  description: string;
  /** Button label */
  buttonLabel: string;
  /** Button action type */
  actionType: 'connect_wallet' | 'complete_verification' | 'contact_admin';
  /** Features that will unlock */
  unlockFeatures: string[];
  /** Tracking data */
  metadata?: Record<string, unknown>;
}

/**
 * Tell Admin request
 */
export interface TellAdminRequest {
  /** Requesting member ID */
  memberId: string;
  /** Community ID */
  communityId: string;
  /** Request type */
  requestType: 'migrate_community' | 'enable_arrakis' | 'other';
  /** Optional message */
  message?: string;
  /** Timestamp */
  requestedAt: Date;
  /** Whether this is a repeat request (throttled) */
  isRepeat: boolean;
  /** Next allowed request time */
  nextAllowedAt?: Date;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Blur intensity by tier
 */
const BLUR_INTENSITY: Record<VerificationTier, number> = {
  incumbent_only: 80, // Heavy blur
  arrakis_basic: 30, // Light blur
  arrakis_full: 0, // No blur
};

/**
 * Feature display names for unlock messages
 */
const FEATURE_DISPLAY_NAMES: Record<FeatureId, string> = {
  shadow_tracking: 'Activity Tracking',
  public_leaderboard: 'Public Leaderboard',
  leaderboard_position: 'Your Rank Position',
  profile_view: 'Member Profiles',
  conviction_preview: 'Conviction Score Preview',
  tier_preview: 'Tier Information',
  badge_preview: 'Badge Previews',
  full_profile: 'Full Profile Access',
  badge_showcase: 'Badge Showcase',
  tier_progression: 'Tier Progression',
  social_features: 'Social Features',
  water_sharing: 'Water Sharing',
  directory_listing: 'Member Directory',
  activity_tracking: 'Detailed Activity',
  conviction_history: 'Conviction History',
  leaderboard_wallet_visible: 'Wallet Addresses',
};

/**
 * Upgrade action messages by tier transition
 */
const UPGRADE_ACTIONS: Record<string, string> = {
  'incumbent_only->arrakis_basic': 'Connect your wallet to unlock',
  'incumbent_only->arrakis_full': 'Connect wallet and verify to unlock',
  'arrakis_basic->arrakis_full': 'Complete verification to unlock',
};

/**
 * Request throttle duration (in milliseconds)
 */
const TELL_ADMIN_THROTTLE_MS = 24 * 60 * 60 * 1000; // 24 hours

// =============================================================================
// GlimpseMode Class
// =============================================================================

/**
 * GlimpseMode
 *
 * Provides glimpse mode functionality for the coexistence architecture.
 * Shows blurred/locked previews of social features to encourage migration.
 */
export class GlimpseMode {
  private storage: ICoexistenceStorage;
  private tierIntegration: TierIntegration;
  private tellAdminRequests: Map<string, Date> = new Map();

  constructor(storage: ICoexistenceStorage) {
    this.storage = storage;
    this.tierIntegration = createTierIntegration(storage);
  }

  // ===========================================================================
  // Blurred Profile Card (TASK-61.2)
  // ===========================================================================

  /**
   * Create a glimpse profile view with appropriate blur level
   *
   * @param viewerStatus - Viewer's verification status
   * @param profile - Full profile data to glimpse
   * @returns Glimpse profile with blur applied
   */
  createGlimpseProfile(
    viewerStatus: MemberVerificationStatus,
    profile: GatedProfile
  ): GlimpseProfile {
    const viewerTier = this.tierIntegration.getTiersService().getMemberTier(viewerStatus);
    const blurIntensity = BLUR_INTENSITY[viewerTier];
    const isBlurred = blurIntensity > 0;

    // Determine what preview data to show based on tier
    const preview: GlimpseProfile['preview'] = {};

    if (viewerTier !== 'incumbent_only') {
      // Tier 2+ gets some preview data
      preview.tierLabel = profile.tier ?? 'Member';
      preview.badgeCountPreview = profile.badgeCount;
    }

    // Always show activity level indicator (anonymized)
    preview.activityLevel = this.getActivityLevel(profile);

    // Determine restriction message
    const restriction = this.getProfileRestriction(viewerTier);

    return {
      memberId: profile.memberId,
      nym: profile.nym,
      pfpUrl: profile.pfpUrl,
      isBlurred,
      blurIntensity,
      preview,
      restriction,
    };
  }

  /**
   * Get activity level from profile (anonymized indicator)
   */
  private getActivityLevel(profile: GatedProfile): 'low' | 'medium' | 'high' {
    // Use badge count as a proxy for activity
    const badgeCount = profile.badgeCount ?? 0;
    if (badgeCount >= 5) return 'high';
    if (badgeCount >= 2) return 'medium';
    return 'low';
  }

  /**
   * Get profile restriction details for a tier
   */
  private getProfileRestriction(
    viewerTier: VerificationTier
  ): GlimpseProfile['restriction'] {
    if (viewerTier === 'incumbent_only') {
      return {
        feature: 'profile_view',
        message: 'Connect your wallet to view member profiles',
        unlockAction: 'Connect Wallet',
      };
    }

    if (viewerTier === 'arrakis_basic') {
      return {
        feature: 'full_profile',
        message: 'Complete verification to see full profile details',
        unlockAction: 'Complete Verification',
      };
    }

    // arrakis_full - no restriction
    return {
      feature: 'full_profile',
      message: '',
      unlockAction: '',
    };
  }

  // ===========================================================================
  // Locked Badge Showcase (TASK-61.3)
  // ===========================================================================

  /**
   * Create a badge showcase with locked/unlocked states
   *
   * @param viewerStatus - Viewer's verification status
   * @param badges - All badges the member has earned
   * @returns Badge showcase with lock states
   */
  createBadgeShowcase(
    viewerStatus: MemberVerificationStatus,
    badges: Array<{ id: string; name: string; emoji: string; category: string }>
  ): GlimpseBadgeShowcase {
    const viewerTier = this.tierIntegration.getTiersService().getMemberTier(viewerStatus);
    const gate = this.tierIntegration.getFeatureGate();

    const canViewShowcase = gate.checkFeature('badge_showcase', viewerStatus);
    const canPreviewBadges = gate.checkFeature('badge_preview', viewerStatus);

    // Map badges to locked/unlocked state
    const mappedBadges: LockedBadge[] = badges.map((badge) => ({
      badgeId: badge.id,
      name: badge.name,
      emoji: badge.emoji,
      category: badge.category,
      isLocked: !canViewShowcase,
      unlockRequirement: canViewShowcase ? undefined : 'Complete verification',
    }));

    // Determine unlock message and action
    let unlockMessage: string;
    let unlockAction: string;

    if (viewerTier === 'incumbent_only') {
      unlockMessage = `${badges.length} badges ready to claim! Connect your wallet to preview.`;
      unlockAction = 'Connect Wallet';
    } else if (viewerTier === 'arrakis_basic') {
      unlockMessage = `${badges.length} badges earned! Complete verification to showcase them.`;
      unlockAction = 'Complete Verification';
    } else {
      unlockMessage = `${badges.length} badges in your collection`;
      unlockAction = '';
    }

    return {
      viewerTier,
      totalBadges: badges.length,
      readyToClaim: canViewShowcase ? 0 : badges.length,
      lockedBadges: canViewShowcase ? [] : mappedBadges,
      unlockedBadges: canViewShowcase ? mappedBadges : canPreviewBadges ? mappedBadges : [],
      fullAccessible: canViewShowcase,
      unlockMessage,
      unlockAction,
    };
  }

  // ===========================================================================
  // Own Preview Profile (TASK-61.4)
  // ===========================================================================

  /**
   * Create "Your Preview Profile" showing what you'll get after upgrade
   *
   * @param status - Member's verification status
   * @param profileData - Member's profile data
   * @param stats - Member's stats (badge count, rank, etc.)
   * @returns Preview profile with upgrade info
   */
  createOwnPreviewProfile(
    status: MemberVerificationStatus,
    profileData: {
      nym: string;
      pfpUrl?: string | null;
      badges: Array<{ category: string }>;
    },
    stats: {
      convictionRank?: number;
      totalMembers: number;
    }
  ): OwnPreviewProfile {
    const currentTier = this.tierIntegration.getTiersService().getMemberTier(status);
    const tiersService = this.tierIntegration.getTiersService();

    // Calculate badge stats
    const badgesByCategory = new Map<string, number>();
    for (const badge of profileData.badges) {
      const count = badgesByCategory.get(badge.category) ?? 0;
      badgesByCategory.set(badge.category, count + 1);
    }

    // Calculate conviction percentile
    let convictionPercentile: string | undefined;
    if (stats.convictionRank && stats.totalMembers > 0) {
      const percentile = Math.round(
        ((stats.totalMembers - stats.convictionRank + 1) / stats.totalMembers) * 100
      );
      convictionPercentile = `Top ${100 - percentile}%`;
    }

    // Determine features to unlock
    const featuresToUnlock = this.getFeaturesToUnlock(currentTier);

    // Determine next tier and action
    const tierFeatures = tiersService.getFeatures(currentTier);
    const nextTierName = tierFeatures.upgradeTo?.displayName ?? 'Full Access';
    const nextUpgradeAction = tierFeatures.upgradeTo?.action ?? 'Already at max tier';

    return {
      memberId: status.memberId,
      nym: profileData.nym,
      pfpUrl: profileData.pfpUrl,
      currentTier,
      previewStats: {
        badgeCount: profileData.badges.length,
        badgesByCategory,
        convictionRank: stats.convictionRank,
        convictionPercentile,
        totalMembers: stats.totalMembers,
      },
      featuresToUnlock,
      nextUpgradeAction,
      nextTierName,
    };
  }

  /**
   * Get features that will unlock for current tier
   */
  private getFeaturesToUnlock(
    currentTier: VerificationTier
  ): Array<{ featureId: FeatureId; displayName: string; description: string }> {
    const tiersService = this.tierIntegration.getTiersService();

    // Determine target tier
    let targetTier: VerificationTier;
    if (currentTier === 'incumbent_only') {
      targetTier = 'arrakis_basic';
    } else if (currentTier === 'arrakis_basic') {
      targetTier = 'arrakis_full';
    } else {
      return []; // Already at max
    }

    // Get unlockable features
    const unlockableFeatures = tiersService.getUnlockableFeatures(currentTier, targetTier);

    return unlockableFeatures.map((featureId) => ({
      featureId,
      displayName: FEATURE_DISPLAY_NAMES[featureId],
      description: this.getFeatureDescription(featureId),
    }));
  }

  /**
   * Get description for a feature
   */
  private getFeatureDescription(featureId: FeatureId): string {
    const descriptions: Record<FeatureId, string> = {
      shadow_tracking: 'Track your activity across the community',
      public_leaderboard: 'See the community leaderboard',
      leaderboard_position: 'See your position on the leaderboard',
      profile_view: 'View other members\' profiles',
      conviction_preview: 'Preview your conviction score',
      tier_preview: 'See tier information',
      badge_preview: 'Preview badges you can earn',
      full_profile: 'Access complete member profiles',
      badge_showcase: 'Display your earned badges',
      tier_progression: 'Track your tier progression',
      social_features: 'Access all social features',
      water_sharing: 'Share water with other members',
      directory_listing: 'Appear in member directory',
      activity_tracking: 'See detailed activity stats',
      conviction_history: 'View your conviction history over time',
      leaderboard_wallet_visible: 'See wallet addresses on leaderboard',
    };

    return descriptions[featureId] ?? 'Unlock additional features';
  }

  // ===========================================================================
  // Upgrade CTA (TASK-61.5)
  // ===========================================================================

  /**
   * Create an upgrade CTA based on viewer's tier
   *
   * @param viewerStatus - Viewer's verification status
   * @param context - Context for CTA (e.g., 'profile', 'leaderboard', 'badge')
   * @returns Upgrade CTA configuration
   */
  createUpgradeCTA(
    viewerStatus: MemberVerificationStatus,
    context: 'profile' | 'leaderboard' | 'badge' | 'directory'
  ): UpgradeCTA | null {
    const currentTier = this.tierIntegration.getTiersService().getMemberTier(viewerStatus);

    if (currentTier === 'arrakis_full') {
      return null; // No upgrade needed
    }

    const targetTier: VerificationTier =
      currentTier === 'incumbent_only' ? 'arrakis_basic' : 'arrakis_full';

    // Generate CTA based on context
    const ctaConfig = this.getCTAConfig(currentTier, targetTier, context);

    return {
      ctaId: `${context}_${currentTier}_${Date.now()}`,
      currentTier,
      targetTier,
      ...ctaConfig,
    };
  }

  /**
   * Get CTA configuration for a specific context
   */
  private getCTAConfig(
    currentTier: VerificationTier,
    targetTier: VerificationTier,
    context: 'profile' | 'leaderboard' | 'badge' | 'directory'
  ): {
    title: string;
    description: string;
    buttonLabel: string;
    actionType: 'connect_wallet' | 'complete_verification' | 'contact_admin';
    unlockFeatures: string[];
  } {
    const isWalletStep = currentTier === 'incumbent_only';

    // Context-specific messaging
    const contextMessages: Record<string, { title: string; description: string }> = {
      profile: {
        title: isWalletStep ? 'Unlock Member Profiles' : 'Unlock Full Profiles',
        description: isWalletStep
          ? 'Connect your wallet to view other members\' profiles'
          : 'Complete verification to see full profile details',
      },
      leaderboard: {
        title: isWalletStep ? 'Join the Leaderboard' : 'See Full Rankings',
        description: isWalletStep
          ? 'Connect your wallet to see your position'
          : 'Complete verification to see wallet addresses',
      },
      badge: {
        title: isWalletStep ? 'Preview Your Badges' : 'Showcase Your Badges',
        description: isWalletStep
          ? 'Connect your wallet to preview badges you\'ve earned'
          : 'Complete verification to showcase your badge collection',
      },
      directory: {
        title: isWalletStep ? 'Browse Member Directory' : 'Full Directory Access',
        description: isWalletStep
          ? 'Connect your wallet to browse the member directory'
          : 'Complete verification for full directory features',
      },
    };

    const message = contextMessages[context];
    const unlockFeatures = this.getFeaturesToUnlock(currentTier).map((f) => f.displayName);

    return {
      title: message?.title ?? 'Complete Verification',
      description: message?.description ?? 'Verify to unlock more features',
      buttonLabel: isWalletStep ? 'Connect Wallet' : 'Complete Verification',
      actionType: isWalletStep ? 'connect_wallet' : 'complete_verification',
      unlockFeatures,
    };
  }

  // ===========================================================================
  // Badge Count Preview (TASK-61.6)
  // ===========================================================================

  /**
   * Get badge count preview for glimpse mode
   *
   * @param viewerStatus - Viewer's verification status
   * @param badgeCount - Actual badge count
   * @returns Badge count with appropriate messaging
   */
  getBadgeCountPreview(
    viewerStatus: MemberVerificationStatus,
    badgeCount: number
  ): {
    count: number;
    label: string;
    isPreview: boolean;
    message: string;
  } {
    const viewerTier = this.tierIntegration.getTiersService().getMemberTier(viewerStatus);

    if (viewerTier === 'arrakis_full') {
      return {
        count: badgeCount,
        label: `${badgeCount} badges`,
        isPreview: false,
        message: '',
      };
    }

    if (viewerTier === 'arrakis_basic') {
      return {
        count: badgeCount,
        label: `${badgeCount} badges earned`,
        isPreview: true,
        message: 'Complete verification to showcase',
      };
    }

    // incumbent_only
    return {
      count: badgeCount,
      label: `${badgeCount} badges ready`,
      isPreview: true,
      message: 'Connect wallet to preview',
    };
  }

  // ===========================================================================
  // Conviction Rank Position (TASK-61.7)
  // ===========================================================================

  /**
   * Calculate conviction rank position for glimpse mode
   *
   * @param viewerStatus - Viewer's verification status
   * @param position - Member's rank position (1-indexed)
   * @param totalMembers - Total members in ranking
   * @param convictionScore - Optional conviction score
   * @returns Conviction rank result with appropriate visibility
   */
  calculateConvictionRank(
    viewerStatus: MemberVerificationStatus,
    position: number,
    totalMembers: number,
    convictionScore?: number
  ): ConvictionRankResult {
    const viewerTier = this.tierIntegration.getTiersService().getMemberTier(viewerStatus);
    const gate = this.tierIntegration.getFeatureGate();

    // Calculate percentile (higher position = better = lower percentile number)
    const percentile = Math.round(((position / totalMembers) * 100));
    const percentileLabel = percentile <= 10
      ? `Top ${percentile}%`
      : percentile <= 25
        ? `Top ${percentile}%`
        : `${100 - percentile}th percentile`;

    // Check if detailed conviction is visible
    const detailedVisible = gate.checkFeature('conviction_preview', viewerStatus);

    return {
      position,
      totalMembers,
      percentile,
      percentileLabel,
      detailedVisible,
      convictionScore: detailedVisible ? convictionScore : undefined,
      upgradeAction: detailedVisible
        ? undefined
        : viewerTier === 'incumbent_only'
          ? 'Connect wallet to see your conviction score'
          : undefined,
    };
  }

  // ===========================================================================
  // Unlock Messaging (TASK-61.8)
  // ===========================================================================

  /**
   * Get unlock message for a specific feature
   *
   * @param viewerStatus - Viewer's verification status
   * @param feature - Feature being restricted
   * @returns Unlock message with CTA
   */
  getUnlockMessage(
    viewerStatus: MemberVerificationStatus,
    feature: FeatureId
  ): {
    message: string;
    action: string;
    buttonLabel: string;
  } {
    const viewerTier = this.tierIntegration.getTiersService().getMemberTier(viewerStatus);
    const featureName = FEATURE_DISPLAY_NAMES[feature];

    if (viewerTier === 'incumbent_only') {
      return {
        message: `${featureName} requires wallet connection`,
        action: 'connect_wallet',
        buttonLabel: 'Connect Wallet',
      };
    }

    if (viewerTier === 'arrakis_basic') {
      return {
        message: `${featureName} requires full verification`,
        action: 'complete_verification',
        buttonLabel: 'Complete Verification',
      };
    }

    // arrakis_full - should not reach here
    return {
      message: '',
      action: '',
      buttonLabel: '',
    };
  }

  // ===========================================================================
  // Tell Admin Functionality
  // ===========================================================================

  /**
   * Create a "Tell Admin" request for migration
   *
   * Throttled to prevent spam (once per 24 hours per user)
   *
   * @param status - Member's verification status
   * @param message - Optional message to admin
   * @returns Tell admin request result
   */
  createTellAdminRequest(
    status: MemberVerificationStatus,
    message?: string
  ): TellAdminRequest {
    const key = `${status.communityId}:${status.memberId}`;
    const lastRequest = this.tellAdminRequests.get(key);
    const now = new Date();

    // Check throttle
    const isRepeat = lastRequest !== undefined &&
      now.getTime() - lastRequest.getTime() < TELL_ADMIN_THROTTLE_MS;

    let nextAllowedAt: Date | undefined;
    if (isRepeat && lastRequest) {
      nextAllowedAt = new Date(lastRequest.getTime() + TELL_ADMIN_THROTTLE_MS);
    } else {
      // Update last request time
      this.tellAdminRequests.set(key, now);
    }

    return {
      memberId: status.memberId,
      communityId: status.communityId,
      requestType: 'migrate_community',
      message,
      requestedAt: now,
      isRepeat,
      nextAllowedAt,
    };
  }

  /**
   * Clear throttle for testing
   */
  clearThrottle(): void {
    this.tellAdminRequests.clear();
  }

  // ===========================================================================
  // Getters
  // ===========================================================================

  /**
   * Get the tier integration instance
   */
  getTierIntegration(): TierIntegration {
    return this.tierIntegration;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new GlimpseMode instance
 *
 * @param storage - Coexistence storage adapter
 * @returns GlimpseMode instance
 */
export function createGlimpseMode(storage: ICoexistenceStorage): GlimpseMode {
  return new GlimpseMode(storage);
}
