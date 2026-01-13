/**
 * Tier Service
 *
 * Manages the 9-tier membership system for Sietch v3.0.
 *
 * Key Features:
 * - Automatic tier calculation based on BGT holdings and rank
 * - Rank precedence: Top 7 = Naib, Top 8-69 = Fedaykin (overrides BGT)
 * - BGT-based tiers: Hajra (6.9+) through Usul (1111+)
 * - Tier history tracking for analytics
 * - Tier progression calculations
 *
 * Privacy: Tier is public, but BGT amount is never exposed externally
 */

import { formatUnits, parseUnits } from 'viem';
import { logger } from '../utils/logger.js';
import { logAuditEvent } from '../db/index.js';
import type { Tier, TierProgress, TierDistribution } from '../types/index.js';

/**
 * BGT Thresholds for each tier (in wei as BigInt)
 * Rank-based tiers (Naib, Fedaykin) have null threshold
 */
export const TIER_THRESHOLDS: Record<Tier, bigint | null> = {
  hajra: parseUnits('6.9', 18),       // 6.9 BGT minimum
  ichwan: parseUnits('69', 18),       // 69 BGT
  qanat: parseUnits('222', 18),       // 222 BGT
  sihaya: parseUnits('420', 18),      // 420 BGT
  mushtamal: parseUnits('690', 18),   // 690 BGT
  sayyadina: parseUnits('888', 18),   // 888 BGT
  usul: parseUnits('1111', 18),       // 1111 BGT
  fedaykin: null,                     // Rank-based: Top 8-69
  naib: null,                         // Rank-based: Top 7
};

/**
 * Tier order for progression logic
 * Ordered from lowest to highest (BGT-based only)
 */
export const TIER_ORDER: Tier[] = [
  'hajra',
  'ichwan',
  'qanat',
  'sihaya',
  'mushtamal',
  'sayyadina',
  'usul',
  'fedaykin',
  'naib',
];

/**
 * Tier display names and descriptions
 */
export const TIER_INFO: Record<Tier, { name: string; description: string; bgtThreshold: number | null }> = {
  hajra: {
    name: 'Hajra',
    description: 'Journey of seeking - on the path to belonging',
    bgtThreshold: 6.9,
  },
  ichwan: {
    name: 'Ichwan',
    description: 'Brotherhood - first acceptance into community',
    bgtThreshold: 69,
  },
  qanat: {
    name: 'Qanat',
    description: 'Underground water channels - access to hidden depths',
    bgtThreshold: 222,
  },
  sihaya: {
    name: 'Sihaya',
    description: 'Desert spring - precious, life-giving',
    bgtThreshold: 420,
  },
  mushtamal: {
    name: 'Mushtamal',
    description: 'Inner garden of the sietch - trusted inner space',
    bgtThreshold: 690,
  },
  sayyadina: {
    name: 'Sayyadina',
    description: 'Fremen priestess rank - spiritual guide, near-leader',
    bgtThreshold: 888,
  },
  usul: {
    name: 'Usul',
    description: 'Base of the pillar - innermost identity',
    bgtThreshold: 1111,
  },
  fedaykin: {
    name: 'Fedaykin',
    description: 'Elite warriors, death commandos - Top 8-69',
    bgtThreshold: null,
  },
  naib: {
    name: 'Naib',
    description: 'Tribal leaders of the sietch - Top 7',
    bgtThreshold: null,
  },
};

/**
 * Tier Service class
 */
class TierService {
  /**
   * Calculate the appropriate tier for a member based on BGT holdings and rank
   *
   * Logic:
   * 1. If rank 1-7: Naib (rank precedence)
   * 2. If rank 8-69: Fedaykin (rank precedence)
   * 3. Otherwise: Calculate based on BGT threshold
   *    - >= 1111: Usul
   *    - >= 888: Sayyadina
   *    - >= 690: Mushtamal
   *    - >= 420: Sihaya
   *    - >= 222: Qanat
   *    - >= 69: Ichwan
   *    - >= 6.9: Hajra
   *    - < 6.9: Hajra (default)
   *
   * @param bgt - BGT holdings in wei (as string or bigint)
   * @param rank - Eligibility rank (1-69 for eligible, null/undefined for others)
   * @returns The appropriate tier
   */
  calculateTier(bgt: string | bigint, rank: number | null | undefined): Tier {
    // Convert bgt to BigInt if string
    const bgtBigInt = typeof bgt === 'string' ? BigInt(bgt) : bgt;

    // Rank-based tier precedence
    if (rank !== null && rank !== undefined) {
      if (rank >= 1 && rank <= 7) {
        return 'naib';
      }
      if (rank >= 8 && rank <= 69) {
        return 'fedaykin';
      }
    }

    // BGT-based tier calculation (from highest to lowest)
    if (bgtBigInt >= TIER_THRESHOLDS.usul!) return 'usul';
    if (bgtBigInt >= TIER_THRESHOLDS.sayyadina!) return 'sayyadina';
    if (bgtBigInt >= TIER_THRESHOLDS.mushtamal!) return 'mushtamal';
    if (bgtBigInt >= TIER_THRESHOLDS.sihaya!) return 'sihaya';
    if (bgtBigInt >= TIER_THRESHOLDS.qanat!) return 'qanat';
    if (bgtBigInt >= TIER_THRESHOLDS.ichwan!) return 'ichwan';
    if (bgtBigInt >= TIER_THRESHOLDS.hajra!) return 'hajra';

    // Default to Hajra (should only happen if BGT < 6.9, which shouldn't be in system)
    return 'hajra';
  }

  /**
   * Check if a tier change is a promotion (moving to higher tier)
   *
   * @param oldTier - Previous tier
   * @param newTier - New tier
   * @returns True if this is a promotion
   */
  isPromotion(oldTier: Tier, newTier: Tier): boolean {
    const oldIndex = TIER_ORDER.indexOf(oldTier);
    const newIndex = TIER_ORDER.indexOf(newTier);
    return newIndex > oldIndex;
  }

  /**
   * Get the next tier in progression for a given tier
   *
   * @param currentTier - Current tier
   * @returns Next tier, or null if at Naib (max tier)
   */
  getNextTier(currentTier: Tier): Tier | null {
    const currentIndex = TIER_ORDER.indexOf(currentTier);
    if (currentIndex === -1 || currentIndex === TIER_ORDER.length - 1) {
      return null; // Already at Naib (max tier) or tier not found
    }
    return TIER_ORDER[currentIndex + 1] ?? null;
  }

  /**
   * Calculate tier progress for a member
   * Shows current tier, next tier, and BGT needed to reach it
   *
   * @param currentTier - Member's current tier
   * @param currentBgt - Member's current BGT (wei as string)
   * @param currentRank - Member's current eligibility rank (null if not in top 69)
   * @returns Tier progress information
   */
  getTierProgress(
    currentTier: Tier,
    currentBgt: string,
    currentRank: number | null
  ): TierProgress {
    const bgtBigInt = BigInt(currentBgt);
    const currentBgtFormatted = parseFloat(formatUnits(bgtBigInt, 18));
    const nextTier = this.getNextTier(currentTier);

    // Rank-based tiers (no BGT progression)
    if (currentTier === 'naib') {
      return {
        currentTier,
        nextTier: null,
        bgtToNextTier: null,
        bgtToNextTierFormatted: null,
        currentBgt,
        currentBgtFormatted,
        currentRank,
        isRankBased: true,
      };
    }

    if (currentTier === 'fedaykin') {
      // Fedaykin can only progress to Naib (rank-based)
      return {
        currentTier,
        nextTier: 'naib',
        bgtToNextTier: null,
        bgtToNextTierFormatted: null,
        currentBgt,
        currentBgtFormatted,
        currentRank,
        isRankBased: true,
      };
    }

    // BGT-based tier progression
    if (!nextTier) {
      return {
        currentTier,
        nextTier: null,
        bgtToNextTier: null,
        bgtToNextTierFormatted: null,
        currentBgt,
        currentBgtFormatted,
        currentRank,
        isRankBased: false,
      };
    }

    const nextTierThreshold = TIER_THRESHOLDS[nextTier];
    if (!nextTierThreshold) {
      // Next tier is rank-based (Fedaykin)
      return {
        currentTier,
        nextTier,
        bgtToNextTier: null,
        bgtToNextTierFormatted: null,
        currentBgt,
        currentBgtFormatted,
        currentRank,
        isRankBased: false,
      };
    }

    // Calculate BGT needed
    const bgtToNextTier = nextTierThreshold - bgtBigInt;
    const bgtToNextTierFormatted =
      bgtToNextTier > 0n ? parseFloat(formatUnits(bgtToNextTier, 18)) : 0;

    return {
      currentTier,
      nextTier,
      bgtToNextTier: bgtToNextTier.toString(),
      bgtToNextTierFormatted,
      currentBgt,
      currentBgtFormatted,
      currentRank,
      isRankBased: false,
    };
  }

  /**
   * Get tier info for all tiers
   *
   * @returns Array of tier information
   */
  getAllTierInfo(): Array<{
    name: Tier;
    displayName: string;
    description: string;
    bgtThreshold: number | null;
    rankRequirement: string | null;
  }> {
    return TIER_ORDER.map((tier) => {
      const info = TIER_INFO[tier];
      let rankRequirement: string | null = null;

      if (tier === 'naib') {
        rankRequirement = 'Top 7';
      } else if (tier === 'fedaykin') {
        rankRequirement = 'Top 8-69';
      }

      return {
        name: tier,
        displayName: info.name,
        description: info.description,
        bgtThreshold: info.bgtThreshold,
        rankRequirement,
      };
    });
  }

  /**
   * Format BGT amount for display (human-readable)
   *
   * @param bgtWei - BGT amount in wei
   * @returns Formatted BGT amount
   */
  formatBgt(bgtWei: string | bigint): number {
    const bgtBigInt = typeof bgtWei === 'string' ? BigInt(bgtWei) : bgtWei;
    return parseFloat(formatUnits(bgtBigInt, 18));
  }

  /**
   * Get tier threshold for a given tier
   *
   * @param tier - Tier name
   * @returns BGT threshold in human-readable format, or null if rank-based
   */
  getTierThreshold(tier: Tier): number | null {
    const threshold = TIER_THRESHOLDS[tier];
    return threshold ? parseFloat(formatUnits(threshold, 18)) : null;
  }

  // =============================================================================
  // Persistence Methods (Sprint 15: Tier Foundation - S15-T4)
  // =============================================================================

  /**
   * Update member's tier and log to tier_history
   * This is the primary method for changing a member's tier
   *
   * @param memberId - Member ID
   * @param newTier - New tier to assign
   * @param currentBgt - Current BGT holdings (wei as string)
   * @param currentRank - Current eligibility rank (null if not in top 69)
   * @param oldTier - Optional: explicitly provide old tier (otherwise fetched from DB)
   * @returns True if tier was changed, false if already at that tier
   */
  async updateMemberTier(
    memberId: string,
    newTier: Tier,
    currentBgt: string,
    currentRank: number | null,
    oldTier?: Tier | null
  ): Promise<boolean> {
    const {
      getMemberProfileById,
      updateMemberTier: updateTierInDb,
      insertTierHistory,
      logAuditEvent,
    } = await import('../db/index.js');

    // Fetch current tier if not provided
    if (oldTier === undefined) {
      const profile = getMemberProfileById(memberId);
      if (!profile) {
        logger.error({ memberId }, 'Cannot update tier: member not found');
        return false;
      }
      oldTier = profile.tier as Tier;
    }

    // No change needed
    if (oldTier === newTier) {
      return false;
    }

    // Update member_profiles
    updateTierInDb(memberId, newTier);

    // Log to tier_history
    insertTierHistory(memberId, oldTier, newTier, currentBgt, currentRank);

    // Log audit event
    const isPromotion = oldTier ? this.isPromotion(oldTier, newTier) : true;
    await logAuditEvent('tier_change' as any, {
      memberId,
      oldTier,
      newTier,
      bgt: this.formatBgt(currentBgt),
      rank: currentRank,
      isPromotion,
    });

    logger.info(
      { memberId, oldTier, newTier, isPromotion },
      'Member tier updated'
    );

    return true;
  }

  /**
   * Get tier history for a member
   *
   * @param memberId - Member ID
   * @returns Array of tier history entries
   */
  async getMemberTierHistory(memberId: string) {
    const { getTierHistory } = await import('../db/index.js');
    return getTierHistory(memberId);
  }

  /**
   * Get tier distribution across all members
   *
   * @returns Object with member counts per tier
   */
  async getTierDistribution(): Promise<TierDistribution> {
    const { getTierDistribution } = await import('../db/index.js');
    return getTierDistribution();
  }

  /**
   * Get recent tier changes across all members
   *
   * @param limit - Maximum number of changes to return
   * @returns Array of tier history entries
   */
  async getRecentTierChanges(limit: number = 50) {
    const { getRecentTierChanges } = await import('../db/index.js');
    return getRecentTierChanges(limit);
  }

  /**
   * Get tier changes within a date range
   * Useful for weekly digest and analytics
   *
   * @param startDate - Start date
   * @param endDate - End date
   * @returns Array of tier history entries
   */
  async getTierChangesInDateRange(startDate: Date, endDate: Date) {
    const { getTierChangesInDateRange } = await import('../db/index.js');
    return getTierChangesInDateRange(startDate, endDate);
  }

  /**
   * Count tier promotions within a date range
   *
   * @param startDate - Start date
   * @param endDate - End date
   * @returns Count of promotions
   */
  async countTierPromotions(startDate: Date, endDate: Date): Promise<number> {
    const { countTierPromotions } = await import('../db/index.js');
    return countTierPromotions(startDate, endDate);
  }

  /**
   * Get members by tier
   *
   * @param tier - Tier to filter by
   * @returns Array of member profiles
   */
  async getMembersByTier(tier: Tier) {
    const { getMembersByTier } = await import('../db/index.js');
    return getMembersByTier(tier);
  }
}

// Export singleton instance
export const tierService = new TierService();
