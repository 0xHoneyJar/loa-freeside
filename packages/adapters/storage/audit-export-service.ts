/**
 * AuditExportService — Streaming causal dataset export (cycle-043 Phase II)
 *
 * Produces training-ready JSON Lines datasets from the audit trail.
 * Each record is a state/action/reward/provenance tuple suitable for
 * offline reinforcement learning pipelines.
 *
 * SDD ref: Post-convergence Comment 3, Speculation 2
 * Sprint: 364, Task 3.2
 */

import type { Pool } from 'pg';
import type { Logger } from 'pino';
import type { TimeRange } from './audit-query-service.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExportConfig {
  timeRange: TimeRange;
  domainTags?: string[];
  eventTypes?: string[];
  format: 'jsonl';
  includeProvenance: boolean;
}

export interface CausalRecord {
  state: {
    reputation_state: string;
    capabilities: string[];
    pool_id: string;
    task_type: string;
  };
  action: {
    model_id: string;
    delegation_chain: string[];
    ensemble_strategy: string;
  };
  reward: {
    quality_score: number;
    dimensions: Record<string, number>;
    latency_ms: number;
  };
  provenance?: {
    entry_hash: string;
    event_time: string;
  };
}

export interface ExportStats {
  row_count: number;
  time_range: TimeRange;
  unique_models: string[];
  unique_task_types: string[];
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class AuditExportService {
  constructor(
    private readonly pool: Pool,
    private readonly log: Logger,
  ) {}

  /**
   * Stream audit records as JSON Lines. Uses a cursor to bound memory
   * regardless of time range size.
   */
  async *exportToStream(config: ExportConfig): AsyncGenerator<string> {
    const { query, params } = this.buildExportQuery(config);
    const batchSize = 500;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DECLARE export_cursor CURSOR FOR ${query}`,
        params,
      );

      let fetched: number;
      do {
        const result = await client.query(
          `FETCH ${batchSize} FROM export_cursor`,
        );
        fetched = result.rows.length;

        for (const row of result.rows) {
          const record = this.mapToCausalRecord(row, config.includeProvenance);
          yield JSON.stringify(record) + '\n';
        }
      } while (fetched === batchSize);

      await client.query('CLOSE export_cursor');
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Return aggregate stats without loading full data.
   */
  async exportStats(config: ExportConfig): Promise<ExportStats> {
    const { whereClause, params } = this.buildWhereClause(config);

    const result = await this.pool.query(
      `SELECT
         COUNT(*) AS row_count,
         MIN(event_time) AS min_time,
         MAX(event_time) AS max_time,
         array_agg(DISTINCT payload->>'model_id') FILTER (WHERE payload->>'model_id' IS NOT NULL) AS unique_models,
         array_agg(DISTINCT payload->'request_context'->>'task_type') FILTER (WHERE payload->'request_context'->>'task_type' IS NOT NULL) AS unique_task_types
       FROM audit_trail
       WHERE ${whereClause}`,
      params,
    );

    const row = result.rows[0];
    return {
      row_count: parseInt(row.row_count, 10),
      time_range: config.timeRange,
      unique_models: row.unique_models ?? [],
      unique_task_types: row.unique_task_types ?? [],
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private buildWhereClause(config: ExportConfig): { whereClause: string; params: unknown[] } {
    const conditions: string[] = ['event_time >= $1 AND event_time < $2'];
    const params: unknown[] = [config.timeRange.from, config.timeRange.to];

    if (config.domainTags && config.domainTags.length > 0) {
      params.push(config.domainTags);
      conditions.push(`domain_tag = ANY($${params.length})`);
    }

    if (config.eventTypes && config.eventTypes.length > 0) {
      params.push(config.eventTypes);
      conditions.push(`event_type = ANY($${params.length})`);
    }

    return { whereClause: conditions.join(' AND '), params };
  }

  private buildExportQuery(config: ExportConfig): { query: string; params: unknown[] } {
    const { whereClause, params } = this.buildWhereClause(config);

    const query = `
      SELECT entry_hash, payload, event_time
      FROM audit_trail
      WHERE ${whereClause}
      ORDER BY event_time ASC`;

    return { query, params };
  }

  private mapToCausalRecord(row: any, includeProvenance: boolean): CausalRecord {
    const payload = row.payload ?? {};
    const reqCtx = payload.request_context ?? {};
    const qualObs = payload.quality_observation ?? {};

    const record: CausalRecord = {
      state: {
        reputation_state: reqCtx.reputation_state ?? 'unknown',
        capabilities: reqCtx.capabilities ?? [],
        pool_id: reqCtx.pool_id ?? '',
        task_type: reqCtx.task_type ?? '',
      },
      action: {
        model_id: payload.model_id ?? '',
        delegation_chain: reqCtx.delegation_chain ?? [],
        ensemble_strategy: reqCtx.ensemble_strategy ?? '',
      },
      reward: {
        quality_score: qualObs.score ?? 0,
        dimensions: qualObs.dimensions ?? {},
        latency_ms: payload.latency_ms ?? 0,
      },
    };

    if (includeProvenance) {
      record.provenance = {
        entry_hash: row.entry_hash ?? '',
        event_time: row.event_time instanceof Date
          ? row.event_time.toISOString()
          : String(row.event_time ?? ''),
      };
    }

    return record;
  }
}
