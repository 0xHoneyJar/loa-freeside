/**
 * Budget Drift Monitor Tests
 * Sprint S12-T4: Budget Drift Monitoring Job (§4.5.1)
 *
 * Tests:
 * 1. Unit conversion: Redis cents → micro-cents (×10,000)
 * 2. Drift threshold comparison uses absolute value
 * 3. No floating-point arithmetic for financial calculations
 * 4. Timeout handling prevents slow queries from blocking the job
 * 5. Error in one community doesn't stop processing of others
 * 6. getCurrentMonth() uses UTC consistently
 * 7. BUDGET_ACCOUNTING_DRIFT alarm fires when drift > $0.50
 * 8. Timer cleanup in withTimeout (no leaks)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs before any imports that trigger Lua loading
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
  DRIFT_MONITOR_JOB_CONFIG,
  type DriftActiveCommunityProvider,
  type BudgetUsageQueryProvider,
  type CommunityDrift,
} from '@arrakis/adapters/agent';

// --------------------------------------------------------------------------
// Mocks
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

function mockUsageQuery(
  data: Record<string, number> = {},
  rateData: Record<string, { ratePerMinute: number; avgCostMicroCents: number }> = {},
): BudgetUsageQueryProvider {
  return {
    getCommittedMicroCents: vi.fn(async (communityId: string) => data[communityId] ?? 0),
    getRequestRate: vi.fn(async (communityId: string) => rateData[communityId] ?? { ratePerMinute: 0, avgCostMicroCents: 0 }),
  };
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Build a Redis key for the committed counter */
function redisKey(communityId: string, month: string): string {
  return `agent:budget:committed:${communityId}:${month}`;
}

/** Get current month in UTC YYYY-MM format (same logic as production) */
function utcMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('BudgetDriftMonitor', () => {
  const month = utcMonth();

  describe('constants', () => {
    it('DRIFT_THRESHOLD_MICRO_CENTS = 500,000 ($0.50)', () => {
      expect(DRIFT_THRESHOLD_MICRO_CENTS).toBe(500_000);
    });

    it('DRIFT_MONITOR_JOB_CONFIG runs every 15 minutes', () => {
      expect(DRIFT_MONITOR_JOB_CONFIG.repeat.every).toBe(15 * 60 * 1000);
      expect(DRIFT_MONITOR_JOB_CONFIG.name).toBe('budget-drift-monitor');
    });
  });

  describe('unit conversion: cents → micro-cents', () => {
    it('1 cent in Redis = 10,000 micro-cents (not 100)', async () => {
      const redis = mockRedis({ [redisKey('comm-1', month)]: '1' });
      const usageQuery = mockUsageQuery({ 'comm-1': 10_000 });
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-1']),
        usageQuery,
        logger,
      );

      const result = await monitor.process();
      // 1 cent × 10,000 = 10,000 micro-cents; PG = 10,000 → drift = 0
      expect(result.maxDriftMicroCents).toBe(0);
      expect(result.driftDetected).toBe(0);
    });

    it('50 cents in Redis = 500,000 micro-cents', async () => {
      const redis = mockRedis({ [redisKey('comm-1', month)]: '50' });
      const usageQuery = mockUsageQuery({ 'comm-1': 500_000 });
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-1']),
        usageQuery,
        logger,
      );

      const result = await monitor.process();
      expect(result.maxDriftMicroCents).toBe(0);
      expect(result.driftDetected).toBe(0);
    });

    it('100 cents in Redis = 1,000,000 micro-cents ($1.00)', async () => {
      const redis = mockRedis({ [redisKey('comm-1', month)]: '100' });
      // PG shows $0.50 less → drift of 500,001 micro-cents (just over threshold)
      const usageQuery = mockUsageQuery({ 'comm-1': 499_999 });
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-1']),
        usageQuery,
        logger,
      );

      const result = await monitor.process();
      // 100 × 10,000 = 1,000,000; 1,000,000 - 499,999 = 500,001
      expect(result.maxDriftMicroCents).toBe(500_001);
      expect(result.driftDetected).toBe(1);
    });
  });

  describe('drift detection', () => {
    it('no alarm when drift exactly at threshold (not >)', async () => {
      // Redis: 50 cents = 500,000 micro-cents; PG: 0 → drift = 500,000
      const redis = mockRedis({ [redisKey('comm-1', month)]: '50' });
      const usageQuery = mockUsageQuery({ 'comm-1': 0 });
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-1']),
        usageQuery,
        logger,
      );

      const result = await monitor.process();
      // Drift = 500,000 which is NOT > 500,000 (it's equal)
      expect(result.driftDetected).toBe(0);
    });

    it('alarm fires when drift exceeds threshold by 1 micro-cent', async () => {
      // Redis: 51 cents = 510,000 micro-cents; PG: 9,999 → drift = 500,001
      const redis = mockRedis({ [redisKey('comm-1', month)]: '51' });
      const usageQuery = mockUsageQuery({ 'comm-1': 9_999 });
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

    it('drift uses absolute value — PG over Redis also triggers', async () => {
      // Redis: explicit '0' (not null); PG: 500,001 → drift = -500,001 → |drift| > threshold
      // Uses '0' instead of absent key to test pg_over direction (F-2: null = redis_missing)
      const redis = mockRedis({ [redisKey('comm-1', month)]: '0' });
      const usageQuery = mockUsageQuery({ 'comm-1': 500_001 });
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-1']),
        usageQuery,
        logger,
      );

      const result = await monitor.process();
      expect(result.driftDetected).toBe(1);
      expect(result.maxDriftMicroCents).toBe(500_001);
    });

    it('logs BUDGET_ACCOUNTING_DRIFT alarm with correct fields', async () => {
      const redis = mockRedis({ [redisKey('comm-1', month)]: '100' });
      const usageQuery = mockUsageQuery({ 'comm-1': 0 });
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-1']),
        usageQuery,
        logger,
      );

      await monitor.process();

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          communityId: 'comm-1',
          redisMicroCents: 1_000_000,
          pgMicroCents: 0,
          driftMicroCents: 1_000_000,
          driftDirection: 'redis_over',
          thresholdMicroCents: DRIFT_THRESHOLD_MICRO_CENTS,
          alarm: 'BUDGET_ACCOUNTING_DRIFT',
        }),
        expect.stringContaining('BUDGET_ACCOUNTING_DRIFT'),
      );
    });

    it('drift direction is redis_over when Redis > PG', async () => {
      const redis = mockRedis({ [redisKey('comm-1', month)]: '10' });
      const usageQuery = mockUsageQuery({ 'comm-1': 50_000 });
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-1']),
        usageQuery,
        logger,
      );

      await monitor.process();

      // 10 × 10,000 = 100,000; 100,000 - 50,000 = 50,000 → redis_over
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ driftDirection: 'redis_over' }),
        expect.any(String),
      );
    });

    it('drift direction is pg_over when PG > Redis', async () => {
      const redis = mockRedis({ [redisKey('comm-1', month)]: '1' });
      const usageQuery = mockUsageQuery({ 'comm-1': 20_000 });
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-1']),
        usageQuery,
        logger,
      );

      await monitor.process();

      // 1 × 10,000 = 10,000; 10,000 - 20,000 = -10,000 → pg_over
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ driftDirection: 'pg_over' }),
        expect.any(String),
      );
    });

    it('drift direction is none when perfectly balanced', async () => {
      const redis = mockRedis({ [redisKey('comm-1', month)]: '5' });
      const usageQuery = mockUsageQuery({ 'comm-1': 50_000 });
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-1']),
        usageQuery,
        logger,
      );

      await monitor.process();

      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ driftDirection: 'none' }),
        expect.any(String),
      );
    });
  });

  describe('multiple communities', () => {
    it('checks all communities and reports aggregate stats', async () => {
      const redis = mockRedis({
        [redisKey('comm-1', month)]: '100', // 1,000,000 μ¢
        [redisKey('comm-2', month)]: '10',  // 100,000 μ¢
        [redisKey('comm-3', month)]: '0',   // 0 μ¢
      });
      const usageQuery = mockUsageQuery({
        'comm-1': 0,        // drift: 1,000,000 → alarm
        'comm-2': 100_000,  // drift: 0 → no alarm
        'comm-3': 400_000,  // drift: -400,000 → no alarm (under threshold)
      });
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-1', 'comm-2', 'comm-3']),
        usageQuery,
        logger,
      );

      const result = await monitor.process();

      expect(result.communitiesChecked).toBe(3);
      // comm-1: drift 1,000,000 (redis_over) > adaptive → BUDGET_ACCOUNTING_DRIFT
      // comm-3: PG 400,000 > Redis 0 → BUDGET_HARD_OVERSPEND (S14-T2: PG > Redis = unconditional)
      expect(result.driftDetected).toBe(2);
      expect(result.maxDriftMicroCents).toBe(1_000_000);
      expect(result.errors).toBe(0);
    });
  });

  describe('error isolation', () => {
    it('error in one community does not stop others', async () => {
      const redis = mockRedis({
        [redisKey('comm-1', month)]: '10',
        // comm-2 will fail in usageQuery
        [redisKey('comm-3', month)]: '5',
      });
      const usageQuery: BudgetUsageQueryProvider = {
        getCommittedMicroCents: vi.fn(async (communityId: string) => {
          if (communityId === 'comm-2') throw new Error('PG timeout');
          return 0;
        }),
        getRequestRate: vi.fn(async () => ({ ratePerMinute: 0, avgCostMicroCents: 0 })),
      };
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-1', 'comm-2', 'comm-3']),
        usageQuery,
        logger,
      );

      const result = await monitor.process();

      expect(result.communitiesChecked).toBe(3);
      expect(result.errors).toBe(1);
      // comm-1 and comm-3 still processed
      expect(logger.debug).toHaveBeenCalledTimes(2);
    });

    it('Redis returning null fires BUDGET_REDIS_KEY_MISSING (F-2: not hard overspend)', async () => {
      const redis = mockRedis({}); // no keys at all → null
      const usageQuery = mockUsageQuery({ 'comm-1': 100_000 });
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-1']),
        usageQuery,
        logger,
      );

      const result = await monitor.process();

      // Redis null + PG > 0 → redis_missing → BUDGET_REDIS_KEY_MISSING
      expect(result.maxDriftMicroCents).toBe(100_000);
      expect(result.driftDetected).toBe(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          communityId: 'comm-1',
          driftDirection: 'redis_missing',
          alarm: 'BUDGET_REDIS_KEY_MISSING',
        }),
        expect.stringContaining('BUDGET_REDIS_KEY_MISSING'),
      );
    });
  });

  describe('timeout handling', () => {
    it('rejects when community check exceeds timeout', async () => {
      const redis: import('ioredis').Redis = {
        get: vi.fn(async () => {
          // Simulate slow Redis by never resolving quickly
          await new Promise((resolve) => setTimeout(resolve, 15_000));
          return '10';
        }),
      } as unknown as import('ioredis').Redis;
      const usageQuery = mockUsageQuery({});
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-slow']),
        usageQuery,
        logger,
      );

      const result = await monitor.process();

      expect(result.errors).toBe(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.objectContaining({
            message: expect.stringContaining('timed out'),
          }),
          communityId: 'comm-slow',
        }),
        expect.stringContaining('error checking community'),
      );
    }, 15_000);

    it('clears timer when community check resolves before timeout', async () => {
      // Track setTimeout/clearTimeout
      const originalSetTimeout = globalThis.setTimeout;
      const originalClearTimeout = globalThis.clearTimeout;
      const timerIds: ReturnType<typeof setTimeout>[] = [];
      const clearedIds: ReturnType<typeof setTimeout>[] = [];

      vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: Function, ms: number) => {
        const id = originalSetTimeout(fn, ms);
        timerIds.push(id);
        return id;
      }) as typeof setTimeout);

      vi.spyOn(globalThis, 'clearTimeout').mockImplementation((id) => {
        if (id) clearedIds.push(id as ReturnType<typeof setTimeout>);
        originalClearTimeout(id);
      });

      const redis = mockRedis({ [redisKey('comm-1', month)]: '5' });
      const usageQuery = mockUsageQuery({ 'comm-1': 50_000 });
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-1']),
        usageQuery,
        logger,
      );

      await monitor.process();

      // The withTimeout timer should have been cleared
      expect(clearedIds.length).toBeGreaterThanOrEqual(1);

      vi.restoreAllMocks();
    });
  });

  describe('empty/missing data', () => {
    it('handles no active communities gracefully', async () => {
      const redis = mockRedis({});
      const usageQuery = mockUsageQuery({});
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider([]),
        usageQuery,
        logger,
      );

      const result = await monitor.process();

      expect(result.communitiesChecked).toBe(0);
      expect(result.driftDetected).toBe(0);
      expect(result.errors).toBe(0);
      expect(result.maxDriftMicroCents).toBe(0);
    });

    it('handles non-numeric Redis values via safeInt fallback', async () => {
      const redis = mockRedis({ [redisKey('comm-1', month)]: 'garbage' });
      const usageQuery = mockUsageQuery({ 'comm-1': 100_000 });
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-1']),
        usageQuery,
        logger,
      );

      const result = await monitor.process();

      // safeInt('garbage') = 0; 0 × 10,000 = 0; 0 - 100,000 = -100,000
      expect(result.maxDriftMicroCents).toBe(100_000);
    });

    it('handles negative Redis values via safeInt clamping', async () => {
      const redis = mockRedis({ [redisKey('comm-1', month)]: '-50' });
      const usageQuery = mockUsageQuery({ 'comm-1': 0 });
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-1']),
        usageQuery,
        logger,
      );

      const result = await monitor.process();

      // safeInt('-50') = max(0, trunc(-50)) = 0; 0 × 10,000 = 0
      expect(result.maxDriftMicroCents).toBe(0);
    });
  });

  describe('integer arithmetic', () => {
    it('no floating-point in conversion — always integer results', async () => {
      const redis = mockRedis({ [redisKey('comm-1', month)]: '33' });
      const usageQuery = mockUsageQuery({ 'comm-1': 330_000 });
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-1']),
        usageQuery,
        logger,
      );

      await monitor.process();

      // 33 × 10,000 = 330,000 exactly (integer × integer = integer)
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          redisMicroCents: 330_000,
          pgMicroCents: 330_000,
          driftMicroCents: 0,
        }),
        expect.any(String),
      );
    });

    it('safeInt truncates fractional Redis values', async () => {
      const redis = mockRedis({ [redisKey('comm-1', month)]: '10.7' });
      const usageQuery = mockUsageQuery({ 'comm-1': 100_000 });
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-1']),
        usageQuery,
        logger,
      );

      await monitor.process();

      // safeInt('10.7') = max(0, trunc(10.7)) = 10; 10 × 10,000 = 100,000
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ redisMicroCents: 100_000 }),
        expect.any(String),
      );
    });
  });

  describe('cycle complete logging', () => {
    it('logs summary at info level after processing all communities', async () => {
      const redis = mockRedis({ [redisKey('comm-1', month)]: '5' });
      const usageQuery = mockUsageQuery({ 'comm-1': 50_000 });
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-1']),
        usageQuery,
        logger,
      );

      await monitor.process();

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          communitiesChecked: 1,
          driftDetected: 0,
          errors: 0,
          maxDriftMicroCents: 0,
          month,
        }),
        'budget-drift-monitor: cycle complete',
      );
    });
  });

  // --------------------------------------------------------------------------
  // Adaptive Drift Thresholds (S14-T2)
  // --------------------------------------------------------------------------

  describe('adaptive drift thresholds (S14-T2)', () => {
    it('exports new constants', () => {
      expect(DRIFT_LAG_FACTOR_SECONDS).toBe(30);
      expect(DRIFT_MAX_THRESHOLD_MICRO_CENTS).toBe(100_000_000);
    });

    it('at zero throughput, threshold equals static DRIFT_THRESHOLD_MICRO_CENTS', async () => {
      // Redis: 100 cents = 1,000,000 μ¢; PG: 0 → drift = 1,000,000 (> 500,000 static)
      const redis = mockRedis({ [redisKey('comm-1', month)]: '100' });
      const usageQuery = mockUsageQuery(
        { 'comm-1': 0 },
        { 'comm-1': { ratePerMinute: 0, avgCostMicroCents: 0 } },
      );
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-1']),
        usageQuery,
        logger,
      );

      const result = await monitor.process();

      // Zero throughput → adaptive = static = 500,000; drift 1,000,000 > 500,000 → alarm
      expect(result.driftDetected).toBe(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          alarm: 'BUDGET_ACCOUNTING_DRIFT',
          adaptiveThresholdMicroCents: DRIFT_THRESHOLD_MICRO_CENTS,
        }),
        expect.stringContaining('BUDGET_ACCOUNTING_DRIFT'),
      );
    });

    it('at high throughput, drift within expected lag triggers warn not alarm', async () => {
      // Scenario: 1000 req/min, avg cost 5000 μ¢, lag 30s
      // Expected lag drift: 1000 * (30/60) * 5000 = 2,500,000 μ¢
      // Adaptive threshold: 500,000 + 2,500,000 = 3,000,000 μ¢
      // Redis: 300 cents = 3,000,000 μ¢; PG: 1,000,000 → drift = 2,000,000
      // 2,000,000 > static (500,000) but < adaptive (3,000,000) → WARN
      const redis = mockRedis({ [redisKey('comm-1', month)]: '300' });
      const usageQuery = mockUsageQuery(
        { 'comm-1': 1_000_000 },
        { 'comm-1': { ratePerMinute: 1000, avgCostMicroCents: 5000 } },
      );
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-1']),
        usageQuery,
        logger,
      );

      const result = await monitor.process();

      // Should warn, not alarm
      expect(result.driftDetected).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          communityId: 'comm-1',
          staticThresholdMicroCents: DRIFT_THRESHOLD_MICRO_CENTS,
          adaptiveThresholdMicroCents: 3_000_000,
        }),
        'budget-drift-monitor: drift within expected lag range',
      );
    });

    it('at high throughput, drift exceeding adaptive threshold fires alarm', async () => {
      // 1000 req/min, avg cost 5000 μ¢ → adaptive = 3,000,000
      // Redis: 500 cents = 5,000,000; PG: 1,000,000 → drift = 4,000,000 > 3,000,000
      const redis = mockRedis({ [redisKey('comm-1', month)]: '500' });
      const usageQuery = mockUsageQuery(
        { 'comm-1': 1_000_000 },
        { 'comm-1': { ratePerMinute: 1000, avgCostMicroCents: 5000 } },
      );
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
          adaptiveThresholdMicroCents: 3_000_000,
        }),
        expect.stringContaining('BUDGET_ACCOUNTING_DRIFT'),
      );
    });

    it('adaptive threshold never exceeds DRIFT_MAX_THRESHOLD_MICRO_CENTS ceiling', async () => {
      // Extreme throughput: 100,000 req/min, avg cost 100,000 μ¢
      // Raw: 500,000 + 100,000 * 0.5 * 100,000 = 5,000,500,000 → clamped to 100,000,000
      const redis = mockRedis({ [redisKey('comm-1', month)]: '10100' }); // 101,000,000 μ¢
      const usageQuery = mockUsageQuery(
        { 'comm-1': 0 },
        { 'comm-1': { ratePerMinute: 100_000, avgCostMicroCents: 100_000 } },
      );
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-1']),
        usageQuery,
        logger,
      );

      const result = await monitor.process();

      // Drift = 101,000,000 > ceiling 100,000,000 → alarm fires
      expect(result.driftDetected).toBe(1);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          adaptiveThresholdMicroCents: DRIFT_MAX_THRESHOLD_MICRO_CENTS,
        }),
        expect.any(String),
      );
    });

    it('adaptive threshold never drops below static floor (monotonicity)', async () => {
      // Even with zero rate, threshold = static floor
      const redis = mockRedis({ [redisKey('comm-1', month)]: '5' });
      const usageQuery = mockUsageQuery(
        { 'comm-1': 50_000 },
        { 'comm-1': { ratePerMinute: 0, avgCostMicroCents: 0 } },
      );
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-1']),
        usageQuery,
        logger,
      );

      await monitor.process();

      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          adaptiveThresholdMicroCents: DRIFT_THRESHOLD_MICRO_CENTS,
        }),
        expect.any(String),
      );
    });

    it('increasing throughput never decreases threshold (property test)', async () => {
      const thresholds: number[] = [];

      for (const rate of [0, 10, 100, 500, 1000, 5000, 10000]) {
        const redis = mockRedis({ [redisKey('comm-1', month)]: '5' });
        const usageQuery = mockUsageQuery(
          { 'comm-1': 50_000 },
          { 'comm-1': { ratePerMinute: rate, avgCostMicroCents: 3000 } },
        );
        const logger = mockLogger();
        const monitor = new BudgetDriftMonitor(
          redis,
          mockCommunityProvider(['comm-1']),
          usageQuery,
          logger,
        );

        await monitor.process();

        // Extract adaptive threshold from debug log
        const debugCall = (logger.debug as ReturnType<typeof vi.fn>).mock.calls[0];
        thresholds.push(debugCall[0].adaptiveThresholdMicroCents);
      }

      // Each threshold must be >= the previous one (monotonic non-decreasing)
      for (let i = 1; i < thresholds.length; i++) {
        expect(thresholds[i]).toBeGreaterThanOrEqual(thresholds[i - 1]);
      }

      // All thresholds must be >= static floor
      for (const t of thresholds) {
        expect(t).toBeGreaterThanOrEqual(DRIFT_THRESHOLD_MICRO_CENTS);
      }

      // All thresholds must be <= ceiling
      for (const t of thresholds) {
        expect(t).toBeLessThanOrEqual(DRIFT_MAX_THRESHOLD_MICRO_CENTS);
      }
    });

    it('uses 60-min trailing window for request rate (not 15-min)', async () => {
      const redis = mockRedis({ [redisKey('comm-1', month)]: '5' });
      const usageQuery = mockUsageQuery(
        { 'comm-1': 50_000 },
        { 'comm-1': { ratePerMinute: 100, avgCostMicroCents: 1000 } },
      );
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-1']),
        usageQuery,
        logger,
      );

      await monitor.process();

      // Verify getRequestRate was called with 60-min window
      expect(usageQuery.getRequestRate).toHaveBeenCalledWith('comm-1', 60);
    });

    it('debug log includes full observability fields', async () => {
      const redis = mockRedis({ [redisKey('comm-1', month)]: '5' });
      const usageQuery = mockUsageQuery(
        { 'comm-1': 50_000 },
        { 'comm-1': { ratePerMinute: 200, avgCostMicroCents: 2000 } },
      );
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-1']),
        usageQuery,
        logger,
      );

      await monitor.process();

      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          staticThresholdMicroCents: DRIFT_THRESHOLD_MICRO_CENTS,
          adaptiveThresholdMicroCents: expect.any(Number),
          ratePerMinute: 200,
          avgCostMicroCents: 2000,
        }),
        expect.any(String),
      );
    });
  });

  // --------------------------------------------------------------------------
  // Hard Overspend Rule (S14-T2)
  // --------------------------------------------------------------------------

  describe('hard overspend rule (S14-T2)', () => {
    it('PG > Redis fires BUDGET_HARD_OVERSPEND alarm unconditionally', async () => {
      // Redis: 5 cents = 50,000 μ¢; PG: 1,000,000 μ¢ → PG over Redis → hard overspend
      // Uses non-null Redis value — null Redis triggers BUDGET_REDIS_KEY_MISSING (F-2)
      const redis = mockRedis({ [redisKey('comm-1', month)]: '5' });
      const usageQuery = mockUsageQuery(
        { 'comm-1': 1_000_000 },
        { 'comm-1': { ratePerMinute: 0, avgCostMicroCents: 0 } },
      );
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
          communityId: 'comm-1',
          alarm: 'BUDGET_HARD_OVERSPEND',
          driftDirection: 'pg_over',
        }),
        expect.stringContaining('BUDGET_HARD_OVERSPEND'),
      );
    });

    it('PG > Redis fires alarm even with high adaptive threshold', async () => {
      // High throughput should NOT suppress overspend
      const redis = mockRedis({ [redisKey('comm-1', month)]: '10' }); // 100,000 μ¢
      const usageQuery = mockUsageQuery(
        { 'comm-1': 200_000 }, // PG: 200,000 > Redis: 100,000
        { 'comm-1': { ratePerMinute: 10000, avgCostMicroCents: 50000 } }, // Very high throughput
      );
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
          alarm: 'BUDGET_HARD_OVERSPEND',
        }),
        expect.stringContaining('BUDGET_HARD_OVERSPEND'),
      );
    });

    it('Redis > PG does NOT trigger hard overspend (normal lag pattern)', async () => {
      // Redis: 100 cents = 1,000,000 μ¢; PG: 0 → redis_over (normal lag)
      const redis = mockRedis({ [redisKey('comm-1', month)]: '100' });
      const usageQuery = mockUsageQuery(
        { 'comm-1': 0 },
        { 'comm-1': { ratePerMinute: 0, avgCostMicroCents: 0 } },
      );
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-1']),
        usageQuery,
        logger,
      );

      const result = await monitor.process();

      // Should be BUDGET_ACCOUNTING_DRIFT, not BUDGET_HARD_OVERSPEND
      expect(result.driftDetected).toBe(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          alarm: 'BUDGET_ACCOUNTING_DRIFT',
        }),
        expect.stringContaining('BUDGET_ACCOUNTING_DRIFT'),
      );
    });

    it('Redis null + PG = 0 does not trigger redis_missing (no data to be missing)', async () => {
      const redis = mockRedis({}); // null
      const usageQuery = mockUsageQuery(
        { 'comm-1': 0 },
        { 'comm-1': { ratePerMinute: 0, avgCostMicroCents: 0 } },
      );
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-1']),
        usageQuery,
        logger,
      );

      const result = await monitor.process();

      // Redis null but PG also 0 → direction = 'none' (not redis_missing)
      expect(result.driftDetected).toBe(0);
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ driftDirection: 'none' }),
        expect.any(String),
      );
    });

    it('PG = Redis = 0 does not trigger any alarm', async () => {
      const redis = mockRedis({});
      const usageQuery = mockUsageQuery(
        { 'comm-1': 0 },
        { 'comm-1': { ratePerMinute: 0, avgCostMicroCents: 0 } },
      );
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
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });
});
