/**
 * Stream Reconciliation Worker
 * Sprint S3-T5: BullMQ worker for dropped stream finalization
 *
 * Queries loa-finn for actual usage on dropped/interrupted streams
 * and finalizes budget accordingly. If loa-finn has no record, the
 * reservation is left for the reaper to clean up on TTL expiry (§8.4).
 *
 * Job config: 30s delay, 3 retries, exponential backoff (10s base).
 *
 * @see SDD §4.7.1 Stream Reconciliation Worker
 */

import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import type { BudgetManager } from './budget-manager.js';
import type { LoaFinnClient } from './loa-finn-client.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface StreamReconciliationJob {
  idempotencyKey: string;
  communityId: string;
  userId: string;
  traceId: string;
  reservedAt: number;
}

// --------------------------------------------------------------------------
// Worker
// --------------------------------------------------------------------------

export class StreamReconciliationWorker {
  constructor(
    private readonly budgetManager: BudgetManager,
    private readonly loaFinnClient: LoaFinnClient,
    private readonly logger: Logger,
  ) {}

  /**
   * Process a stream-reconcile job.
   *
   * 1. Query loa-finn for actual usage by idempotencyKey
   * 2. If found: finalize budget with actual cost
   * 3. If not found (404/202): log and defer to reaper
   */
  async process(job: Job<StreamReconciliationJob>): Promise<void> {
    const { idempotencyKey, communityId, userId, traceId } = job.data;

    this.logger.info(
      { idempotencyKey, communityId, traceId, attempt: job.attemptsMade + 1 },
      'stream-reconciliation: processing job',
    );

    // getUsage returns null for 404/202; throws on network/server errors
    // (which propagate to BullMQ for retry via exponential backoff)
    const usage = await this.loaFinnClient.getUsage(idempotencyKey);

    if (usage) {
      // loa-finn processed the request — finalize with actual cost
      const costCents = Math.round(usage.costUsd * 100);

      await this.budgetManager.finalize({
        communityId,
        userId,
        idempotencyKey,
        actualCost: costCents,
        usage,
        traceId,
        modelAlias: undefined,
      });

      this.logger.info(
        { idempotencyKey, communityId, traceId, costCents },
        'stream-reconciliation: finalized with actual cost',
      );
    } else {
      // loa-finn has no record — request was never processed or still in progress.
      // Reservation will be cleaned up by reaper (§8.4) on TTL expiry.
      this.logger.info(
        { idempotencyKey, communityId, traceId },
        'stream-reconciliation: no usage found, deferring to reaper',
      );
    }
  }
}
