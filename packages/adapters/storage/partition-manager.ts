/**
 * Partition Manager — Audit trail partition lifecycle (cycle-043)
 *
 * Manages monthly partition creation and headroom monitoring.
 * Called by: scheduled job (pg_cron/external), CI pre-deploy gate.
 *
 * SDD ref: §3.4.4a (Partition Manager)
 * Sprint: 360, Task 3.2e (FR-6)
 */

import type { Pool } from 'pg';
import type { Logger } from 'pino';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PartitionInfo {
  partition_name: string;
  range_start: string;
  range_end: string;
}

export interface PartitionHealthResult {
  healthy: boolean;
  partitions: PartitionInfo[];
  monthsAhead: number;
  alertRequired: boolean;
}

export interface PartitionManagerConfig {
  pool: Pool;
  logger: Logger;
  minHeadroomMonths?: number;
}

// ─── Manager ─────────────────────────────────────────────────────────────────

export class PartitionManager {
  private readonly pool: Pool;
  private readonly log: Logger;
  private readonly minHeadroomMonths: number;

  constructor(config: PartitionManagerConfig) {
    this.pool = config.pool;
    this.log = config.logger;
    this.minHeadroomMonths = config.minHeadroomMonths ?? 1;
  }

  /**
   * Ensure partitions exist for current month + N months ahead.
   * Calls the SQL function create_audit_partitions() which is idempotent.
   */
  async ensurePartitions(monthsAhead: number = 2): Promise<PartitionInfo[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query<PartitionInfo>(
        'SELECT * FROM create_audit_partitions($1)',
        [monthsAhead],
      );

      this.log.info(
        { months_ahead: monthsAhead, partitions_created: result.rows.length },
        'audit trail partitions ensured',
      );

      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Check partition health — returns months of future headroom.
   * Alerts if headroom < minHeadroomMonths.
   *
   * Used by CI pre-deploy gate: fails deploy if headroom < 2 months.
   */
  async checkPartitionHealth(): Promise<PartitionHealthResult> {
    const client = await this.pool.connect();
    try {
      // Query existing partitions from pg_catalog
      // SQL returns partition_name and bound_expr; range_start/range_end are parsed from bound_expr below
      const result = await client.query<{ partition_name: string; bound_expr: string }>(
        `SELECT
           c.relname AS partition_name,
           pg_get_expr(c.relpartbound, c.oid) AS bound_expr
         FROM pg_class c
         JOIN pg_inherits i ON c.oid = i.inhrelid
         JOIN pg_class p ON i.inhparent = p.oid
         WHERE p.relname = 'audit_trail'
           AND c.relname != 'audit_trail_default'
         ORDER BY c.relname`,
      );

      // Parse bound_expr → range_start/range_end for PartitionInfo
      const partitions: PartitionInfo[] = result.rows.map((row) => {
        // bound_expr format: "FOR VALUES FROM ('2026-02-01') TO ('2026-03-01')"
        const matches = row.bound_expr?.match(/FROM \('([^']+)'\) TO \('([^']+)'\)/);
        return {
          partition_name: row.partition_name,
          range_start: matches?.[1] ?? 'unknown',
          range_end: matches?.[2] ?? 'unknown',
        };
      });

      // Calculate months of headroom
      const now = new Date();
      const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      let latestEnd = currentMonth;

      for (const p of partitions) {
        if (p.range_end !== 'unknown') {
          const endDate = new Date(p.range_end);
          if (endDate > latestEnd) {
            latestEnd = endDate;
          }
        }
      }

      const monthsAhead = Math.max(
        0,
        (latestEnd.getFullYear() - currentMonth.getFullYear()) * 12 +
          (latestEnd.getMonth() - currentMonth.getMonth()) - 1,
      );

      const alertRequired = monthsAhead < this.minHeadroomMonths;

      if (alertRequired) {
        this.log.warn(
          { months_ahead: monthsAhead, min_required: this.minHeadroomMonths },
          'audit trail partition headroom below threshold',
        );
      }

      return {
        healthy: !alertRequired,
        partitions,
        monthsAhead,
        alertRequired,
      };
    } finally {
      client.release();
    }
  }
}
