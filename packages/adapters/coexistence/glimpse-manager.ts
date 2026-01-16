/**
 * GlimpseManager Implementation
 *
 * Sprint S-27: Glimpse Mode & Migration Readiness
 *
 * Implements IGlimpseAndReadiness for glimpse mode operations and
 * migration readiness checks.
 *
 * @see SDD §7.2.3 Glimpse Mode
 */

import type { Logger } from 'pino';
import type {
  IGlimpseAndReadiness,
  GlimpseContext,
  LeaderboardQueryOptions,
  ProfileDirectoryQueryOptions,
  BadgeShowcaseQueryOptions,
} from '@arrakis/core/ports';
import type {
  GlimpseModeConfig,
  GlimpseModeStatus,
  GlimpseLeaderboard,
  GlimpseLeaderboardEntry,
  GlimpseProfileDirectory,
  GlimpseProfileCard,
  GlimpseBadgeShowcase,
  GlimpseBadge,
  PreviewProfile,
  UnlockMessage,
  MigrationReadinessResult,
  MigrationReadinessRequirements,
  MigrationReadinessCheck,
  VerificationTier,
  Feature,
} from '@arrakis/core/domain';
import {
  DEFAULT_GLIMPSE_MODE_CONFIG,
  DEFAULT_UNLOCK_MESSAGES,
  DEFAULT_MIGRATION_READINESS_REQUIREMENTS,
  getFeaturesForTier,
} from '@arrakis/core/domain';

// =============================================================================
// Dependency Interfaces
// =============================================================================

/**
 * Leaderboard data source interface.
 */
export interface ILeaderboardDataSource {
  /**
   * Get leaderboard entries.
   */
  getLeaderboard(
    guildId: string,
    options: LeaderboardQueryOptions
  ): Promise<{
    entries: Array<{
      userId: string;
      displayName: string;
      score: number;
      tier: string;
      rank: number;
    }>;
    total: number;
  }>;

  /**
   * Get user's position on leaderboard.
   */
  getUserPosition(
    guildId: string,
    userId: string
  ): Promise<{
    rank: number;
    score: number;
    tier: string;
    displayName: string;
  } | null>;
}

/**
 * Profile data source interface.
 */
export interface IProfileDataSource {
  /**
   * Get profile cards for directory.
   */
  getProfiles(
    guildId: string,
    options: ProfileDirectoryQueryOptions
  ): Promise<{
    profiles: Array<{
      userId: string;
      displayName: string;
      avatarUrl: string | null;
      tierName: string;
      convictionScore: number;
      badgeCount: number;
    }>;
    total: number;
  }>;

  /**
   * Get full profile for a user.
   */
  getFullProfile(
    guildId: string,
    userId: string
  ): Promise<PreviewProfile | null>;
}

/**
 * Badge data source interface.
 */
export interface IBadgeDataSource {
  /**
   * Get available badges for community.
   */
  getBadges(
    guildId: string,
    options: BadgeShowcaseQueryOptions
  ): Promise<{
    badges: Array<{
      badgeId: string;
      name: string;
      description: string;
      iconUrl: string | null;
      rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
      totalHolders: number;
    }>;
    total: number;
  }>;

  /**
   * Get badges earned by user.
   */
  getUserBadges(
    guildId: string,
    userId: string
  ): Promise<string[]>; // Badge IDs
}

/**
 * Community verification data source.
 */
export interface ICommunityVerificationSource {
  /**
   * Get verification tier for a community.
   */
  getVerificationTier(communityId: string): Promise<VerificationTier | null>;

  /**
   * Get guild ID for a community.
   */
  getGuildId(communityId: string): Promise<string | null>;

  /**
   * Get shadow mode start date.
   */
  getShadowModeStartDate(communityId: string): Promise<Date | null>;
}

/**
 * Shadow stats interface.
 */
export interface IShadowStats {
  /**
   * Get shadow mode statistics.
   */
  getStats(guildId: string): Promise<{
    accuracy: number;
    totalMembers: number;
    divergentMembers: number;
    lastSyncAt: Date | null;
  }>;
}

/**
 * Config store interface.
 */
export interface IGlimpseConfigStore {
  /**
   * Get glimpse mode config.
   */
  getConfig(communityId: string): Promise<GlimpseModeConfig | null>;

  /**
   * Save glimpse mode config.
   */
  saveConfig(config: GlimpseModeConfig): Promise<void>;

  /**
   * Get migration readiness requirements.
   */
  getRequirements(communityId: string): Promise<MigrationReadinessRequirements | null>;

  /**
   * Save migration readiness requirements.
   */
  saveRequirements(
    communityId: string,
    requirements: MigrationReadinessRequirements
  ): Promise<void>;
}

/**
 * Metrics interface.
 */
export interface IGlimpseMetrics {
  /** Glimpse views counter */
  glimpseViews: {
    inc(labels: { community_id: string; feature: string }): void;
  };
  /** Migration readiness checks counter */
  readinessChecks: {
    inc(labels: { community_id: string; result: string }): void;
  };
}

// =============================================================================
// GlimpseManager Implementation
// =============================================================================

/**
 * Options for GlimpseManager.
 */
export interface GlimpseManagerOptions {
  /** Default leaderboard limit */
  defaultLeaderboardLimit?: number;
  /** Default profile directory limit */
  defaultProfileLimit?: number;
}

/**
 * GlimpseManager implements glimpse mode and migration readiness.
 */
export class GlimpseManager implements IGlimpseAndReadiness {
  private readonly leaderboard: ILeaderboardDataSource;
  private readonly profiles: IProfileDataSource;
  private readonly badges: IBadgeDataSource;
  private readonly verification: ICommunityVerificationSource;
  private readonly shadow: IShadowStats;
  private readonly configStore: IGlimpseConfigStore;
  private readonly metrics: IGlimpseMetrics;
  private readonly log: Logger;
  private readonly options: Required<GlimpseManagerOptions>;

  constructor(
    leaderboard: ILeaderboardDataSource,
    profiles: IProfileDataSource,
    badges: IBadgeDataSource,
    verification: ICommunityVerificationSource,
    shadow: IShadowStats,
    configStore: IGlimpseConfigStore,
    metrics: IGlimpseMetrics,
    logger: Logger,
    options?: GlimpseManagerOptions
  ) {
    this.leaderboard = leaderboard;
    this.profiles = profiles;
    this.badges = badges;
    this.verification = verification;
    this.shadow = shadow;
    this.configStore = configStore;
    this.metrics = metrics;
    this.log = logger.child({ component: 'GlimpseManager' });
    this.options = {
      defaultLeaderboardLimit: options?.defaultLeaderboardLimit ?? 25,
      defaultProfileLimit: options?.defaultProfileLimit ?? 20,
    };
  }

  // ===========================================================================
  // Glimpse Mode Lifecycle
  // ===========================================================================

  /**
   * Check if glimpse mode is active for a community.
   */
  async isGlimpseModeActive(communityId: string): Promise<boolean> {
    const tier = await this.verification.getVerificationTier(communityId);

    // Glimpse mode is active when NOT at arrakis_full tier
    return tier !== 'arrakis_full';
  }

  /**
   * Get glimpse mode status for a community.
   */
  async getStatus(communityId: string): Promise<GlimpseModeStatus | null> {
    const guildId = await this.verification.getGuildId(communityId);
    if (!guildId) return null;

    const tier = await this.verification.getVerificationTier(communityId);
    if (!tier) return null;

    const readiness = await this.checkReadiness(communityId);

    const availableFeatures = getFeaturesForTier(tier);
    const allFeatures = getFeaturesForTier('arrakis_full');
    const lockedFeatures = allFeatures.filter(
      (f) => !availableFeatures.includes(f)
    );

    return {
      communityId,
      guildId,
      active: tier !== 'arrakis_full',
      verificationTier: tier,
      migrationReadiness: readiness,
      availableFeatures,
      lockedFeatures,
      updatedAt: new Date(),
    };
  }

  /**
   * Get glimpse mode configuration.
   */
  async getConfig(communityId: string): Promise<GlimpseModeConfig | null> {
    const stored = await this.configStore.getConfig(communityId);
    if (stored) return stored;

    // Return default if not configured
    const guildId = await this.verification.getGuildId(communityId);
    if (!guildId) return null;

    return {
      communityId,
      guildId,
      ...DEFAULT_GLIMPSE_MODE_CONFIG,
    };
  }

  /**
   * Update glimpse mode configuration.
   */
  async updateConfig(
    communityId: string,
    config: Partial<GlimpseModeConfig>
  ): Promise<void> {
    const existing = await this.getConfig(communityId);
    if (!existing) {
      throw new Error(`Community ${communityId} not found`);
    }

    const updated: GlimpseModeConfig = {
      ...existing,
      ...config,
    };

    await this.configStore.saveConfig(updated);
    this.log.info({ communityId }, 'Glimpse mode config updated');
  }

  // ===========================================================================
  // Leaderboard Glimpse (S-27.1)
  // ===========================================================================

  /**
   * Get glimpse leaderboard.
   *
   * Shows viewer's position and score, hides competitors' details
   * unless community has full access.
   */
  async getLeaderboard(
    context: GlimpseContext,
    options?: LeaderboardQueryOptions
  ): Promise<GlimpseLeaderboard> {
    const { communityId, guildId, viewerId } = context;
    const isGlimpseMode = await this.isGlimpseModeActive(communityId);
    const config = await this.getConfig(communityId);

    this.metrics.glimpseViews.inc({
      community_id: communityId,
      feature: 'leaderboard',
    });

    // Get raw leaderboard data
    const data = await this.leaderboard.getLeaderboard(guildId, {
      limit: options?.limit ?? this.options.defaultLeaderboardLimit,
      offset: options?.offset ?? 0,
      period: options?.period ?? 'all_time',
    });

    // Get viewer's position
    const viewerPosition = await this.leaderboard.getUserPosition(
      guildId,
      viewerId
    );

    // Transform entries based on glimpse mode
    const entries: GlimpseLeaderboardEntry[] = data.entries.map((entry) => {
      const isViewer = entry.userId === viewerId;

      if (isGlimpseMode && !isViewer) {
        // Hide competitor details
        return {
          rank: entry.rank,
          isViewer: false,
          displayName: null,
          score: null,
          tier: null,
          isGlimpsed: true,
        };
      }

      return {
        rank: entry.rank,
        isViewer,
        displayName: entry.displayName,
        score: entry.score,
        tier: entry.tier,
        isGlimpsed: false,
      };
    });

    // Viewer entry (always shown)
    const viewerEntry: GlimpseLeaderboardEntry | null = viewerPosition
      ? {
          rank: viewerPosition.rank,
          isViewer: true,
          displayName: viewerPosition.displayName,
          score: viewerPosition.score,
          tier: viewerPosition.tier,
          isGlimpsed: false,
        }
      : null;

    return {
      communityId,
      guildId,
      entries,
      viewerEntry,
      totalMembers: data.total,
      isGlimpseMode,
      unlockMessage: isGlimpseMode
        ? DEFAULT_UNLOCK_MESSAGES.migration_cta.message
        : undefined,
    };
  }

  // ===========================================================================
  // Profile Directory Glimpse (S-27.2)
  // ===========================================================================

  /**
   * Get glimpse profile directory.
   *
   * Shows profile cards with blurred details unless community has full access.
   */
  async getProfileDirectory(
    context: GlimpseContext,
    options?: ProfileDirectoryQueryOptions
  ): Promise<GlimpseProfileDirectory> {
    const { communityId, guildId, viewerId } = context;
    const isGlimpseMode = await this.isGlimpseModeActive(communityId);

    this.metrics.glimpseViews.inc({
      community_id: communityId,
      feature: 'profile_directory',
    });

    // Get raw profile data
    const data = await this.profiles.getProfiles(guildId, {
      limit: options?.limit ?? this.options.defaultProfileLimit,
      offset: options?.offset ?? 0,
      tier: options?.tier,
      search: options?.search,
    });

    // Transform profiles based on glimpse mode
    const profiles: GlimpseProfileCard[] = data.profiles.map((profile) => {
      const isViewer = profile.userId === viewerId;

      if (isGlimpseMode && !isViewer) {
        // Blur competitor details
        return {
          userId: profile.userId,
          isViewer: false,
          displayName: null,
          avatarUrl: null,
          tierName: null,
          convictionScore: null,
          badgeCount: profile.badgeCount, // Badge count shown
          isBlurred: true,
        };
      }

      return {
        userId: profile.userId,
        isViewer,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        tierName: profile.tierName,
        convictionScore: profile.convictionScore,
        badgeCount: profile.badgeCount,
        isBlurred: false,
      };
    });

    // Viewer profile (always shown in full)
    const viewerProfileData = data.profiles.find((p) => p.userId === viewerId);
    const viewerProfile: GlimpseProfileCard | null = viewerProfileData
      ? {
          userId: viewerProfileData.userId,
          isViewer: true,
          displayName: viewerProfileData.displayName,
          avatarUrl: viewerProfileData.avatarUrl,
          tierName: viewerProfileData.tierName,
          convictionScore: viewerProfileData.convictionScore,
          badgeCount: viewerProfileData.badgeCount,
          isBlurred: false,
        }
      : null;

    return {
      communityId,
      guildId,
      profiles,
      viewerProfile,
      totalProfiles: data.total,
      isGlimpseMode,
      unlockMessage: isGlimpseMode
        ? DEFAULT_UNLOCK_MESSAGES.migration_cta.message
        : undefined,
    };
  }

  // ===========================================================================
  // Badge Showcase Glimpse (S-27.3)
  // ===========================================================================

  /**
   * Get glimpse badge showcase.
   *
   * Shows badges with locked icons unless community has full access.
   */
  async getBadgeShowcase(
    context: GlimpseContext,
    options?: BadgeShowcaseQueryOptions
  ): Promise<GlimpseBadgeShowcase> {
    const { communityId, guildId, viewerId } = context;
    const isGlimpseMode = await this.isGlimpseModeActive(communityId);

    this.metrics.glimpseViews.inc({
      community_id: communityId,
      feature: 'badge_showcase',
    });

    // Get available badges
    const data = await this.badges.getBadges(guildId, {
      rarity: options?.rarity,
      earnedOnly: options?.earnedOnly,
    });

    // Get viewer's earned badges
    const viewerEarnedBadgeIds = await this.badges.getUserBadges(
      guildId,
      viewerId
    );
    const viewerEarnedSet = new Set(viewerEarnedBadgeIds);

    // Transform badges based on glimpse mode
    const badges: GlimpseBadge[] = data.badges.map((badge) => {
      const viewerEarned = viewerEarnedSet.has(badge.badgeId);

      return {
        badgeId: badge.badgeId,
        name: badge.name,
        description: badge.description,
        iconUrl: badge.iconUrl,
        isLocked: isGlimpseMode && !viewerEarned,
        viewerEarned,
        totalHolders: badge.totalHolders,
        rarity: badge.rarity,
      };
    });

    // Viewer's badges (always shown in full)
    const viewerBadges = badges.filter((b) => b.viewerEarned);

    return {
      communityId,
      guildId,
      badges,
      viewerBadges,
      totalBadges: data.total,
      isGlimpseMode,
      unlockMessage: isGlimpseMode
        ? DEFAULT_UNLOCK_MESSAGES.migration_cta.message
        : undefined,
    };
  }

  // ===========================================================================
  // Preview Profile (S-27.4)
  // ===========================================================================

  /**
   * Get full preview profile for the viewing user.
   *
   * Always shows complete stats regardless of community tier.
   * This is the "Your Preview Profile" feature.
   */
  async getPreviewProfile(context: GlimpseContext): Promise<PreviewProfile | null> {
    const { guildId, viewerId, communityId } = context;

    this.metrics.glimpseViews.inc({
      community_id: communityId,
      feature: 'preview_profile',
    });

    return this.profiles.getFullProfile(guildId, viewerId);
  }

  // ===========================================================================
  // Unlock Messaging (S-27.5)
  // ===========================================================================

  /**
   * Get unlock message for a feature.
   */
  async getUnlockMessage(
    communityId: string,
    feature: string,
    isAdmin: boolean
  ): Promise<UnlockMessage> {
    const config = await this.getConfig(communityId);

    // Custom message if set
    if (config?.customUnlockMessage) {
      return {
        type: 'custom',
        message: config.customUnlockMessage,
        adminOnly: false,
      };
    }

    // Check readiness to determine message type
    const readiness = await this.checkReadiness(communityId);

    if (readiness.ready) {
      // Ready but not migrated - admin action required
      return DEFAULT_UNLOCK_MESSAGES.admin_action_required;
    }

    if (isAdmin) {
      // Show readiness status to admins
      return {
        ...DEFAULT_UNLOCK_MESSAGES.readiness_check,
        description: `Blockers: ${readiness.blockers.join(', ')}`,
      };
    }

    // Default migration CTA
    return DEFAULT_UNLOCK_MESSAGES.migration_cta;
  }

  /**
   * Set custom unlock message.
   */
  async setCustomUnlockMessage(
    communityId: string,
    message: string
  ): Promise<void> {
    await this.updateConfig(communityId, {
      customUnlockMessage: message,
    });
  }

  // ===========================================================================
  // Migration Readiness Checks (S-27.6)
  // ===========================================================================

  /**
   * Check migration readiness for a community.
   */
  async checkReadiness(communityId: string): Promise<MigrationReadinessResult> {
    const guildId = await this.verification.getGuildId(communityId);
    if (!guildId) {
      return {
        communityId,
        guildId: '',
        ready: false,
        checks: [],
        blockers: ['Community not found'],
        warnings: [],
        estimatedDaysUntilReady: null,
        recommendedStrategy: null,
      };
    }

    const requirements = await this.getRequirements(communityId);
    const checks: MigrationReadinessCheck[] = [];
    const blockers: string[] = [];
    const warnings: string[] = [];

    // Check shadow days
    const shadowDays = await this.getShadowDays(communityId);
    const shadowDaysCheck: MigrationReadinessCheck = {
      name: 'Shadow Mode Duration',
      description: `Minimum ${requirements.minShadowDays} days in shadow mode required`,
      passed: shadowDays >= requirements.minShadowDays,
      current: shadowDays,
      required: requirements.minShadowDays,
      severity: 'blocker',
    };
    checks.push(shadowDaysCheck);
    if (!shadowDaysCheck.passed) {
      blockers.push(
        `Insufficient shadow days: ${shadowDays}/${requirements.minShadowDays}`
      );
    }

    // Check accuracy
    const accuracy = await this.getShadowAccuracy(communityId);
    const accuracyCheck: MigrationReadinessCheck = {
      name: 'Shadow Accuracy',
      description: `Minimum ${(requirements.minAccuracy * 100).toFixed(0)}% accuracy required`,
      passed: accuracy >= requirements.minAccuracy,
      current: `${(accuracy * 100).toFixed(1)}%`,
      required: `${(requirements.minAccuracy * 100).toFixed(0)}%`,
      severity: 'blocker',
    };
    checks.push(accuracyCheck);
    if (!accuracyCheck.passed) {
      blockers.push(
        `Insufficient accuracy: ${(accuracy * 100).toFixed(1)}%/${(requirements.minAccuracy * 100).toFixed(0)}%`
      );
    }

    // Check divergence rate (warning only)
    const stats = await this.shadow.getStats(guildId);
    const divergenceRate =
      stats.totalMembers > 0
        ? stats.divergentMembers / stats.totalMembers
        : 0;

    if (
      requirements.maxDivergenceRate &&
      divergenceRate > requirements.maxDivergenceRate
    ) {
      warnings.push(
        `High divergence rate: ${(divergenceRate * 100).toFixed(1)}%`
      );
    }

    // Record metrics
    this.metrics.readinessChecks.inc({
      community_id: communityId,
      result: blockers.length === 0 ? 'ready' : 'not_ready',
    });

    // Estimate days until ready
    const estimatedDays = await this.estimateDaysUntilReady(communityId);

    // Get recommended strategy
    const strategy = await this.getRecommendedStrategy(communityId);

    return {
      communityId,
      guildId,
      ready: blockers.length === 0,
      checks,
      blockers,
      warnings,
      estimatedDaysUntilReady: blockers.length === 0 ? null : estimatedDays,
      recommendedStrategy: blockers.length === 0 ? strategy : null,
    };
  }

  /**
   * Get readiness requirements.
   */
  async getRequirements(
    communityId: string
  ): Promise<MigrationReadinessRequirements> {
    const stored = await this.configStore.getRequirements(communityId);
    return stored ?? DEFAULT_MIGRATION_READINESS_REQUIREMENTS;
  }

  /**
   * Update readiness requirements (admin override).
   */
  async updateRequirements(
    communityId: string,
    requirements: Partial<MigrationReadinessRequirements>
  ): Promise<void> {
    const existing = await this.getRequirements(communityId);
    const updated: MigrationReadinessRequirements = {
      ...existing,
      ...requirements,
    };
    await this.configStore.saveRequirements(communityId, updated);
    this.log.info({ communityId, requirements: updated }, 'Readiness requirements updated');
  }

  /**
   * Get shadow mode days for a community.
   */
  async getShadowDays(communityId: string): Promise<number> {
    const startDate = await this.verification.getShadowModeStartDate(communityId);
    if (!startDate) return 0;

    const now = new Date();
    const diffMs = now.getTime() - startDate.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  /**
   * Get current shadow accuracy for a community.
   */
  async getShadowAccuracy(communityId: string): Promise<number> {
    const guildId = await this.verification.getGuildId(communityId);
    if (!guildId) return 0;

    const stats = await this.shadow.getStats(guildId);
    return stats.accuracy;
  }

  /**
   * Estimate days until ready for migration.
   */
  async estimateDaysUntilReady(communityId: string): Promise<number | null> {
    const requirements = await this.getRequirements(communityId);
    const currentDays = await this.getShadowDays(communityId);
    const currentAccuracy = await this.getShadowAccuracy(communityId);

    // If accuracy is below threshold and not improving, can't estimate
    if (currentAccuracy < requirements.minAccuracy) {
      // Assume accuracy improves by 1% per week on average
      const accuracyGap = requirements.minAccuracy - currentAccuracy;
      const estimatedAccuracyDays = Math.ceil(accuracyGap * 100 * 7);

      // Take the max of days needed and accuracy improvement time
      const daysNeeded = requirements.minShadowDays - currentDays;
      return Math.max(daysNeeded, estimatedAccuracyDays);
    }

    // Just need to wait out the shadow days
    const daysNeeded = requirements.minShadowDays - currentDays;
    return daysNeeded > 0 ? daysNeeded : null;
  }

  /**
   * Get recommended migration strategy.
   */
  async getRecommendedStrategy(
    communityId: string
  ): Promise<'instant' | 'gradual' | 'parallel_forever' | null> {
    const guildId = await this.verification.getGuildId(communityId);
    if (!guildId) return null;

    const stats = await this.shadow.getStats(guildId);
    const accuracy = stats.accuracy;

    // High accuracy (>98%): instant migration recommended
    if (accuracy >= 0.98) {
      return 'instant';
    }

    // Good accuracy (95-98%): gradual migration recommended
    if (accuracy >= 0.95) {
      return 'gradual';
    }

    // Lower accuracy: parallel forever until improved
    return 'parallel_forever';
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a GlimpseManager instance.
 */
export function createGlimpseManager(
  leaderboard: ILeaderboardDataSource,
  profiles: IProfileDataSource,
  badges: IBadgeDataSource,
  verification: ICommunityVerificationSource,
  shadow: IShadowStats,
  configStore: IGlimpseConfigStore,
  metrics: IGlimpseMetrics,
  logger: Logger,
  options?: GlimpseManagerOptions
): GlimpseManager {
  return new GlimpseManager(
    leaderboard,
    profiles,
    badges,
    verification,
    shadow,
    configStore,
    metrics,
    logger,
    options
  );
}
