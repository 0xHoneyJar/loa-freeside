/**
 * Budget Drift Monitoring Job
 * Sprint S12-T4: Scheduled comparison of Redis committed vs PostgreSQL agent_usage_log
 *
 * Runs every 15 minutes via BullMQ repeatable. For each active community:
 * 1. Read Redis committed counter: agent:budget:committed:{communityId}:{month}
 * 2. Query PostgreSQL SUM(cost_micro_cents) from agent_usage_log for same month
 * 3. Compare: if |redis - pg| > DRIFT_THRESHOLD_MICRO_CENTS → fire alarm
 * 4. Log drift for all communities at debug level (even within tolerance)
 *
 * @see SDD §4.5.1 Budget Drift Detection
 */

import type { Logger } from 'pino';
import type { Redis } from 'ioredis';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Provides list of active community IDs */
export interface DriftActiveCommunityProvider {
  getActiveCommunityIds(): Promise<string[]>;
}

/** Queries PostgreSQL for budget totals */
export interface BudgetUsageQueryProvider {
  /** SUM(cost_micro_cents) for a community in a given month (YYYY-MM) */
  getCommittedMicroCents(communityId: string, month: string): Promise<number>;
}

export interface DriftMonitorResult {
  communitiesChecked: number;
  driftDetected: number;
  errors: number;
  maxDriftMicroCents: number;
}

export interface CommunityDrift {
  communityId: string;
  redisMicroCents: number;
  pgMicroCents: number;
  driftMicroCents: number;
  driftDirection: 'redis_over' | 'pg_over' | 'none';
}

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

/** 500,000 micro-cents = $0.50 — threshold for BUDGET_ACCOUNTING_DRIFT alarm */
export const DRIFT_THRESHOLD_MICRO_CENTS = 500_000;

/** Per-community query timeout */
const PER_COMMUNITY_TIMEOUT_MS = 10_000;

// --------------------------------------------------------------------------
// Drift Monitor Job Processor
// --------------------------------------------------------------------------

export class BudgetDriftMonitor {
  constructor(
    private readonly redis: Redis,
    private readonly communityProvider: DriftActiveCommunityProvider,
    private readonly usageQuery: BudgetUsageQueryProvider,
    private readonly logger: Logger,
  ) {}

  /**
   * Run drift check for all active communities.
   * Called by BullMQ worker on the repeatable schedule.
   */
  async process(): Promise<DriftMonitorResult> {
    const month = getCurrentMonth();
    const communityIds = await this.communityProvider.getActiveCommunityIds();

    let driftDetected = 0;
    let errors = 0;
    let maxDriftMicroCents = 0;

    for (const communityId of communityIds) {
      try {
        const drift = await withTimeout(
          this.checkCommunity(communityId, month),
          PER_COMMUNITY_TIMEOUT_MS,
          communityId,
        );

        const absDrift = Math.abs(drift.driftMicroCents);
        maxDriftMicroCents = Math.max(maxDriftMicroCents, absDrift);

        // Log all drift at debug level for monitoring
        this.logger.debug(
          {
            communityId,
            redisMicroCents: drift.redisMicroCents,
            pgMicroCents: drift.pgMicroCents,
            driftMicroCents: drift.driftMicroCents,
            driftDirection: drift.driftDirection,
            month,
          },
          'budget-drift-monitor: community check',
        );

        // Fire alarm if drift exceeds threshold
        if (absDrift > DRIFT_THRESHOLD_MICRO_CENTS) {
          driftDetected++;
          this.logger.error(
            {
              communityId,
              redisMicroCents: drift.redisMicroCents,
              pgMicroCents: drift.pgMicroCents,
              driftMicroCents: drift.driftMicroCents,
              driftDirection: drift.driftDirection,
              thresholdMicroCents: DRIFT_THRESHOLD_MICRO_CENTS,
              month,
              alarm: 'BUDGET_ACCOUNTING_DRIFT',
            },
            'BUDGET_ACCOUNTING_DRIFT: Redis/PG budget mismatch exceeds threshold',
          );
        }
      } catch (err) {
        errors++;
        this.logger.error(
          { err, communityId, month },
          'budget-drift-monitor: error checking community — continuing',
        );
      }
    }

    this.logger.info(
      {
        communitiesChecked: communityIds.length,
        driftDetected,
        errors,
        maxDriftMicroCents,
        month,
      },
      'budget-drift-monitor: cycle complete',
    );

    return {
      communitiesChecked: communityIds.length,
      driftDetected,
      errors,
      maxDriftMicroCents,
    };
  }

  /**
   * Check a single community for drift.
   */
  private async checkCommunity(communityId: string, month: string): Promise<CommunityDrift> {
    // Read Redis committed counter (in cents, stored as integer string)
    const redisKey = `agent:budget:committed:${communityId}:${month}`;
    const redisStr = await this.redis.get(redisKey);
    // Convert cents to micro-cents for comparison (1 cent = 10,000 micro-cents)
    const redisMicroCents = safeInt(redisStr) * 10_000;

    // Query PostgreSQL for sum of cost_micro_cents
    const pgMicroCents = await this.usageQuery.getCommittedMicroCents(communityId, month);

    const driftMicroCents = redisMicroCents - pgMicroCents;
    const driftDirection: CommunityDrift['driftDirection'] =
      driftMicroCents > 0 ? 'redis_over' : driftMicroCents < 0 ? 'pg_over' : 'none';

    return {
      communityId,
      redisMicroCents,
      pgMicroCents,
      driftMicroCents,
      driftDirection,
    };
  }
}

// --------------------------------------------------------------------------
// BullMQ Job Configuration
// --------------------------------------------------------------------------

/** BullMQ repeatable job configuration for the drift monitor */
export const DRIFT_MONITOR_JOB_CONFIG = {
  name: 'budget-drift-monitor',
  repeat: {
    every: 15 * 60 * 1000, // every 15 minutes
  },
  removeOnComplete: { count: 10 },
  removeOnFail: { count: 50 },
};

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function getCurrentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function safeInt(v: string | null, def = 0): number {
  if (v === null) return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : def;
}

function withTimeout<T>(promise: Promise<T>, ms: number, communityId: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`drift check timed out after ${ms}ms for ${communityId}`)),
      ms,
    );
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}
