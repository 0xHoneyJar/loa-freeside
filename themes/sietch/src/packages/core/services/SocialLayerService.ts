/**
 * SocialLayerService - Full Social Layer Unlock for Coexistence
 *
 * Sprint 65: Full Social Layer & Polish
 *
 * Manages the unlocking of full social features when communities
 * migrate to primary or exclusive mode.
 *
 * Features unlocked at mode=primary or mode=exclusive:
 * - Full profile visibility
 * - Complete badge showcase
 * - Profile directory listing
 * - Tier progression
 * - Water sharing
 * - Activity tracking
 * - Conviction history
 *
 * @module packages/core/services/SocialLayerService
 */

import type { ICoexistenceStorage, StoredMigrationState } from '../ports/ICoexistenceStorage.js';
import type { CoexistenceMode } from '../../adapters/storage/schema.js';
import type { VerificationTier } from './VerificationTiersService.js';
import { createLogger, type ILogger } from '../../infrastructure/logging/index.js';

// =============================================================================
// Types (TASK-65.1, TASK-65.2, TASK-65.3)
// =============================================================================

/**
 * Social feature categories
 */
export type SocialFeatureCategory =
  | 'profile'
  | 'badges'
  | 'directory'
  | 'conviction'
  | 'water_sharing'
  | 'activity';

/**
 * Individual social feature status
 */
export interface SocialFeatureStatus {
  /** Feature ID */
  featureId: string;
  /** Category */
  category: SocialFeatureCategory;
  /** Whether feature is unlocked */
  unlocked: boolean;
  /** Display name */
  displayName: string;
  /** Description */
  description: string;
  /** Required mode to unlock (null if always available) */
  requiredMode: CoexistenceMode | null;
  /** Required tier to use (null if no tier required) */
  requiredTier: VerificationTier | null;
}

/**
 * Social layer unlock status for a community
 */
export interface SocialLayerStatus {
  /** Community ID */
  communityId: string;
  /** Current coexistence mode */
  currentMode: CoexistenceMode;
  /** Whether social layer is fully unlocked */
  fullyUnlocked: boolean;
  /** Individual feature statuses */
  features: SocialFeatureStatus[];
  /** Unlock progress (0-100) */
  unlockProgress: number;
  /** Next milestone to unlock more features */
  nextMilestone?: {
    mode: CoexistenceMode;
    description: string;
    featuresUnlocked: number;
  };
}

/**
 * Badge system integration result
 */
export interface BadgeIntegrationResult {
  /** Member ID */
  memberId: string;
  /** Community ID */
  communityId: string;
  /** Badges now available */
  availableBadges: number;
  /** Badges already claimed */
  claimedBadges: number;
  /** New badges unlocked by tier change */
  newlyUnlocked: string[];
}

/**
 * Profile directory entry
 */
export interface DirectoryEntry {
  /** Member ID */
  memberId: string;
  /** Pseudonym */
  nym: string;
  /** Profile picture URL */
  pfpUrl?: string | null;
  /** Verification tier */
  tier: VerificationTier;
  /** Conviction score */
  convictionScore?: number;
  /** Badge count */
  badgeCount: number;
  /** Activity level */
  activityLevel: 'low' | 'medium' | 'high';
  /** Whether profile is visible in directory */
  isVisible: boolean;
}

/**
 * Directory search options
 */
export interface DirectorySearchOptions {
  /** Search query (nym, wallet) */
  query?: string;
  /** Filter by tier */
  tier?: VerificationTier;
  /** Filter by minimum conviction score */
  minConviction?: number;
  /** Sort by field */
  sortBy?: 'nym' | 'conviction' | 'badges' | 'activity';
  /** Sort order */
  sortOrder?: 'asc' | 'desc';
  /** Pagination offset */
  offset?: number;
  /** Pagination limit */
  limit?: number;
}

/**
 * Directory search result
 */
export interface DirectorySearchResult {
  /** Matching entries */
  entries: DirectoryEntry[];
  /** Total count */
  total: number;
  /** Search options used */
  options: DirectorySearchOptions;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Modes that unlock full social layer
 */
export const FULL_SOCIAL_MODES: CoexistenceMode[] = ['primary', 'exclusive'];

/**
 * Social features configuration
 */
export const SOCIAL_FEATURES: SocialFeatureStatus[] = [
  // Profile features
  {
    featureId: 'full_profile',
    category: 'profile',
    unlocked: false,
    displayName: 'Full Profile',
    description: 'Complete profile with all details visible',
    requiredMode: 'primary',
    requiredTier: 'arrakis_full',
  },
  {
    featureId: 'profile_customization',
    category: 'profile',
    unlocked: false,
    displayName: 'Profile Customization',
    description: 'Customize your profile appearance and details',
    requiredMode: 'primary',
    requiredTier: 'arrakis_full',
  },
  // Badge features
  {
    featureId: 'badge_showcase',
    category: 'badges',
    unlocked: false,
    displayName: 'Badge Showcase',
    description: 'Display your earned badges on your profile',
    requiredMode: 'parallel',
    requiredTier: 'arrakis_full',
  },
  {
    featureId: 'badge_claiming',
    category: 'badges',
    unlocked: false,
    displayName: 'Badge Claiming',
    description: 'Claim badges based on on-chain activity',
    requiredMode: 'primary',
    requiredTier: 'arrakis_full',
  },
  // Directory features
  {
    featureId: 'directory_listing',
    category: 'directory',
    unlocked: false,
    displayName: 'Directory Listing',
    description: 'Appear in the community member directory',
    requiredMode: 'primary',
    requiredTier: 'arrakis_full',
  },
  {
    featureId: 'directory_search',
    category: 'directory',
    unlocked: false,
    displayName: 'Directory Search',
    description: 'Search for other community members',
    requiredMode: 'parallel',
    requiredTier: 'arrakis_basic',
  },
  // Conviction features
  {
    featureId: 'conviction_history',
    category: 'conviction',
    unlocked: false,
    displayName: 'Conviction History',
    description: 'View your conviction score history over time',
    requiredMode: 'primary',
    requiredTier: 'arrakis_full',
  },
  {
    featureId: 'conviction_ranking',
    category: 'conviction',
    unlocked: false,
    displayName: 'Conviction Ranking',
    description: 'See your ranking among community members',
    requiredMode: 'parallel',
    requiredTier: 'arrakis_basic',
  },
  // Water sharing features
  {
    featureId: 'water_sharing',
    category: 'water_sharing',
    unlocked: false,
    displayName: 'Water Sharing',
    description: 'Share water with other community members',
    requiredMode: 'primary',
    requiredTier: 'arrakis_full',
  },
  {
    featureId: 'water_receiving',
    category: 'water_sharing',
    unlocked: false,
    displayName: 'Water Receiving',
    description: 'Receive water from other community members',
    requiredMode: 'primary',
    requiredTier: 'arrakis_full',
  },
  // Activity features
  {
    featureId: 'activity_tracking',
    category: 'activity',
    unlocked: false,
    displayName: 'Activity Tracking',
    description: 'Track your community engagement over time',
    requiredMode: 'primary',
    requiredTier: 'arrakis_full',
  },
  {
    featureId: 'activity_leaderboard',
    category: 'activity',
    unlocked: false,
    displayName: 'Activity Leaderboard',
    description: 'Compete on the activity leaderboard',
    requiredMode: 'parallel',
    requiredTier: 'arrakis_basic',
  },
];

// =============================================================================
// Service Implementation
// =============================================================================

/**
 * Social Layer Service
 *
 * Manages social feature unlocking based on coexistence mode.
 */
export class SocialLayerService {
  private readonly logger: ILogger;

  constructor(
    private readonly storage: ICoexistenceStorage,
    logger?: ILogger
  ) {
    this.logger = logger ?? createLogger({ service: 'SocialLayerService' });
  }

  /**
   * Get social layer status for a community
   *
   * @param communityId - Community UUID
   * @returns Social layer status
   */
  async getSocialLayerStatus(communityId: string): Promise<SocialLayerStatus | null> {
    const migrationState = await this.storage.getMigrationState(communityId);
    if (!migrationState) {
      this.logger.debug('No migration state found', { communityId });
      return null;
    }

    const currentMode = migrationState.currentMode as CoexistenceMode;
    const fullyUnlocked = FULL_SOCIAL_MODES.includes(currentMode);

    // Calculate feature statuses based on current mode
    const features = SOCIAL_FEATURES.map((feature) => ({
      ...feature,
      unlocked: this.isFeatureUnlocked(feature, currentMode),
    }));

    const unlockedCount = features.filter((f) => f.unlocked).length;
    const totalFeatures = features.length;
    const unlockProgress = Math.round((unlockedCount / totalFeatures) * 100);

    // Determine next milestone
    let nextMilestone: SocialLayerStatus['nextMilestone'];
    if (!fullyUnlocked) {
      const nextMode = this.getNextMode(currentMode);
      if (nextMode) {
        const featuresInNextMode = features.filter(
          (f) => !f.unlocked && this.isFeatureUnlocked(f, nextMode)
        ).length;
        nextMilestone = {
          mode: nextMode,
          description: `Migrate to ${nextMode} mode`,
          featuresUnlocked: featuresInNextMode,
        };
      }
    }

    return {
      communityId,
      currentMode,
      fullyUnlocked,
      features,
      unlockProgress,
      nextMilestone,
    };
  }

  /**
   * Check if a specific feature is unlocked
   */
  isFeatureUnlocked(feature: SocialFeatureStatus, mode: CoexistenceMode): boolean {
    if (!feature.requiredMode) return true;

    const modeOrder: CoexistenceMode[] = ['shadow', 'parallel', 'primary', 'exclusive'];
    const currentIndex = modeOrder.indexOf(mode);
    const requiredIndex = modeOrder.indexOf(feature.requiredMode);

    return currentIndex >= requiredIndex;
  }

  /**
   * Get next mode in progression
   */
  private getNextMode(currentMode: CoexistenceMode): CoexistenceMode | null {
    const modeOrder: CoexistenceMode[] = ['shadow', 'parallel', 'primary', 'exclusive'];
    const currentIndex = modeOrder.indexOf(currentMode);
    if (currentIndex >= 0 && currentIndex < modeOrder.length - 1) {
      const nextMode = modeOrder[currentIndex + 1];
      return nextMode ?? null;
    }
    return null;
  }

  /**
   * Check if social layer is fully unlocked for a community
   */
  async isSocialLayerUnlocked(communityId: string): Promise<boolean> {
    const status = await this.getSocialLayerStatus(communityId);
    return status?.fullyUnlocked ?? false;
  }

  /**
   * Get unlocked features for a member based on tier and mode
   */
  async getMemberFeatures(
    communityId: string,
    memberId: string,
    memberTier: VerificationTier
  ): Promise<SocialFeatureStatus[]> {
    const status = await this.getSocialLayerStatus(communityId);
    if (!status) return [];

    // Filter features by both mode unlock and tier requirement
    return status.features.filter((feature) => {
      if (!feature.unlocked) return false;
      if (!feature.requiredTier) return true;

      const tierOrder: VerificationTier[] = ['incumbent_only', 'arrakis_basic', 'arrakis_full'];
      const memberTierIndex = tierOrder.indexOf(memberTier);
      const requiredTierIndex = tierOrder.indexOf(feature.requiredTier);

      return memberTierIndex >= requiredTierIndex;
    });
  }

  /**
   * Unlock social layer when mode changes to primary/exclusive
   *
   * Called during migration execution
   */
  async onModeChange(
    communityId: string,
    previousMode: CoexistenceMode,
    newMode: CoexistenceMode
  ): Promise<void> {
    const wasUnlocked = FULL_SOCIAL_MODES.includes(previousMode);
    const isNowUnlocked = FULL_SOCIAL_MODES.includes(newMode);

    if (!wasUnlocked && isNowUnlocked) {
      this.logger.info('Social layer unlocked', {
        communityId,
        previousMode,
        newMode,
      });

      // Here you would trigger any unlock-specific actions
      // e.g., notify members, enable features, etc.
    } else if (wasUnlocked && !isNowUnlocked) {
      this.logger.info('Social layer locked (rollback)', {
        communityId,
        previousMode,
        newMode,
      });
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a SocialLayerService instance
 */
export function createSocialLayerService(
  storage: ICoexistenceStorage,
  logger?: ILogger
): SocialLayerService {
  return new SocialLayerService(storage, logger);
}
