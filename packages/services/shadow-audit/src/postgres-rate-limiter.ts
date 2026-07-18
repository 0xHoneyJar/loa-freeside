import type { Sql } from 'postgres';
import type { RateDecision, ReconstructionBudget } from './rate-limiter.js';

export interface PostgresFixedWindowRateLimiterConfig {
  namespace: string;
  limit: number;
  windowMs: number;
}

/**
 * Deployment-wide fixed-window budget.
 *
 * One atomic UPSERT, keyed by namespace + limiter key, is shared by every
 * application replica. PostgreSQL's clock is authoritative so replica clock
 * skew cannot split a window.
 */
export class PostgresFixedWindowRateLimiter implements ReconstructionBudget {
  constructor(
    private readonly sql: Sql,
    private readonly cfg: PostgresFixedWindowRateLimiterConfig,
  ) {
    if (!Number.isInteger(cfg.limit) || cfg.limit < 1) {
      throw new Error('Postgres fixed-window limit must be a positive integer');
    }
    if (!Number.isInteger(cfg.windowMs) || cfg.windowMs < 1) {
      throw new Error('Postgres fixed-window duration must be a positive integer');
    }
    if (!cfg.namespace) {
      throw new Error('Postgres fixed-window namespace is required');
    }
  }

  async check(key: string): Promise<RateDecision> {
    const rows = await this.sql<{ request_count: number; retry_after_ms: number }[]>`
      INSERT INTO shadow_audit_rate_limits (
        namespace, limiter_key, window_started_at, request_count
      ) VALUES (
        ${this.cfg.namespace}, ${key}, clock_timestamp(), 1
      )
      ON CONFLICT (namespace, limiter_key) DO UPDATE
      SET request_count = CASE
            WHEN shadow_audit_rate_limits.window_started_at
              <= clock_timestamp() - (${this.cfg.windowMs} * INTERVAL '1 millisecond')
              THEN 1
            ELSE LEAST(shadow_audit_rate_limits.request_count + 1, ${this.cfg.limit + 1})
          END,
          window_started_at = CASE
            WHEN shadow_audit_rate_limits.window_started_at
              <= clock_timestamp() - (${this.cfg.windowMs} * INTERVAL '1 millisecond')
              THEN clock_timestamp()
            ELSE shadow_audit_rate_limits.window_started_at
          END
      RETURNING
        request_count,
        GREATEST(
          0,
          CEIL(
            EXTRACT(
              EPOCH FROM (
                window_started_at
                + (${this.cfg.windowMs} * INTERVAL '1 millisecond')
                - clock_timestamp()
              )
            ) * 1000
          )
        )::int AS retry_after_ms
    `;
    const row = rows[0];
    if (!row) {
      throw new Error('Postgres fixed-window limiter returned no decision');
    }
    const allowed = row.request_count <= this.cfg.limit;
    return {
      allowed,
      remaining: Math.max(0, this.cfg.limit - row.request_count),
      retryAfterMs: allowed ? 0 : row.retry_after_ms,
    };
  }
}
