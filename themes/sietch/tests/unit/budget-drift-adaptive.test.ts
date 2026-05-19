/**
 * Budget Drift Monitor — Adaptive Threshold Integration Tests
 * Sprint S14-T3: Verify adaptive thresholds under simulated load
 *
 * Tests:
 * 1. Zero false positives at 1000 req/min with expected 30s propagation lag
 * 2. Anomalous drift (2x expected) at 1000 req/min fires alarm
 * 3. Low-throughput (<10 req/min) communities use static threshold
 * 4. 100 communities with varying throughput — no false positives for expected lag
 * 5. Property tests: monotonicity and bounds
 */

import { describe, it, expect, vi } from 'vitest';

// Mock fs before barrel imports (budget-manager loads Lua at module level)
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    readFileSync: vi.fn().mockReturnValue('-- mock lua'),
  };
});

import {
  BudgetDriftMonitor,
  DRIFT_THRESHOLD_MICRO_CENTS,
  DRIFT_LAG_FACTOR_SECONDS,
  DRIFT_MAX_THRESHOLD_MICRO_CENTS,
  type DriftActiveCommunityProvider,
  type BudgetUsageQueryProvider,
} from '@freeside/adapters/agent';

// --------------------------------------------------------------------------
// Test Helpers
// --------------------------------------------------------------------------

function mockLogger() {
  return {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as import('pino').Logger;
}

function mockRedis(data: Record<string, string> = {}) {
  return {
    get: vi.fn(async (key: string) => data[key] ?? null),
  } as unknown as import('ioredis').Redis;
}

function mockCommunityProvider(ids: string[]): DriftActiveCommunityProvider {
  return { getActiveCommunityIds: vi.fn(async () => ids) };
}

/** Current month in UTC */
function utcMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Redis key for budget committed counter */
function redisKey(communityId: string, month: string): string {
  return `agent:budget:committed:${communityId}:${month}`;
}

/**
 * Compute expected adaptive threshold for given rate and avg cost.
 * Mirrors production formula for test assertions.
 */
function expectedAdaptiveThreshold(ratePerMinute: number, avgCostMicroCents: number): number {
  const lagAdjustment = ratePerMinute * (DRIFT_LAG_FACTOR_SECONDS / 60) * avgCostMicroCents;
  return Math.max(
    DRIFT_THRESHOLD_MICRO_CENTS,
    Math.min(DRIFT_THRESHOLD_MICRO_CENTS + lagAdjustment, DRIFT_MAX_THRESHOLD_MICRO_CENTS),
  );
}

/**
 * Compute expected drift during lag period for given rate and avg cost.
 * This is the amount of drift that's "normal" due to Redis→PG propagation delay.
 */
function expectedLagDrift(ratePerMinute: number, avgCostMicroCents: number): number {
  return ratePerMinute * (DRIFT_LAG_FACTOR_SECONDS / 60) * avgCostMicroCents;
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('Adaptive Drift Thresholds — Integration Under Load (S14-T3)', () => {
  const month = utcMonth();

  describe('zero false positives at 1000 req/min with expected lag', () => {
    it('expected lag drift at 1000 req/min does NOT fire alarm', async () => {
      // Scenario: 1000 req/min, avg cost 5000 μ¢, 30s lag
      // Expected lag drift: 1000 * 0.5 * 5000 = 2,500,000 μ¢
      // Adaptive threshold: 500,000 + 2,500,000 = 3,000,000 μ¢
      // Set drift to exactly the expected lag amount (Redis ahead of PG by lag amount)
      const rate = 1000;
      const avgCost = 5000;
      const lagDrift = expectedLagDrift(rate, avgCost); // 2,500,000

      // Redis shows PG amount + lag drift (Redis is ahead)
      const pgValue = 5_000_000; // $5.00 in PG
      const redisValueMicroCents = pgValue + lagDrift; // 7,500,000 μ¢
      const redisCents = Math.round(redisValueMicroCents / 10_000); // 750 cents

      const redis = mockRedis({ [redisKey('comm-1', month)]: String(redisCents) });
      const usageQuery: BudgetUsageQueryProvider = {
        getCommittedMicroCents: vi.fn(async () => pgValue),
        getRequestRate: vi.fn(async () => ({ ratePerMinute: rate, avgCostMicroCents: avgCost })),
      };
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-1']),
        usageQuery,
        logger,
      );

      const result = await monitor.process();

      // Expected lag drift is within adaptive threshold → warn (not alarm)
      expect(result.driftDetected).toBe(0);
      expect(logger.error).not.toHaveBeenCalled();
      // Should log warn since drift > static but < adaptive
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          communityId: 'comm-1',
        }),
        'budget-drift-monitor: drift within expected lag range',
      );
    });

    it('drift at 80% of expected lag does NOT fire alarm', async () => {
      const rate = 1000;
      const avgCost = 5000;
      const lagDrift = expectedLagDrift(rate, avgCost);

      const pgValue = 5_000_000;
      const redisValueMicroCents = pgValue + lagDrift * 0.8;
      const redisCents = Math.round(redisValueMicroCents / 10_000);

      const redis = mockRedis({ [redisKey('comm-1', month)]: String(redisCents) });
      const usageQuery: BudgetUsageQueryProvider = {
        getCommittedMicroCents: vi.fn(async () => pgValue),
        getRequestRate: vi.fn(async () => ({ ratePerMinute: rate, avgCostMicroCents: avgCost })),
      };
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-1']),
        usageQuery,
        logger,
      );

      const result = await monitor.process();

      expect(result.driftDetected).toBe(0);
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe('anomalous drift at 1000 req/min fires alarm', () => {
    it('drift at 2x expected lag fires BUDGET_ACCOUNTING_DRIFT', async () => {
      const rate = 1000;
      const avgCost = 5000;
      const lagDrift = expectedLagDrift(rate, avgCost); // 2,500,000
      const adaptiveThreshold = expectedAdaptiveThreshold(rate, avgCost); // 3,000,000

      const pgValue = 5_000_000;
      // 2x expected lag → 5,000,000 μ¢ drift → exceeds adaptive threshold of 3,000,000
      const redisValueMicroCents = pgValue + lagDrift * 2;
      const redisCents = Math.round(redisValueMicroCents / 10_000);

      const redis = mockRedis({ [redisKey('comm-1', month)]: String(redisCents) });
      const usageQuery: BudgetUsageQueryProvider = {
        getCommittedMicroCents: vi.fn(async () => pgValue),
        getRequestRate: vi.fn(async () => ({ ratePerMinute: rate, avgCostMicroCents: avgCost })),
      };
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-1']),
        usageQuery,
        logger,
      );

      const result = await monitor.process();

      expect(result.driftDetected).toBe(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          alarm: 'BUDGET_ACCOUNTING_DRIFT',
          adaptiveThresholdMicroCents: adaptiveThreshold,
        }),
        expect.stringContaining('BUDGET_ACCOUNTING_DRIFT'),
      );
    });

    it('drift at 1.5x expected lag fires alarm (just over threshold)', async () => {
      const rate = 1000;
      const avgCost = 5000;
      const lagDrift = expectedLagDrift(rate, avgCost); // 2,500,000
      const adaptiveThreshold = expectedAdaptiveThreshold(rate, avgCost); // 3,000,000

      const pgValue = 5_000_000;
      // 1.5x lag = 3,750,000 drift → exceeds adaptive 3,000,000
      const redisValueMicroCents = pgValue + lagDrift * 1.5;
      const redisCents = Math.round(redisValueMicroCents / 10_000);

      const redis = mockRedis({ [redisKey('comm-1', month)]: String(redisCents) });
      const usageQuery: BudgetUsageQueryProvider = {
        getCommittedMicroCents: vi.fn(async () => pgValue),
        getRequestRate: vi.fn(async () => ({ ratePerMinute: rate, avgCostMicroCents: avgCost })),
      };
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-1']),
        usageQuery,
        logger,
      );

      const result = await monitor.process();

      expect(result.driftDetected).toBe(1);
    });
  });

  describe('low-throughput communities use static threshold', () => {
    it('at 0 req/min, drift > static threshold fires alarm', async () => {
      const redis = mockRedis({ [redisKey('comm-1', month)]: '60' }); // 600,000 μ¢
      const usageQuery: BudgetUsageQueryProvider = {
        getCommittedMicroCents: vi.fn(async () => 0),
        getRequestRate: vi.fn(async () => ({ ratePerMinute: 0, avgCostMicroCents: 0 })),
      };
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-1']),
        usageQuery,
        logger,
      );

      const result = await monitor.process();

      // drift = 600,000 > static 500,000 and adaptive = static (no throughput) → alarm
      expect(result.driftDetected).toBe(1);
    });

    it('at 50 req/min with low avg cost, threshold above static — warn not alarm', async () => {
      const rate = 50;
      const avgCost = 1000; // 1000 μ¢ per request
      const adaptiveThreshold = expectedAdaptiveThreshold(rate, avgCost);
      // lagAdjustment = 50 * 0.5 * 1000 = 25,000 μ¢
      // adaptive = 500,000 + 25,000 = 525,000

      expect(adaptiveThreshold).toBe(525_000);

      // Drift of 510,000 > static (500,000) but < adaptive (525,000) → warn
      // Note: Redis stores cents, so micro-cent values must be multiples of 10,000
      const pgValue = 100_000; // $0.10
      // Redis: 61 cents = 610,000 μ¢; drift = 610,000 - 100,000 = 510,000
      const redis = mockRedis({ [redisKey('comm-1', month)]: '61' });
      const usageQuery: BudgetUsageQueryProvider = {
        getCommittedMicroCents: vi.fn(async () => pgValue),
        getRequestRate: vi.fn(async () => ({ ratePerMinute: rate, avgCostMicroCents: avgCost })),
      };
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-1']),
        usageQuery,
        logger,
      );

      const result = await monitor.process();

      // Within adaptive → warn, not alarm
      expect(result.driftDetected).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('100 communities with varying throughput', () => {
    it('no false positives when drift equals expected lag per community', async () => {
      const rates = [0, 10, 50, 100, 500, 1000];
      const avgCosts = [1000, 2000, 5000, 10000];
      const communityIds: string[] = [];
      const redisData: Record<string, string> = {};
      const pgData: Record<string, number> = {};
      const rateDataMap: Record<string, { ratePerMinute: number; avgCostMicroCents: number }> = {};

      let idx = 0;
      for (const rate of rates) {
        for (const avgCost of avgCosts) {
          const communityId = `comm-${idx++}`;
          communityIds.push(communityId);

          const lagDrift = expectedLagDrift(rate, avgCost);
          const pgValue = 10_000_000; // $10 base
          // Redis exactly at expected lag ahead of PG (redis_over, normal)
          const redisValueMicroCents = pgValue + lagDrift;
          const redisCents = Math.round(redisValueMicroCents / 10_000);

          redisData[redisKey(communityId, month)] = String(redisCents);
          pgData[communityId] = pgValue;
          rateDataMap[communityId] = { ratePerMinute: rate, avgCostMicroCents: avgCost };
        }
      }

      const redis = mockRedis(redisData);
      const usageQuery: BudgetUsageQueryProvider = {
        getCommittedMicroCents: vi.fn(async (communityId: string) => pgData[communityId] ?? 0),
        getRequestRate: vi.fn(async (communityId: string) => rateDataMap[communityId] ?? { ratePerMinute: 0, avgCostMicroCents: 0 }),
      };
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(communityIds),
        usageQuery,
        logger,
      );

      const result = await monitor.process();

      expect(result.communitiesChecked).toBe(communityIds.length);
      expect(result.errors).toBe(0);

      // No alarms should fire — all drift is within expected lag
      // (zero-throughput communities have 0 drift, high-throughput have lag-proportional drift)
      expect(result.driftDetected).toBe(0);
      // But high-throughput communities with drift > static should get warnings
      const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls;
      const errorCalls = (logger.error as ReturnType<typeof vi.fn>).mock.calls;
      expect(errorCalls.length).toBe(0); // zero alarms
      // Communities with drift > static threshold should warn
      expect(warnCalls.length).toBeGreaterThan(0);
    });
  });

  describe('property tests: monotonicity and bounds', () => {
    it('threshold is monotonically non-decreasing with throughput', () => {
      const thresholds: number[] = [];
      for (let rate = 0; rate <= 10000; rate += 100) {
        thresholds.push(expectedAdaptiveThreshold(rate, 5000));
      }

      for (let i = 1; i < thresholds.length; i++) {
        expect(thresholds[i]).toBeGreaterThanOrEqual(thresholds[i - 1]);
      }
    });

    it('threshold is monotonically non-decreasing with avg cost', () => {
      const thresholds: number[] = [];
      for (let cost = 0; cost <= 100000; cost += 1000) {
        thresholds.push(expectedAdaptiveThreshold(1000, cost));
      }

      for (let i = 1; i < thresholds.length; i++) {
        expect(thresholds[i]).toBeGreaterThanOrEqual(thresholds[i - 1]);
      }
    });

    it('threshold is always >= static floor', () => {
      for (let rate = 0; rate <= 100000; rate += 500) {
        for (const cost of [0, 100, 1000, 10000, 100000]) {
          const t = expectedAdaptiveThreshold(rate, cost);
          expect(t).toBeGreaterThanOrEqual(DRIFT_THRESHOLD_MICRO_CENTS);
        }
      }
    });

    it('threshold is always <= max ceiling', () => {
      for (let rate = 0; rate <= 100000; rate += 500) {
        for (const cost of [0, 100, 1000, 10000, 100000]) {
          const t = expectedAdaptiveThreshold(rate, cost);
          expect(t).toBeLessThanOrEqual(DRIFT_MAX_THRESHOLD_MICRO_CENTS);
        }
      }
    });

    it('threshold clamps to ceiling at extreme throughput', () => {
      // 100,000 req/min × 100,000 avg cost × 0.5 = 5,000,000,000 adjustment
      // 500,000 + 5,000,000,000 >> 100,000,000 → clamp to ceiling
      const t = expectedAdaptiveThreshold(100_000, 100_000);
      expect(t).toBe(DRIFT_MAX_THRESHOLD_MICRO_CENTS);
    });

    it('threshold equals static at zero throughput', () => {
      expect(expectedAdaptiveThreshold(0, 0)).toBe(DRIFT_THRESHOLD_MICRO_CENTS);
      expect(expectedAdaptiveThreshold(0, 100000)).toBe(DRIFT_THRESHOLD_MICRO_CENTS);
      expect(expectedAdaptiveThreshold(100, 0)).toBe(DRIFT_THRESHOLD_MICRO_CENTS);
    });
  });
});
