/**
 * Leaderboard Service (v4.1 - Sprint 32)
 *
 * Provides engagement leaderboard based on badge count.
 * Privacy-first design: Does NOT expose activity stats or wallet info.
 *
 * Rankings are based on:
 * 1. Badge count (primary)
 * 2. Tenure (tiebreaker - older members rank higher)
 *
 * Sprint 32: Added Redis caching with 60-second TTL for performance.
 */

import { logger } from '../utils/logger.js';
import {
  getDatabase,
  calculateTenureCategory,
  getMemberBadgeCount,
} from '../db/queries.js';
import { redisService } from './cache/RedisService.js';
import type { LeaderboardEntry } from '../types/index.js';

/**
 * Default leaderboard size
 */
const DEFAULT_LEADERBOARD_SIZE = 20;

/**
 * Maximum leaderboard size
 */
const MAX_LEADERBOARD_SIZE = 100;

/**
 * Leaderboard Service
 *
 * Provides member ranking by badge count with privacy protection.
 */
class LeaderboardService {
  /**
   * Get engagement leaderboard (top N members by badge count)
   *
   * Privacy notes:
   * - Does NOT return activity stats
   * - Does NOT return wallet info
   * - Only returns public profile information
   *
   * Sprint 32: Now uses Redis caching with 60-second TTL
   */
  async getLeaderboard(limit: number = DEFAULT_LEADERBOARD_SIZE): Promise<LeaderboardEntry[]> {
    // Normalize limit
    const normalizedLimit = Math.min(
      MAX_LEADERBOARD_SIZE,
      Math.max(1, limit)
    );

    // Try cache first
    const cached = await redisService.getLeaderboard(normalizedLimit);
    if (cached) {
      logger.debug(
        { count: cached.length, limit: normalizedLimit },
        'Leaderboard served from cache'
      );
      return cached as LeaderboardEntry[];
    }

    // Cache miss - query database
    const entries = this.getLeaderboardFromDb(normalizedLimit);

    // Store in cache (fire and forget)
    redisService.setLeaderboard(normalizedLimit, entries).catch((error) => {
      logger.warn({ error: (error as Error).message }, 'Failed to cache leaderboard');
    });

    return entries;
  }

  /**
   * Get leaderboard directly from database (bypasses cache)
   * Used internally and for cache population
   */
  getLeaderboardFromDb(limit: number = DEFAULT_LEADERBOARD_SIZE): LeaderboardEntry[] {
    const database = getDatabase();

    // Normalize limit
    const normalizedLimit = Math.min(
      MAX_LEADERBOARD_SIZE,
      Math.max(1, limit)
    );

    // Query members with badge count, sorted by badge count then tenure
    // Tiebreaker: older members rank higher (earlier created_at)
    const rows = database
      .prepare(
        `
        SELECT
          mp.member_id,
          mp.nym,
          mp.pfp_url,
          mp.tier,
          mp.created_at,
          COALESCE((
            SELECT COUNT(*) FROM member_badges mb
            WHERE mb.member_id = mp.member_id AND mb.revoked = 0
          ), 0) as badge_count
        FROM member_profiles mp
        WHERE mp.onboarding_complete = 1
        ORDER BY badge_count DESC, mp.created_at ASC
        LIMIT ?
      `
      )
      .all(normalizedLimit) as Array<{
        member_id: string;
        nym: string;
        pfp_url: string | null;
        tier: 'naib' | 'fedaykin';
        created_at: string;
        badge_count: number;
      }>;

    // Transform to LeaderboardEntry with rank
    const entries: LeaderboardEntry[] = rows.map((row, index) => {
      const createdAt = new Date(row.created_at);
      const tenureCategory = calculateTenureCategory(createdAt);

      return {
        rank: index + 1,
        nym: row.nym,
        pfpUrl: row.pfp_url,
        tier: row.tier,
        badgeCount: row.badge_count,
        tenureCategory,
      };
    });

    logger.debug(
      { count: entries.length, limit: normalizedLimit },
      'Fetched leaderboard from database'
    );

    return entries;
  }

  /**
   * Invalidate the leaderboard cache
   * Call this when badge counts change (badge awarded/revoked)
   */
  async invalidateCache(): Promise<void> {
    await redisService.invalidateLeaderboard();
  }

  /**
   * Get a specific member's rank on the leaderboard
   * Returns null if member not found or not on leaderboard
   */
  getMemberRank(memberId: string): number | null {
    const database = getDatabase();

    // Get the member's badge count
    const badgeCount = getMemberBadgeCount(memberId);

    // Get the member's created_at for tiebreaker
    const memberRow = database
      .prepare(
        `
        SELECT created_at FROM member_profiles
        WHERE member_id = ? AND onboarding_complete = 1
      `
      )
      .get(memberId) as { created_at: string } | undefined;

    if (!memberRow) {
      return null;
    }

    const memberCreatedAt = memberRow.created_at;

    // Count how many members rank higher
    // Higher badge count OR same badge count with earlier join date
    const rankRow = database
      .prepare(
        `
        SELECT COUNT(*) + 1 as rank
        FROM member_profiles mp
        LEFT JOIN (
          SELECT member_id, COUNT(*) as badge_count
          FROM member_badges
          WHERE revoked = 0
          GROUP BY member_id
        ) bc ON mp.member_id = bc.member_id
        WHERE mp.onboarding_complete = 1
        AND (
          COALESCE(bc.badge_count, 0) > ?
          OR (COALESCE(bc.badge_count, 0) = ? AND mp.created_at < ?)
        )
      `
      )
      .get(badgeCount, badgeCount, memberCreatedAt) as { rank: number };

    return rankRow.rank;
  }

  /**
   * Get leaderboard position for multiple members
   * Returns a map of memberId -> rank
   */
  getMemberRanks(memberIds: string[]): Map<string, number> {
    const ranks = new Map<string, number>();

    for (const memberId of memberIds) {
      const rank = this.getMemberRank(memberId);
      if (rank !== null) {
        ranks.set(memberId, rank);
      }
    }

    return ranks;
  }

  /**
   * Check if member qualifies for "Top 10" achievement
   */
  isInTopTen(memberId: string): boolean {
    const rank = this.getMemberRank(memberId);
    return rank !== null && rank <= 10;
  }
}

/**
 * Singleton leaderboard service instance
 */
export const leaderboardService = new LeaderboardService();
