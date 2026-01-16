/**
 * ScyllaDB Shadow Ledger Adapter
 *
 * Sprint S-24: Incumbent Detection & Shadow Ledger
 *
 * Implements IShadowLedger interface using ScyllaDB for high-velocity
 * shadow state tracking and divergence recording.
 *
 * @see SDD §7.1.3 Shadow Ledger Schema
 */

import type { Logger } from 'pino';
import { randomUUID } from 'node:crypto';
import type {
  IShadowLedger,
  DivergenceQueryOptions,
  PredictionQueryOptions,
} from '@arrakis/core/ports';
import type {
  ShadowMemberState,
  ShadowDivergence,
  ShadowPrediction,
  DivergenceType,
  PredictionType,
  IncumbentState,
  ArrakisEligibilityResult,
} from '@arrakis/core/domain';

// =============================================================================
// ScyllaDB Client Interface
// =============================================================================

/**
 * ScyllaDB client interface (minimal subset needed).
 */
export interface IScyllaClient {
  execute(
    query: string,
    params?: unknown[],
    options?: { prepare?: boolean }
  ): Promise<{ rows: Record<string, unknown>[] }>;
  batch(
    queries: Array<{ query: string; params?: unknown[] }>,
    options?: { prepare?: boolean }
  ): Promise<void>;
}

// =============================================================================
// ScyllaDB Shadow Ledger Implementation
// =============================================================================

/**
 * ScyllaDB-backed shadow ledger implementation.
 */
export class ScyllaDBShadowLedger implements IShadowLedger {
  private readonly scylla: IScyllaClient;
  private readonly log: Logger;

  constructor(scylla: IScyllaClient, logger: Logger) {
    this.scylla = scylla;
    this.log = logger.child({ component: 'ScyllaDBShadowLedger' });
  }

  // ===========================================================================
  // Shadow Member State Operations
  // ===========================================================================

  async getMemberState(
    guildId: string,
    userId: string
  ): Promise<ShadowMemberState | null> {
    const result = await this.scylla.execute(
      `SELECT * FROM shadow_member_state WHERE guild_id = ? AND user_id = ?`,
      [guildId, userId],
      { prepare: true }
    );

    if (result.rows.length === 0) return null;

    return this.mapRowToMemberState(result.rows[0]!);
  }

  async getGuildStates(
    guildId: string,
    limit = 1000,
    offset = 0
  ): Promise<ShadowMemberState[]> {
    // Note: ScyllaDB doesn't support OFFSET, using LIMIT only
    // For pagination, use token-based pagination in production
    const result = await this.scylla.execute(
      `SELECT * FROM shadow_member_state WHERE guild_id = ? LIMIT ?`,
      [guildId, limit],
      { prepare: true }
    );

    return result.rows.map((row) => this.mapRowToMemberState(row));
  }

  async getDivergentMembers(guildId: string): Promise<ShadowMemberState[]> {
    const result = await this.scylla.execute(
      `SELECT * FROM shadow_member_state WHERE guild_id = ? AND divergence_flag = true ALLOW FILTERING`,
      [guildId],
      { prepare: true }
    );

    return result.rows.map((row) => this.mapRowToMemberState(row));
  }

  async saveMemberState(state: ShadowMemberState): Promise<ShadowMemberState> {
    await this.scylla.execute(
      `INSERT INTO shadow_member_state
       (guild_id, user_id, incumbent_roles, arrakis_eligible, arrakis_tier,
        conviction_score, divergence_flag, last_sync_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        state.guildId,
        state.userId,
        state.incumbentRoles,
        state.arrakisEligible,
        state.arrakisTier,
        state.convictionScore,
        state.divergenceFlag,
        state.lastSyncAt,
      ],
      { prepare: true }
    );

    return state;
  }

  async saveMemberStates(states: ShadowMemberState[]): Promise<number> {
    if (states.length === 0) return 0;

    const queries = states.map((state) => ({
      query: `INSERT INTO shadow_member_state
              (guild_id, user_id, incumbent_roles, arrakis_eligible, arrakis_tier,
               conviction_score, divergence_flag, last_sync_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        state.guildId,
        state.userId,
        state.incumbentRoles,
        state.arrakisEligible,
        state.arrakisTier,
        state.convictionScore,
        state.divergenceFlag,
        state.lastSyncAt,
      ],
    }));

    await this.scylla.batch(queries, { prepare: true });

    return states.length;
  }

  async deleteMemberState(guildId: string, userId: string): Promise<boolean> {
    await this.scylla.execute(
      `DELETE FROM shadow_member_state WHERE guild_id = ? AND user_id = ?`,
      [guildId, userId],
      { prepare: true }
    );

    return true;
  }

  async deleteGuildStates(guildId: string): Promise<number> {
    // Get count first for return value
    const countResult = await this.scylla.execute(
      `SELECT COUNT(*) as count FROM shadow_member_state WHERE guild_id = ?`,
      [guildId],
      { prepare: true }
    );

    const count = Number(countResult.rows[0]?.count ?? 0);

    // Delete all states for guild
    await this.scylla.execute(
      `DELETE FROM shadow_member_state WHERE guild_id = ?`,
      [guildId],
      { prepare: true }
    );

    return count;
  }

  // ===========================================================================
  // Divergence Recording
  // ===========================================================================

  async recordDivergence(
    guildId: string,
    userId: string,
    incumbentState: IncumbentState,
    arrakisResult: ArrakisEligibilityResult
  ): Promise<ShadowDivergence> {
    const divergenceType: DivergenceType =
      incumbentState.hasRole && !arrakisResult.eligible
        ? 'false_positive'
        : 'false_negative';

    const now = new Date();

    const divergence: ShadowDivergence = {
      guildId,
      userId,
      detectedAt: now,
      incumbentState: JSON.stringify(incumbentState),
      arrakisState: JSON.stringify(arrakisResult),
      divergenceType,
      resolved: false,
      resolvedAt: null,
    };

    await this.scylla.execute(
      `INSERT INTO shadow_divergences
       (guild_id, user_id, detected_at, incumbent_state, arrakis_state,
        divergence_type, resolved, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        guildId,
        userId,
        now,
        divergence.incumbentState,
        divergence.arrakisState,
        divergenceType,
        false,
        null,
      ],
      { prepare: true }
    );

    this.log.debug(
      { guildId, userId, divergenceType },
      'Recorded divergence'
    );

    return divergence;
  }

  async getDivergences(
    options: DivergenceQueryOptions
  ): Promise<ShadowDivergence[]> {
    let query = 'SELECT * FROM shadow_divergences';
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (options.guildId) {
      // Need user_id for partition key, so use ALLOW FILTERING
      conditions.push('guild_id = ?');
      params.push(options.guildId);
    }

    if (options.divergenceType) {
      conditions.push('divergence_type = ?');
      params.push(options.divergenceType);
    }

    if (options.resolved !== undefined) {
      conditions.push('resolved = ?');
      params.push(options.resolved);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
      query += ' ALLOW FILTERING';
    }

    if (options.limit) {
      query += ` LIMIT ${options.limit}`;
    }

    const result = await this.scylla.execute(query, params, { prepare: true });

    return result.rows.map((row) => this.mapRowToDivergence(row));
  }

  async resolveDivergence(
    guildId: string,
    userId: string,
    detectedAt: Date
  ): Promise<ShadowDivergence | null> {
    const now = new Date();

    await this.scylla.execute(
      `UPDATE shadow_divergences
       SET resolved = true, resolved_at = ?
       WHERE guild_id = ? AND user_id = ? AND detected_at = ?`,
      [now, guildId, userId, detectedAt],
      { prepare: true }
    );

    // Fetch updated record
    const result = await this.scylla.execute(
      `SELECT * FROM shadow_divergences
       WHERE guild_id = ? AND user_id = ? AND detected_at = ?`,
      [guildId, userId, detectedAt],
      { prepare: true }
    );

    if (result.rows.length === 0) return null;

    return this.mapRowToDivergence(result.rows[0]!);
  }

  async getDivergenceCounts(
    guildId: string,
    since?: Date
  ): Promise<Record<DivergenceType, number>> {
    let query = `SELECT divergence_type, COUNT(*) as count
                 FROM shadow_divergences
                 WHERE guild_id = ?`;
    const params: unknown[] = [guildId];

    if (since) {
      query += ' AND detected_at >= ?';
      params.push(since);
    }

    query += ' GROUP BY divergence_type ALLOW FILTERING';

    const result = await this.scylla.execute(query, params, { prepare: true });

    const counts: Record<DivergenceType, number> = {
      false_positive: 0,
      false_negative: 0,
    };

    for (const row of result.rows) {
      const type = row.divergence_type as DivergenceType;
      counts[type] = Number(row.count ?? 0);
    }

    return counts;
  }

  // ===========================================================================
  // Prediction Tracking
  // ===========================================================================

  async recordPrediction(
    guildId: string,
    userId: string,
    predictionType: PredictionType,
    predictedValue: string
  ): Promise<ShadowPrediction> {
    const prediction: ShadowPrediction = {
      predictionId: randomUUID(),
      guildId,
      userId,
      predictedAt: new Date(),
      predictionType,
      predictedValue,
      verifiedAt: null,
      actualValue: null,
      correct: null,
    };

    await this.scylla.execute(
      `INSERT INTO shadow_predictions
       (prediction_id, guild_id, user_id, predicted_at, prediction_type,
        predicted_value, verified_at, actual_value, correct)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        prediction.predictionId,
        guildId,
        userId,
        prediction.predictedAt,
        predictionType,
        predictedValue,
        null,
        null,
        null,
      ],
      { prepare: true }
    );

    this.log.debug(
      { guildId, userId, predictionType, predictionId: prediction.predictionId },
      'Recorded prediction'
    );

    return prediction;
  }

  async getPredictions(
    options: PredictionQueryOptions
  ): Promise<ShadowPrediction[]> {
    let query = 'SELECT * FROM shadow_predictions';
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (options.guildId) {
      conditions.push('guild_id = ?');
      params.push(options.guildId);
    }

    if (options.predictionType) {
      conditions.push('prediction_type = ?');
      params.push(options.predictionType);
    }

    if (options.verified !== undefined) {
      if (options.verified) {
        conditions.push('verified_at IS NOT NULL');
      } else {
        conditions.push('verified_at IS NULL');
      }
    }

    if (options.correct !== undefined) {
      conditions.push('correct = ?');
      params.push(options.correct);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
      if (!options.guildId) {
        query += ' ALLOW FILTERING';
      }
    }

    if (options.limit) {
      query += ` LIMIT ${options.limit}`;
    }

    const result = await this.scylla.execute(query, params, { prepare: true });

    return result.rows.map((row) => this.mapRowToPrediction(row));
  }

  async getUnverifiedPredictions(guildId: string): Promise<ShadowPrediction[]> {
    const result = await this.scylla.execute(
      `SELECT * FROM shadow_predictions
       WHERE guild_id = ? AND verified_at IS NULL ALLOW FILTERING`,
      [guildId],
      { prepare: true }
    );

    return result.rows.map((row) => this.mapRowToPrediction(row));
  }

  async verifyPrediction(
    predictionId: string,
    actualValue: string
  ): Promise<ShadowPrediction | null> {
    // First, find the prediction to get its predicted value
    const findResult = await this.scylla.execute(
      `SELECT * FROM shadow_predictions WHERE prediction_id = ? ALLOW FILTERING`,
      [predictionId],
      { prepare: true }
    );

    if (findResult.rows.length === 0) return null;

    const row = findResult.rows[0]!;
    const predictedValue = row.predicted_value as string;
    const correct = predictedValue === actualValue;
    const now = new Date();

    await this.scylla.execute(
      `UPDATE shadow_predictions
       SET verified_at = ?, actual_value = ?, correct = ?
       WHERE guild_id = ? AND prediction_id = ?`,
      [now, actualValue, correct, row.guild_id, predictionId],
      { prepare: true }
    );

    return {
      ...this.mapRowToPrediction(row),
      verifiedAt: now,
      actualValue,
      correct,
    };
  }

  async verifyPredictions(
    verifications: Array<{ predictionId: string; actualValue: string }>
  ): Promise<number> {
    let verified = 0;

    for (const v of verifications) {
      const result = await this.verifyPrediction(v.predictionId, v.actualValue);
      if (result) verified++;
    }

    return verified;
  }

  // ===========================================================================
  // Accuracy Calculation
  // ===========================================================================

  async calculateAccuracy(
    guildId: string,
    since: Date,
    until: Date = new Date()
  ): Promise<number> {
    const result = await this.scylla.execute(
      `SELECT correct FROM shadow_predictions
       WHERE guild_id = ?
         AND predicted_at >= ?
         AND predicted_at <= ?
         AND verified_at IS NOT NULL ALLOW FILTERING`,
      [guildId, since, until],
      { prepare: true }
    );

    if (result.rows.length === 0) return 0;

    const correctCount = result.rows.filter((row) => row.correct === true).length;

    return correctCount / result.rows.length;
  }

  async getAccuracyTrend(
    guildId: string,
    intervalDays: number,
    buckets: number
  ): Promise<Array<{ date: Date; accuracy: number; sampleSize: number }>> {
    const trend: Array<{ date: Date; accuracy: number; sampleSize: number }> = [];
    const now = new Date();

    for (let i = 0; i < buckets; i++) {
      const until = new Date(now.getTime() - i * intervalDays * 24 * 60 * 60 * 1000);
      const since = new Date(until.getTime() - intervalDays * 24 * 60 * 60 * 1000);

      const result = await this.scylla.execute(
        `SELECT correct FROM shadow_predictions
         WHERE guild_id = ?
           AND predicted_at >= ?
           AND predicted_at < ?
           AND verified_at IS NOT NULL ALLOW FILTERING`,
        [guildId, since, until],
        { prepare: true }
      );

      const sampleSize = result.rows.length;
      const correctCount = result.rows.filter((row) => row.correct === true).length;
      const accuracy = sampleSize > 0 ? correctCount / sampleSize : 0;

      trend.unshift({ date: since, accuracy, sampleSize });
    }

    return trend;
  }

  // ===========================================================================
  // Stats & Analytics
  // ===========================================================================

  async getStats(guildId: string): Promise<{
    totalMembers: number;
    divergentMembers: number;
    divergenceRate: number;
    totalPredictions: number;
    verifiedPredictions: number;
    accuracy: number;
    lastSyncAt: Date | null;
  }> {
    // Get member stats
    const memberResult = await this.scylla.execute(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN divergence_flag = true THEN 1 ELSE 0 END) as divergent
       FROM shadow_member_state
       WHERE guild_id = ?`,
      [guildId],
      { prepare: true }
    );

    const totalMembers = Number(memberResult.rows[0]?.total ?? 0);
    const divergentMembers = Number(memberResult.rows[0]?.divergent ?? 0);

    // Get prediction stats
    const predictionResult = await this.scylla.execute(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN verified_at IS NOT NULL THEN 1 ELSE 0 END) as verified,
              SUM(CASE WHEN correct = true THEN 1 ELSE 0 END) as correct
       FROM shadow_predictions
       WHERE guild_id = ?`,
      [guildId],
      { prepare: true }
    );

    const totalPredictions = Number(predictionResult.rows[0]?.total ?? 0);
    const verifiedPredictions = Number(predictionResult.rows[0]?.verified ?? 0);
    const correctPredictions = Number(predictionResult.rows[0]?.correct ?? 0);

    // Get last sync time
    const syncResult = await this.scylla.execute(
      `SELECT MAX(last_sync_at) as last_sync
       FROM shadow_member_state
       WHERE guild_id = ?`,
      [guildId],
      { prepare: true }
    );

    const lastSyncAt = syncResult.rows[0]?.last_sync
      ? new Date(syncResult.rows[0].last_sync as string)
      : null;

    return {
      totalMembers,
      divergentMembers,
      divergenceRate: totalMembers > 0 ? divergentMembers / totalMembers : 0,
      totalPredictions,
      verifiedPredictions,
      accuracy: verifiedPredictions > 0 ? correctPredictions / verifiedPredictions : 0,
      lastSyncAt,
    };
  }

  // ===========================================================================
  // Row Mapping Helpers
  // ===========================================================================

  private mapRowToMemberState(row: Record<string, unknown>): ShadowMemberState {
    return {
      guildId: row.guild_id as string,
      userId: row.user_id as string,
      incumbentRoles: new Set(row.incumbent_roles as string[] ?? []),
      arrakisEligible: row.arrakis_eligible as boolean,
      arrakisTier: row.arrakis_tier as string | null,
      convictionScore: row.conviction_score as number | null,
      divergenceFlag: row.divergence_flag as boolean,
      lastSyncAt: new Date(row.last_sync_at as string),
    };
  }

  private mapRowToDivergence(row: Record<string, unknown>): ShadowDivergence {
    return {
      guildId: row.guild_id as string,
      userId: row.user_id as string,
      detectedAt: new Date(row.detected_at as string),
      incumbentState: row.incumbent_state as string,
      arrakisState: row.arrakis_state as string,
      divergenceType: row.divergence_type as DivergenceType,
      resolved: row.resolved as boolean,
      resolvedAt: row.resolved_at ? new Date(row.resolved_at as string) : null,
    };
  }

  private mapRowToPrediction(row: Record<string, unknown>): ShadowPrediction {
    return {
      predictionId: row.prediction_id as string,
      guildId: row.guild_id as string,
      userId: row.user_id as string,
      predictedAt: new Date(row.predicted_at as string),
      predictionType: row.prediction_type as PredictionType,
      predictedValue: row.predicted_value as string,
      verifiedAt: row.verified_at ? new Date(row.verified_at as string) : null,
      actualValue: row.actual_value as string | null,
      correct: row.correct as boolean | null,
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a ScyllaDB Shadow Ledger instance.
 */
export function createScyllaDBShadowLedger(
  scylla: IScyllaClient,
  logger: Logger
): ScyllaDBShadowLedger {
  return new ScyllaDBShadowLedger(scylla, logger);
}
