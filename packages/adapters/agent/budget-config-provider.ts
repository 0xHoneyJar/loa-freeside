/**
 * Budget Config Provider
 * Sprint S3-T9: Sync community budget limits from PostgreSQL to Redis
 *
 * - On startup: reads all community_agent_config rows where ai_enabled=true,
 *   writes agent:budget:limit:{communityId} to Redis (persistent, no TTL).
 * - Periodic refresh: every 5min via BullMQ repeatable job.
 * - Monthly reset: 1st of month 00:00 UTC, zeroes committed+reserved counters.
 *   Uses distributed lock to prevent concurrent resets.
 *
 * @see SDD §4.3 Budget Config
 * @see Flatline IMP-004 Monthly Reset
 */

import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { getCurrentMonth } from './budget-manager.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Provides active community budget configs from the database */
export interface BudgetConfigSource {
  getActiveCommunityConfigs(): Promise<CommunityBudgetConfig[]>;
}

export interface CommunityBudgetConfig {
  communityId: string;
  monthlyBudgetCents: number;
  pricingOverrides?: Record<string, { inputPer1k: number; outputPer1k: number }> | null;
}

export interface BudgetSyncResult {
  synced: number;
  errors: number;
}

export interface MonthlyResetResult {
  reset: number;
  errors: number;
  month: string;
}

/** Distributed lock TTL for monthly reset (30s) */
const RESET_LOCK_TTL_MS = 30_000;

/** Pricing cache TTL — 5 minutes (S1-T5, same pattern as tier overrides) */
const PRICING_CACHE_TTL_S = 300;

/** Normalize a budget cents value: clamp negatives and non-finite to 0, truncate decimals */
function normalizeBudgetCents(v: number): number {
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.trunc(v);
}

// --------------------------------------------------------------------------
// Budget Config Provider
// --------------------------------------------------------------------------

export class BudgetConfigProvider {
  constructor(
    private readonly redis: Redis,
    private readonly configSource: BudgetConfigSource,
    private readonly logger: Logger,
  ) {}

  /**
   * Initial sync: read all active configs from DB, write budget limits to Redis.
   * Called on startup and by periodic refresh job.
   */
  async syncBudgetLimits(): Promise<BudgetSyncResult> {
    const configs = await this.configSource.getActiveCommunityConfigs();

    let synced = 0;
    let errors = 0;

    for (const config of configs) {
      try {
        const limitKey = `agent:budget:limit:${config.communityId}`;
        const budgetCents = normalizeBudgetCents(config.monthlyBudgetCents);

        if (budgetCents !== config.monthlyBudgetCents) {
          this.logger.warn(
            { communityId: config.communityId, raw: config.monthlyBudgetCents, normalized: budgetCents },
            'budget-config: normalized invalid monthlyBudgetCents',
          );
        }

        // Persistent key — no TTL. Only updated by sync job.
        await this.redis.set(limitKey, String(budgetCents));
        synced++;
      } catch (err) {
        errors++;
        this.logger.error(
          { err, communityId: config.communityId },
          'budget-config: error syncing limit — continuing',
        );
      }
    }

    this.logger.info(
      { synced, errors, total: configs.length },
      'budget-config: sync complete',
    );

    return { synced, errors };
  }

  /**
   * Get model pricing for a specific model alias, with runtime override support.
   * Priority: per-community override → global pricing config → null (caller uses defaults).
   * Results cached in Redis at agent:pricing:{communityId} with 5-minute TTL (S1-T5).
   *
   * @param modelAlias - Model alias to look up pricing for
   * @param communityId - Optional community ID for per-community overrides
   * @returns Pricing per 1K tokens, or null if no override configured
   */
  async getModelPricing(
    modelAlias: string,
    communityId?: string,
  ): Promise<{ inputPer1k: number; outputPer1k: number } | null> {
    // Check per-community overrides first (cached)
    if (communityId) {
      const overrides = await this.getCachedPricingOverrides(communityId);
      if (overrides?.[modelAlias]) {
        return overrides[modelAlias];
      }
    }

    // Check global pricing defaults (cached at agent:pricing:global)
    const globalPricing = await this.getCachedGlobalPricing();
    if (globalPricing?.[modelAlias]) {
      return globalPricing[modelAlias];
    }

    return null;
  }

  /**
   * Get pricing overrides for a community (for BudgetManager.estimateCost).
   * Returns null if no overrides configured.
   */
  async getPricingOverrides(
    communityId: string,
  ): Promise<Record<string, { inputPer1k: number; outputPer1k: number }> | null> {
    const configs = await this.configSource.getActiveCommunityConfigs();
    const config = configs.find((c) => c.communityId === communityId);
    return config?.pricingOverrides ?? null;
  }

  // --------------------------------------------------------------------------
  // Pricing Cache (S1-T5: Bridgebuilder Finding #7)
  // --------------------------------------------------------------------------

  private async getCachedPricingOverrides(
    communityId: string,
  ): Promise<Record<string, { inputPer1k: number; outputPer1k: number }> | null> {
    const cacheKey = `agent:pricing:${communityId}`;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached !== null) {
        return cached === 'null' ? null : JSON.parse(cached);
      }
    } catch (err) {
      this.logger.warn({ err, communityId }, 'budget-config: pricing cache read error');
    }

    // Cache miss — query source
    const overrides = await this.getPricingOverrides(communityId);
    try {
      await this.redis.set(cacheKey, overrides ? JSON.stringify(overrides) : 'null', 'EX', PRICING_CACHE_TTL_S);
    } catch (err) {
      this.logger.warn({ err, communityId }, 'budget-config: pricing cache write error');
    }

    return overrides;
  }

  private async getCachedGlobalPricing(): Promise<Record<string, { inputPer1k: number; outputPer1k: number }> | null> {
    const cacheKey = 'agent:pricing:global';

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached !== null) {
        return cached === 'null' ? null : JSON.parse(cached);
      }
    } catch {
      // Cache miss or error — return null (caller uses hardcoded defaults)
    }

    return null;
  }

  /**
   * Monthly reset: zero committed+reserved counters for all active communities.
   * Runs on 1st of month at 00:00 UTC (Flatline IMP-004).
   *
   * Uses distributed lock per community to prevent concurrent resets.
   * In-flight reservations from previous month are finalized against that month's
   * counters since idempotencyKey includes the month.
   */
  async monthlyReset(): Promise<MonthlyResetResult> {
    const month = getCurrentMonth();
    const configs = await this.configSource.getActiveCommunityConfigs();

    let reset = 0;
    let errors = 0;

    for (const config of configs) {
      const lockKey = `agent:budget:reset-lock:${config.communityId}`;

      try {
        // Acquire distributed lock (SET NX EX)
        const acquired = await this.redis.set(lockKey, '1', 'PX', RESET_LOCK_TTL_MS, 'NX');
        if (!acquired) {
          this.logger.debug(
            { communityId: config.communityId, month },
            'budget-config: reset lock held by another process — skipping',
          );
          continue;
        }

        // Zero committed + reserved counters for the new month
        const committedKey = `agent:budget:committed:${config.communityId}:${month}`;
        const reservedKey = `agent:budget:reserved:${config.communityId}:${month}`;

        await this.redis.set(committedKey, '0');
        await this.redis.set(reservedKey, '0');

        reset++;

        this.logger.info(
          { communityId: config.communityId, month },
          'budget-config: monthly reset complete',
        );
      } catch (err) {
        errors++;
        this.logger.error(
          { err, communityId: config.communityId, month },
          'budget-config: monthly reset error — continuing',
        );
      }
    }

    this.logger.info(
      { reset, errors, month, total: configs.length },
      'budget-config: monthly reset cycle complete',
    );

    return { reset, errors, month };
  }
}

// --------------------------------------------------------------------------
// BullMQ Job Configs
// --------------------------------------------------------------------------

/** Repeatable job: sync budget limits every 5 minutes */
export const BUDGET_SYNC_JOB_CONFIG = {
  name: 'budget-sync',
  repeat: {
    every: 300_000, // every 5 minutes
  },
  removeOnComplete: { count: 5 },
  removeOnFail: { count: 20 },
} as const;

/** Cron job: monthly reset at 00:00 UTC on 1st of month */
export const BUDGET_MONTHLY_RESET_JOB_CONFIG = {
  name: 'budget-monthly-reset',
  repeat: {
    pattern: '0 0 1 * *', // 00:00 UTC on 1st of every month
    tz: 'UTC',
  },
  removeOnComplete: { count: 12 },
  removeOnFail: { count: 12 },
} as const;
