/**
 * Stats Service
 *
 * Provides comprehensive statistics aggregation for Sietch v3.0:
 * - Personal stats for /stats command (tier progress, activity, badges)
 * - Community stats for public consumption
 * - Admin analytics for dashboard
 * - Tier progression leaderboard (closest to promotion)
 *
 * Privacy-first design:
 * - Personal stats available only to the member
 * - Community stats are aggregated (no individual data)
 * - Tier leaderboard excludes exact BGT values (rounded for privacy)
 */

import { logger } from '../utils/logger.js';
import {
  getDatabase,
  getMemberProfileById,
  getMemberProfileByDiscordId,
  getMemberBadges,
  getMemberActivity,
  calculateTenureCategory,
  getMemberBadgeCount,
} from '../db/queries.js';
import { getOwnStats } from './activity.js';
import { tierService } from './index.js';
import { formatUnits } from 'viem';
import type {
  PersonalStats,
  CommunityStatsResponse,
  AdminAnalytics,
  Tier,
  TierDistribution,
  PublicBadge,
} from '../types/index.js';

/**
 * Tier progression leaderboard entry
 * Shows members closest to their next tier promotion
 */
export interface TierProgressionEntry {
  /** Member nym */
  nym: string;
  /** Member ID (for privacy: no discord ID exposed) */
  memberId: string;
  /** Current tier */
  currentTier: Tier;
  /** Next tier in progression */
  nextTier: Tier;
  /** Rounded BGT (for privacy: not exact value) */
  bgtRounded: number;
  /** Next tier threshold (rounded) */
  nextTierThreshold: number;
  /** Distance to next tier (rounded for privacy) */
  distanceToNextTier: number;
  /** Rank in the progression leaderboard (1 = closest to promotion) */
  rank: number;
}

/**
 * Stats Service class
 */
class StatsService {
  /**
   * Get personal stats for a member by Discord ID
   * Includes tier progress, activity, badges, and streaks
   *
   * @param discordUserId - Discord user ID
   * @returns Personal stats object or null if member not found
   */
  getPersonalStats(discordUserId: string): PersonalStats | null {
    try {
      // Get member profile
      const profile = getMemberProfileByDiscordId(discordUserId);
      if (!profile || !profile.onboardingComplete) {
        logger.debug({ discordUserId }, 'Member not found or onboarding incomplete');
        return null;
      }

      // Get activity stats (with decay applied)
      const activity = getOwnStats(discordUserId);
      if (!activity) {
        logger.warn({ discordUserId, memberId: profile.memberId }, 'Activity stats not found');
        return null;
      }

      // Get badges
      const badges = getMemberBadges(profile.memberId);
      const badgeCount = badges.length;

      // Calculate tenure
      const memberSince = profile.createdAt;
      const tenureCategory = calculateTenureCategory(memberSince);

      // Get BGT and rank from eligibility snapshot
      const db = getDatabase();
      const eligibilityRow = db
        .prepare(
          `
          SELECT bgt_held, rank
          FROM eligibility_snapshot
          WHERE wallet_address = (
            SELECT wallet_address
            FROM wallet_mappings
            WHERE discord_user_id = ?
          )
          ORDER BY updated_at DESC
          LIMIT 1
        `
        )
        .get(discordUserId) as { bgt_held: string; rank: number | null } | undefined;

      const currentBgt = eligibilityRow?.bgt_held ?? '0';
      const currentRank = eligibilityRow?.rank ?? null;

      // Get tier progress
      const tierProgress = tierService.getTierProgress(
        profile.tier,
        currentBgt,
        currentRank
      );

      // Calculate messages this week
      // Note: For v3.0, we approximate using activity balance as a proxy
      // A more accurate implementation would track messages with timestamps
      const messagesThisWeek = Math.floor(activity.activityBalance / 10);

      // Calculate streaks
      // Note: For v3.0 Sprint 19, we provide placeholder values
      // Full streak tracking would require daily activity tracking table
      const currentStreak = this.calculateCurrentStreak(profile.memberId);
      const longestStreak = this.calculateLongestStreak(profile.memberId);

      // Convert badges to PublicBadge format
      const publicBadges: PublicBadge[] = badges.map((badge) => ({
        badgeId: badge.badgeId,
        name: badge.name,
        description: badge.description,
        category: badge.category,
        emoji: badge.emoji,
        awardedAt: badge.awardedAt,
      }));

      return {
        nym: profile.nym,
        memberId: profile.memberId,
        tier: profile.tier,
        tierProgress,
        memberSince,
        tenureCategory,
        messagesThisWeek,
        currentStreak,
        longestStreak,
        badgeCount,
        badges: publicBadges,
      };
    } catch (error) {
      logger.error({ error, discordUserId }, 'Error fetching personal stats');
      return null;
    }
  }

  /**
   * Calculate current activity streak (consecutive days active)
   * Placeholder implementation for Sprint 19
   *
   * TODO: Implement full streak tracking with daily activity table
   *
   * @param memberId - Member ID
   * @returns Current streak in days
   */
  private calculateCurrentStreak(memberId: string): number {
    const db = getDatabase();

    // Check if member was active in last 24 hours
    const recentActivity = db
      .prepare(
        `
        SELECT last_active_at
        FROM member_activity
        WHERE member_id = ?
      `
      )
      .get(memberId) as { last_active_at: string | null } | undefined;

    if (!recentActivity?.last_active_at) {
      return 0;
    }

    const lastActive = new Date(recentActivity.last_active_at);
    const now = new Date();
    const hoursSinceActive = (now.getTime() - lastActive.getTime()) / (1000 * 60 * 60);

    // If active in last 24 hours, consider it a 1-day streak
    // Full implementation would track consecutive days
    return hoursSinceActive < 24 ? 1 : 0;
  }

  /**
   * Calculate longest activity streak
   * Placeholder implementation for Sprint 19
   *
   * TODO: Implement full streak tracking with daily activity table
   *
   * @param memberId - Member ID
   * @returns Longest streak in days
   */
  private calculateLongestStreak(memberId: string): number {
    // For Sprint 19, we approximate using total messages
    // Full implementation would track historical daily activity
    const db = getDatabase();

    const activity = db
      .prepare(
        `
        SELECT total_messages
        FROM member_activity
        WHERE member_id = ?
      `
      )
      .get(memberId) as { total_messages: number } | undefined;

    if (!activity) {
      return 0;
    }

    // Rough approximation: assume 1 message per day on average
    // Cap at a reasonable maximum
    return Math.min(Math.floor(activity.total_messages / 10), 30);
  }

  /**
   * Get community stats (public, aggregated data)
   * No individual member information exposed
   *
   * @returns Community statistics
   */
  getCommunityStats(): CommunityStatsResponse {
    const db = getDatabase();

    // Total members
    const totalRow = db
      .prepare(
        `
        SELECT COUNT(*) as count
        FROM member_profiles
        WHERE onboarding_complete = 1
      `
      )
      .get() as { count: number };

    const totalMembers = totalRow.count;

    // Members by tier
    const tierRows = db
      .prepare(
        `
        SELECT tier, COUNT(*) as count
        FROM member_profiles
        WHERE onboarding_complete = 1
        GROUP BY tier
      `
      )
      .all() as Array<{ tier: Tier; count: number }>;

    const membersByTier: Record<Tier, number> = {
      hajra: 0,
      ichwan: 0,
      qanat: 0,
      sihaya: 0,
      mushtamal: 0,
      sayyadina: 0,
      usul: 0,
      fedaykin: 0,
      naib: 0,
    };

    for (const row of tierRows) {
      membersByTier[row.tier] = row.count;
    }

    // Total BGT represented (from eligibility snapshot)
    const bgtRow = db
      .prepare(
        `
        SELECT SUM(CAST(bgt_held AS INTEGER)) as total_bgt
        FROM eligibility_snapshot
        WHERE wallet_address IN (
          SELECT wallet_address
          FROM wallet_mappings
          WHERE discord_user_id IN (
            SELECT discord_user_id
            FROM member_profiles
            WHERE onboarding_complete = 1
          )
        )
      `
      )
      .get() as { total_bgt: string | null };

    const totalBgtWei = bgtRow.total_bgt ?? '0';
    const totalBgt = parseFloat(formatUnits(BigInt(totalBgtWei), 18));

    // Weekly active members (active in last 7 days)
    const weeklyActiveRow = db
      .prepare(
        `
        SELECT COUNT(*) as count
        FROM member_activity
        WHERE last_active_at IS NOT NULL
        AND datetime(last_active_at) > datetime('now', '-7 days')
      `
      )
      .get() as { count: number };

    const weeklyActive = weeklyActiveRow.count;

    return {
      total_members: totalMembers,
      members_by_tier: membersByTier,
      total_bgt: totalBgt,
      weekly_active: weeklyActive,
      generated_at: new Date().toISOString(),
    };
  }

  /**
   * Get admin analytics (full dashboard data)
   * Requires admin privileges
   *
   * @returns Comprehensive analytics data
   */
  getAdminAnalytics(): AdminAnalytics {
    const communityStats = this.getCommunityStats();
    const db = getDatabase();

    // New members this week
    const newThisWeekRow = db
      .prepare(
        `
        SELECT COUNT(*) as count
        FROM member_profiles
        WHERE onboarding_complete = 1
        AND datetime(created_at) > datetime('now', '-7 days')
      `
      )
      .get() as { count: number };

    // Promotions this week (tier changes)
    const promotionsRow = db
      .prepare(
        `
        SELECT COUNT(*) as count
        FROM tier_history
        WHERE datetime(changed_at) > datetime('now', '-7 days')
        AND old_tier IS NOT NULL
      `
      )
      .get() as { count: number };

    // Badges awarded this week
    const badgesRow = db
      .prepare(
        `
        SELECT COUNT(*) as count
        FROM member_badges
        WHERE datetime(awarded_at) > datetime('now', '-7 days')
      `
      )
      .get() as { count: number };

    // Average messages per member this week (approximation)
    const avgMessagesRow = db
      .prepare(
        `
        SELECT AVG(activity_balance) as avg_balance
        FROM member_activity
        WHERE last_active_at IS NOT NULL
        AND datetime(last_active_at) > datetime('now', '-7 days')
      `
      )
      .get() as { avg_balance: number | null };

    const avgMessagesPerMember = avgMessagesRow.avg_balance
      ? Math.floor(avgMessagesRow.avg_balance / 10)
      : 0;

    // Most active tier (by total activity balance)
    const activeTierRow = db
      .prepare(
        `
        SELECT mp.tier, SUM(ma.activity_balance) as total_activity
        FROM member_profiles mp
        JOIN member_activity ma ON mp.member_id = ma.member_id
        WHERE mp.onboarding_complete = 1
        AND ma.last_active_at IS NOT NULL
        AND datetime(ma.last_active_at) > datetime('now', '-7 days')
        GROUP BY mp.tier
        ORDER BY total_activity DESC
        LIMIT 1
      `
      )
      .get() as { tier: Tier; total_activity: number } | undefined;

    // Get total BGT in wei for API
    const bgtRow = db
      .prepare(
        `
        SELECT SUM(CAST(bgt_held AS INTEGER)) as total_bgt
        FROM eligibility_snapshot
        WHERE wallet_address IN (
          SELECT wallet_address
          FROM wallet_mappings
          WHERE discord_user_id IN (
            SELECT discord_user_id
            FROM member_profiles
            WHERE onboarding_complete = 1
          )
        )
      `
      )
      .get() as { total_bgt: string | null };

    const totalBgtWei = bgtRow.total_bgt ?? '0';

    return {
      totalMembers: communityStats.total_members,
      membersByTier: communityStats.members_by_tier,
      totalBgt: communityStats.total_bgt,
      totalBgtWei,
      weeklyActive: communityStats.weekly_active,
      newThisWeek: newThisWeekRow.count,
      promotionsThisWeek: promotionsRow.count,
      badgesAwardedThisWeek: badgesRow.count,
      avgMessagesPerMember,
      mostActiveTier: activeTierRow?.tier ?? null,
      generatedAt: new Date(),
    };
  }

  /**
   * Get tier progression leaderboard
   * Shows members closest to their next tier promotion
   *
   * Excludes:
   * - Fedaykin (rank-based, can't progress via BGT)
   * - Naib (already at max tier)
   * - Members at Usul without being in top 69 (would need rank for Fedaykin)
   *
   * Privacy:
   * - BGT values are rounded (no exact amounts)
   * - Sorted by distance to next tier (ascending)
   *
   * @param limit - Maximum number of entries to return (default: 10)
   * @returns Tier progression leaderboard
   */
  getTierLeaderboard(limit: number = 10): TierProgressionEntry[] {
    const db = getDatabase();

    try {
      // Get members with their BGT and tier, excluding rank-based tiers
      const rows = db
        .prepare(
          `
          SELECT
            mp.member_id,
            mp.nym,
            mp.tier,
            es.bgt_held,
            es.rank
          FROM member_profiles mp
          JOIN wallet_mappings wm ON mp.discord_user_id = wm.discord_user_id
          JOIN eligibility_snapshot es ON wm.wallet_address = es.wallet_address
          WHERE mp.onboarding_complete = 1
          AND mp.tier NOT IN ('fedaykin', 'naib')
          ORDER BY es.updated_at DESC
        `
        )
        .all() as Array<{
          member_id: string;
          nym: string;
          tier: Tier;
          bgt_held: string;
          rank: number | null;
        }>;

      // Calculate progression for each member
      const progressionData: TierProgressionEntry[] = [];

      for (const row of rows) {
        const currentTier = row.tier;
        const nextTier = tierService.getNextTier(currentTier);

        // Skip if no next tier or next tier is rank-based
        if (!nextTier || nextTier === 'fedaykin' || nextTier === 'naib') {
          continue;
        }

        const tierProgress = tierService.getTierProgress(
          currentTier,
          row.bgt_held,
          row.rank
        );

        // Skip if can't calculate distance (shouldn't happen due to filter above)
        if (!tierProgress.bgtToNextTierFormatted || tierProgress.bgtToNextTierFormatted <= 0) {
          continue;
        }

        // Get next tier threshold
        const nextTierInfo = tierService.getAllTierInfo().find((t) => t.name === nextTier);
        if (!nextTierInfo || !nextTierInfo.bgtThreshold) {
          continue;
        }

        // Round values for privacy
        const bgtRounded = Math.round(tierProgress.currentBgtFormatted);
        const nextTierThreshold = nextTierInfo.bgtThreshold;
        const distanceToNextTier = Math.round(tierProgress.bgtToNextTierFormatted);

        progressionData.push({
          nym: row.nym,
          memberId: row.member_id,
          currentTier,
          nextTier,
          bgtRounded,
          nextTierThreshold,
          distanceToNextTier,
          rank: 0, // Will be set below
        });
      }

      // Sort by distance to next tier (ascending = closest to promotion)
      progressionData.sort((a, b) => a.distanceToNextTier - b.distanceToNextTier);

      // Assign ranks and limit results
      const limitedData = progressionData.slice(0, limit);
      limitedData.forEach((entry, index) => {
        entry.rank = index + 1;
      });

      logger.debug(
        { count: limitedData.length, limit },
        'Generated tier progression leaderboard'
      );

      return limitedData;
    } catch (error) {
      logger.error({ error }, 'Error generating tier leaderboard');
      return [];
    }
  }

  /**
   * Get a member's rank on the tier progression leaderboard
   * Returns null if member is not on the leaderboard (Fedaykin, Naib, or not progressing)
   *
   * @param memberId - Member ID
   * @returns Rank (1-indexed) or null
   */
  getMemberTierProgressionRank(memberId: string): number | null {
    // Get full leaderboard (we need to calculate all members to know rank)
    const fullLeaderboard = this.getTierLeaderboard(1000); // Get up to 1000 members

    const entry = fullLeaderboard.find((e) => e.memberId === memberId);
    return entry ? entry.rank : null;
  }
}

/**
 * Singleton stats service instance
 */
export const statsService = new StatsService();
