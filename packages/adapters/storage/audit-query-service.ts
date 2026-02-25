/**
 * AuditQueryService — Read-only query interface for audit trail analytics (cycle-043 Phase II)
 *
 * Provides time-bounded, partition-aware queries for model performance analysis
 * without compromising audit chain integrity. All queries include created_at
 * bounds to enable PostgreSQL partition pruning.
 *
 * SDD ref: Post-convergence Comment 3, Speculation 2
 * Sprint: 364, Task 3.1
 */

import type { Pool } from 'pg';
import type { Logger } from 'pino';
import type { InteractionHistoryProvider, InteractionRecord } from '../../../themes/sietch/src/packages/core/protocol/capability-mesh.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TimeRange {
  from: Date;
  to: Date;
}

export interface AuditEntry {
  entry_id: string;
  entry_hash: string;
  event_type: string;
  actor_id: string;
  domain_tag: string;
  payload: Record<string, unknown>;
  event_time: Date;
}

export interface ModelPerformanceRecord {
  model_id: string;
  quality_score: number;
  dimensions: Record<string, number>;
  latency_ms: number;
  pool_id: string;
  task_type: string;
  delegation_id?: string;
  event_time: Date;
  entry_hash: string;
}

export interface QualityDistribution {
  model_id: string;
  buckets: { range_start: number; range_end: number; count: number }[];
  total_observations: number;
  mean_score: number;
  median_score: number;
}

export interface DomainActivitySummary {
  domain_tag: string;
  entry_count: number;
  first_entry: Date;
  last_entry: Date;
  distinct_actors: number;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class AuditQueryService {
  constructor(
    private readonly pool: Pool,
    private readonly log: Logger,
  ) {}

  /** Escape LIKE metacharacters (%, _, \) for safe pattern matching */
  private escapeLike(input: string): string {
    return input.replace(/[\\%_]/g, '\\$&');
  }

  // ── Time-bounded queries ─────────────────────────────────────────────────

  async queryByDomainTag(tag: string, timeRange: TimeRange): Promise<AuditEntry[]> {
    const result = await this.pool.query(
      `SELECT entry_id, entry_hash, event_type, actor_id, domain_tag, payload, event_time
       FROM audit_trail
       WHERE domain_tag = $1
         AND event_time >= $2 AND event_time < $3
       ORDER BY event_time ASC`,
      [tag, timeRange.from, timeRange.to],
    );
    return result.rows;
  }

  async queryByEventType(eventType: string, timeRange: TimeRange): Promise<AuditEntry[]> {
    const result = await this.pool.query(
      `SELECT entry_id, entry_hash, event_type, actor_id, domain_tag, payload, event_time
       FROM audit_trail
       WHERE event_type = $1
         AND event_time >= $2 AND event_time < $3
       ORDER BY event_time ASC`,
      [eventType, timeRange.from, timeRange.to],
    );
    return result.rows;
  }

  async queryByActorId(actorId: string, timeRange: TimeRange): Promise<AuditEntry[]> {
    const result = await this.pool.query(
      `SELECT entry_id, entry_hash, event_type, actor_id, domain_tag, payload, event_time
       FROM audit_trail
       WHERE actor_id = $1
         AND event_time >= $2 AND event_time < $3
       ORDER BY event_time ASC`,
      [actorId, timeRange.from, timeRange.to],
    );
    return result.rows;
  }

  // ── Model performance queries ────────────────────────────────────────────

  async getModelPerformanceHistory(
    modelId: string,
    timeRange: TimeRange,
  ): Promise<ModelPerformanceRecord[]> {
    const result = await this.pool.query(
      `SELECT entry_hash, payload, event_time
       FROM audit_trail
       WHERE event_type = 'model_performance'
         AND payload->>'model_id' = $1
         AND event_time >= $2 AND event_time < $3
       ORDER BY event_time ASC`,
      [modelId, timeRange.from, timeRange.to],
    );

    return result.rows.map((row: any) => ({
      model_id: modelId,
      quality_score: row.payload?.quality_observation?.score ?? 0,
      dimensions: row.payload?.quality_observation?.dimensions ?? {},
      latency_ms: row.payload?.latency_ms ?? 0,
      pool_id: row.payload?.request_context?.pool_id ?? '',
      task_type: row.payload?.request_context?.task_type ?? '',
      delegation_id: row.payload?.request_context?.delegation_id,
      event_time: row.event_time,
      entry_hash: row.entry_hash,
    }));
  }

  async getModelPairInteractions(
    modelA: string,
    modelB: string,
    timeRange: TimeRange,
  ): Promise<InteractionRecord[]> {
    // Query delegation chains that include both models
    const result = await this.pool.query(
      `SELECT payload, event_time
       FROM audit_trail
       WHERE event_type = 'model_performance'
         AND event_time >= $1 AND event_time < $2
         AND (
           payload->>'model_id' = $3
           OR payload->'request_context'->>'delegation_id' LIKE $4 ESCAPE '\\'
           OR payload->'request_context'->>'delegation_id' LIKE $5 ESCAPE '\\'
         )
       ORDER BY event_time ASC`,
      [timeRange.from, timeRange.to, modelA, `%${this.escapeLike(modelA)}%`, `%${this.escapeLike(modelB)}%`],
    );

    // Aggregate interactions between the pair
    let totalObservations = 0;
    let totalScore = 0;

    for (const row of result.rows) {
      const payload = row.payload as Record<string, any>;
      const delegationId = payload?.request_context?.delegation_id ?? '';
      const rowModelId = payload?.model_id ?? '';

      // Check if this entry involves both models
      const involvesBoth =
        (rowModelId === modelA && delegationId.includes(modelB)) ||
        (rowModelId === modelB && delegationId.includes(modelA));

      if (involvesBoth) {
        totalObservations++;
        totalScore += payload?.quality_observation?.score ?? 0;
      }
    }

    if (totalObservations === 0) {
      return [];
    }

    const [a, b] = [modelA, modelB].sort();
    return [{
      model_pair: [a, b] as [string, string],
      quality_score: totalScore / totalObservations,
      observation_count: totalObservations,
    }];
  }

  // ── Aggregate queries ────────────────────────────────────────────────────

  async getQualityDistribution(
    modelId: string,
    timeRange: TimeRange,
  ): Promise<QualityDistribution> {
    const result = await this.pool.query(
      `SELECT
         payload->'quality_observation'->>'score' AS score
       FROM audit_trail
       WHERE event_type = 'model_performance'
         AND payload->>'model_id' = $1
         AND event_time >= $2 AND event_time < $3
       ORDER BY event_time ASC`,
      [modelId, timeRange.from, timeRange.to],
    );

    const scores = result.rows
      .map((r: any) => parseFloat(r.score))
      .filter((s: number) => Number.isFinite(s));

    if (scores.length === 0) {
      return {
        model_id: modelId,
        buckets: [],
        total_observations: 0,
        mean_score: 0,
        median_score: 0,
      };
    }

    // Build 10 buckets from 0.0 to 1.0
    const buckets = Array.from({ length: 10 }, (_, i) => ({
      range_start: i * 0.1,
      range_end: (i + 1) * 0.1,
      count: 0,
    }));

    for (const score of scores) {
      const idx = Math.min(Math.floor(score * 10), 9);
      buckets[idx].count++;
    }

    const mean = scores.reduce((a: number, b: number) => a + b, 0) / scores.length;
    const sorted = [...scores].sort((a, b) => a - b);
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];

    return {
      model_id: modelId,
      buckets,
      total_observations: scores.length,
      mean_score: mean,
      median_score: median,
    };
  }

  async getDomainTagActivity(timeRange: TimeRange): Promise<DomainActivitySummary[]> {
    const result = await this.pool.query(
      `SELECT
         domain_tag,
         COUNT(*) AS entry_count,
         MIN(event_time) AS first_entry,
         MAX(event_time) AS last_entry,
         COUNT(DISTINCT actor_id) AS distinct_actors
       FROM audit_trail
       WHERE event_time >= $1 AND event_time < $2
       GROUP BY domain_tag
       ORDER BY entry_count DESC`,
      [timeRange.from, timeRange.to],
    );

    return result.rows.map((row: any) => ({
      domain_tag: row.domain_tag,
      entry_count: parseInt(row.entry_count, 10),
      first_entry: row.first_entry,
      last_entry: row.last_entry,
      distinct_actors: parseInt(row.distinct_actors, 10),
    }));
  }
}

// ─── AuditBackedInteractionHistoryProvider ────────────────────────────────────

/**
 * Wires AuditQueryService.getModelPairInteractions() into the
 * InteractionHistoryProvider interface (from Task 2.2).
 *
 * Completes the follow-up integration for MeshResolver:
 * Sprint 2 used InMemoryInteractionHistoryProvider; this provides
 * persistent interaction history backed by the audit trail.
 */
export class AuditBackedInteractionHistoryProvider implements InteractionHistoryProvider {
  constructor(
    private readonly queryService: AuditQueryService,
    private readonly defaultTimeRange: TimeRange,
  ) {}

  async getInteractions(modelA: string, modelB: string): Promise<InteractionRecord[]> {
    return this.queryService.getModelPairInteractions(modelA, modelB, this.defaultTimeRange);
  }
}
