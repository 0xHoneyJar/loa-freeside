/**
 * SietchTheme - Premium Tier Theme Implementation
 *
 * Sprint 37: SietchTheme Implementation
 *
 * Provides the full 9-tier Dune-inspired structure for premium communities:
 * - Naib (rank 1-7): Tribal leaders - Top 7
 * - Fedaykin (rank 8-69): Elite warriors - Top 8-69
 * - Usul (1111+ BGT): Base of the pillar
 * - Sayyadina (888+ BGT): Priestess rank
 * - Mushtamal (690+ BGT): Inner garden
 * - Sihaya (420+ BGT): Desert spring
 * - Qanat (222+ BGT): Underground channels
 * - Ichwan (69+ BGT): Brotherhood
 * - Hajra (6.9+ BGT): Journey of seeking
 *
 * Note: For rank-based evaluation, Naib and Fedaykin use absolute rank.
 * BGT-based tiers (Usul through Hajra) use threshold evaluation
 * which is handled by external services. This theme provides
 * the configuration for both ranking strategies.
 *
 * @module packages/adapters/themes/SietchTheme
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
// Constants
// =============================================================================

/**
 * BGT thresholds for each tier (for reference and conversion)
 * Note: Actual evaluation uses the threshold ranking strategy
 */
export const BGT_THRESHOLDS = {
  hajra: 6.9,
  ichwan: 69,
  qanat: 222,
  sihaya: 420,
  mushtamal: 690,
  sayyadina: 888,
  usul: 1111,
  // fedaykin and naib are rank-based, no BGT threshold
} as const;

/**
 * Rank boundaries for rank-based tiers
 */
export const RANK_BOUNDARIES = {
  naib: { min: 1, max: 7 },
  fedaykin: { min: 8, max: 69 },
} as const;

// =============================================================================
// Tier Definitions
// =============================================================================

/**
 * SietchTheme tier definitions
 * 9 tiers: Naib, Fedaykin (rank-based) + Usul through Hajra (BGT-based)
 *
 * For the theme's evaluateTier method, we use absolute rank mapping:
 * - Naib: ranks 1-7
 * - Fedaykin: ranks 8-69
 * - Usul: ranks 70-100 (highest BGT tier among non-ranked)
 * - Sayyadina: ranks 101-150
 * - Mushtamal: ranks 151-200
 * - Sihaya: ranks 201-300
 * - Qanat: ranks 301-500
 * - Ichwan: ranks 501-1000
 * - Hajra: ranks 1001+
 *
 * In practice, the actual tier assignment in the Sietch system is based on
 * BGT holdings checked against thresholds. This rank mapping provides a
 * reasonable default for systems using pure rank ordering.
 */
const SIETCH_TIERS: TierDefinition[] = [
  {
    id: 'naib',
    name: 'naib',
    displayName: 'Naib',
    minRank: 1,
    maxRank: 7,
    roleColor: '#FFD700', // Gold
    permissions: ['view_all', 'council_access', 'vote', 'govern', 'naib_ceremony'],
  },
  {
    id: 'fedaykin',
    name: 'fedaykin',
    displayName: 'Fedaykin',
    minRank: 8,
    maxRank: 69,
    roleColor: '#4169E1', // Royal Blue
    permissions: ['view_all', 'vote', 'elite_access', 'water_share'],
  },
  {
    id: 'usul',
    name: 'usul',
    displayName: 'Usul',
    minRank: 70,
    maxRank: 100,
    roleColor: '#9B59B6', // Purple
    permissions: ['view_premium', 'vote', 'inner_circle'],
  },
  {
    id: 'sayyadina',
    name: 'sayyadina',
    displayName: 'Sayyadina',
    minRank: 101,
    maxRank: 150,
    roleColor: '#6610F2', // Indigo
    permissions: ['view_premium', 'vote', 'ceremony_access'],
  },
  {
    id: 'mushtamal',
    name: 'mushtamal',
    displayName: 'Mushtamal',
    minRank: 151,
    maxRank: 200,
    roleColor: '#20C997', // Teal
    permissions: ['view_premium', 'vote', 'garden_access'],
  },
  {
    id: 'sihaya',
    name: 'sihaya',
    displayName: 'Sihaya',
    minRank: 201,
    maxRank: 300,
    roleColor: '#28A745', // Green
    permissions: ['view_standard', 'vote'],
  },
  {
    id: 'qanat',
    name: 'qanat',
    displayName: 'Qanat',
    minRank: 301,
    maxRank: 500,
    roleColor: '#17A2B8', // Cyan
    permissions: ['view_standard', 'limited_vote'],
  },
  {
    id: 'ichwan',
    name: 'ichwan',
    displayName: 'Ichwan',
    minRank: 501,
    maxRank: 1000,
    roleColor: '#FD7E14', // Orange
    permissions: ['view_basic'],
  },
  {
    id: 'hajra',
    name: 'hajra',
    displayName: 'Hajra',
    minRank: 1001,
    maxRank: null, // Unlimited
    roleColor: '#C2B280', // Sand
    permissions: ['view_general'],
  },
];

// =============================================================================
// Badge Definitions
// =============================================================================

/**
 * SietchTheme badge definitions
 * 12 badges covering tenure, achievement, activity, and special categories
 */
const SIETCH_BADGES: BadgeDefinition[] = [
  // -------------------------------------------------------------------------
  // Tenure Badges
  // -------------------------------------------------------------------------
  {
    id: 'og',
    displayName: 'OG',
    emoji: '🏛️',
    category: 'tenure',
    criteria: { type: 'tenure', threshold: 180 }, // 6 months
    description: 'Original member - 180+ days in the Sietch',
    revocable: false,
  },
  {
    id: 'veteran',
    displayName: 'Sietch Veteran',
    emoji: '⚔️',
    category: 'tenure',
    criteria: { type: 'tenure', threshold: 90 }, // 3 months
    description: 'Veteran member - 90+ days in the Sietch',
    revocable: false,
  },
  {
    id: 'elder',
    displayName: 'Elder',
    emoji: '📜',
    category: 'tenure',
    criteria: { type: 'tenure', threshold: 365 }, // 1 year
    description: 'Sietch elder - 1+ year member',
    revocable: false,
  },

  // -------------------------------------------------------------------------
  // Achievement Badges
  // -------------------------------------------------------------------------
  {
    id: 'naib_ascended',
    displayName: 'Naib Ascended',
    emoji: '👑',
    category: 'achievement',
    criteria: { type: 'tier_reached', tierRequired: 'naib' },
    description: 'Reached the rank of Naib (Top 7)',
    revocable: false,
  },
  {
    id: 'fedaykin_initiated',
    displayName: 'Fedaykin Initiated',
    emoji: '⚔️',
    category: 'achievement',
    criteria: { type: 'tier_reached', tierRequired: 'fedaykin' },
    description: 'Initiated as Fedaykin (Top 8-69)',
    revocable: false,
  },
  {
    id: 'usul_ascended',
    displayName: 'Usul Ascended',
    emoji: '🌟',
    category: 'achievement',
    criteria: { type: 'tier_reached', tierRequired: 'usul' },
    description: 'Ascended to Usul tier (1111+ BGT)',
    revocable: false,
  },
  {
    id: 'first_maker',
    displayName: 'First Maker',
    emoji: '🐛',
    category: 'achievement',
    criteria: { type: 'conviction', threshold: 10000 },
    description: 'Achieved 10,000+ conviction score',
    revocable: false,
  },

  // -------------------------------------------------------------------------
  // Activity Badges
  // -------------------------------------------------------------------------
  {
    id: 'desert_active',
    displayName: 'Desert Active',
    emoji: '🏜️',
    category: 'activity',
    criteria: { type: 'activity', threshold: 50 },
    description: 'Active in the desert - 50+ activity score',
    revocable: true,
  },
  {
    id: 'sietch_engaged',
    displayName: 'Sietch Engaged',
    emoji: '🔥',
    category: 'activity',
    criteria: { type: 'activity', threshold: 200 },
    description: 'Highly engaged - 200+ activity score',
    revocable: true,
  },

  // -------------------------------------------------------------------------
  // Special Badges
  // -------------------------------------------------------------------------
  {
    id: 'water_sharer',
    displayName: 'Water Sharer',
    emoji: '💧',
    category: 'special',
    criteria: { type: 'custom', customEvaluator: 'waterSharerCheck' },
    description: 'Shared water with another - can invite one member',
    revocable: true, // Can be revoked if shared-with member leaves
  },
  {
    id: 'former_naib',
    displayName: 'Former Naib',
    emoji: '🌅',
    category: 'special',
    criteria: { type: 'custom', customEvaluator: 'formerNaibCheck' },
    description: 'Once held a Naib seat',
    revocable: false,
  },
  {
    id: 'founding_naib',
    displayName: 'Founding Naib',
    emoji: '🌄',
    category: 'special',
    criteria: { type: 'custom', customEvaluator: 'foundingNaibCheck' },
    description: 'One of the original seven Naibs',
    revocable: false,
  },
];

// =============================================================================
// SietchTheme Implementation
// =============================================================================

/**
 * SietchTheme class
 *
 * Premium-tier theme with 9 tiers and 12 badges.
 * Uses Dune-inspired terminology and structure.
 */
export class SietchTheme implements IThemeProvider {
  readonly themeId = 'sietch';
  readonly themeName = 'Sietch (Dune)';
  readonly tier: SubscriptionTier = 'premium';

  /**
   * Get tier configuration
   */
  getTierConfig(): TierConfig {
    return {
      tiers: [...SIETCH_TIERS],
      rankingStrategy: 'absolute',
      demotionGracePeriod: 24, // 24 hours grace period for premium
    };
  }

  /**
   * Get badge configuration
   */
  getBadgeConfig(): BadgeConfig {
    return {
      categories: ['tenure', 'achievement', 'activity', 'special'],
      badges: [...SIETCH_BADGES],
    };
  }

  /**
   * Get naming configuration with Dune terminology
   */
  getNamingConfig(): NamingConfig {
    return {
      serverNameTemplate: '{community} Sietch',
      categoryNames: {
        info: 'SIETCH SCROLLS',
        council: 'NAIB COUNCIL',
        general: 'COMMON GROUNDS',
        operations: 'THE STILLSUIT',
      },
      terminology: {
        member: 'Fremen',
        holder: 'Sietch Dweller',
        admin: 'Naib',
        community: 'Sietch',
      },
    };
  }

  /**
   * Get channel template for Dune-themed server setup
   */
  getChannelTemplate(): ChannelTemplate {
    return {
      categories: [
        // Information category
        {
          id: 'sietch-scrolls',
          name: 'SIETCH SCROLLS',
          channels: [
            {
              name: 'the-door',
              type: 'text',
              readonly: true,
              topic: 'Entry to the Sietch - verify your identity',
            },
            {
              name: 'desert-laws',
              type: 'text',
              readonly: true,
              topic: 'Rules of the Sietch',
            },
            {
              name: 'census',
              type: 'text',
              readonly: true,
              topic: 'Member directory and leaderboard',
            },
            {
              name: 'announcements',
              type: 'announcement',
              readonly: true,
            },
          ],
        },
        // Naib Council - Top 7 only
        {
          id: 'naib-council',
          name: 'NAIB COUNCIL',
          tierRestriction: 'naib',
          channels: [
            {
              name: 'council-chamber',
              type: 'text',
              topic: 'Naib deliberation chamber',
              tierRestriction: 'naib',
            },
            {
              name: 'naib-voice',
              type: 'voice',
              tierRestriction: 'naib',
            },
          ],
        },
        // Fedaykin quarters - Top 69
        {
          id: 'fedaykin-quarters',
          name: 'FEDAYKIN QUARTERS',
          tierRestriction: 'fedaykin',
          channels: [
            {
              name: 'war-room',
              type: 'text',
              topic: 'Fedaykin strategy and discussion',
              tierRestriction: 'fedaykin',
            },
            {
              name: 'fedaykin-voice',
              type: 'voice',
              tierRestriction: 'fedaykin',
            },
          ],
        },
        // The Oasis - Water Sharer badge holders
        {
          id: 'the-oasis',
          name: 'THE OASIS',
          channels: [
            {
              name: 'oasis-lounge',
              type: 'text',
              topic: 'Exclusive space for Water Sharers',
            },
          ],
        },
        // General areas
        {
          id: 'common-grounds',
          name: 'COMMON GROUNDS',
          channels: [
            {
              name: 'sietch-lounge',
              type: 'text',
              topic: 'General Sietch discussion',
            },
            {
              name: 'introductions',
              type: 'text',
              topic: 'Introduce yourself to the Sietch',
            },
            {
              name: 'spice-market',
              type: 'text',
              topic: 'Trading and market discussion',
            },
            {
              name: 'desert-voice',
              type: 'voice',
            },
          ],
        },
        // Cave Entrance - Aspirants (positions 70-100)
        {
          id: 'cave-entrance',
          name: 'CAVE ENTRANCE',
          channels: [
            {
              name: 'taqwa-waiting',
              type: 'text',
              topic: 'For those seeking entry to the Sietch',
            },
          ],
        },
        // Operations
        {
          id: 'the-stillsuit',
          name: 'THE STILLSUIT',
          channels: [
            {
              name: 'bot-commands',
              type: 'text',
              topic: 'Stillsuit (bot) commands',
            },
            {
              name: 'leaderboard',
              type: 'text',
              readonly: true,
              topic: 'BGT leaderboard updates',
            },
          ],
        },
      ],
    };
  }

  /**
   * Evaluate tier for a given rank
   *
   * Uses the rank-based mapping from SIETCH_TIERS.
   * For BGT-threshold based evaluation, use TierService.calculateTier()
   *
   * @param rank - Member's current rank (1 = top)
   * @param _totalHolders - Not used for absolute ranking
   * @returns Tier result
   */
  evaluateTier(rank: number, _totalHolders?: number): TierResult {
    // Handle invalid ranks
    if (rank < 1) {
      return {
        tierId: 'naib',
        tierName: 'Naib',
        roleColor: '#FFD700',
        rankInTier: 1,
      };
    }

    // Find matching tier
    const tier = SIETCH_TIERS.find(
      (t) =>
        rank >= (t.minRank ?? 0) &&
        (t.maxRank === null || t.maxRank === undefined || rank <= t.maxRank)
    );

    // Default to hajra for very high ranks
    if (!tier) {
      return {
        tierId: 'hajra',
        tierName: 'Hajra',
        roleColor: '#C2B280',
        rankInTier: rank - 1000, // Position within hajra
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

    for (const badge of SIETCH_BADGES) {
      const result = this.evaluateBadgeCriteria(badge, member);
      if (result.earned) {
        earned.push({
          badgeId: badge.id,
          badgeName: badge.displayName,
          emoji: badge.emoji,
          earnedAt: now,
          context: result.context,
        });
      }
    }

    return earned;
  }

  /**
   * Evaluate a single badge criteria
   */
  private evaluateBadgeCriteria(
    badge: BadgeDefinition,
    member: MemberContext
  ): { earned: boolean; context?: Record<string, unknown> } {
    const { criteria } = badge;

    switch (criteria.type) {
      case 'tenure':
        return { earned: member.tenureDays >= (criteria.threshold ?? 0) };

      case 'tier_reached':
        // Check if current tier or highest tier matches
        // Handle tier hierarchy for "reached" semantics
        return {
          earned:
            this.tierMeetsOrExceeds(member.currentTier, criteria.tierRequired) ||
            this.tierMeetsOrExceeds(member.highestTier, criteria.tierRequired),
        };

      case 'activity':
        return { earned: member.activityScore >= (criteria.threshold ?? 0) };

      case 'conviction':
        return { earned: member.convictionScore >= (criteria.threshold ?? 0) };

      case 'tier_maintained':
        // For maintained, we check current tier only
        // Full duration tracking requires tier history (TierService)
        return { earned: member.currentTier === criteria.tierRequired };

      case 'custom':
        // Custom evaluators handled by BadgeEvaluator service
        // Check customContext for pre-evaluated results
        if (member.customContext && criteria.customEvaluator) {
          const result = member.customContext[criteria.customEvaluator];
          if (typeof result === 'boolean') {
            return { earned: result };
          }
          if (typeof result === 'object' && result !== null) {
            const resultObj = result as { earned?: boolean; context?: Record<string, unknown> };
            return {
              earned: resultObj.earned ?? false,
              context: resultObj.context,
            };
          }
        }
        return { earned: false };

      default:
        return { earned: false };
    }
  }

  /**
   * Check if a tier meets or exceeds a target tier
   * Used for "tier_reached" badge evaluation
   */
  private tierMeetsOrExceeds(
    actualTier: string | undefined,
    requiredTier: string | undefined
  ): boolean {
    if (!actualTier || !requiredTier) return false;

    const tierOrder = ['hajra', 'ichwan', 'qanat', 'sihaya', 'mushtamal', 'sayyadina', 'usul', 'fedaykin', 'naib'];
    const actualIndex = tierOrder.indexOf(actualTier);
    const requiredIndex = tierOrder.indexOf(requiredTier);

    if (actualIndex === -1 || requiredIndex === -1) return false;

    return actualIndex >= requiredIndex;
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Get tier definition by ID
   */
  getTierById(tierId: string): TierDefinition | undefined {
    return SIETCH_TIERS.find((t) => t.id === tierId);
  }

  /**
   * Get badge definition by ID
   */
  getBadgeById(badgeId: string): BadgeDefinition | undefined {
    return SIETCH_BADGES.find((b) => b.id === badgeId);
  }

  /**
   * Get all tier IDs in order (highest to lowest)
   */
  getTierOrder(): string[] {
    return SIETCH_TIERS.map((t) => t.id);
  }

  /**
   * Check if a tier is rank-based (Naib or Fedaykin)
   */
  isRankBasedTier(tierId: string): boolean {
    return tierId === 'naib' || tierId === 'fedaykin';
  }

  /**
   * Get BGT threshold for a tier (null for rank-based tiers)
   */
  getBgtThreshold(tierId: string): number | null {
    if (this.isRankBasedTier(tierId)) return null;
    return BGT_THRESHOLDS[tierId as keyof typeof BGT_THRESHOLDS] ?? null;
  }
}

/**
 * Factory function to create SietchTheme instance
 */
export function createSietchTheme(): IThemeProvider {
  return new SietchTheme();
}

/**
 * Singleton instance for convenience
 */
export const sietchTheme = new SietchTheme();
