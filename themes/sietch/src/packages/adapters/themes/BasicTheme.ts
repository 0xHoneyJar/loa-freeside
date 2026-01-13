/**
 * BasicTheme - Free Tier Theme Implementation
 *
 * Sprint 36: Theme Interface & BasicTheme
 *
 * Provides a simple 3-tier structure for free-tier communities:
 * - Gold (rank 1-10): Top performers
 * - Silver (rank 11-50): Active members
 * - Bronze (rank 51-100): Participants
 *
 * Generic naming (no Dune terminology) for broad appeal.
 *
 * @module packages/adapters/themes/BasicTheme
 */

import type {
  IThemeProvider,
  TierConfig,
  TierDefinition,
  TierResult,
  BadgeConfig,
  BadgeDefinition,
  EarnedBadge,
  NamingConfig,
  ChannelTemplate,
  MemberContext,
  SubscriptionTier,
} from '../../core/ports/IThemeProvider.js';

// =============================================================================
// Tier Definitions
// =============================================================================

/**
 * BasicTheme tier definitions
 * Gold (1-10), Silver (11-50), Bronze (51-100)
 */
const BASIC_TIERS: TierDefinition[] = [
  {
    id: 'gold',
    name: 'gold',
    displayName: 'Gold',
    minRank: 1,
    maxRank: 10,
    roleColor: '#FFD700', // Gold
    permissions: ['view_exclusive', 'early_access', 'vote'],
  },
  {
    id: 'silver',
    name: 'silver',
    displayName: 'Silver',
    minRank: 11,
    maxRank: 50,
    roleColor: '#C0C0C0', // Silver
    permissions: ['view_exclusive', 'vote'],
  },
  {
    id: 'bronze',
    name: 'bronze',
    displayName: 'Bronze',
    minRank: 51,
    maxRank: 100,
    roleColor: '#CD7F32', // Bronze
    permissions: ['view_general'],
  },
];

// =============================================================================
// Badge Definitions
// =============================================================================

/**
 * BasicTheme badge definitions
 * 5 badges covering tenure, achievement, activity, and special categories
 */
const BASIC_BADGES: BadgeDefinition[] = [
  // Tenure badges
  {
    id: 'early_adopter',
    displayName: 'Early Adopter',
    emoji: '🌟',
    category: 'tenure',
    criteria: { type: 'tenure', threshold: 30 },
    description: 'Member for 30+ days',
    revocable: false,
  },
  {
    id: 'veteran',
    displayName: 'Veteran',
    emoji: '⭐',
    category: 'tenure',
    criteria: { type: 'tenure', threshold: 90 },
    description: 'Member for 90+ days',
    revocable: false,
  },
  // Achievement badges
  {
    id: 'top_tier',
    displayName: 'Top Tier',
    emoji: '🏆',
    category: 'achievement',
    criteria: { type: 'tier_reached', tierRequired: 'gold' },
    description: 'Reached Gold tier',
    revocable: false,
  },
  // Activity badges
  {
    id: 'active',
    displayName: 'Active',
    emoji: '⚡',
    category: 'activity',
    criteria: { type: 'activity', threshold: 50 },
    description: 'Activity score 50+',
    revocable: true,
  },
  // Special badges
  {
    id: 'contributor',
    displayName: 'Contributor',
    emoji: '🤝',
    category: 'special',
    criteria: { type: 'custom', customEvaluator: 'contributorCheck' },
    description: 'Community contributor',
    revocable: false,
  },
];

// =============================================================================
// BasicTheme Implementation
// =============================================================================

/**
 * BasicTheme class
 *
 * Free-tier theme with 3 tiers and 5 badges.
 * Uses generic naming suitable for any community.
 */
export class BasicTheme implements IThemeProvider {
  readonly themeId = 'basic';
  readonly themeName = 'Basic';
  readonly tier: SubscriptionTier = 'free';

  /**
   * Get tier configuration
   */
  getTierConfig(): TierConfig {
    return {
      tiers: [...BASIC_TIERS],
      rankingStrategy: 'absolute',
      demotionGracePeriod: 0, // Immediate demotion for free tier
    };
  }

  /**
   * Get badge configuration
   */
  getBadgeConfig(): BadgeConfig {
    return {
      categories: ['tenure', 'achievement', 'activity', 'special'],
      badges: [...BASIC_BADGES],
    };
  }

  /**
   * Get naming configuration
   */
  getNamingConfig(): NamingConfig {
    return {
      serverNameTemplate: '{community} Community',
      categoryNames: {
        info: 'INFO',
        council: 'LEADERSHIP',
        general: 'GENERAL',
        operations: 'BOT-OPS',
      },
      terminology: {
        member: 'Member',
        holder: 'Holder',
        admin: 'Admin',
        community: 'Community',
      },
    };
  }

  /**
   * Get channel template for server setup
   */
  getChannelTemplate(): ChannelTemplate {
    return {
      categories: [
        {
          id: 'info',
          name: 'INFO',
          channels: [
            { name: 'welcome', type: 'text', readonly: true, topic: 'Welcome to the community!' },
            { name: 'announcements', type: 'announcement', readonly: true },
            { name: 'rules', type: 'text', readonly: true },
          ],
        },
        {
          id: 'general',
          name: 'GENERAL',
          channels: [
            { name: 'general-chat', type: 'text' },
            { name: 'introductions', type: 'text' },
          ],
        },
        {
          id: 'leadership',
          name: 'LEADERSHIP',
          tierRestriction: 'gold',
          channels: [
            { name: 'gold-lounge', type: 'text', topic: 'Exclusive Gold tier chat' },
          ],
        },
        {
          id: 'operations',
          name: 'BOT-OPS',
          channels: [
            { name: 'bot-commands', type: 'text', topic: 'Bot commands go here' },
            { name: 'leaderboard', type: 'text', readonly: true },
          ],
        },
      ],
    };
  }

  /**
   * Evaluate tier for a given rank
   *
   * @param rank - Member's current rank (1 = top)
   * @param _totalHolders - Not used for absolute ranking
   * @returns Tier result
   */
  evaluateTier(rank: number, _totalHolders?: number): TierResult {
    // Handle invalid ranks
    if (rank < 1) {
      return {
        tierId: 'gold',
        tierName: 'Gold',
        roleColor: '#FFD700',
        rankInTier: 1,
      };
    }

    // Find matching tier
    const tier = BASIC_TIERS.find(
      (t) =>
        rank >= (t.minRank ?? 0) &&
        (t.maxRank === null || t.maxRank === undefined || rank <= t.maxRank)
    );

    // Default to bronze for ranks > 100
    if (!tier) {
      return {
        tierId: 'bronze',
        tierName: 'Bronze',
        roleColor: '#CD7F32',
        rankInTier: rank - 50, // Position within "extended" bronze
      };
    }

    // Calculate rank within tier
    const rankInTier = rank - (tier.minRank ?? 0) + 1;

    return {
      tierId: tier.id,
      tierName: tier.displayName,
      roleColor: tier.roleColor,
      rankInTier,
    };
  }

  /**
   * Evaluate badges for a member
   *
   * @param member - Member context with scores and tenure
   * @returns Array of earned badges
   */
  evaluateBadges(member: MemberContext): EarnedBadge[] {
    const earned: EarnedBadge[] = [];
    const now = new Date();

    for (const badge of BASIC_BADGES) {
      const isEarned = this.evaluateBadgeCriteria(badge, member);
      if (isEarned) {
        earned.push({
          badgeId: badge.id,
          badgeName: badge.displayName,
          emoji: badge.emoji,
          earnedAt: now,
        });
      }
    }

    return earned;
  }

  /**
   * Evaluate a single badge criteria
   */
  private evaluateBadgeCriteria(badge: BadgeDefinition, member: MemberContext): boolean {
    const { criteria } = badge;

    switch (criteria.type) {
      case 'tenure':
        return member.tenureDays >= (criteria.threshold ?? 0);

      case 'tier_reached':
        // Check if current tier or highest tier matches
        return (
          member.currentTier === criteria.tierRequired ||
          member.highestTier === criteria.tierRequired
        );

      case 'activity':
        return member.activityScore >= (criteria.threshold ?? 0);

      case 'conviction':
        return member.convictionScore >= (criteria.threshold ?? 0);

      case 'tier_maintained':
        // For BasicTheme, simplified: just check current tier
        return member.currentTier === criteria.tierRequired;

      case 'custom':
        // Custom evaluators handled by BadgeEvaluator service
        // BasicTheme returns false for custom badges (must be explicitly awarded)
        return false;

      default:
        return false;
    }
  }
}

/**
 * Factory function to create BasicTheme instance
 */
export function createBasicTheme(): IThemeProvider {
  return new BasicTheme();
}

/**
 * Singleton instance for convenience
 */
export const basicTheme = new BasicTheme();
