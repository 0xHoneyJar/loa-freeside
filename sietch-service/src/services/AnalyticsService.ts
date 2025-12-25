/**
 * Analytics Service
 *
 * Provides community analytics and statistics for admin dashboard (Sietch v3.0 - Sprint 21).
 *
 * Features:
 * - Total members by tier distribution
 * - Total BGT represented across all members
 * - Weekly active users count
 * - New members this week
 * - Tier promotions this week
 * - Badge awards this week
 *
 * Usage:
 * - Called by /admin-stats Discord command
 * - Used by admin analytics API endpoint
 */

import { logger } from '../utils/logger.js';
import { getDatabase } from '../db/index.js';
import { formatUnits } from 'viem';
import type { Tier } from '../types/index.js';

/**
 * Community analytics data structure
 */
export interface CommunityAnalytics {
  /** Total onboarded members */
  totalMembers: number;
  /** Member distribution by tier */
  byTier: Record<Tier, number>;
  /** Total BGT represented (formatted, in BGT units) */
  totalBgt: number;
  /** Total BGT in wei (raw bigint as string for precision) */
  totalBgtWei: string;
  /** Weekly active users (members with activity in last 7 days) */
  weeklyActive: number;
  /** New members this week */
  newThisWeek: number;
  /** Tier promotions this week */
  promotionsThisWeek: number;
  /** Badges awarded this week */
  badgesAwardedThisWeek: number;
  /** When the analytics were generated */
  generatedAt: Date;
}

/**
 * Analytics Service class
 */
class AnalyticsService {
  /**
   * Get comprehensive community analytics
   *
   * @returns Community analytics object
   */
  getCommunityAnalytics(): CommunityAnalytics {
    const db = getDatabase();
    const now = new Date();

    logger.debug('Collecting community analytics');

    // Total onboarded members
    const totalMembersRow = db
      .prepare(
        `
        SELECT COUNT(*) as count
        FROM member_profiles
        WHERE onboarding_complete = 1
      `
      )
      .get() as { count: number };

    const totalMembers = totalMembersRow.count;

    // Tier distribution
    const tierDistributionRows = db
      .prepare(
        `
        SELECT tier, COUNT(*) as count
        FROM member_profiles
        WHERE onboarding_complete = 1 AND tier IS NOT NULL
        GROUP BY tier
      `
      )
      .all() as Array<{ tier: Tier; count: number }>;

    const byTier: Record<Tier, number> = {
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

    for (const row of tierDistributionRows) {
      byTier[row.tier] = row.count;
    }

    // Total BGT represented
    // Sum BGT from all onboarded members via wallet mappings
    const totalBgtRow = db
      .prepare(
        `
        SELECT COALESCE(SUM(CAST(ce.bgt AS INTEGER)), 0) as total_bgt_wei
        FROM member_profiles mp
        JOIN wallet_mappings wm ON wm.discord_id = mp.discord_user_id
        JOIN current_eligibility ce ON ce.address = wm.wallet_address
        WHERE mp.onboarding_complete = 1
      `
      )
      .get() as { total_bgt_wei: number };

    const totalBgtWei = BigInt(totalBgtRow.total_bgt_wei || 0);
    const totalBgt = parseFloat(formatUnits(totalBgtWei, 18));

    // Weekly active users (members with activity in last 7 days)
    const weeklyActiveRow = db
      .prepare(
        `
        SELECT COUNT(DISTINCT mp.member_id) as count
        FROM member_profiles mp
        JOIN member_activity ma ON ma.member_id = mp.member_id
        WHERE mp.onboarding_complete = 1
        AND ma.last_message_at IS NOT NULL
        AND datetime(ma.last_message_at, 'unixepoch') > datetime('now', '-7 days')
      `
      )
      .get() as { count: number };

    const weeklyActive = weeklyActiveRow.count;

    // New members this week
    const newThisWeekRow = db
      .prepare(
        `
        SELECT COUNT(*) as count
        FROM member_profiles
        WHERE onboarding_complete = 1
        AND datetime(created_at, 'unixepoch') > datetime('now', '-7 days')
      `
      )
      .get() as { count: number };

    const newThisWeek = newThisWeekRow.count;

    // Tier promotions this week (from tier_history table)
    const promotionsThisWeekRow = db
      .prepare(
        `
        SELECT COUNT(*) as count
        FROM tier_history
        WHERE datetime(changed_at, 'unixepoch') > datetime('now', '-7 days')
        AND from_tier IS NOT NULL
      `
      )
      .get() as { count: number };

    const promotionsThisWeek = promotionsThisWeekRow.count;

    // Badges awarded this week
    const badgesAwardedThisWeekRow = db
      .prepare(
        `
        SELECT COUNT(*) as count
        FROM member_badges
        WHERE datetime(awarded_at, 'unixepoch') > datetime('now', '-7 days')
      `
      )
      .get() as { count: number };

    const badgesAwardedThisWeek = badgesAwardedThisWeekRow.count;

    const analytics: CommunityAnalytics = {
      totalMembers,
      byTier,
      totalBgt,
      totalBgtWei: totalBgtWei.toString(),
      weeklyActive,
      newThisWeek,
      promotionsThisWeek,
      badgesAwardedThisWeek,
      generatedAt: now,
    };

    logger.debug({ analytics }, 'Community analytics collected');

    return analytics;
  }

  /**
   * Get tier distribution summary string
   * Useful for Discord embeds
   *
   * @returns Formatted tier distribution string
   */
  getTierDistributionSummary(): string {
    const analytics = this.getCommunityAnalytics();
    const lines: string[] = [];

    const tierOrder: Tier[] = [
      'naib',
      'fedaykin',
      'usul',
      'sayyadina',
      'mushtamal',
      'sihaya',
      'qanat',
      'ichwan',
      'hajra',
    ];

    for (const tier of tierOrder) {
      const count = analytics.byTier[tier];
      if (count > 0) {
        // Capitalize tier name
        const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);
        lines.push(`${tierName}: ${count}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Get top active members for the week
   * Returns members with highest activity balance
   *
   * @param limit - Number of members to return (default 5)
   * @returns Array of top active members
   */
  getTopActiveMembers(
    limit = 5
  ): Array<{ nym: string; activityBalance: number; messageCount: number }> {
    const db = getDatabase();

    const topActive = db
      .prepare(
        `
        SELECT
          mp.nym,
          ma.activity_balance,
          ma.total_messages
        FROM member_profiles mp
        JOIN member_activity ma ON ma.member_id = mp.member_id
        WHERE mp.onboarding_complete = 1
        AND ma.activity_balance > 0
        ORDER BY ma.activity_balance DESC
        LIMIT ?
      `
      )
      .all(limit) as Array<{
      nym: string;
      activity_balance: number;
      total_messages: number;
    }>;

    return topActive.map((row) => ({
      nym: row.nym,
      activityBalance: row.activity_balance,
      messageCount: row.total_messages,
    }));
  }

  /**
   * Get recent tier promotions
   * Returns recent tier changes (promotions only, not initial assignments)
   *
   * @param limit - Number of promotions to return (default 10)
   * @returns Array of recent promotions
   */
  getRecentPromotions(
    limit = 10
  ): Array<{ nym: string; fromTier: string; toTier: string; changedAt: Date }> {
    const db = getDatabase();

    const recentPromotions = db
      .prepare(
        `
        SELECT
          mp.nym,
          th.from_tier,
          th.to_tier,
          th.changed_at
        FROM tier_history th
        JOIN member_profiles mp ON mp.member_id = th.member_id
        WHERE th.from_tier IS NOT NULL
        ORDER BY th.changed_at DESC
        LIMIT ?
      `
      )
      .all(limit) as Array<{
      nym: string;
      from_tier: string;
      to_tier: string;
      changed_at: string;
    }>;

    return recentPromotions.map((row) => ({
      nym: row.nym,
      fromTier: row.from_tier,
      toTier: row.to_tier,
      changedAt: new Date(row.changed_at),
    }));
  }
}

// Export singleton instance
export const analyticsService = new AnalyticsService();
