/**
 * Score Repository
 * Sprint S-8: ScyllaDB Integration
 *
 * Repository pattern for score operations using ScyllaDB.
 * Integrates with tenant context for multi-tenancy.
 */

import type { Logger } from 'pino';
import type { ScyllaClient } from '../infrastructure/scylla/scylla-client.js';
import type { Score, ScoreHistoryEntry, BatchResult, ScoreEventType } from '../infrastructure/scylla/types.js';
import type { TenantRequestContext } from '../services/TenantContext.js';
import { recordCommand } from '../services/TenantMetrics.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface ScoreUpdate {
  profileId: string;
  convictionDelta?: string;
  activityDelta?: string;
  eventType: ScoreEventType;
  txHash?: string;
}

export interface ScoreQuery {
  communityId: string;
  profileId: string;
}

export interface ScoreRankUpdate {
  profileId: string;
  newRank: number;
}

// --------------------------------------------------------------------------
// Score Repository
// --------------------------------------------------------------------------

export class ScoreRepository {
  private readonly log: Logger;
  private readonly scylla: ScyllaClient;

  constructor(scyllaClient: ScyllaClient, logger: Logger) {
    this.scylla = scyllaClient;
    this.log = logger.child({ component: 'ScoreRepository' });
  }

  /**
   * Get score for a profile within tenant context
   */
  async getScore(ctx: TenantRequestContext, profileId: string): Promise<Score | null> {
    const startTime = Date.now();

    try {
      const score = await this.scylla.getScore(ctx.communityId, profileId);

      const duration = (Date.now() - startTime) / 1000;
      recordCommand(ctx.communityId, ctx.tier, 'score_get', 'success', duration);

      this.log.debug(
        { communityId: ctx.communityId, profileId, found: !!score, durationMs: Date.now() - startTime },
        'Score retrieved'
      );

      return score;
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      recordCommand(ctx.communityId, ctx.tier, 'score_get', 'error', duration);

      this.log.error({ error, communityId: ctx.communityId, profileId }, 'Failed to get score');
      throw error;
    }
  }

  /**
   * Get scores for multiple profiles
   */
  async getScores(ctx: TenantRequestContext, profileIds: string[]): Promise<Map<string, Score>> {
    const startTime = Date.now();
    const results = new Map<string, Score>();

    try {
      // Fetch in parallel
      const promises = profileIds.map(async (profileId) => {
        const score = await this.scylla.getScore(ctx.communityId, profileId);
        if (score) {
          results.set(profileId, score);
        }
      });

      await Promise.all(promises);

      const duration = (Date.now() - startTime) / 1000;
      recordCommand(ctx.communityId, ctx.tier, 'score_get_batch', 'success', duration);

      this.log.debug(
        { communityId: ctx.communityId, requested: profileIds.length, found: results.size },
        'Batch scores retrieved'
      );

      return results;
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      recordCommand(ctx.communityId, ctx.tier, 'score_get_batch', 'error', duration);

      this.log.error({ error, communityId: ctx.communityId }, 'Failed to get batch scores');
      throw error;
    }
  }

  /**
   * Update score for a profile
   */
  async updateScore(
    ctx: TenantRequestContext,
    update: ScoreUpdate
  ): Promise<Score> {
    const startTime = Date.now();

    try {
      // Get current score or create default
      let current = await this.scylla.getScore(ctx.communityId, update.profileId);

      if (!current) {
        current = {
          communityId: ctx.communityId,
          profileId: update.profileId,
          convictionScore: '0',
          activityScore: '0',
          currentRank: 0,
          updatedAt: new Date(),
        };
      }

      // Apply deltas
      const newConviction = update.convictionDelta
        ? this.addDecimalStrings(current.convictionScore, update.convictionDelta)
        : current.convictionScore;

      const newActivity = update.activityDelta
        ? this.addDecimalStrings(current.activityScore, update.activityDelta)
        : current.activityScore;

      const updatedScore: Score = {
        ...current,
        convictionScore: newConviction,
        activityScore: newActivity,
        updatedAt: new Date(),
      };

      // Persist to ScyllaDB
      await this.scylla.updateScore(updatedScore);

      // Record history
      await this.recordHistory(ctx, current, updatedScore, update);

      const duration = (Date.now() - startTime) / 1000;
      recordCommand(ctx.communityId, ctx.tier, 'score_update', 'success', duration);

      this.log.info(
        {
          communityId: ctx.communityId,
          profileId: update.profileId,
          eventType: update.eventType,
          convictionDelta: update.convictionDelta,
          activityDelta: update.activityDelta,
        },
        'Score updated'
      );

      return updatedScore;
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      recordCommand(ctx.communityId, ctx.tier, 'score_update', 'error', duration);

      this.log.error({ error, communityId: ctx.communityId, update }, 'Failed to update score');
      throw error;
    }
  }

  /**
   * Batch update scores (for bulk operations like sync)
   */
  async batchUpdateScores(
    ctx: TenantRequestContext,
    updates: ScoreUpdate[]
  ): Promise<BatchResult> {
    const startTime = Date.now();

    try {
      // Build score objects
      const scores: Score[] = [];

      for (const update of updates) {
        let current = await this.scylla.getScore(ctx.communityId, update.profileId);

        if (!current) {
          current = {
            communityId: ctx.communityId,
            profileId: update.profileId,
            convictionScore: '0',
            activityScore: '0',
            currentRank: 0,
            updatedAt: new Date(),
          };
        }

        const newConviction = update.convictionDelta
          ? this.addDecimalStrings(current.convictionScore, update.convictionDelta)
          : current.convictionScore;

        const newActivity = update.activityDelta
          ? this.addDecimalStrings(current.activityScore, update.activityDelta)
          : current.activityScore;

        scores.push({
          ...current,
          convictionScore: newConviction,
          activityScore: newActivity,
          updatedAt: new Date(),
        });
      }

      // Batch write to ScyllaDB
      const result = await this.scylla.batchUpdateScores(scores);

      const duration = (Date.now() - startTime) / 1000;
      const status = result.failed === 0 ? 'success' : 'error';
      recordCommand(ctx.communityId, ctx.tier, 'score_batch_update', status, duration);

      this.log.info(
        {
          communityId: ctx.communityId,
          success: result.success,
          failed: result.failed,
        },
        'Batch score update completed'
      );

      return result;
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      recordCommand(ctx.communityId, ctx.tier, 'score_batch_update', 'error', duration);

      this.log.error({ error, communityId: ctx.communityId }, 'Failed to batch update scores');
      throw error;
    }
  }

  /**
   * Update ranks for profiles (after leaderboard recalculation)
   */
  async updateRanks(
    ctx: TenantRequestContext,
    rankUpdates: ScoreRankUpdate[]
  ): Promise<void> {
    const startTime = Date.now();

    try {
      for (const { profileId, newRank } of rankUpdates) {
        const current = await this.scylla.getScore(ctx.communityId, profileId);
        if (current) {
          await this.scylla.updateScore({
            ...current,
            currentRank: newRank,
            updatedAt: new Date(),
          });
        }
      }

      const duration = (Date.now() - startTime) / 1000;
      recordCommand(ctx.communityId, ctx.tier, 'score_rank_update', 'success', duration);

      this.log.debug(
        { communityId: ctx.communityId, count: rankUpdates.length },
        'Ranks updated'
      );
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      recordCommand(ctx.communityId, ctx.tier, 'score_rank_update', 'error', duration);

      this.log.error({ error, communityId: ctx.communityId }, 'Failed to update ranks');
      throw error;
    }
  }

  /**
   * Get score history for a profile
   */
  async getScoreHistory(
    ctx: TenantRequestContext,
    profileId: string,
    days = 30
  ): Promise<ScoreHistoryEntry[]> {
    const startTime = Date.now();

    try {
      const history = await this.scylla.getScoreHistory(ctx.communityId, profileId, days);

      const duration = (Date.now() - startTime) / 1000;
      recordCommand(ctx.communityId, ctx.tier, 'score_history', 'success', duration);

      return history;
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      recordCommand(ctx.communityId, ctx.tier, 'score_history', 'error', duration);

      this.log.error({ error, communityId: ctx.communityId, profileId }, 'Failed to get score history');
      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // Private Helpers
  // --------------------------------------------------------------------------

  private async recordHistory(
    ctx: TenantRequestContext,
    before: Score,
    after: Score,
    update: ScoreUpdate
  ): Promise<void> {
    const today = new Date().toISOString().split('T')[0];

    const entry: ScoreHistoryEntry = {
      communityId: ctx.communityId,
      profileId: update.profileId,
      day: today,
      eventTime: new Date(),
      scoreBefore: before.convictionScore,
      scoreAfter: after.convictionScore,
      delta: update.convictionDelta || '0',
      eventType: update.eventType,
      txHash: update.txHash,
    };

    try {
      await this.scylla.recordScoreHistory(entry);
    } catch (error) {
      // Log but don't fail the main operation
      this.log.warn({ error, entry }, 'Failed to record score history');
    }
  }

  private addDecimalStrings(a: string, b: string): string {
    // Simple decimal string addition
    // For production, consider using a decimal library
    const numA = parseFloat(a) || 0;
    const numB = parseFloat(b) || 0;
    return (numA + numB).toString();
  }
}

// --------------------------------------------------------------------------
// Factory
// --------------------------------------------------------------------------

export function createScoreRepository(
  scyllaClient: ScyllaClient,
  logger: Logger
): ScoreRepository {
  return new ScoreRepository(scyllaClient, logger);
}
