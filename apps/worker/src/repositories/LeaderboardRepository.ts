/**
 * Leaderboard Repository
 * Sprint S-8: ScyllaDB Integration
 *
 * Repository pattern for leaderboard operations using ScyllaDB.
 * Integrates with tenant context for multi-tenancy.
 */

import type { Logger } from 'pino';
import type { ScyllaClient } from '../infrastructure/scylla/scylla-client.js';
import type {
  LeaderboardEntry,
  LeaderboardType,
  PaginatedResult,
  Score,
} from '../infrastructure/scylla/types.js';
import type { TenantRequestContext } from '../services/TenantContext.js';
import { recordCommand } from '../services/TenantMetrics.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface LeaderboardPage {
  entries: LeaderboardEntry[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  totalEstimate?: number;
}

export interface LeaderboardRecalculateOptions {
  type: LeaderboardType;
  limit?: number;
}

export interface ProfileRank {
  profileId: string;
  rank: number;
  score: string;
  tier: string;
}

// --------------------------------------------------------------------------
// Leaderboard Repository
// --------------------------------------------------------------------------

export class LeaderboardRepository {
  private readonly log: Logger;
  private readonly scylla: ScyllaClient;

  constructor(scyllaClient: ScyllaClient, logger: Logger) {
    this.scylla = scyllaClient;
    this.log = logger.child({ component: 'LeaderboardRepository' });
  }

  /**
   * Get leaderboard page for a community
   */
  async getLeaderboard(
    ctx: TenantRequestContext,
    type: LeaderboardType,
    page = 0,
    pageSize = 100
  ): Promise<LeaderboardPage> {
    const startTime = Date.now();

    try {
      const result = await this.scylla.getLeaderboard(ctx.communityId, type, page, pageSize);

      const duration = (Date.now() - startTime) / 1000;
      recordCommand(ctx.communityId, ctx.tier, 'leaderboard_get', 'success', duration);

      this.log.debug(
        {
          communityId: ctx.communityId,
          type,
          page,
          pageSize,
          count: result.data.length,
        },
        'Leaderboard page retrieved'
      );

      return {
        entries: result.data,
        page,
        pageSize,
        hasMore: result.hasMore,
      };
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      recordCommand(ctx.communityId, ctx.tier, 'leaderboard_get', 'error', duration);

      this.log.error({ error, communityId: ctx.communityId, type }, 'Failed to get leaderboard');
      throw error;
    }
  }

  /**
   * Get profile's rank on leaderboard
   */
  async getProfileRank(
    ctx: TenantRequestContext,
    profileId: string,
    type: LeaderboardType
  ): Promise<ProfileRank | null> {
    const startTime = Date.now();

    try {
      // Scan leaderboard buckets to find the profile
      // In production, we'd maintain a secondary index for O(1) lookup
      let currentPage = 0;
      const pageSize = 100;

      while (currentPage < 100) { // Max 10k entries scanned
        const result = await this.scylla.getLeaderboard(ctx.communityId, type, currentPage, pageSize);

        for (const entry of result.data) {
          if (entry.profileId === profileId) {
            const duration = (Date.now() - startTime) / 1000;
            recordCommand(ctx.communityId, ctx.tier, 'leaderboard_rank', 'success', duration);

            return {
              profileId: entry.profileId,
              rank: entry.rank,
              score: entry.score,
              tier: entry.tier,
            };
          }
        }

        if (!result.hasMore) break;
        currentPage++;
      }

      const duration = (Date.now() - startTime) / 1000;
      recordCommand(ctx.communityId, ctx.tier, 'leaderboard_rank', 'success', duration);

      return null;
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      recordCommand(ctx.communityId, ctx.tier, 'leaderboard_rank', 'error', duration);

      this.log.error({ error, communityId: ctx.communityId, profileId, type }, 'Failed to get profile rank');
      throw error;
    }
  }

  /**
   * Get profiles around a specific rank (for context)
   */
  async getProfilesAroundRank(
    ctx: TenantRequestContext,
    type: LeaderboardType,
    targetRank: number,
    range = 5
  ): Promise<LeaderboardEntry[]> {
    const startTime = Date.now();

    try {
      const startRank = Math.max(1, targetRank - range);
      const page = Math.floor((startRank - 1) / 100);
      const pageSize = range * 2 + 1;

      const result = await this.scylla.getLeaderboard(ctx.communityId, type, page, pageSize);

      // Filter to entries within range
      const entries = result.data.filter(
        (e) => e.rank >= startRank && e.rank <= targetRank + range
      );

      const duration = (Date.now() - startTime) / 1000;
      recordCommand(ctx.communityId, ctx.tier, 'leaderboard_around', 'success', duration);

      return entries;
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      recordCommand(ctx.communityId, ctx.tier, 'leaderboard_around', 'error', duration);

      this.log.error({ error, communityId: ctx.communityId, type, targetRank }, 'Failed to get profiles around rank');
      throw error;
    }
  }

  /**
   * Update leaderboard from scores
   * Called after score sync or recalculation
   */
  async recalculateLeaderboard(
    ctx: TenantRequestContext,
    scores: Score[],
    options: LeaderboardRecalculateOptions
  ): Promise<number> {
    const startTime = Date.now();

    try {
      const { type, limit = 10000 } = options;

      // Sort scores by the appropriate field
      const sortedScores = [...scores].sort((a, b) => {
        const scoreA = type === 'activity'
          ? parseFloat(a.activityScore)
          : parseFloat(a.convictionScore);
        const scoreB = type === 'activity'
          ? parseFloat(b.activityScore)
          : parseFloat(b.convictionScore);
        return scoreB - scoreA; // Descending
      });

      // Take top N and update leaderboard
      const topScores = sortedScores.slice(0, limit);
      let updated = 0;

      for (let i = 0; i < topScores.length; i++) {
        const score = topScores[i];
        const rank = i + 1;
        const bucket = Math.floor(rank / 100) * 100;
        const scoreValue = type === 'activity' ? score.activityScore : score.convictionScore;

        const entry: LeaderboardEntry = {
          communityId: ctx.communityId,
          leaderboardType: type,
          bucket,
          rank,
          profileId: score.profileId,
          displayName: '', // Would be populated from profile service
          score: scoreValue,
          tier: this.calculateTier(rank),
          updatedAt: new Date(),
        };

        await this.scylla.updateLeaderboardEntry(entry);
        updated++;
      }

      const duration = (Date.now() - startTime) / 1000;
      recordCommand(ctx.communityId, ctx.tier, 'leaderboard_recalc', 'success', duration);

      this.log.info(
        {
          communityId: ctx.communityId,
          type,
          updated,
          durationMs: Date.now() - startTime,
        },
        'Leaderboard recalculated'
      );

      return updated;
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      recordCommand(ctx.communityId, ctx.tier, 'leaderboard_recalc', 'error', duration);

      this.log.error({ error, communityId: ctx.communityId, options }, 'Failed to recalculate leaderboard');
      throw error;
    }
  }

  /**
   * Update a single leaderboard entry
   */
  async updateEntry(ctx: TenantRequestContext, entry: LeaderboardEntry): Promise<void> {
    const startTime = Date.now();

    try {
      await this.scylla.updateLeaderboardEntry({
        ...entry,
        communityId: ctx.communityId,
        updatedAt: new Date(),
      });

      const duration = (Date.now() - startTime) / 1000;
      recordCommand(ctx.communityId, ctx.tier, 'leaderboard_update', 'success', duration);

      this.log.debug(
        { communityId: ctx.communityId, profileId: entry.profileId, rank: entry.rank },
        'Leaderboard entry updated'
      );
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      recordCommand(ctx.communityId, ctx.tier, 'leaderboard_update', 'error', duration);

      this.log.error({ error, communityId: ctx.communityId, entry }, 'Failed to update leaderboard entry');
      throw error;
    }
  }

  /**
   * Get top N entries for a leaderboard type
   */
  async getTopEntries(
    ctx: TenantRequestContext,
    type: LeaderboardType,
    limit = 10
  ): Promise<LeaderboardEntry[]> {
    const page = await this.getLeaderboard(ctx, type, 0, limit);
    return page.entries;
  }

  // --------------------------------------------------------------------------
  // Private Helpers
  // --------------------------------------------------------------------------

  private calculateTier(rank: number): string {
    if (rank <= 10) return 'diamond';
    if (rank <= 50) return 'platinum';
    if (rank <= 100) return 'gold';
    if (rank <= 500) return 'silver';
    return 'bronze';
  }
}

// --------------------------------------------------------------------------
// Factory
// --------------------------------------------------------------------------

export function createLeaderboardRepository(
  scyllaClient: ScyllaClient,
  logger: Logger
): LeaderboardRepository {
  return new LeaderboardRepository(scyllaClient, logger);
}
