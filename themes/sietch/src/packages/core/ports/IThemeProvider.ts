/**
 * IThemeProvider - Theme System Interfaces
 *
 * Sprint 36: Theme Interface & BasicTheme
 *
 * Architecture:
 * - IThemeProvider: Main interface for theme implementations
 * - TierConfig: Rank-to-tier mapping configuration
 * - BadgeConfig: Achievement badge definitions
 * - NamingConfig: Server/channel naming templates
 * - ChannelTemplate: Discord channel structure
 *
 * @module packages/core/ports/IThemeProvider
 */

// =============================================================================
// Subscription Tiers
// =============================================================================

/**
 * Subscription tier for theme access
 */
export type SubscriptionTier = 'free' | 'premium' | 'enterprise';

// =============================================================================
// Tier Configuration Types
// =============================================================================

/**
 * Strategy for mapping ranks to tiers
 * - absolute: Fixed rank ranges (e.g., rank 1-10 = Gold)
 * - percentage: Based on percentile (e.g., top 10% = Gold)
 * - threshold: Based on score thresholds
 */
export type RankingStrategy = 'absolute' | 'percentage' | 'threshold';

/**
 * Single tier definition
 */
export interface TierDefinition {
  /** Unique tier identifier */
  id: string;
  /** Internal name (snake_case) */
  name: string;
  /** Display name for users */
  displayName: string;
  /** Minimum rank for this tier (inclusive) */
  minRank?: number;
  /** Maximum rank for this tier (inclusive, null = unlimited) */
  maxRank?: number | null;
  /** Discord role hex color */
  roleColor: string;
  /** Permission identifiers for this tier */
  permissions: string[];
}

/**
 * Complete tier configuration for a theme
 */
export interface TierConfig {
  /** Ordered list of tiers (highest rank first) */
  tiers: TierDefinition[];
  /** Strategy for rank-to-tier mapping */
  rankingStrategy: RankingStrategy;
  /** Hours before demotion after rank drop (0 = immediate) */
  demotionGracePeriod?: number;
}

/**
 * Result of tier evaluation
 */
export interface TierResult {
  /** Tier identifier */
  tierId: string;
  /** Display name */
  tierName: string;
  /** Role color hex */
  roleColor: string;
  /** Rank within tier (1 = top of tier) */
  rankInTier?: number;
  /** Previous tier (for demotion tracking) */
  previousTier?: string;
}

// =============================================================================
// Badge Configuration Types
// =============================================================================

/**
 * Badge categories for organization
 */
export type BadgeCategory = 'tenure' | 'achievement' | 'activity' | 'special';

/**
 * Types of badge criteria
 */
export type BadgeCriteriaType =
  | 'tenure'           // Days holding
  | 'tier_reached'     // Reached specific tier
  | 'tier_maintained'  // Maintained tier for duration
  | 'activity'         // Activity score threshold
  | 'conviction'       // Conviction score threshold
  | 'custom';          // Custom evaluator function

/**
 * Badge criteria for automatic evaluation
 */
export interface BadgeCriteria {
  /** Type of criteria check */
  type: BadgeCriteriaType;
  /** Threshold value (days for tenure, score for others) */
  threshold?: number;
  /** Required tier for tier_reached */
  tierRequired?: string;
  /** Duration in days for tier_maintained */
  durationDays?: number;
  /** Custom evaluator function name */
  customEvaluator?: string;
}

/**
 * Single badge definition
 */
export interface BadgeDefinition {
  /** Unique badge identifier */
  id: string;
  /** Display name */
  displayName: string;
  /** Emoji for display */
  emoji: string;
  /** Category for grouping */
  category: BadgeCategory;
  /** Criteria for earning */
  criteria: BadgeCriteria;
  /** Description for users */
  description?: string;
  /** Whether badge can be lost */
  revocable?: boolean;
}

/**
 * Complete badge configuration for a theme
 */
export interface BadgeConfig {
  /** Available badge categories */
  categories: BadgeCategory[];
  /** All badge definitions */
  badges: BadgeDefinition[];
}

/**
 * Badge earned by a member
 */
export interface EarnedBadge {
  /** Badge identifier */
  badgeId: string;
  /** Display name */
  badgeName: string;
  /** Emoji */
  emoji: string;
  /** When badge was earned */
  earnedAt: Date;
  /** Additional context (e.g., lineage for Water Sharer) */
  context?: Record<string, unknown>;
}

// =============================================================================
// Naming Configuration Types
// =============================================================================

/**
 * Category name mappings
 */
export interface CategoryNames {
  /** Information category (rules, announcements) */
  info: string;
  /** Admin/council category */
  council: string;
  /** General discussion category */
  general: string;
  /** Operations/bot category */
  operations: string;
}

/**
 * Terminology for theme
 */
export interface Terminology {
  /** What to call community members */
  member: string;
  /** What to call token holders */
  holder: string;
  /** What to call admins */
  admin: string;
  /** What to call the community */
  community?: string;
}

/**
 * Naming configuration for server branding
 */
export interface NamingConfig {
  /** Template for server name */
  serverNameTemplate: string;
  /** Category name mappings */
  categoryNames: CategoryNames;
  /** Terminology for theme */
  terminology: Terminology;
}

// =============================================================================
// Channel Template Types
// =============================================================================

/**
 * Channel type for Discord
 */
export type ChannelType = 'text' | 'voice' | 'announcement' | 'forum';

/**
 * Single channel definition
 */
export interface ChannelDefinition {
  /** Channel name */
  name: string;
  /** Channel type */
  type: ChannelType;
  /** Read-only (info channel) */
  readonly?: boolean;
  /** Topic/description */
  topic?: string;
  /** Tier restriction (tier id or null for all) */
  tierRestriction?: string;
}

/**
 * Category with channels
 */
export interface CategoryDefinition {
  /** Category identifier */
  id: string;
  /** Category display name */
  name: string;
  /** Channels in category */
  channels: ChannelDefinition[];
  /** Tier restriction for entire category */
  tierRestriction?: string;
}

/**
 * Complete channel template for server setup
 */
export interface ChannelTemplate {
  /** Categories with channels */
  categories: CategoryDefinition[];
}

// =============================================================================
// Member Context for Evaluation
// =============================================================================

/**
 * Member context for badge/tier evaluation
 */
export interface MemberContext {
  /** Wallet address */
  address: string;
  /** Current rank (1 = top) */
  rank: number;
  /** Current tier id */
  currentTier?: string;
  /** Conviction score */
  convictionScore: number;
  /** Activity score */
  activityScore: number;
  /** First claim timestamp */
  firstClaimAt: Date | null;
  /** Last activity timestamp */
  lastActivityAt: Date | null;
  /** Days holding */
  tenureDays: number;
  /** Highest tier ever reached */
  highestTier?: string;
  /** Additional context for custom evaluators */
  customContext?: Record<string, unknown>;
}

// =============================================================================
// Main Interface
// =============================================================================

/**
 * IThemeProvider Interface
 *
 * Defines the contract for theme implementations.
 * Themes provide configuration for tiers, badges, naming, and channels.
 *
 * Implementations:
 * - BasicTheme: Free tier (3 tiers, 5 badges)
 * - SietchTheme: Premium tier (9 tiers, 10+ badges, Dune naming)
 */
export interface IThemeProvider {
  /** Unique theme identifier */
  readonly themeId: string;

  /** Human-readable theme name */
  readonly themeName: string;

  /** Subscription tier required for this theme */
  readonly tier: SubscriptionTier;

  /**
   * Get tier configuration
   * @returns Tier definitions and ranking strategy
   */
  getTierConfig(): TierConfig;

  /**
   * Get badge configuration
   * @returns Badge definitions and categories
   */
  getBadgeConfig(): BadgeConfig;

  /**
   * Get naming configuration
   * @returns Server naming templates and terminology
   */
  getNamingConfig(): NamingConfig;

  /**
   * Get channel template for server setup
   * @returns Category and channel definitions
   */
  getChannelTemplate(): ChannelTemplate;

  /**
   * Evaluate tier for a given rank
   * @param rank - Member's current rank (1 = top)
   * @param totalHolders - Total number of holders for percentage calculations
   * @returns Tier result with id, name, and color
   */
  evaluateTier(rank: number, totalHolders?: number): TierResult;

  /**
   * Evaluate badges for a member
   * @param member - Member context with scores and tenure
   * @returns Array of earned badges
   */
  evaluateBadges(member: MemberContext): EarnedBadge[];
}
