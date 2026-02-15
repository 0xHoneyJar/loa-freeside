/**
 * DLQ Processor — Dead Letter Queue Retry Handler
 *
 * Processes failed billing operations with exponential backoff.
 * Retry schedule: 1min, 5min, 30min. After 3 retries → manual_review.
 *
 * SDD refs: §1.4 Background Jobs
 * Sprint refs: Task 3.5
 *
 * @module jobs/dlq-processor
 */

import type Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';

// =============================================================================
// Types
// =============================================================================

export interface DLQProcessorConfig {
  /** SQLite database */
  db: Database.Database;
  /** Interval in milliseconds (default: 60 seconds) */
  intervalMs?: number;
  /** Max items to process per run (default: 10) */
  batchSize?: number;
  /** Retry handler for each operation type */
  handlers: Partial<Record<string, (payload: unknown) => Promise<void>>>;
}

interface DLQRow {
  id: string;
  operation_type: string;
  payload: string;
  retry_count: number;
  max_retries: number;
  status: string;
}

// =============================================================================
// Backoff Schedule
// =============================================================================

/** Retry delays in seconds: 1min, 5min, 30min */
const BACKOFF_DELAYS = [60, 300, 1800];

function getNextRetryDelay(retryCount: number): number {
  return BACKOFF_DELAYS[Math.min(retryCount, BACKOFF_DELAYS.length - 1)];
}

function sqliteNow(): string {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

function sqliteFuture(offsetSeconds: number): string {
  return new Date(Date.now() + offsetSeconds * 1000)
    .toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

// =============================================================================
// DLQ Processor
// =============================================================================

export function createDLQProcessor(config: DLQProcessorConfig) {
  let timer: ReturnType<typeof setInterval> | null = null;
  const intervalMs = config.intervalMs ?? 60_000;
  const batchSize = config.batchSize ?? 10;

  async function processQueue(): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
    escalated: number;
  }> {
    const now = sqliteNow();

    // Get pending items ready for retry
    const items = config.db.prepare(
      `SELECT id, operation_type, payload, retry_count, max_retries, status
       FROM billing_dlq
       WHERE status = 'pending'
         AND (next_retry_at IS NULL OR next_retry_at <= ?)
       ORDER BY created_at ASC
       LIMIT ?`
    ).all(now, batchSize) as DLQRow[];

    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    let escalated = 0;

    for (const item of items) {
      processed++;

      // Mark as processing
      config.db.prepare(
        `UPDATE billing_dlq SET status = 'processing', updated_at = ? WHERE id = ?`
      ).run(now, item.id);

      const handler = config.handlers[item.operation_type];
      if (!handler) {
        logger.error({
          event: 'billing.dlq.no_handler',
          id: item.id,
          operationType: item.operation_type,
        }, `No DLQ handler for operation type: ${item.operation_type}`);

        config.db.prepare(
          `UPDATE billing_dlq
           SET status = 'manual_review', error_message = ?, updated_at = ?
           WHERE id = ?`
        ).run(`No handler registered for: ${item.operation_type}`, sqliteNow(), item.id);

        escalated++;
        continue;
      }

      try {
        const payload = JSON.parse(item.payload);
        await handler(payload);

        // Success — mark completed
        config.db.prepare(
          `UPDATE billing_dlq
           SET status = 'completed', completed_at = ?, updated_at = ?
           WHERE id = ?`
        ).run(sqliteNow(), sqliteNow(), item.id);

        succeeded++;

        logger.info({
          event: 'billing.dlq.success',
          id: item.id,
          operationType: item.operation_type,
          retryCount: item.retry_count,
        }, 'DLQ item processed successfully');
      } catch (err) {
        const newRetryCount = item.retry_count + 1;
        const errorMessage = (err as Error).message;

        if (newRetryCount >= item.max_retries) {
          // Max retries exceeded — escalate to manual review
          config.db.prepare(
            `UPDATE billing_dlq
             SET status = 'manual_review', retry_count = ?,
                 error_message = ?, updated_at = ?
             WHERE id = ?`
          ).run(newRetryCount, errorMessage, sqliteNow(), item.id);

          escalated++;

          logger.error({
            event: 'billing.dlq.escalated',
            id: item.id,
            operationType: item.operation_type,
            retryCount: newRetryCount,
            error: errorMessage,
          }, 'DLQ item escalated to manual review after max retries');
        } else {
          // Schedule retry with exponential backoff
          const delay = getNextRetryDelay(newRetryCount);
          const nextRetry = sqliteFuture(delay);

          config.db.prepare(
            `UPDATE billing_dlq
             SET status = 'pending', retry_count = ?,
                 error_message = ?, next_retry_at = ?, updated_at = ?
             WHERE id = ?`
          ).run(newRetryCount, errorMessage, nextRetry, sqliteNow(), item.id);

          failed++;

          logger.warn({
            event: 'billing.dlq.retry',
            id: item.id,
            operationType: item.operation_type,
            retryCount: newRetryCount,
            nextRetryAt: nextRetry,
            error: errorMessage,
          }, `DLQ item failed — retry ${newRetryCount}/${item.max_retries} scheduled`);
        }
      }
    }

    if (processed > 0) {
      logger.info({
        event: 'billing.dlq.batch',
        processed,
        succeeded,
        failed,
        escalated,
      }, `DLQ batch: ${succeeded} succeeded, ${failed} retrying, ${escalated} escalated`);
    }

    return { processed, succeeded, failed, escalated };
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(async () => {
        try {
          await processQueue();
        } catch (err) {
          logger.error({ err, event: 'billing.dlq.unhandled' },
            'Unhandled DLQ processor error');
        }
      }, intervalMs);
      logger.info({
        event: 'billing.dlq.start',
        intervalMs,
      }, 'DLQ processor started');
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        logger.info({ event: 'billing.dlq.stop' },
          'DLQ processor stopped');
      }
    },
    processOnce: processQueue,
  };
}

// =============================================================================
// DLQ Helper: Enqueue Failed Operation
// =============================================================================

/**
 * Add a failed operation to the DLQ for retry.
 */
export function enqueueDLQ(
  db: Database.Database,
  operationType: string,
  payload: unknown,
  errorMessage: string,
): string {
  const id = `dlq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = sqliteNow();
  const nextRetry = sqliteFuture(BACKOFF_DELAYS[0]);

  db.prepare(
    `INSERT INTO billing_dlq
     (id, operation_type, payload, error_message, next_retry_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, operationType, JSON.stringify(payload), errorMessage, nextRetry, now, now);

  logger.info({
    event: 'billing.dlq.enqueue',
    id,
    operationType,
    error: errorMessage,
  }, 'Operation added to DLQ');

  return id;
}
