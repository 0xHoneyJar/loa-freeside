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
): BudgetUsageQueryProvider {
  return {
    getCommittedMicroCents: vi.fn(async (communityId: string) => data[communityId] ?? 0),
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
      // Redis: 0 cents; PG: 500,001 → drift = -500,001 → |drift| > threshold
      const redis = mockRedis({});
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
      expect(result.driftDetected).toBe(1); // only comm-1
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

    it('Redis returning null treated as 0 cents', async () => {
      const redis = mockRedis({}); // no keys at all
      const usageQuery = mockUsageQuery({ 'comm-1': 100_000 });
      const logger = mockLogger();
      const monitor = new BudgetDriftMonitor(
        redis,
        mockCommunityProvider(['comm-1']),
        usageQuery,
        logger,
      );

      const result = await monitor.process();

      // 0 × 10,000 = 0; 0 - 100,000 = -100,000 → pg_over, under threshold
      expect(result.maxDriftMicroCents).toBe(100_000);
      expect(result.driftDetected).toBe(0);
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
});
