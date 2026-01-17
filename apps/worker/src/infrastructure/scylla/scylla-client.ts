/**
 * ScyllaDB Client
 * Sprint S-3: ScyllaDB & Observability Foundation
 *
 * TypeScript client for ScyllaDB operations per SDD §6.4
 */

import { Client, auth, types, mapping } from 'cassandra-driver';
import type { Logger } from 'pino';
import type {
  ScyllaConfig,
  Score,
  ScoreHistoryEntry,
  LeaderboardEntry,
  EligibilitySnapshot,
  PaginatedResult,
  BatchResult,
  LeaderboardType,
  ScoreEventType,
} from './types.js';
import { DEFAULT_SCYLLA_CONFIG } from './types.js';
import { ScyllaMetrics } from './metrics.js';

/**
 * ScyllaDB Client for high-velocity data operations
 */
export class ScyllaClient {
  private client: Client;
  private readonly log: Logger;
  private readonly metrics: ScyllaMetrics;
  private readonly keyspace: string;
  private connected = false;

  constructor(config: ScyllaConfig, logger: Logger) {
    this.log = logger.child({ component: 'ScyllaClient' });
    this.metrics = new ScyllaMetrics();
    this.keyspace = config.keyspace;

    const mergedConfig = { ...DEFAULT_SCYLLA_CONFIG, ...config };

    // Build client options
    const clientOptions: ConstructorParameters<typeof Client>[0] = {
      keyspace: mergedConfig.keyspace,
      localDataCenter: mergedConfig.localDataCenter,
      authProvider: new auth.PlainTextAuthProvider(
        mergedConfig.username,
        mergedConfig.password,
      ),
      pooling: {
        coreConnectionsPerHost: {
          [types.distance.local]: mergedConfig.poolSize || 4,
          [types.distance.remote]: 1,
        },
      },
      queryOptions: {
        consistency: types.consistencies.localQuorum,
        prepare: true,
      },
      socketOptions: {
        readTimeout: mergedConfig.requestTimeout || 10000,
      },
    };

    // Use cloud bundle or contact points
    if (mergedConfig.bundlePath) {
      clientOptions.cloud = { secureConnectBundle: mergedConfig.bundlePath };
    } else if (mergedConfig.contactPoints) {
      clientOptions.contactPoints = mergedConfig.contactPoints;
    }

    this.client = new Client(clientOptions);

    this.log.info(
      { keyspace: mergedConfig.keyspace },
      'ScyllaDB client initialized',
    );
  }

  /**
   * Connect to ScyllaDB cluster
   */
  async connect(): Promise<void> {
    const startTime = Date.now();

    try {
      await this.client.connect();
      this.connected = true;
      this.metrics.recordConnection(true);
      this.log.info(
        { durationMs: Date.now() - startTime },
        'Connected to ScyllaDB',
      );
    } catch (error) {
      this.metrics.recordConnection(false);
      this.log.error({ error }, 'Failed to connect to ScyllaDB');
      throw error;
    }
  }

  /**
   * Check if client is connected and healthy
   */
  async isHealthy(): Promise<boolean> {
    if (!this.connected) return false;

    try {
      await this.client.execute('SELECT now() FROM system.local');
      return true;
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // SCORES OPERATIONS
  // ===========================================================================

  /**
   * Get score for a specific profile
   */
  async getScore(communityId: string, profileId: string): Promise<Score | null> {
    const startTime = Date.now();

    try {
      const result = await this.client.execute(
        'SELECT * FROM scores_by_profile WHERE community_id = ? AND profile_id = ?',
        [communityId, profileId],
        { prepare: true },
      );

      this.metrics.recordQuery('getScore', Date.now() - startTime, true);

      if (result.rowLength === 0) return null;

      const row = result.first();
      return this.mapRowToScore(row);
    } catch (error) {
      this.metrics.recordQuery('getScore', Date.now() - startTime, false);
      this.log.error({ error, communityId, profileId }, 'Failed to get score');
      throw error;
    }
  }

  /**
   * Update score for a profile (writes to both tables)
   */
  async updateScore(score: Score): Promise<void> {
    const startTime = Date.now();

    const queries = [
      {
        query: `INSERT INTO scores (community_id, profile_id, conviction_score, activity_score, current_rank, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)`,
        params: [
          score.communityId,
          score.profileId,
          score.convictionScore,
          score.activityScore,
          score.currentRank,
          score.updatedAt,
        ],
      },
      {
        query: `INSERT INTO scores_by_profile (community_id, profile_id, conviction_score, activity_score, current_rank, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)`,
        params: [
          score.communityId,
          score.profileId,
          score.convictionScore,
          score.activityScore,
          score.currentRank,
          score.updatedAt,
        ],
      },
    ];

    try {
      await this.client.batch(queries, { prepare: true });
      this.metrics.recordQuery('updateScore', Date.now() - startTime, true);
      this.log.debug({ communityId: score.communityId, profileId: score.profileId }, 'Score updated');
    } catch (error) {
      this.metrics.recordQuery('updateScore', Date.now() - startTime, false);
      this.log.error({ error, score }, 'Failed to update score');
      throw error;
    }
  }

  /**
   * Batch update scores (for bulk operations)
   */
  async batchUpdateScores(scores: Score[]): Promise<BatchResult> {
    const startTime = Date.now();
    const result: BatchResult = { success: 0, failed: 0, errors: [] };

    // Process in batches of 50 (ScyllaDB batch limit consideration)
    const batchSize = 50;

    for (let i = 0; i < scores.length; i += batchSize) {
      const batch = scores.slice(i, i + batchSize);
      const queries = batch.flatMap((score) => [
        {
          query: `INSERT INTO scores (community_id, profile_id, conviction_score, activity_score, current_rank, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?)`,
          params: [
            score.communityId,
            score.profileId,
            score.convictionScore,
            score.activityScore,
            score.currentRank,
            score.updatedAt,
          ],
        },
        {
          query: `INSERT INTO scores_by_profile (community_id, profile_id, conviction_score, activity_score, current_rank, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?)`,
          params: [
            score.communityId,
            score.profileId,
            score.convictionScore,
            score.activityScore,
            score.currentRank,
            score.updatedAt,
          ],
        },
      ]);

      try {
        await this.client.batch(queries, { prepare: true });
        result.success += batch.length;
      } catch (error) {
        result.failed += batch.length;
        result.errors.push(error as Error);
      }
    }

    this.metrics.recordQuery('batchUpdateScores', Date.now() - startTime, result.failed === 0);
    return result;
  }

  // ===========================================================================
  // LEADERBOARD OPERATIONS
  // ===========================================================================

  /**
   * Get leaderboard page
   */
  async getLeaderboard(
    communityId: string,
    type: LeaderboardType,
    page = 0,
    pageSize = 100,
  ): Promise<PaginatedResult<LeaderboardEntry>> {
    const startTime = Date.now();
    const bucket = Math.floor(page * pageSize / 100) * 100;

    try {
      const result = await this.client.execute(
        `SELECT * FROM leaderboards
         WHERE community_id = ? AND leaderboard_type = ? AND bucket = ?
         ORDER BY rank ASC
         LIMIT ?`,
        [communityId, type, bucket, pageSize],
        { prepare: true },
      );

      this.metrics.recordQuery('getLeaderboard', Date.now() - startTime, true);

      const data = result.rows.map((row) => this.mapRowToLeaderboardEntry(row));

      return {
        data,
        hasMore: result.rowLength === pageSize,
      };
    } catch (error) {
      this.metrics.recordQuery('getLeaderboard', Date.now() - startTime, false);
      this.log.error({ error, communityId, type }, 'Failed to get leaderboard');
      throw error;
    }
  }

  /**
   * Update leaderboard entry
   */
  async updateLeaderboardEntry(entry: LeaderboardEntry): Promise<void> {
    const startTime = Date.now();

    try {
      await this.client.execute(
        `INSERT INTO leaderboards
         (community_id, leaderboard_type, bucket, rank, profile_id, display_name, score, tier, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.communityId,
          entry.leaderboardType,
          entry.bucket,
          entry.rank,
          entry.profileId,
          entry.displayName,
          entry.score,
          entry.tier,
          entry.updatedAt,
        ],
        { prepare: true },
      );

      this.metrics.recordQuery('updateLeaderboardEntry', Date.now() - startTime, true);
    } catch (error) {
      this.metrics.recordQuery('updateLeaderboardEntry', Date.now() - startTime, false);
      throw error;
    }
  }

  // ===========================================================================
  // SCORE HISTORY OPERATIONS
  // ===========================================================================

  /**
   * Record score history entry
   */
  async recordScoreHistory(entry: ScoreHistoryEntry): Promise<void> {
    const startTime = Date.now();

    try {
      await this.client.execute(
        `INSERT INTO score_history
         (community_id, profile_id, day, event_time, score_before, score_after, delta, event_type, tx_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.communityId,
          entry.profileId,
          entry.day,
          entry.eventTime,
          entry.scoreBefore,
          entry.scoreAfter,
          entry.delta,
          entry.eventType,
          entry.txHash || null,
        ],
        { prepare: true },
      );

      this.metrics.recordQuery('recordScoreHistory', Date.now() - startTime, true);
    } catch (error) {
      this.metrics.recordQuery('recordScoreHistory', Date.now() - startTime, false);
      throw error;
    }
  }

  /**
   * Get score history for a profile
   */
  async getScoreHistory(
    communityId: string,
    profileId: string,
    days = 30,
  ): Promise<ScoreHistoryEntry[]> {
    const startTime = Date.now();
    const entries: ScoreHistoryEntry[] = [];

    // Query each day partition
    const today = new Date();
    for (let i = 0; i < days; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dayStr = date.toISOString().split('T')[0];

      try {
        const result = await this.client.execute(
          `SELECT * FROM score_history
           WHERE community_id = ? AND profile_id = ? AND day = ?
           ORDER BY event_time DESC`,
          [communityId, profileId, dayStr],
          { prepare: true },
        );

        for (const row of result.rows) {
          entries.push(this.mapRowToScoreHistory(row));
        }
      } catch {
        // Partition may not exist, continue
      }
    }

    this.metrics.recordQuery('getScoreHistory', Date.now() - startTime, true);
    return entries;
  }

  // ===========================================================================
  // ELIGIBILITY SNAPSHOT OPERATIONS
  // ===========================================================================

  /**
   * Get cached eligibility snapshot
   */
  async getEligibilitySnapshot(
    communityId: string,
    profileId: string,
    ruleId: string,
  ): Promise<EligibilitySnapshot | null> {
    const startTime = Date.now();

    try {
      const result = await this.client.execute(
        `SELECT * FROM eligibility_snapshots
         WHERE community_id = ? AND profile_id = ? AND rule_id = ?`,
        [communityId, profileId, ruleId],
        { prepare: true },
      );

      this.metrics.recordQuery('getEligibilitySnapshot', Date.now() - startTime, true);

      if (result.rowLength === 0) {
        this.metrics.recordCacheMiss();
        return null;
      }

      this.metrics.recordCacheHit();
      return this.mapRowToEligibilitySnapshot(result.first());
    } catch (error) {
      this.metrics.recordQuery('getEligibilitySnapshot', Date.now() - startTime, false);
      throw error;
    }
  }

  /**
   * Save eligibility snapshot (with 5min TTL)
   */
  async saveEligibilitySnapshot(snapshot: EligibilitySnapshot): Promise<void> {
    const startTime = Date.now();

    try {
      await this.client.execute(
        `INSERT INTO eligibility_snapshots
         (community_id, profile_id, wallet_address, rule_id, is_eligible, token_balance, checked_at, block_number)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          snapshot.communityId,
          snapshot.profileId,
          snapshot.walletAddress,
          snapshot.ruleId,
          snapshot.isEligible,
          snapshot.tokenBalance,
          snapshot.checkedAt,
          snapshot.blockNumber,
        ],
        { prepare: true },
      );

      this.metrics.recordQuery('saveEligibilitySnapshot', Date.now() - startTime, true);
    } catch (error) {
      this.metrics.recordQuery('saveEligibilitySnapshot', Date.now() - startTime, false);
      throw error;
    }
  }

  // ===========================================================================
  // METRICS & LIFECYCLE
  // ===========================================================================

  /**
   * Get metrics for monitoring
   */
  getMetrics(): ScyllaMetrics {
    return this.metrics;
  }

  /**
   * Close connection
   */
  async close(): Promise<void> {
    await this.client.shutdown();
    this.connected = false;
    this.log.info('ScyllaDB connection closed');
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private mapRowToScore(row: types.Row): Score {
    return {
      communityId: row.get('community_id').toString(),
      profileId: row.get('profile_id').toString(),
      convictionScore: row.get('conviction_score')?.toString() || '0',
      activityScore: row.get('activity_score')?.toString() || '0',
      currentRank: row.get('current_rank') || 0,
      updatedAt: row.get('updated_at') || new Date(),
    };
  }

  private mapRowToLeaderboardEntry(row: types.Row): LeaderboardEntry {
    return {
      communityId: row.get('community_id').toString(),
      leaderboardType: row.get('leaderboard_type'),
      bucket: row.get('bucket'),
      rank: row.get('rank'),
      profileId: row.get('profile_id').toString(),
      displayName: row.get('display_name'),
      score: row.get('score')?.toString() || '0',
      tier: row.get('tier'),
      updatedAt: row.get('updated_at') || new Date(),
    };
  }

  private mapRowToScoreHistory(row: types.Row): ScoreHistoryEntry {
    return {
      communityId: row.get('community_id').toString(),
      profileId: row.get('profile_id').toString(),
      day: row.get('day').toString(),
      eventTime: row.get('event_time'),
      scoreBefore: row.get('score_before')?.toString() || '0',
      scoreAfter: row.get('score_after')?.toString() || '0',
      delta: row.get('delta')?.toString() || '0',
      eventType: row.get('event_type'),
      txHash: row.get('tx_hash'),
    };
  }

  private mapRowToEligibilitySnapshot(row: types.Row): EligibilitySnapshot {
    return {
      communityId: row.get('community_id').toString(),
      profileId: row.get('profile_id').toString(),
      walletAddress: row.get('wallet_address'),
      ruleId: row.get('rule_id').toString(),
      isEligible: row.get('is_eligible'),
      tokenBalance: row.get('token_balance') || '0',
      checkedAt: row.get('checked_at'),
      blockNumber: BigInt(row.get('block_number')?.toString() || '0'),
    };
  }
}
