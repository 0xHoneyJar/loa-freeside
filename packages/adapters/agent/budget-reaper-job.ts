/**
 * Budget Reaper BullMQ Job
 * Sprint S3-T7: Repeatable job that runs reaper Lua for each active community
 *
 * Runs every 60 seconds. Iterates active communities (ai_enabled=true)
 * and calls BudgetManager.reap() for each. Individual community errors
 * are logged but do not fail the job.
 *
 * @see SDD §8.4 Budget Reaper
 */

import type { Logger } from 'pino';
import type { BudgetManager } from './budget-manager.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Provides list of active community IDs (ai_enabled = true) */
export interface ActiveCommunityProvider {
  getActiveCommunityIds(): Promise<string[]>;
}

export interface ReaperJobResult {
  communitiesProcessed: number;
  totalReaped: number;
  totalReclaimed: number;
  errors: number;
  circuitBroken: boolean;
}

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

// 10s: p99 reap() is ~50ms; 10s allows for Redis GC pauses + large sorted sets. See SDD §8.4.
const PER_COMMUNITY_TIMEOUT_MS = 10_000;

// 50%: if more than half of communities fail, something systemic is wrong (e.g. Redis down).
const CIRCUIT_BREAKER_THRESHOLD = 0.5;

// --------------------------------------------------------------------------
// Reaper Job Processor
// --------------------------------------------------------------------------

export class BudgetReaperJob {
  constructor(
    private readonly budgetManager: BudgetManager,
    private readonly communityProvider: ActiveCommunityProvider,
    private readonly logger: Logger,
  ) {}

  /**
   * Process a reaper job.
   * Iterates all active communities and runs reap() for each.
   * Individual errors are logged but do not fail the overall job.
   * Circuit breaker: if >50% of communities fail, skip remaining.
   */
  async process(): Promise<ReaperJobResult> {
    const communityIds = await this.communityProvider.getActiveCommunityIds();

    let totalReaped = 0;
    let totalReclaimed = 0;
    let errors = 0;
    let communitiesAttempted = 0;
    let circuitBroken = false;

    for (const communityId of communityIds) {
      // Circuit breaker: if >50% of attempted communities failed, abort remaining
      if (communitiesAttempted > 0 && errors / communitiesAttempted >= CIRCUIT_BREAKER_THRESHOLD) {
        circuitBroken = true;
        this.logger.error(
          { errors, communitiesAttempted, total: communityIds.length },
          'budget-reaper: circuit breaker tripped — >50% failure rate, skipping remaining communities',
        );
        break;
      }

      communitiesAttempted++;

      const start = Date.now();
      try {
        const result = await Promise.race([
          this.budgetManager.reap(communityId),
          rejectAfterTimeout(PER_COMMUNITY_TIMEOUT_MS, communityId),
        ]);
        const durationMs = Date.now() - start;

        const logLevel = result.count > 0 ? 'info' : 'debug';
        this.logger[logLevel](
          {
            communityId,
            reaped_count: result.count,
            reclaimed_cents: result.totalReclaimed,
            duration_ms: durationMs,
          },
          'budget-reaper: reaped expired reservations',
        );

        totalReaped += result.count;
        totalReclaimed += result.totalReclaimed;
      } catch (err) {
        const durationMs = Date.now() - start;
        errors++;
        this.logger.error(
          { err, communityId, duration_ms: durationMs },
          'budget-reaper: error reaping community — continuing',
        );
      }
    }

    this.logger.info(
      {
        communitiesProcessed: communityIds.length,
        totalReaped,
        totalReclaimed,
        errors,
        circuitBroken,
      },
      'budget-reaper: cycle complete',
    );

    return {
      communitiesProcessed: communityIds.length,
      totalReaped,
      totalReclaimed,
      errors,
      circuitBroken,
    };
  }
}

/** Rejects after timeout with a descriptive error */
function rejectAfterTimeout(ms: number, communityId: string): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`reap() timed out after ${ms}ms for ${communityId}`)), ms),
  );
}

/** BullMQ repeatable job configuration for the reaper */
export const REAPER_JOB_CONFIG = {
  name: 'budget-reaper',
  repeat: {
    every: 60_000, // every 60 seconds
  },
  removeOnComplete: { count: 10 },
  removeOnFail: { count: 50 },
} as const;
