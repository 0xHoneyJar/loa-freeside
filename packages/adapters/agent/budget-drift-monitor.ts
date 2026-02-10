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
import { REAL_CLOCK, type Clock } from './clock.js';

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
  /** Trailing-window throughput stats for adaptive drift threshold (S14-T2) */
  getRequestRate(communityId: string, windowMinutes: number): Promise<{ ratePerMinute: number; avgCostMicroCents: number }>;
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
  /** redis_missing: Redis key absent but PG has data (possible key expiry/restart) */
  driftDirection: 'redis_over' | 'pg_over' | 'redis_missing' | 'none';
}

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

/** 500,000 micro-cents = $0.50 — static threshold for BUDGET_ACCOUNTING_DRIFT alarm */
export const DRIFT_THRESHOLD_MICRO_CENTS = 500_000;

/** Estimated Redis→PG propagation delay in seconds (S14-T2) */
export const DRIFT_LAG_FACTOR_SECONDS = 30;

/** Maximum adaptive threshold: 100,000,000 micro-cents = $100.00 (S14-T2) */
export const DRIFT_MAX_THRESHOLD_MICRO_CENTS = 100_000_000;

/** Trailing window for request rate calculation — 60 min avoids feedback with 15-min drift cycle */
const DRIFT_RATE_WINDOW_MINUTES = 60;

/** Per-community query timeout */
const PER_COMMUNITY_TIMEOUT_MS = 10_000;

// --------------------------------------------------------------------------
// Drift Monitor Job Processor
// --------------------------------------------------------------------------

// REAL_CLOCK imported from ./clock.js (S13-T2: shared types extraction)

export class BudgetDriftMonitor {
  private readonly clock: Clock;

  constructor(
    private readonly redis: Redis,
    private readonly communityProvider: DriftActiveCommunityProvider,
    private readonly usageQuery: BudgetUsageQueryProvider,
    private readonly logger: Logger,
    clock?: Clock,
  ) {
    this.clock = clock ?? REAL_CLOCK;
  }

  /**
   * Run drift check for all active communities.
   * Called by BullMQ worker on the repeatable schedule.
   */
  async process(): Promise<DriftMonitorResult> {
    const month = this.getCurrentMonth();
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

        // Compute adaptive threshold from trailing-window throughput (S14-T2)
        const { ratePerMinute, avgCostMicroCents } = await this.usageQuery.getRequestRate(
          communityId,
          DRIFT_RATE_WINDOW_MINUTES,
        );
        const lagAdjustment = ratePerMinute * (DRIFT_LAG_FACTOR_SECONDS / 60) * avgCostMicroCents;
        const adaptiveThreshold = clamp(
          DRIFT_THRESHOLD_MICRO_CENTS + lagAdjustment,
          DRIFT_THRESHOLD_MICRO_CENTS,
          DRIFT_MAX_THRESHOLD_MICRO_CENTS,
        );

        // Log all drift at debug level for monitoring
        this.logger.debug(
          {
            communityId,
            redisMicroCents: drift.redisMicroCents,
            pgMicroCents: drift.pgMicroCents,
            driftMicroCents: drift.driftMicroCents,
            driftDirection: drift.driftDirection,
            staticThresholdMicroCents: DRIFT_THRESHOLD_MICRO_CENTS,
            adaptiveThresholdMicroCents: adaptiveThreshold,
            ratePerMinute,
            avgCostMicroCents,
            month,
          },
          'budget-drift-monitor: community check',
        );

        // F-2 Fix: Redis key missing is a distinct failure mode from hard overspend.
        // Key expiry, Redis restart, or memory eviction should not flood BUDGET_HARD_OVERSPEND.
        if (drift.driftDirection === 'redis_missing') {
          driftDetected++;
          this.logger.error(
            {
              communityId,
              redisMicroCents: drift.redisMicroCents,
              pgMicroCents: drift.pgMicroCents,
              driftMicroCents: drift.driftMicroCents,
              driftDirection: drift.driftDirection,
              month,
              alarm: 'BUDGET_REDIS_KEY_MISSING',
            },
            'BUDGET_REDIS_KEY_MISSING: Redis committed key absent but PG has data — possible key expiry or Redis restart',
          );
        } else if (drift.driftDirection === 'pg_over' && drift.pgMicroCents > drift.redisMicroCents) {
          // Hard overspend rule (S14-T2): PG > Redis (with Redis key present)
          // Fire alarm unconditionally — this is never lag, it's a real accounting error
          driftDetected++;
          this.logger.error(
            {
              communityId,
              redisMicroCents: drift.redisMicroCents,
              pgMicroCents: drift.pgMicroCents,
              driftMicroCents: drift.driftMicroCents,
              driftDirection: drift.driftDirection,
              thresholdMicroCents: DRIFT_THRESHOLD_MICRO_CENTS,
              adaptiveThresholdMicroCents: adaptiveThreshold,
              month,
              alarm: 'BUDGET_HARD_OVERSPEND',
            },
            'BUDGET_HARD_OVERSPEND: PG committed exceeds Redis committed — real accounting error',
          );
        } else if (absDrift > adaptiveThreshold) {
          // Drift exceeds adaptive threshold — alarm
          driftDetected++;
          this.logger.error(
            {
              communityId,
              redisMicroCents: drift.redisMicroCents,
              pgMicroCents: drift.pgMicroCents,
              driftMicroCents: drift.driftMicroCents,
              driftDirection: drift.driftDirection,
              thresholdMicroCents: DRIFT_THRESHOLD_MICRO_CENTS,
              adaptiveThresholdMicroCents: adaptiveThreshold,
              month,
              alarm: 'BUDGET_ACCOUNTING_DRIFT',
            },
            'BUDGET_ACCOUNTING_DRIFT: Redis/PG budget mismatch exceeds adaptive threshold',
          );
        } else if (absDrift > DRIFT_THRESHOLD_MICRO_CENTS) {
          // Drift exceeds static but within adaptive — warn (expected lag at current throughput)
          this.logger.warn(
            {
              communityId,
              redisMicroCents: drift.redisMicroCents,
              pgMicroCents: drift.pgMicroCents,
              driftMicroCents: drift.driftMicroCents,
              driftDirection: drift.driftDirection,
              staticThresholdMicroCents: DRIFT_THRESHOLD_MICRO_CENTS,
              adaptiveThresholdMicroCents: adaptiveThreshold,
              ratePerMinute,
              month,
            },
            'budget-drift-monitor: drift within expected lag range',
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
  /** Get current month using injectable clock for deterministic testing */
  private getCurrentMonth(): string {
    const d = new Date(this.clock.now());
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  private async checkCommunity(communityId: string, month: string): Promise<CommunityDrift> {
    // Read Redis committed counter (in cents, stored as integer string)
    const redisKey = `agent:budget:committed:${communityId}:${month}`;
    const redisStr = await this.redis.get(redisKey);
    // Convert cents to micro-cents for comparison (1 cent = 10,000 micro-cents)
    const redisMicroCents = safeInt(redisStr) * 10_000;

    // Query PostgreSQL for sum of cost_micro_cents
    const pgMicroCents = await this.usageQuery.getCommittedMicroCents(communityId, month);

    const driftMicroCents = redisMicroCents - pgMicroCents;
    // F-2 Fix: Distinguish Redis key absence from genuine PG overspend.
    // When Redis returns null but PG has data, it's likely key expiry or Redis restart,
    // not an accounting error. Different alarm → different runbook response.
    const driftDirection: CommunityDrift['driftDirection'] =
      redisStr === null && pgMicroCents > 0 ? 'redis_missing' :
      driftMicroCents > 0 ? 'redis_over' :
      driftMicroCents < 0 ? 'pg_over' : 'none';

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

function safeInt(v: string | null, def = 0): number {
  if (v === null) return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : def;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
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
