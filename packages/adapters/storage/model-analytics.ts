/**
 * ModelAnalytics — Dashboard query functions (cycle-043 Phase II)
 *
 * High-level analytical functions for model performance visualization.
 * Powers the operational dashboard for understanding model behavior over time.
 *
 * SDD ref: Post-convergence Comment 2 §IV (Bayesian routing signal)
 * Sprint: 364, Task 3.3
 */

import type { Pool } from 'pg';
import type { Logger } from 'pino';
import type { TimeRange } from './audit-query-service.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type Granularity = 'hour' | 'day' | 'week';

export interface ScoreTrendPoint {
  bucket: Date;
  avg_score: number;
  observation_count: number;
}

export interface ModelComparison {
  model_id: string;
  avg_quality_score: number;
  total_observations: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
}

export interface TaskTypeBreakdown {
  task_type: string;
  observation_count: number;
  avg_score: number;
}

export interface AggregateRatio {
  aggregate: number;
  taskSpecific: number;
}

// ─── Allowed granularity values (whitelist for SQL injection prevention) ─────

const ALLOWED_GRANULARITIES: ReadonlySet<string> = new Set(['hour', 'day', 'week']);

// ─── Service ─────────────────────────────────────────────────────────────────

export class ModelAnalytics {
  constructor(
    private readonly pool: Pool,
    private readonly log: Logger,
  ) {}

  /**
   * Score trend over time for a model (time-series chart).
   * Uses date_trunc() for PostgreSQL-native time bucketing.
   */
  async getScoreTrend(
    modelId: string,
    granularity: Granularity,
    timeRange: TimeRange,
  ): Promise<ScoreTrendPoint[]> {
    if (!ALLOWED_GRANULARITIES.has(granularity)) {
      throw new Error(`Invalid granularity: ${granularity}. Must be one of: hour, day, week`);
    }

    const result = await this.pool.query(
      `SELECT
         date_trunc($1, event_time) AS bucket,
         AVG((payload->'quality_observation'->>'score')::numeric) AS avg_score,
         COUNT(*) AS observation_count
       FROM audit_trail
       WHERE event_type = 'model_performance'
         AND payload->>'model_id' = $2
         AND event_time >= $3 AND event_time < $4
       GROUP BY bucket
       ORDER BY bucket ASC`,
      [granularity, modelId, timeRange.from, timeRange.to],
    );

    return result.rows.map((row: any) => ({
      bucket: row.bucket,
      avg_score: parseFloat(row.avg_score) || 0,
      observation_count: parseInt(row.observation_count, 10),
    }));
  }

  /**
   * Compare multiple models side-by-side (bar chart / heatmap).
   */
  async compareModels(
    modelIds: string[],
    timeRange: TimeRange,
  ): Promise<ModelComparison[]> {
    if (modelIds.length === 0) {
      return [];
    }

    const result = await this.pool.query(
      `SELECT
         payload->>'model_id' AS model_id,
         AVG((payload->'quality_observation'->>'score')::numeric) AS avg_quality_score,
         COUNT(*) AS total_observations,
         AVG((payload->>'latency_ms')::numeric) AS avg_latency_ms,
         PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY (payload->>'latency_ms')::numeric) AS p95_latency_ms
       FROM audit_trail
       WHERE event_type = 'model_performance'
         AND payload->>'model_id' = ANY($1)
         AND event_time >= $2 AND event_time < $3
       GROUP BY payload->>'model_id'
       ORDER BY avg_quality_score DESC`,
      [modelIds, timeRange.from, timeRange.to],
    );

    return result.rows.map((row: any) => ({
      model_id: row.model_id,
      avg_quality_score: parseFloat(row.avg_quality_score) || 0,
      total_observations: parseInt(row.total_observations, 10),
      avg_latency_ms: parseFloat(row.avg_latency_ms) || 0,
      p95_latency_ms: parseFloat(row.p95_latency_ms) || 0,
    }));
  }

  /**
   * Task-type breakdown for a model (pie chart).
   */
  async getTaskTypeBreakdown(
    modelId: string,
    timeRange: TimeRange,
  ): Promise<TaskTypeBreakdown[]> {
    const result = await this.pool.query(
      `SELECT
         COALESCE(payload->'request_context'->>'task_type', 'unspecified') AS task_type,
         COUNT(*) AS observation_count,
         AVG((payload->'quality_observation'->>'score')::numeric) AS avg_score
       FROM audit_trail
       WHERE event_type = 'model_performance'
         AND payload->>'model_id' = $1
         AND event_time >= $2 AND event_time < $3
       GROUP BY task_type
       ORDER BY observation_count DESC`,
      [modelId, timeRange.from, timeRange.to],
    );

    return result.rows.map((row: any) => ({
      task_type: row.task_type,
      observation_count: parseInt(row.observation_count, 10),
      avg_score: parseFloat(row.avg_score) || 0,
    }));
  }

  /**
   * Ratio of aggregate (unspecified) vs task-specific observations.
   */
  async getAggregateRatio(
    modelId: string,
    timeRange: TimeRange,
  ): Promise<AggregateRatio> {
    const result = await this.pool.query(
      `SELECT
         COUNT(*) FILTER (
           WHERE payload->'request_context'->>'task_type' IS NULL
              OR payload->'request_context'->>'task_type' = ''
         ) AS aggregate_count,
         COUNT(*) FILTER (
           WHERE payload->'request_context'->>'task_type' IS NOT NULL
             AND payload->'request_context'->>'task_type' != ''
         ) AS task_specific_count
       FROM audit_trail
       WHERE event_type = 'model_performance'
         AND payload->>'model_id' = $1
         AND event_time >= $2 AND event_time < $3`,
      [modelId, timeRange.from, timeRange.to],
    );

    const row = result.rows[0];
    return {
      aggregate: parseInt(row.aggregate_count, 10),
      taskSpecific: parseInt(row.task_specific_count, 10),
    };
  }
}
