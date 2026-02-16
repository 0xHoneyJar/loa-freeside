/**
 * LeaderboardService — Cached Leaderboard Rankings
 *
 * Provides leaderboard queries across timeframes with in-memory cache.
 * Rankings based on referral count and total earnings.
 *
 * Timeframes: daily, weekly, monthly, all_time
 * Cache TTL: 60 seconds (configurable)
 *
 * SDD refs: §4.6 LeaderboardService
 * Sprint refs: Tasks 5.1, 5.3
 *
 * @module packages/adapters/billing/LeaderboardService
 */

import type Database from 'better-sqlite3';
import { logger } from '../../../utils/logger.js';

// =============================================================================
// Types
// =============================================================================

export type LeaderboardTimeframe = 'daily' | 'weekly' | 'monthly' | 'all_time';

export interface LeaderboardEntry {
  rank: number;
  accountId: string;
  displayName: string;
  referralCount: number;
  totalEarningsMicro: bigint;
}

export interface LeaderboardOptions {
  limit?: number;
  offset?: number;
}

export interface CreatorRank {
  rank: number;
  referralCount: number;
  totalEarningsMicro: bigint;
  totalParticipants: number;
}

interface CacheEntry {
  data: LeaderboardEntry[];
  expiresAt: number;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_CACHE_TTL_MS = 60_000; // 1 minute

const TIMEFRAME_FILTERS: Record<LeaderboardTimeframe, string> = {
  daily: `datetime('now', '-1 day')`,
  weekly: `datetime('now', '-7 days')`,
  monthly: `datetime('now', '-30 days')`,
  all_time: `datetime('1970-01-01')`,
};

// =============================================================================
// LeaderboardService
// =============================================================================

export class LeaderboardService {
  private db: Database.Database;
  private cache: Map<string, CacheEntry> = new Map();
  private cacheTtlMs: number;

  constructor(db: Database.Database, cacheTtlMs?: number) {
    this.db = db;
    this.cacheTtlMs = cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  /**
   * Get leaderboard rankings for a timeframe.
   * Returns cached results if available and not expired.
   */
  getLeaderboard(
    timeframe: LeaderboardTimeframe,
    opts?: LeaderboardOptions,
  ): LeaderboardEntry[] {
    const limit = Math.min(opts?.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = opts?.offset ?? 0;
    const cacheKey = `${timeframe}:${limit}:${offset}`;

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      logger.debug({ event: 'leaderboard.cache_hit', timeframe }, 'Leaderboard cache hit');
      return cached.data;
    }

    // Query fresh data
    const data = this.queryLeaderboard(timeframe, limit, offset);

    // Update cache
    this.cache.set(cacheKey, {
      data,
      expiresAt: Date.now() + this.cacheTtlMs,
    });

    return data;
  }

  /**
   * Get individual creator's rank in a timeframe.
   */
  getCreatorRank(accountId: string, timeframe: LeaderboardTimeframe): CreatorRank | null {
    const filter = TIMEFRAME_FILTERS[timeframe];

    try {
      // Get total participants
      const totalRow = this.db.prepare(`
        SELECT COUNT(DISTINCT referrer_account_id) as total
        FROM referral_registrations
        WHERE created_at >= ${filter}
      `).get() as { total: number };

      // Get this creator's stats
      const statsRow = this.db.prepare(`
        SELECT
          COUNT(DISTINCT r.id) as referral_count,
          COALESCE((
            SELECT SUM(e.amount_micro) FROM referrer_earnings e
            WHERE e.referrer_account_id = ?
              AND e.created_at >= ${filter}
          ), 0) as total_earnings
        FROM referral_registrations r
        WHERE r.referrer_account_id = ?
          AND r.created_at >= ${filter}
      `).get(accountId, accountId) as { referral_count: number; total_earnings: number } | undefined;

      if (!statsRow || statsRow.referral_count === 0) {
        return null;
      }

      // Get rank (count of creators with more referrals)
      const rankRow = this.db.prepare(`
        SELECT COUNT(DISTINCT referrer_account_id) + 1 as rank
        FROM referral_registrations
        WHERE created_at >= ${filter}
        GROUP BY referrer_account_id
        HAVING COUNT(*) > ?
      `).all(statsRow.referral_count) as Array<Record<string, unknown>>;

      const rank = rankRow.length + 1;

      return {
        rank,
        referralCount: statsRow.referral_count,
        totalEarningsMicro: BigInt(statsRow.total_earnings),
        totalParticipants: totalRow.total,
      };
    } catch (err) {
      logger.error({ err, accountId, timeframe }, 'Failed to get creator rank');
      return null;
    }
  }

  /**
   * Invalidate all cached leaderboard data.
   * Called by the refresh cron job.
   */
  invalidateCache(): void {
    this.cache.clear();
    logger.debug({ event: 'leaderboard.cache_invalidated' }, 'Leaderboard cache invalidated');
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private queryLeaderboard(
    timeframe: LeaderboardTimeframe,
    limit: number,
    offset: number,
  ): LeaderboardEntry[] {
    const filter = TIMEFRAME_FILTERS[timeframe];

    try {
      const rows = this.db.prepare(`
        SELECT
          r.referrer_account_id as account_id,
          COUNT(DISTINCT r.id) as referral_count,
          COALESCE((
            SELECT SUM(e.amount_micro) FROM referrer_earnings e
            WHERE e.referrer_account_id = r.referrer_account_id
              AND e.created_at >= ${filter}
          ), 0) as total_earnings
        FROM referral_registrations r
        WHERE r.created_at >= ${filter}
        GROUP BY r.referrer_account_id
        ORDER BY referral_count DESC, total_earnings DESC
        LIMIT ? OFFSET ?
      `).all(limit, offset) as Array<{
        account_id: string;
        referral_count: number;
        total_earnings: number;
      }>;

      return rows.map((row, idx) => ({
        rank: offset + idx + 1,
        accountId: row.account_id,
        displayName: this.anonymizeAddress(row.account_id),
        referralCount: row.referral_count,
        totalEarningsMicro: BigInt(row.total_earnings),
      }));
    } catch (err) {
      logger.error({ err, timeframe }, 'Failed to query leaderboard');
      return [];
    }
  }

  /**
   * Anonymize account ID for public display.
   * Shows first 6 and last 4 characters.
   */
  private anonymizeAddress(accountId: string): string {
    if (accountId.length <= 10) return accountId;
    return `${accountId.slice(0, 6)}...${accountId.slice(-4)}`;
  }
}
