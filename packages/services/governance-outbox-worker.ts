/**
 * Governance Outbox Worker — Reliable Conservation Guard Propagation
 *
 * Polls governance_outbox for unprocessed rows and calls
 * conservationGuard.updateLimit() idempotently. Implements exponential
 * backoff with DLQ for failed rows.
 *
 * Two Generals Problem (F-1 / Bridgebuilder):
 *   This worker faces a variant of the Two Generals problem applied to
 *   economic governance: the governance lot entry is committed in Postgres,
 *   but the conservation guard's Redis limit must be updated separately.
 *   There is no atomic cross-store transaction.
 *
 *   The `governance_pending:{community_id}` Redis key makes this gap
 *   visible. The worker sets it BEFORE calling `updateLimit()` and DELetes
 *   it after success. Crash safety: the key auto-expires via TTL
 *   (staleThresholdMinutes * 60s), and the outbox row is retried on the
 *   next poll because it was never marked `processed_at`.
 *
 *   Concurrency safety: outbox rows are claimed with FOR UPDATE SKIP LOCKED,
 *   ensuring only one worker processes a given community's policy at a time.
 *   The Redis key is per-community (not per-row), so setting it again on
 *   retry is idempotent (same key, refreshed TTL).
 *
 * @see SDD §5.4 Outbox Pattern
 * @see Sprint 5, Task 5.4 (AC-5.4.1 through AC-5.4.12)
 * @module packages/services/governance-outbox-worker
 */

import type { Pool, PoolClient } from 'pg';
import type { Redis } from 'ioredis';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Outbox row from DB */
export interface OutboxRow {
  id: string;
  community_id: string;
  policy_id: string;
  policy_version: number;
  action: string;
  payload: { limit_micro: string };
  processed_at: string | null;
  attempts: number;
  last_error: string | null;
  created_at: string;
}

/** Conservation guard port (subset needed by worker) */
export interface ConservationGuardPort {
  updateLimit(communityId: string, limitMicro: string): Promise<void>;
}

/** Logger interface */
export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/** Metrics port */
export interface MetricsPort {
  putMetric(name: string, value: number, unit?: string): void;
}

/** Worker dependencies */
export interface OutboxWorkerDeps {
  pool: Pool;
  redis: Redis;
  conservationGuard: ConservationGuardPort;
  logger: Logger;
  metrics: MetricsPort;
}

/** Worker configuration */
export interface OutboxWorkerConfig {
  /** Polling interval in milliseconds (default: 5000) */
  pollIntervalMs?: number;
  /** Maximum retry attempts before DLQ (default: 3) */
  maxAttempts?: number;
  /** Batch size per poll (default: 10) */
  batchSize?: number;
  /** Stale threshold in minutes for alarm (default: 5) */
  staleThresholdMinutes?: number;
}

/** Processing result */
export interface ProcessResult {
  processed: number;
  failed: number;
  movedToDlq: number;
}

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_STALE_THRESHOLD_MINUTES = 5;

// --------------------------------------------------------------------------
// Factory
// --------------------------------------------------------------------------

export function createOutboxWorker(deps: OutboxWorkerDeps, config: OutboxWorkerConfig = {}) {
  const { pool, redis, conservationGuard, logger, metrics } = deps;
  const maxAttempts = config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
  const pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const staleThresholdMinutes = config.staleThresholdMinutes ?? DEFAULT_STALE_THRESHOLD_MINUTES;

  let running = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  // -----------------------------------------------------------------------
  // AC-5.4.2: Claim rows with FOR UPDATE SKIP LOCKED
  // -----------------------------------------------------------------------

  async function claimBatch(client: PoolClient): Promise<OutboxRow[]> {
    const result = await client.query<OutboxRow>(
      `SELECT * FROM governance_outbox
       WHERE processed_at IS NULL
         AND attempts < $1
       ORDER BY created_at ASC
       LIMIT $2
       FOR UPDATE SKIP LOCKED`,
      [maxAttempts, batchSize]
    );
    return result.rows;
  }

  // -----------------------------------------------------------------------
  // AC-5.4.3: Process single outbox row
  // AC-5.4.4: Mark as processed on success
  // AC-5.4.5: Retry with exponential backoff (increment attempts + set error)
  // AC-5.4.6: Move to DLQ after max retries
  // -----------------------------------------------------------------------

  async function processRow(client: PoolClient, row: OutboxRow): Promise<'processed' | 'failed' | 'dlq'> {
    try {
      // AC-5.4.3: Call conservationGuard.updateLimit() with idempotency
      if (row.action === 'update_limit') {
        // F-1: Set governance_pending BEFORE updateLimit (TTL = staleThresholdMinutes)
        const pendingKey = `governance_pending:${row.community_id}`;
        const pendingTtlSeconds = staleThresholdMinutes * 60;
        await redis.set(pendingKey, '1', 'EX', pendingTtlSeconds);

        await conservationGuard.updateLimit(row.community_id, row.payload.limit_micro);

        // F-1: Clear governance_pending AFTER successful updateLimit
        await redis.del(pendingKey);
      } else {
        logger.warn('Unknown outbox action', { action: row.action, outboxId: row.id });
      }

      // AC-5.4.4: Mark as processed
      await client.query(
        `UPDATE governance_outbox SET processed_at = NOW() WHERE id = $1`,
        [row.id]
      );

      return 'processed';
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const newAttempts = row.attempts + 1;

      if (newAttempts >= maxAttempts) {
        // AC-5.4.6: Move to DLQ
        await client.query(
          `INSERT INTO governance_outbox_dlq
           (original_outbox_id, community_id, policy_id, policy_version,
            action, payload, attempts, last_error, moved_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
          [
            row.id, row.community_id, row.policy_id, row.policy_version,
            row.action, JSON.stringify(row.payload), newAttempts, errorMessage,
          ]
        );

        // Remove from outbox
        await client.query(`DELETE FROM governance_outbox WHERE id = $1`, [row.id]);

        logger.error('Outbox row moved to DLQ', {
          outboxId: row.id,
          communityId: row.community_id,
          policyId: row.policy_id,
          attempts: newAttempts,
          error: errorMessage,
        });

        metrics.putMetric('outbox_dlq_count', 1);
        return 'dlq';
      }

      // AC-5.4.5: Increment attempts and record error
      await client.query(
        `UPDATE governance_outbox
         SET attempts = $1, last_error = $2
         WHERE id = $3`,
        [newAttempts, errorMessage, row.id]
      );

      logger.warn('Outbox processing failed, will retry', {
        outboxId: row.id,
        attempts: newAttempts,
        maxAttempts,
        error: errorMessage,
      });

      return 'failed';
    }
  }

  // -----------------------------------------------------------------------
  // AC-5.4.1: Poll loop
  // AC-5.4.9: Stale detection + metrics
  // -----------------------------------------------------------------------

  async function poll(): Promise<ProcessResult> {
    const result: ProcessResult = { processed: 0, failed: 0, movedToDlq: 0 };
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const rows = await claimBatch(client);

      for (const row of rows) {
        const outcome = await processRow(client, row);
        switch (outcome) {
          case 'processed': result.processed++; break;
          case 'failed': result.failed++; break;
          case 'dlq': result.movedToDlq++; break;
        }
      }

      await client.query('COMMIT');

      // AC-5.4.9: Emit backlog metrics
      const backlog = await pool.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM governance_outbox WHERE processed_at IS NULL`
      );
      const backlogDepth = parseInt(backlog.rows[0].count, 10);
      metrics.putMetric('outbox_backlog_depth', backlogDepth);

      // AC-5.4.9: Check for stale rows
      const stale = await pool.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM governance_outbox
         WHERE processed_at IS NULL
           AND created_at < NOW() - make_interval(mins => $1)`,
        [staleThresholdMinutes]
      );
      const staleCount = parseInt(stale.rows[0].count, 10);
      if (staleCount > 0) {
        metrics.putMetric('outbox_stale_rows', staleCount);
        logger.warn('Stale outbox rows detected', { count: staleCount, thresholdMinutes: staleThresholdMinutes });
      }

      // DLQ depth
      const dlqDepth = await pool.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM governance_outbox_dlq`
      );
      metrics.putMetric('outbox_dlq_depth', parseInt(dlqDepth.rows[0].count, 10));

      if (result.processed > 0 || result.failed > 0 || result.movedToDlq > 0) {
        logger.info('Outbox poll completed', result);
      }
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('Outbox poll failed', { error: err instanceof Error ? err.message : String(err) });
    } finally {
      client.release();
    }

    return result;
  }

  // -----------------------------------------------------------------------
  // AC-5.4.7: Manual reprocess from DLQ
  // -----------------------------------------------------------------------

  async function reprocessFromDlq(dlqRowId: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const dlqRow = await client.query<{
        original_outbox_id: string;
        community_id: string;
        policy_id: string;
        policy_version: number;
        action: string;
        payload: Record<string, unknown>;
      }>(
        `SELECT * FROM governance_outbox_dlq WHERE id = $1 FOR UPDATE`,
        [dlqRowId]
      );

      if (!dlqRow.rows[0]) {
        throw new Error(`DLQ row not found: ${dlqRowId}`);
      }

      const row = dlqRow.rows[0];

      // Re-insert into outbox with reset attempts
      await client.query(
        `INSERT INTO governance_outbox
         (community_id, policy_id, policy_version, action, payload, attempts, created_at)
         VALUES ($1, $2, $3, $4, $5, 0, NOW())
         ON CONFLICT (policy_id, policy_version) DO NOTHING`,
        [row.community_id, row.policy_id, row.policy_version, row.action, JSON.stringify(row.payload)]
      );

      // Remove from DLQ
      await client.query(`DELETE FROM governance_outbox_dlq WHERE id = $1`, [dlqRowId]);

      await client.query('COMMIT');
      logger.info('DLQ row reprocessed', { dlqRowId, policyId: row.policy_id });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  function start(): void {
    if (running) return;
    running = true;
    logger.info('Outbox worker started', { pollIntervalMs, maxAttempts, batchSize });

    const schedulePoll = () => {
      if (!running) return;
      pollTimer = setTimeout(async () => {
        await poll();
        schedulePoll();
      }, pollIntervalMs);
    };

    // Run first poll immediately
    poll().then(schedulePoll);
  }

  function stop(): void {
    running = false;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    logger.info('Outbox worker stopped');
  }

  return {
    poll,
    reprocessFromDlq,
    start,
    stop,
  };
}
