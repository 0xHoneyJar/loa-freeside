/**
 * Basic Theme
 * Sprint S-17: Theme Interface & BasicTheme
 *
 * Simple 3-tier, 5-badge theme available to all subscription tiers (free).
 * Provides generic naming suitable for any community.
 *
 * Tiers:
 * - Gold (ranks 1-10)
 * - Silver (ranks 11-50)
 * - Bronze (ranks 51-100)
 *
 * Badges:
 * - Early Adopter (first 100 members)
 * - Veteran (180+ days)
 * - Top Tier (reached Gold)
 * - Active Member (active last 30 days)
 * - Contributor (manually granted)
 *
 * @see SDD §6.2.3 BasicTheme Implementation
 */

import type {
  IThemeProvider,
  TierConfig,
  BadgeConfig,
  NamingConfig,
  TierResult,
  EarnedBadge,
  Profile,
  ProfileHistory,
  SubscriptionTier,
} from '../../core/ports/theme-provider.js';
import { evaluateAllBadges } from './badge-evaluators.js';

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

/** Theme identifier */
const THEME_ID = 'basic';

/** Theme display name */
const THEME_NAME = 'Basic Theme';

/** Theme description */
const THEME_DESCRIPTION = 'Simple 3-tier progression with 5 badges';

/** Required subscription tier (free = available to all) */
const SUBSCRIPTION_TIER: SubscriptionTier = 'free';

// --------------------------------------------------------------------------
// Tier Configuration
// --------------------------------------------------------------------------

/**
 * Gold tier - ranks 1-10
 * Highest tier with premium permissions
 */
const GOLD_TIER: TierConfig = {
  id: 'gold',
  name: 'Gold',
  displayName: 'Gold Member',
  minRank: 1,
  maxRank: 10,
  roleColor: 0xffd700, // Gold color
  permissions: ['view_analytics', 'priority_support'],
  emoji: '🥇',
};

/**
 * Silver tier - ranks 11-50
 * Mid-tier with analytics access
 */
const SILVER_TIER: TierConfig = {
  id: 'silver',
  name: 'Silver',
  displayName: 'Silver Member',
  minRank: 11,
  maxRank: 50,
  roleColor: 0xc0c0c0, // Silver color
  permissions: ['view_analytics'],
  emoji: '🥈',
};

/**
 * Bronze tier - ranks 51-100
 * Entry tier with no special permissions
 */
const BRONZE_TIER: TierConfig = {
  id: 'bronze',
  name: 'Bronze',
  displayName: 'Bronze Member',
  minRank: 51,
  maxRank: 100,
  roleColor: 0xcd7f32, // Bronze color
  permissions: [],
  emoji: '🥉',
};

/**
 * Unranked tier - for members outside top 100
 * Used as fallback when member doesn't qualify for any tier
 */
const UNRANKED_TIER: TierConfig = {
  id: 'unranked',
  name: 'Unranked',
  displayName: 'Member',
  minRank: 101,
  maxRank: Number.MAX_SAFE_INTEGER,
  roleColor: 0x808080, // Gray color
  permissions: [],
  emoji: '',
};

/** All tiers ordered by rank (best first) */
const BASIC_TIERS: TierConfig[] = [GOLD_TIER, SILVER_TIER, BRONZE_TIER, UNRANKED_TIER];

// --------------------------------------------------------------------------
// Badge Configuration
// --------------------------------------------------------------------------

/**
 * Early Adopter badge - join_order evaluator
 * Awarded to first 100 members
 */
const EARLY_ADOPTER_BADGE: BadgeConfig = {
  id: 'early_adopter',
  name: 'Early Adopter',
  displayName: 'Early Adopter',
  description: 'One of the first 100 members to join',
  emoji: '🌟',
  evaluator: 'join_order',
  parameters: { maxPosition: 100 },
  rarity: 'rare',
};

/**
 * Veteran badge - tenure evaluator
 * Awarded after 180 days of membership
 */
const VETERAN_BADGE: BadgeConfig = {
  id: 'veteran',
  name: 'Veteran',
  displayName: 'Veteran',
  description: 'Member for 6+ months',
  emoji: '🎖️',
  evaluator: 'tenure',
  parameters: { minDays: 180 },
  rarity: 'uncommon',
};

/**
 * Top Tier badge - tier_reached evaluator
 * Awarded when reaching Gold tier
 */
const TOP_TIER_BADGE: BadgeConfig = {
  id: 'top_tier',
  name: 'Top Tier',
  displayName: 'Top Tier',
  description: 'Reached Gold tier',
  emoji: '👑',
  evaluator: 'tier_reached',
  parameters: { tierId: 'gold' },
  rarity: 'rare',
};

/**
 * Active Member badge - recent_activity evaluator
 * Awarded when active in last 30 days
 */
const ACTIVE_MEMBER_BADGE: BadgeConfig = {
  id: 'active_member',
  name: 'Active Member',
  displayName: 'Active Member',
  description: 'Active in the last 30 days',
  emoji: '⚡',
  evaluator: 'recent_activity',
  parameters: { maxDays: 30 },
  rarity: 'common',
};

/**
 * Contributor badge - manual_grant evaluator
 * Manually granted by admins
 */
const CONTRIBUTOR_BADGE: BadgeConfig = {
  id: 'contributor',
  name: 'Contributor',
  displayName: 'Contributor',
  description: 'Recognized community contributor',
  emoji: '💎',
  evaluator: 'manual_grant',
  parameters: {},
  rarity: 'epic',
};

/** All badges for BasicTheme */
const BASIC_BADGES: BadgeConfig[] = [
  EARLY_ADOPTER_BADGE,
  VETERAN_BADGE,
  TOP_TIER_BADGE,
  ACTIVE_MEMBER_BADGE,
  CONTRIBUTOR_BADGE,
];

// --------------------------------------------------------------------------
// Naming Configuration
// --------------------------------------------------------------------------

/** Generic naming suitable for any community */
const BASIC_NAMING: NamingConfig = {
  tierPrefix: 'Rank',
  tierSuffix: '',
  communityNoun: 'Members',
  leaderboardTitle: 'Top Holders',
  scoreLabel: 'Score',
};

// --------------------------------------------------------------------------
// BasicTheme Implementation
// --------------------------------------------------------------------------

/**
 * Basic Theme Implementation
 *
 * Simple 3-tier, 5-badge theme available to all subscription tiers.
 * Provides generic terminology suitable for any token-gated community.
 *
 * @example
 * const theme = new BasicTheme();
 *
 * // Get tier for rank 5
 * const result = theme.evaluateTier(1000, 500, 5);
 * console.log(result.tier.name); // "Gold"
 *
 * // Evaluate badges
 * const badges = theme.evaluateBadges(profile, history);
 * console.log(badges.length); // Number of earned badges
 */
export class BasicTheme implements IThemeProvider {
  // --------------------------------------------------------------------------
  // IThemeProvider Properties
  // --------------------------------------------------------------------------

  readonly id = THEME_ID;
  readonly name = THEME_NAME;
  readonly description = THEME_DESCRIPTION;
  readonly subscriptionTier = SUBSCRIPTION_TIER;

  // --------------------------------------------------------------------------
  // IThemeProvider Methods
  // --------------------------------------------------------------------------

  /**
   * Get tier configurations
   * @returns Array of 4 tiers (Gold, Silver, Bronze, Unranked)
   */
  getTierConfig(): TierConfig[] {
    return [...BASIC_TIERS];
  }

  /**
   * Get badge configurations
   * @returns Array of 5 badges
   */
  getBadgeConfig(): BadgeConfig[] {
    return [...BASIC_BADGES];
  }

  /**
   * Get naming configuration
   * @returns Generic naming config
   */
  getNamingConfig(): NamingConfig {
    return { ...BASIC_NAMING };
  }

  /**
   * Evaluate which tier a member belongs to
   *
   * @param score - Member's score value
   * @param totalMembers - Total members in community
   * @param rank - Member's rank (1 = highest)
   * @returns TierResult with matched tier
   */
  evaluateTier(score: number, totalMembers: number, rank: number): TierResult {
    // Find the tier that matches this rank
    let matchedTier = UNRANKED_TIER;

    for (const tier of BASIC_TIERS) {
      if (rank >= tier.minRank && rank <= tier.maxRank) {
        matchedTier = tier;
        break;
      }
    }

    // Calculate percentile (100 = best)
    const percentile =
      totalMembers > 0 ? Math.round((1 - (rank - 1) / totalMembers) * 100) : 0;

    return {
      tier: matchedTier,
      score,
      rank,
      percentile,
    };
  }

  /**
   * Evaluate which badges a member has earned
   *
   * @param profile - Member's current profile
   * @param history - Member's historical data
   * @returns Array of earned badges
   */
  evaluateBadges(profile: Profile, history: ProfileHistory): EarnedBadge[] {
    return evaluateAllBadges(BASIC_BADGES, profile, history);
  }
}

// --------------------------------------------------------------------------
// Singleton Export
// --------------------------------------------------------------------------

/**
 * Default BasicTheme instance
 * Use this for most cases to avoid creating multiple instances
 */
export const basicTheme = new BasicTheme();
