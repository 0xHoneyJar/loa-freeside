/**
 * Digest Service
 *
 * Handles weekly community digest generation and posting for Sietch v3.0.
 * Collects stats, generates formatted digest, and posts to announcements channel.
 *
 * Features:
 * - Weekly stats collection (members, BGT, tiers, activity)
 * - Notable event tracking (promotions, new members)
 * - Discord message formatting with Dune theme
 * - Persistent digest history in weekly_digests table
 *
 * Usage:
 * - Called by weekly-digest trigger.dev task every Monday at 00:00 UTC
 * - Admin can manually trigger via /admin digest command
 */

import { logger } from '../utils/logger.js';
import { getDatabase, logAuditEvent } from '../db/index.js';
import { formatUnits } from 'viem';
import type { Client, TextChannel } from 'discord.js';
import type { Tier } from '../types/index.js';

/**
 * Weekly stats data structure
 */
export interface WeeklyStats {
  /** Week identifier (ISO 8601: YYYY-Wnn) */
  weekIdentifier: string;
  /** Total members (onboarded) */
  totalMembers: number;
  /** New members this week */
  newMembers: number;
  /** Total BGT represented (formatted) */
  totalBgt: number;
  /** Total BGT in wei (for database storage) */
  totalBgtWei: string;
  /** Distribution of members by tier */
  tierDistribution: Record<Tier, number>;
  /** Most active tier this week */
  mostActiveTier: Tier | null;
  /** Number of tier promotions this week */
  promotionsCount: number;
  /** Notable promotions (Sayyadina, Usul, Fedaykin, Naib) */
  notablePromotions: Array<{ nym: string; newTier: Tier }>;
  /** Badges awarded this week */
  badgesAwarded: number;
  /** Top new member by BGT (nym and tier) */
  topNewMember: { nym: string; tier: Tier } | null;
  /** When stats were generated */
  generatedAt: Date;
}

/**
 * Digest posting result
 */
export interface DigestPostResult {
  success: boolean;
  messageId?: string;
  channelId?: string;
  error?: string;
}

/**
 * Digest Service class
 */
class DigestService {
  /**
   * Get ISO 8601 week identifier (YYYY-Wnn) for a given date
   *
   * @param date - Date to get week for (defaults to current date)
   * @returns Week identifier string (e.g., "2025-W03")
   */
  getWeekIdentifier(date: Date = new Date()): string {
    // ISO 8601 week date calculation
    // Week 1 is the first week with at least 4 days in the new year
    // Weeks start on Monday

    // Clone date to avoid mutations
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

    // Set to nearest Thursday: current date + 4 - current day number
    // Make Sunday's day number 7 (ISO 8601 standard)
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);

    // Get first day of year (for the Thursday's year, not original date's year)
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));

    // Calculate full weeks to nearest Thursday
    const weekNumber = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);

    // Use the Thursday's year (handles edge cases where week belongs to different year)
    const year = d.getUTCFullYear();
    const paddedWeek = String(weekNumber).padStart(2, '0');

    return `${year}-W${paddedWeek}`;
  }

  /**
   * Collect weekly stats for digest
   *
   * Gathers:
   * - Total members, new members this week
   * - Total BGT represented
   * - Tier distribution
   * - Most active tier (by activity balance)
   * - Promotions count and notable promotions
   * - Badges awarded this week
   * - Top new member by BGT
   *
   * @returns Weekly stats object
   */
  collectWeeklyStats(): WeeklyStats {
    const db = getDatabase();
    const now = new Date();
    const weekIdentifier = this.getWeekIdentifier(now);

    logger.debug({ weekIdentifier }, 'Collecting weekly stats');

    // Total members (onboarded)
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

    // New members this week
    const newMembersRow = db
      .prepare(
        `
        SELECT COUNT(*) as count
        FROM member_profiles
        WHERE onboarding_complete = 1
        AND datetime(created_at) > datetime('now', '-7 days')
      `
      )
      .get() as { count: number };

    const newMembers = newMembersRow.count;

    // Total BGT represented
    const totalBgtRow = db
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

    const totalBgtWei = totalBgtRow.total_bgt ?? '0';
    const totalBgt = parseFloat(formatUnits(BigInt(totalBgtWei), 18));

    // Tier distribution
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

    const tierDistribution: Record<Tier, number> = {
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
      tierDistribution[row.tier] = row.count;
    }

    // Most active tier this week (by total activity balance)
    const mostActiveTierRow = db
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

    const mostActiveTier = mostActiveTierRow?.tier ?? null;

    // Promotions this week (tier changes where old_tier is not null)
    const promotionsCountRow = db
      .prepare(
        `
        SELECT COUNT(*) as count
        FROM tier_history
        WHERE datetime(changed_at) > datetime('now', '-7 days')
        AND old_tier IS NOT NULL
      `
      )
      .get() as { count: number };

    const promotionsCount = promotionsCountRow.count;

    // Notable promotions (Sayyadina+, Usul, Fedaykin, Naib)
    const notablePromotionsRows = db
      .prepare(
        `
        SELECT mp.nym, th.new_tier
        FROM tier_history th
        JOIN member_profiles mp ON th.member_id = mp.member_id
        WHERE datetime(th.changed_at) > datetime('now', '-7 days')
        AND th.old_tier IS NOT NULL
        AND th.new_tier IN ('sayyadina', 'usul', 'fedaykin', 'naib')
        ORDER BY th.changed_at DESC
        LIMIT 5
      `
      )
      .all() as Array<{ nym: string; new_tier: Tier }>;

    const notablePromotions = notablePromotionsRows.map((row) => ({
      nym: row.nym,
      newTier: row.new_tier,
    }));

    // Badges awarded this week
    const badgesAwardedRow = db
      .prepare(
        `
        SELECT COUNT(*) as count
        FROM member_badges
        WHERE datetime(awarded_at) > datetime('now', '-7 days')
      `
      )
      .get() as { count: number };

    const badgesAwarded = badgesAwardedRow.count;

    // Top new member by BGT (joined this week)
    const topNewMemberRow = db
      .prepare(
        `
        SELECT mp.nym, mp.tier, es.bgt_held
        FROM member_profiles mp
        JOIN wallet_mappings wm ON mp.discord_user_id = wm.discord_user_id
        JOIN eligibility_snapshot es ON wm.wallet_address = es.wallet_address
        WHERE mp.onboarding_complete = 1
        AND datetime(mp.created_at) > datetime('now', '-7 days')
        ORDER BY CAST(es.bgt_held AS INTEGER) DESC
        LIMIT 1
      `
      )
      .get() as { nym: string; tier: Tier; bgt_held: string } | undefined;

    const topNewMember = topNewMemberRow
      ? { nym: topNewMemberRow.nym, tier: topNewMemberRow.tier }
      : null;

    const stats: WeeklyStats = {
      weekIdentifier,
      totalMembers,
      newMembers,
      totalBgt,
      totalBgtWei,
      tierDistribution,
      mostActiveTier,
      promotionsCount,
      notablePromotions,
      badgesAwarded,
      topNewMember,
      generatedAt: now,
    };

    logger.info({ stats }, 'Weekly stats collected');

    return stats;
  }

  /**
   * Get Monday-Sunday date range for an ISO 8601 week
   *
   * Uses the same ISO 8601 Thursday rule as getWeekIdentifier to ensure
   * date ranges match the week identifier calculation.
   *
   * @param weekIdentifier - Week identifier (e.g., "2025-W03")
   * @returns Object with weekStart (Monday) and weekEnd (Sunday) dates
   */
  private getWeekDateRange(weekIdentifier: string): { weekStart: Date; weekEnd: Date } {
    const weekMatch = weekIdentifier.match(/(\d{4})-W(\d{2})/);
    if (!weekMatch || !weekMatch[1] || !weekMatch[2]) {
      throw new Error(`Invalid week identifier format: ${weekIdentifier}`);
    }

    const year = parseInt(weekMatch[1]);
    const week = parseInt(weekMatch[2]);

    // ISO 8601: Week 1 is the first week with Thursday in the new year
    // Find January 4th (always in week 1) and work backwards to Monday
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const jan4DayNum = jan4.getUTCDay() || 7; // Sunday = 7
    const week1Monday = new Date(jan4);
    week1Monday.setUTCDate(jan4.getUTCDate() - (jan4DayNum - 1));

    // Calculate target week's Monday
    const weekStart = new Date(week1Monday);
    weekStart.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);

    // Sunday is 6 days after Monday
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekStart.getUTCDate() + 6);

    return { weekStart, weekEnd };
  }

  /**
   * Format weekly stats into Discord message
   *
   * Creates a Dune-themed digest with:
   * - Community stats summary
   * - New members count
   * - Notable promotions
   * - Badges awarded
   *
   * @param stats - Weekly stats to format
   * @returns Formatted Discord message string
   */
  formatDigest(stats: WeeklyStats): string {
    // Get date range for the week using ISO 8601 calculation
    const { weekStart, weekEnd } = this.getWeekDateRange(stats.weekIdentifier);

    const dateRange = `${weekStart.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })} - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

    // Build digest message
    const lines: string[] = [];

    lines.push('📜 **Weekly Pulse of the Sietch**');
    lines.push('');
    lines.push(`**Week of ${dateRange}**`);
    lines.push('');

    // Community stats
    lines.push('📊 **Community Stats:**');
    lines.push(`• Total Members: **${stats.totalMembers}**${stats.newMembers > 0 ? ` (+${stats.newMembers} new)` : ''}`);
    lines.push(`• BGT Represented: **${Math.floor(stats.totalBgt).toLocaleString()} BGT**`);
    if (stats.mostActiveTier) {
      const tierName = this.getTierDisplayName(stats.mostActiveTier);
      lines.push(`• Most Active Tier: **${tierName}**`);
    }
    lines.push('');

    // New members
    if (stats.newMembers > 0) {
      lines.push('🎖️ **New Members:**');
      lines.push(`• ${stats.newMembers} joined this week`);
      if (stats.topNewMember) {
        const tierName = this.getTierDisplayName(stats.topNewMember.tier);
        lines.push(`• Notable: **${stats.topNewMember.nym}** entered as **${tierName}**`);
      }
      lines.push('');
    }

    // Tier promotions
    if (stats.promotionsCount > 0) {
      lines.push('⬆️ **Tier Promotions:**');
      lines.push(`• ${stats.promotionsCount} members rose to higher tiers`);

      if (stats.notablePromotions.length > 0) {
        for (const promotion of stats.notablePromotions) {
          const tierName = this.getTierDisplayName(promotion.newTier);
          lines.push(`• **${promotion.nym}** reached **${tierName}**!`);
        }
      }
      lines.push('');
    }

    // Badges
    if (stats.badgesAwarded > 0) {
      lines.push('🏅 **Badges Awarded:**');
      lines.push(`• ${stats.badgesAwarded} badges given this week`);
      lines.push('');
    }

    // Closing
    lines.push('*The spice flows...*');

    return lines.join('\n');
  }

  /**
   * Get display name for tier (capitalized)
   *
   * Uses explicit mapping for consistency with tier naming throughout the system.
   *
   * @param tier - Tier name
   * @returns Display name
   */
  private getTierDisplayName(tier: Tier): string {
    const TIER_DISPLAY_NAMES: Record<Tier, string> = {
      hajra: 'Hajra',
      ichwan: 'Ichwan',
      qanat: 'Qanat',
      sihaya: 'Sihaya',
      mushtamal: 'Mushtamal',
      sayyadina: 'Sayyadina',
      usul: 'Usul',
      fedaykin: 'Fedaykin',
      naib: 'Naib',
    };
    return TIER_DISPLAY_NAMES[tier];
  }

  /**
   * Post digest to Discord announcements channel
   *
   * Sends formatted digest message and stores record in weekly_digests table.
   *
   * @param stats - Weekly stats to post
   * @param discordClient - Discord client instance
   * @param channelId - Announcements channel ID
   * @returns Post result with message ID
   */
  async postDigest(
    stats: WeeklyStats,
    discordClient: Client,
    channelId: string
  ): Promise<DigestPostResult> {
    try {
      logger.info({ channelId, week: stats.weekIdentifier }, 'Posting weekly digest');

      // Check for duplicate within transaction to prevent race condition
      // If two tasks run simultaneously, only one will succeed in inserting
      const db = getDatabase();
      const checkAndReserve = db.transaction(() => {
        // Check if digest already exists
        const existing = db
          .prepare(
            `
            SELECT COUNT(*) as count
            FROM weekly_digests
            WHERE week_identifier = ?
          `
          )
          .get(stats.weekIdentifier) as { count: number };

        if (existing.count > 0) {
          return { alreadyExists: true };
        }

        // Reserve this week by inserting a placeholder record
        // This prevents concurrent tasks from posting duplicate digests
        // Use NULL for message_id and channel_id, will update after Discord post
        db.prepare(
          `
          INSERT INTO weekly_digests (
            week_identifier,
            total_members,
            new_members,
            total_bgt,
            tier_distribution,
            most_active_tier,
            promotions_count,
            notable_promotions,
            badges_awarded,
            top_new_member_nym,
            message_id,
            channel_id,
            generated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
        `
        ).run(
          stats.weekIdentifier,
          stats.totalMembers,
          stats.newMembers,
          stats.totalBgtWei,
          JSON.stringify(stats.tierDistribution),
          stats.mostActiveTier ?? null,
          stats.promotionsCount,
          JSON.stringify(stats.notablePromotions),
          stats.badgesAwarded,
          stats.topNewMember?.nym ?? null,
          stats.generatedAt.toISOString()
        );

        return { alreadyExists: false };
      });

      // Execute transaction atomically
      const result = checkAndReserve();

      if (result.alreadyExists) {
        logger.warn({ week: stats.weekIdentifier }, 'Digest already exists, skipping post');
        return {
          success: false,
          error: 'Digest already exists for this week',
        };
      }

      // Format digest message
      const digestMessage = this.formatDigest(stats);

      // Fetch channel
      const channel = await discordClient.channels.fetch(channelId);

      if (!channel?.isTextBased()) {
        logger.error({ channelId }, 'Channel is not text-based');
        return {
          success: false,
          error: 'Channel is not text-based',
        };
      }

      // Send message
      const message = await (channel as TextChannel).send(digestMessage);

      logger.info(
        { messageId: message.id, channelId: message.channelId, week: stats.weekIdentifier },
        'Digest posted successfully'
      );

      // Update digest record with message ID and channel ID
      db.prepare(
        `
        UPDATE weekly_digests
        SET message_id = ?, channel_id = ?
        WHERE week_identifier = ?
      `
      ).run(message.id, message.channelId, stats.weekIdentifier);

      // Log audit event
      logAuditEvent('weekly_digest_posted', {
        weekIdentifier: stats.weekIdentifier,
        messageId: message.id,
        channelId: message.channelId,
        totalMembers: stats.totalMembers,
        newMembers: stats.newMembers,
      });

      return {
        success: true,
        messageId: message.id,
        channelId: message.channelId,
      };
    } catch (error) {
      logger.error({ error, channelId, week: stats.weekIdentifier }, 'Failed to post digest');

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Store digest record in database
   *
   * @param stats - Weekly stats
   * @param messageId - Discord message ID (optional)
   * @param channelId - Discord channel ID (optional)
   */
  private storeDigestRecord(stats: WeeklyStats, messageId: string | undefined, channelId: string | undefined): void {
    const db = getDatabase();

    try {
      db.prepare(
        `
        INSERT INTO weekly_digests (
          week_identifier,
          total_members,
          new_members,
          total_bgt,
          tier_distribution,
          most_active_tier,
          promotions_count,
          notable_promotions,
          badges_awarded,
          top_new_member_nym,
          message_id,
          channel_id,
          generated_at,
          posted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `
      ).run(
        stats.weekIdentifier,
        stats.totalMembers,
        stats.newMembers,
        stats.totalBgtWei,
        JSON.stringify(stats.tierDistribution),
        stats.mostActiveTier ?? null,
        stats.promotionsCount,
        JSON.stringify(stats.notablePromotions),
        stats.badgesAwarded,
        stats.topNewMember?.nym ?? null,
        messageId ?? null,
        channelId ?? null,
        stats.generatedAt.toISOString()
      );

      logger.debug({ week: stats.weekIdentifier }, 'Digest record stored in database');
    } catch (error) {
      logger.error({ error, week: stats.weekIdentifier }, 'Failed to store digest record');
      // Non-fatal - digest was posted successfully
    }
  }

  /**
   * Check if digest already exists for a given week
   *
   * @param weekIdentifier - Week identifier (YYYY-Wnn)
   * @returns True if digest exists
   */
  digestExistsForWeek(weekIdentifier: string): boolean {
    const db = getDatabase();

    const row = db
      .prepare(
        `
        SELECT COUNT(*) as count
        FROM weekly_digests
        WHERE week_identifier = ?
      `
      )
      .get(weekIdentifier) as { count: number };

    return row.count > 0;
  }

  /**
   * Get historical digest data
   *
   * @param limit - Number of recent digests to retrieve
   * @returns Array of digest records
   */
  getRecentDigests(limit: number = 10): Array<WeeklyStats & { messageId: string | null }> {
    const db = getDatabase();

    const rows = db
      .prepare(
        `
        SELECT
          week_identifier,
          total_members,
          new_members,
          total_bgt,
          tier_distribution,
          most_active_tier,
          promotions_count,
          notable_promotions,
          badges_awarded,
          top_new_member_nym,
          message_id,
          generated_at
        FROM weekly_digests
        ORDER BY generated_at DESC
        LIMIT ?
      `
      )
      .all(limit) as Array<{
      week_identifier: string;
      total_members: number;
      new_members: number;
      total_bgt: string;
      tier_distribution: string;
      most_active_tier: Tier | null;
      promotions_count: number;
      notable_promotions: string;
      badges_awarded: number;
      top_new_member_nym: string | null;
      message_id: string | null;
      generated_at: string;
    }>;

    return rows.map((row) => ({
      weekIdentifier: row.week_identifier,
      totalMembers: row.total_members,
      newMembers: row.new_members,
      totalBgt: parseFloat(formatUnits(BigInt(row.total_bgt), 18)),
      totalBgtWei: row.total_bgt,
      tierDistribution: JSON.parse(row.tier_distribution),
      mostActiveTier: row.most_active_tier,
      promotionsCount: row.promotions_count,
      notablePromotions: JSON.parse(row.notable_promotions),
      badgesAwarded: row.badges_awarded,
      topNewMember: row.top_new_member_nym
        ? { nym: row.top_new_member_nym, tier: 'hajra' as Tier }
        : null,
      generatedAt: new Date(row.generated_at),
      messageId: row.message_id,
    }));
  }
}

/**
 * Singleton digest service instance
 */
export const digestService = new DigestService();
