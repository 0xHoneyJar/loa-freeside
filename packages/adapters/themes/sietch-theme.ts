/**
 * Sietch Theme
 * Sprint S-18: SietchTheme & Theme Registry
 *
 * Premium 9-tier, 10-badge Dune-themed progression (v4.1 parity).
 * Available to Pro and Enterprise subscription tiers.
 *
 * Tiers (9):
 * - Naib (rank 1) - Community leader
 * - Fedaykin Elite (ranks 2-5) - Elite warriors
 * - Fedaykin (ranks 6-15) - Warriors
 * - Fremen (ranks 16-30) - Desert people
 * - Wanderer (ranks 31-50) - Travelers
 * - Initiate (ranks 51-75) - Learners
 * - Aspirant (ranks 76-100) - Newcomers
 * - Observer (ranks 101-200) - Watchers
 * - Outsider (ranks 201+) - Outside the sietch
 *
 * @see SDD §6.2.4 SietchTheme Implementation
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
const THEME_ID = 'sietch';

/** Theme display name */
const THEME_NAME = 'Sietch Theme';

/** Theme description */
const THEME_DESCRIPTION = 'Dune-themed 9-tier progression (v4.1 parity)';

/** Required subscription tier (Pro or higher) */
const SUBSCRIPTION_TIER: SubscriptionTier = 'pro';

// --------------------------------------------------------------------------
// Tier Configuration (9 Tiers)
// --------------------------------------------------------------------------

/**
 * Naib tier - rank 1 only
 * Community leader, highest honor
 */
const NAIB_TIER: TierConfig = {
  id: 'naib',
  name: 'Naib',
  displayName: 'Naib',
  minRank: 1,
  maxRank: 1,
  roleColor: 0xffd700, // Gold
  permissions: ['naib_council', 'view_analytics', 'priority_support'],
  emoji: '👑',
};

/**
 * Fedaykin Elite tier - ranks 2-5
 * Elite warriors of the sietch
 */
const FEDAYKIN_ELITE_TIER: TierConfig = {
  id: 'fedaykin_elite',
  name: 'Fedaykin Elite',
  displayName: 'Fedaykin Elite',
  minRank: 2,
  maxRank: 5,
  roleColor: 0x9400d3, // Dark Violet
  permissions: ['view_analytics', 'priority_support'],
  emoji: '⚔️',
};

/**
 * Fedaykin tier - ranks 6-15
 * Warriors of the sietch
 */
const FEDAYKIN_TIER: TierConfig = {
  id: 'fedaykin',
  name: 'Fedaykin',
  displayName: 'Fedaykin',
  minRank: 6,
  maxRank: 15,
  roleColor: 0x800080, // Purple
  permissions: ['view_analytics'],
  emoji: '🗡️',
};

/**
 * Fremen tier - ranks 16-30
 * Desert people of the sietch
 */
const FREMEN_TIER: TierConfig = {
  id: 'fremen',
  name: 'Fremen',
  displayName: 'Fremen',
  minRank: 16,
  maxRank: 30,
  roleColor: 0x1e90ff, // Dodger Blue
  permissions: [],
  emoji: '🏜️',
};

/**
 * Wanderer tier - ranks 31-50
 * Travelers between sietches
 */
const WANDERER_TIER: TierConfig = {
  id: 'wanderer',
  name: 'Wanderer',
  displayName: 'Wanderer',
  minRank: 31,
  maxRank: 50,
  roleColor: 0x32cd32, // Lime Green
  permissions: [],
  emoji: '🚶',
};

/**
 * Initiate tier - ranks 51-75
 * Learners of the ways
 */
const INITIATE_TIER: TierConfig = {
  id: 'initiate',
  name: 'Initiate',
  displayName: 'Initiate',
  minRank: 51,
  maxRank: 75,
  roleColor: 0xffff00, // Yellow
  permissions: [],
  emoji: '📚',
};

/**
 * Aspirant tier - ranks 76-100
 * New members seeking acceptance
 */
const ASPIRANT_TIER: TierConfig = {
  id: 'aspirant',
  name: 'Aspirant',
  displayName: 'Aspirant',
  minRank: 76,
  maxRank: 100,
  roleColor: 0xffa500, // Orange
  permissions: [],
  emoji: '🌱',
};

/**
 * Observer tier - ranks 101-200
 * Watchers from the shadows
 */
const OBSERVER_TIER: TierConfig = {
  id: 'observer',
  name: 'Observer',
  displayName: 'Observer',
  minRank: 101,
  maxRank: 200,
  roleColor: 0x808080, // Gray
  permissions: [],
  emoji: '👁️',
};

/**
 * Outsider tier - ranks 201+
 * Outside the sietch
 */
const OUTSIDER_TIER: TierConfig = {
  id: 'outsider',
  name: 'Outsider',
  displayName: 'Outsider',
  minRank: 201,
  maxRank: Number.MAX_SAFE_INTEGER,
  roleColor: 0x696969, // Dim Gray
  permissions: [],
  emoji: '🌍',
};

/** All tiers ordered by rank (best first) */
const SIETCH_TIERS: TierConfig[] = [
  NAIB_TIER,
  FEDAYKIN_ELITE_TIER,
  FEDAYKIN_TIER,
  FREMEN_TIER,
  WANDERER_TIER,
  INITIATE_TIER,
  ASPIRANT_TIER,
  OBSERVER_TIER,
  OUTSIDER_TIER,
];

// --------------------------------------------------------------------------
// Badge Configuration (10 Badges)
// --------------------------------------------------------------------------

/**
 * First Wave badge - join_order evaluator
 * Among the first 50 members
 */
const FIRST_WAVE_BADGE: BadgeConfig = {
  id: 'first_wave',
  name: 'First Wave',
  displayName: 'First Wave',
  description: 'Among the first 50 members to join',
  emoji: '🌊',
  evaluator: 'join_order',
  parameters: { maxPosition: 50 },
  rarity: 'legendary',
};

/**
 * Veteran badge - tenure evaluator
 * Member for over 1 year
 */
const VETERAN_BADGE: BadgeConfig = {
  id: 'veteran',
  name: 'Veteran',
  displayName: 'Veteran',
  description: 'Member for over 1 year',
  emoji: '🎖️',
  evaluator: 'tenure',
  parameters: { minDays: 365 },
  rarity: 'rare',
};

/**
 * Diamond Hands badge - balance_stability evaluator
 * Never dropped below starting balance
 */
const DIAMOND_HANDS_BADGE: BadgeConfig = {
  id: 'diamond_hands',
  name: 'Diamond Hands',
  displayName: 'Diamond Hands',
  description: 'Never dropped below starting balance',
  emoji: '💎',
  evaluator: 'balance_stability',
  parameters: { minRetention: 1.0 },
  rarity: 'epic',
};

/**
 * Council badge - tier_reached evaluator
 * Reached Naib tier
 */
const COUNCIL_BADGE: BadgeConfig = {
  id: 'council',
  name: 'Council Member',
  displayName: 'Council Member',
  description: 'Reached Naib tier',
  emoji: '🏛️',
  evaluator: 'tier_reached',
  parameters: { tierId: 'naib' },
  rarity: 'legendary',
};

/**
 * Survivor badge - market_survival evaluator
 * Survived 3+ market downturns
 */
const SURVIVOR_BADGE: BadgeConfig = {
  id: 'survivor',
  name: 'Survivor',
  displayName: 'Survivor',
  description: 'Survived 3+ market downturns',
  emoji: '🛡️',
  evaluator: 'market_survival',
  parameters: { minEvents: 3 },
  rarity: 'epic',
};

/**
 * Streak Master badge - activity_streak evaluator
 * 30-day activity streak
 */
const STREAK_MASTER_BADGE: BadgeConfig = {
  id: 'streak_master',
  name: 'Streak Master',
  displayName: 'Streak Master',
  description: '30-day activity streak',
  emoji: '🔥',
  evaluator: 'activity_streak',
  parameters: { minStreak: 30 },
  rarity: 'rare',
};

/**
 * Engaged badge - event_participation evaluator
 * Participated in 10+ community events
 */
const ENGAGED_BADGE: BadgeConfig = {
  id: 'engaged',
  name: 'Engaged',
  displayName: 'Engaged',
  description: 'Participated in 10+ community events',
  emoji: '🎯',
  evaluator: 'event_participation',
  parameters: { minEvents: 10 },
  rarity: 'uncommon',
};

/**
 * Contributor badge - manual_grant evaluator
 * Recognized community contributor
 */
const CONTRIBUTOR_BADGE: BadgeConfig = {
  id: 'contributor',
  name: 'Contributor',
  displayName: 'Contributor',
  description: 'Recognized community contributor',
  emoji: '🤝',
  evaluator: 'manual_grant',
  parameters: {},
  rarity: 'epic',
};

/**
 * Pillar badge - rank_tenure evaluator
 * Top 10 holder for 90+ days
 */
const PILLAR_BADGE: BadgeConfig = {
  id: 'pillar',
  name: 'Pillar',
  displayName: 'Pillar',
  description: 'Top 10 holder for 90+ days',
  emoji: '🏆',
  evaluator: 'rank_tenure',
  parameters: { maxRank: 10, minDays: 90 },
  rarity: 'legendary',
};

/**
 * Water Sharer badge - referrals evaluator
 * Referred 5+ new verified members
 */
const WATER_SHARER_BADGE: BadgeConfig = {
  id: 'water_sharer',
  name: 'Water Sharer',
  displayName: 'Water Sharer',
  description: 'Referred 5+ new verified members',
  emoji: '💧',
  evaluator: 'referrals',
  parameters: { minReferrals: 5 },
  rarity: 'rare',
};

/** All badges for SietchTheme */
const SIETCH_BADGES: BadgeConfig[] = [
  FIRST_WAVE_BADGE,
  VETERAN_BADGE,
  DIAMOND_HANDS_BADGE,
  COUNCIL_BADGE,
  SURVIVOR_BADGE,
  STREAK_MASTER_BADGE,
  ENGAGED_BADGE,
  CONTRIBUTOR_BADGE,
  PILLAR_BADGE,
  WATER_SHARER_BADGE,
];

// --------------------------------------------------------------------------
// Naming Configuration
// --------------------------------------------------------------------------

/** Dune-themed naming for the sietch community */
const SIETCH_NAMING: NamingConfig = {
  tierPrefix: '',
  tierSuffix: '',
  communityNoun: 'Sietch',
  leaderboardTitle: 'Conviction Rankings',
  scoreLabel: 'Conviction',
};

// --------------------------------------------------------------------------
// SietchTheme Implementation
// --------------------------------------------------------------------------

/**
 * Sietch Theme Implementation
 *
 * Premium 9-tier Dune-themed progression with 10 badges.
 * Provides full v4.1 parity for existing Arrakis communities.
 *
 * @example
 * const theme = new SietchTheme();
 *
 * // Get tier for rank 1
 * const result = theme.evaluateTier(5000, 1000, 1);
 * console.log(result.tier.name); // "Naib"
 *
 * // Evaluate badges
 * const badges = theme.evaluateBadges(profile, history);
 * console.log(badges.length); // Number of earned badges
 */
export class SietchTheme implements IThemeProvider {
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
   * @returns Array of 9 tiers (Naib through Outsider)
   */
  getTierConfig(): TierConfig[] {
    return [...SIETCH_TIERS];
  }

  /**
   * Get badge configurations
   * @returns Array of 10 badges
   */
  getBadgeConfig(): BadgeConfig[] {
    return [...SIETCH_BADGES];
  }

  /**
   * Get naming configuration
   * @returns Dune-themed naming config
   */
  getNamingConfig(): NamingConfig {
    return { ...SIETCH_NAMING };
  }

  /**
   * Evaluate which tier a member belongs to
   *
   * @param score - Member's conviction value
   * @param totalMembers - Total members in community
   * @param rank - Member's rank (1 = highest)
   * @returns TierResult with matched tier
   */
  evaluateTier(score: number, totalMembers: number, rank: number): TierResult {
    // Find the tier that matches this rank
    let matchedTier = OUTSIDER_TIER;

    for (const tier of SIETCH_TIERS) {
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
    return evaluateAllBadges(SIETCH_BADGES, profile, history);
  }
}

// --------------------------------------------------------------------------
// Singleton Export
// --------------------------------------------------------------------------

/**
 * Default SietchTheme instance
 * Use this for most cases to avoid creating multiple instances
 */
export const sietchTheme = new SietchTheme();
