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
}

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
   */
  async process(): Promise<ReaperJobResult> {
    const communityIds = await this.communityProvider.getActiveCommunityIds();

    let totalReaped = 0;
    let totalReclaimed = 0;
    let errors = 0;

    for (const communityId of communityIds) {
      try {
        const result = await this.budgetManager.reap(communityId);

        const logLevel = result.count > 0 ? 'info' : 'debug';
        this.logger[logLevel](
          {
            communityId,
            reaped_count: result.count,
            reclaimed_cents: result.totalReclaimed,
          },
          'budget-reaper: reaped expired reservations',
        );

        totalReaped += result.count;
        totalReclaimed += result.totalReclaimed;
      } catch (err) {
        errors++;
        this.logger.error(
          { err, communityId },
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
      },
      'budget-reaper: cycle complete',
    );

    return {
      communitiesProcessed: communityIds.length,
      totalReaped,
      totalReclaimed,
      errors,
    };
  }
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
