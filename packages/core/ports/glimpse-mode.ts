/**
 * Glimpse Mode Port Interface
 *
 * Sprint S-27: Glimpse Mode & Migration Readiness
 *
 * Defines the contract for glimpse mode operations.
 *
 * @see SDD §7.2.3 Glimpse Mode
 */

import type {
  GlimpseModeConfig,
  GlimpseModeStatus,
  GlimpseLeaderboard,
  GlimpseProfileDirectory,
  GlimpseBadgeShowcase,
  PreviewProfile,
  UnlockMessage,
  MigrationReadinessResult,
  MigrationReadinessRequirements,
} from '../domain/glimpse-mode.js';

// =============================================================================
// Glimpse Manager Interface
// =============================================================================

/**
 * Context for glimpse operations.
 */
export interface GlimpseContext {
  /** Community ID */
  communityId: string;
  /** Guild ID */
  guildId: string;
  /** Viewing user ID */
  viewerId: string;
  /** Whether viewer is admin */
  isAdmin: boolean;
}

/**
 * Leaderboard query options.
 */
export interface LeaderboardQueryOptions {
  /** Number of entries to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Time period filter */
  period?: 'day' | 'week' | 'month' | 'all_time';
}

/**
 * Profile directory query options.
 */
export interface ProfileDirectoryQueryOptions {
  /** Number of profiles to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Filter by tier */
  tier?: string;
  /** Search by name */
  search?: string;
}

/**
 * Badge showcase query options.
 */
export interface BadgeShowcaseQueryOptions {
  /** Filter by rarity */
  rarity?: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  /** Only show earned badges */
  earnedOnly?: boolean;
}

/**
 * IGlimpseManager defines the contract for glimpse mode operations.
 */
export interface IGlimpseManager {
  // ===========================================================================
  // Glimpse Mode Lifecycle
  // ===========================================================================

  /**
   * Check if glimpse mode is active for a community.
   */
  isGlimpseModeActive(communityId: string): Promise<boolean>;

  /**
   * Get glimpse mode status for a community.
   */
  getStatus(communityId: string): Promise<GlimpseModeStatus | null>;

  /**
   * Get glimpse mode configuration.
   */
  getConfig(communityId: string): Promise<GlimpseModeConfig | null>;

  /**
   * Update glimpse mode configuration.
   */
  updateConfig(
    communityId: string,
    config: Partial<GlimpseModeConfig>
  ): Promise<void>;

  // ===========================================================================
  // Leaderboard Glimpse
  // ===========================================================================

  /**
   * Get glimpse leaderboard.
   *
   * Shows viewer's position and score, hides competitors' details
   * unless community has full access.
   */
  getLeaderboard(
    context: GlimpseContext,
    options?: LeaderboardQueryOptions
  ): Promise<GlimpseLeaderboard>;

  // ===========================================================================
  // Profile Directory Glimpse
  // ===========================================================================

  /**
   * Get glimpse profile directory.
   *
   * Shows profile cards with blurred details unless community has full access.
   */
  getProfileDirectory(
    context: GlimpseContext,
    options?: ProfileDirectoryQueryOptions
  ): Promise<GlimpseProfileDirectory>;

  // ===========================================================================
  // Badge Showcase Glimpse
  // ===========================================================================

  /**
   * Get glimpse badge showcase.
   *
   * Shows badges with locked icons unless community has full access.
   */
  getBadgeShowcase(
    context: GlimpseContext,
    options?: BadgeShowcaseQueryOptions
  ): Promise<GlimpseBadgeShowcase>;

  // ===========================================================================
  // Preview Profile
  // ===========================================================================

  /**
   * Get full preview profile for the viewing user.
   *
   * Always shows complete stats regardless of community tier.
   * This is the "Your Preview Profile" feature.
   */
  getPreviewProfile(context: GlimpseContext): Promise<PreviewProfile | null>;

  // ===========================================================================
  // Unlock Messaging
  // ===========================================================================

  /**
   * Get unlock message for a feature.
   */
  getUnlockMessage(
    communityId: string,
    feature: string,
    isAdmin: boolean
  ): Promise<UnlockMessage>;

  /**
   * Set custom unlock message.
   */
  setCustomUnlockMessage(
    communityId: string,
    message: string
  ): Promise<void>;
}

// =============================================================================
// Migration Readiness Checker Interface
// =============================================================================

/**
 * IMigrationReadinessChecker defines the contract for migration readiness checks.
 */
export interface IMigrationReadinessChecker {
  /**
   * Check migration readiness for a community.
   */
  checkReadiness(communityId: string): Promise<MigrationReadinessResult>;

  /**
   * Get readiness requirements.
   */
  getRequirements(communityId: string): Promise<MigrationReadinessRequirements>;

  /**
   * Update readiness requirements (admin override).
   */
  updateRequirements(
    communityId: string,
    requirements: Partial<MigrationReadinessRequirements>
  ): Promise<void>;

  /**
   * Get shadow mode days for a community.
   */
  getShadowDays(communityId: string): Promise<number>;

  /**
   * Get current shadow accuracy for a community.
   */
  getShadowAccuracy(communityId: string): Promise<number>;

  /**
   * Estimate days until ready for migration.
   */
  estimateDaysUntilReady(communityId: string): Promise<number | null>;

  /**
   * Get recommended migration strategy.
   */
  getRecommendedStrategy(
    communityId: string
  ): Promise<'instant' | 'gradual' | 'parallel_forever' | null>;
}

// =============================================================================
// Combined Glimpse & Readiness Interface
// =============================================================================

/**
 * IGlimpseAndReadiness combines glimpse mode and migration readiness.
 *
 * This is the main interface for S-27 functionality.
 */
export interface IGlimpseAndReadiness extends IGlimpseManager, IMigrationReadinessChecker {
  // Additional combined methods if needed
}
