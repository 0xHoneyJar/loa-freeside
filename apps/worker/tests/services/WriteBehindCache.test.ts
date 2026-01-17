/**
 * WriteBehindCache Tests
 * Sprint S-10: Write-Behind Cache
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import pino from 'pino';

// Mock TenantMetrics to avoid prom-client dependency
vi.mock('../../src/services/TenantMetrics.js', () => ({
  recordCommand: vi.fn(),
}));

import { WriteBehindCache, createWriteBehindCache } from '../../src/services/WriteBehindCache.js';
import type { ScoreRepository, ScoreUpdate } from '../../src/repositories/ScoreRepository.js';
import type { TenantRequestContext } from '../../src/services/TenantContext.js';
import type { Score } from '../../src/infrastructure/scylla/types.js';
import type { PostgresSyncFn, PendingSyncItem, SyncBatchResult } from '../../src/services/WriteBehindCache.js';

// Mock score repository
const createMockScoreRepo = () => ({
  getScore: vi.fn(),
  getScores: vi.fn(),
  updateScore: vi.fn(),
  batchUpdateScores: vi.fn(),
  updateRanks: vi.fn(),
  getScoreHistory: vi.fn(),
});

const logger = pino({ level: 'silent' });

const createTestContext = (communityId = 'test-community'): TenantRequestContext => ({
  communityId,
  guildId: 'guild-123',
  userId: 'user-456',
  tier: 'pro',
  config: {
    communityId,
    guildId: 'guild-123',
    tier: 'pro',
    features: {
      customBranding: true,
      advancedAnalytics: true,
      prioritySupport: false,
      unlimitedCommands: false,
    },
    rateLimits: {
      commandsPerMinute: 100,
      eligibilityChecksPerHour: 1000,
      syncRequestsPerDay: 10,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  requestId: 'req-test',
  startTime: Date.now(),
});

const createMockScore = (profileId: string, communityId = 'test-community'): Score => ({
  communityId,
  profileId,
  convictionScore: '500',
  activityScore: '100',
  currentRank: 5,
  updatedAt: new Date(),
});

describe('WriteBehindCache', () => {
  let mockScoreRepo: ReturnType<typeof createMockScoreRepo>;
  let mockPostgresSync: PostgresSyncFn;
  let cache: WriteBehindCache;

  beforeEach(() => {
    mockScoreRepo = createMockScoreRepo();
    mockPostgresSync = vi.fn().mockResolvedValue({ success: 1, failed: 0 } as SyncBatchResult);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (cache) {
      await cache.stop();
    }
  });

  describe('updateScore', () => {
    it('should write to ScyllaDB and queue PostgreSQL sync', async () => {
      const ctx = createTestContext();
      const update: ScoreUpdate = {
        profileId: 'profile-1',
        convictionDelta: '100',
        eventType: 'stake',
      };
      const expectedScore = createMockScore('profile-1');

      mockScoreRepo.updateScore.mockResolvedValue(expectedScore);

      cache = createWriteBehindCache(
        mockScoreRepo as unknown as ScoreRepository,
        mockPostgresSync,
        logger,
        { syncIntervalMs: 1000000 } // Long interval so sync doesn't auto-run
      );

      const result = await cache.updateScore(ctx, update);

      // Verify ScyllaDB was written
      expect(mockScoreRepo.updateScore).toHaveBeenCalledWith(ctx, update);
      expect(result).toEqual(expectedScore);

      // Verify item was queued
      const status = cache.getStatus();
      expect(status.pendingCount).toBe(1);

      // Verify PostgreSQL sync was NOT called yet (async)
      expect(mockPostgresSync).not.toHaveBeenCalled();
    });

    it('should apply backpressure when queue is full', async () => {
      const ctx = createTestContext();

      // Each profile gets unique mock
      mockScoreRepo.updateScore.mockImplementation(async (_ctx, update) =>
        createMockScore(update.profileId)
      );
      mockPostgresSync.mockResolvedValue({ success: 5, failed: 0 });

      cache = createWriteBehindCache(
        mockScoreRepo as unknown as ScoreRepository,
        mockPostgresSync,
        logger,
        {
          syncIntervalMs: 1000000,
          maxPendingItems: 5,
          batchSize: 10,
        }
      );

      // Fill up the queue with unique profiles
      for (let i = 0; i < 5; i++) {
        await cache.updateScore(ctx, {
          profileId: `profile-${i}`,
          convictionDelta: '100',
          eventType: 'stake',
        });
      }

      expect(cache.getStatus().pendingCount).toBe(5);

      // Next update should trigger sync due to backpressure
      await cache.updateScore(ctx, {
        profileId: 'profile-6',
        convictionDelta: '100',
        eventType: 'stake',
      });

      expect(mockPostgresSync).toHaveBeenCalled();
    });
  });

  describe('batchUpdateScores', () => {
    it('should batch update multiple scores', async () => {
      const ctx = createTestContext();
      const updates: ScoreUpdate[] = [
        { profileId: 'profile-1', convictionDelta: '100', eventType: 'stake' },
        { profileId: 'profile-2', convictionDelta: '200', eventType: 'stake' },
        { profileId: 'profile-3', convictionDelta: '300', eventType: 'stake' },
      ];

      mockScoreRepo.updateScore
        .mockResolvedValueOnce(createMockScore('profile-1'))
        .mockResolvedValueOnce(createMockScore('profile-2'))
        .mockResolvedValueOnce(createMockScore('profile-3'));

      cache = createWriteBehindCache(
        mockScoreRepo as unknown as ScoreRepository,
        mockPostgresSync,
        logger,
        { syncIntervalMs: 1000000 }
      );

      const result = await cache.batchUpdateScores(ctx, updates);

      expect(result.success).toBe(3);
      expect(result.failed).toBe(0);
      expect(cache.getStatus().pendingCount).toBe(3);
    });

    it('should handle partial failures in batch', async () => {
      const ctx = createTestContext();
      const updates: ScoreUpdate[] = [
        { profileId: 'profile-1', convictionDelta: '100', eventType: 'stake' },
        { profileId: 'profile-2', convictionDelta: '200', eventType: 'stake' },
      ];

      mockScoreRepo.updateScore
        .mockResolvedValueOnce(createMockScore('profile-1'))
        .mockRejectedValueOnce(new Error('ScyllaDB error'));

      cache = createWriteBehindCache(
        mockScoreRepo as unknown as ScoreRepository,
        mockPostgresSync,
        logger,
        { syncIntervalMs: 1000000 }
      );

      const result = await cache.batchUpdateScores(ctx, updates);

      expect(result.success).toBe(1);
      expect(result.failed).toBe(1);
      expect(cache.getStatus().pendingCount).toBe(1);
    });
  });

  describe('processSyncQueue', () => {
    it('should sync pending items to PostgreSQL', async () => {
      const ctx = createTestContext();

      mockScoreRepo.updateScore.mockResolvedValue(createMockScore('profile-1'));
      mockPostgresSync.mockResolvedValue({ success: 1, failed: 0 });

      cache = createWriteBehindCache(
        mockScoreRepo as unknown as ScoreRepository,
        mockPostgresSync,
        logger,
        { syncIntervalMs: 1000000, batchSize: 100 }
      );

      // Add an item
      await cache.updateScore(ctx, {
        profileId: 'profile-1',
        convictionDelta: '100',
        eventType: 'stake',
      });

      expect(cache.getStatus().pendingCount).toBe(1);

      // Manually trigger sync
      const result = await cache.processSyncQueue();

      expect(result.success).toBe(1);
      expect(result.failed).toBe(0);
      expect(cache.getStatus().pendingCount).toBe(0);

      // Verify sync function was called with correct data
      expect(mockPostgresSync).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            communityId: 'test-community',
            profileId: 'profile-1',
            convictionScore: '500',
            activityScore: '100',
            currentRank: 5,
          }),
        ])
      );
    });

    it('should batch items according to batchSize', async () => {
      const ctx = createTestContext();

      mockScoreRepo.updateScore.mockImplementation(async (_ctx, update) =>
        createMockScore(update.profileId)
      );
      mockPostgresSync.mockResolvedValue({ success: 3, failed: 0 });

      cache = createWriteBehindCache(
        mockScoreRepo as unknown as ScoreRepository,
        mockPostgresSync,
        logger,
        { syncIntervalMs: 1000000, batchSize: 3 }
      );

      // Add 5 items
      for (let i = 0; i < 5; i++) {
        await cache.updateScore(ctx, {
          profileId: `profile-${i}`,
          convictionDelta: '100',
          eventType: 'stake',
        });
      }

      expect(cache.getStatus().pendingCount).toBe(5);

      // First sync should process 3 items
      await cache.processSyncQueue();

      expect(mockPostgresSync).toHaveBeenCalledTimes(1);
      const firstCall = vi.mocked(mockPostgresSync).mock.calls[0]?.[0];
      expect(firstCall).toHaveLength(3);
      expect(cache.getStatus().pendingCount).toBe(2);
    });

    it('should retry failed items', async () => {
      const ctx = createTestContext();

      mockScoreRepo.updateScore.mockResolvedValue(createMockScore('profile-1'));
      mockPostgresSync
        .mockResolvedValueOnce({ success: 0, failed: 1 })
        .mockResolvedValueOnce({ success: 1, failed: 0 });

      cache = createWriteBehindCache(
        mockScoreRepo as unknown as ScoreRepository,
        mockPostgresSync,
        logger,
        { syncIntervalMs: 1000000, maxRetries: 3 }
      );

      await cache.updateScore(ctx, {
        profileId: 'profile-1',
        convictionDelta: '100',
        eventType: 'stake',
      });

      // First sync fails
      const result1 = await cache.processSyncQueue();
      expect(result1.retried).toBe(1);
      expect(cache.getStatus().pendingCount).toBe(1);

      // Second sync succeeds
      const result2 = await cache.processSyncQueue();
      expect(result2.success).toBe(1);
      expect(cache.getStatus().pendingCount).toBe(0);
    });

    it('should discard items after max retries', async () => {
      const ctx = createTestContext();

      mockScoreRepo.updateScore.mockResolvedValue(createMockScore('profile-1'));
      mockPostgresSync.mockResolvedValue({ success: 0, failed: 1 });

      cache = createWriteBehindCache(
        mockScoreRepo as unknown as ScoreRepository,
        mockPostgresSync,
        logger,
        { syncIntervalMs: 1000000, maxRetries: 2 }
      );

      await cache.updateScore(ctx, {
        profileId: 'profile-1',
        convictionDelta: '100',
        eventType: 'stake',
      });

      // Retry 1
      await cache.processSyncQueue();
      expect(cache.getStatus().pendingCount).toBe(1);

      // Retry 2
      await cache.processSyncQueue();
      expect(cache.getStatus().pendingCount).toBe(1);

      // Retry 3 - should discard
      await cache.processSyncQueue();
      expect(cache.getStatus().pendingCount).toBe(0);
    });
  });

  describe('lifecycle', () => {
    it('should start and stop background sync', async () => {
      cache = createWriteBehindCache(
        mockScoreRepo as unknown as ScoreRepository,
        mockPostgresSync,
        logger,
        { syncIntervalMs: 100 }
      );

      expect(cache.getStatus().isRunning).toBe(false);

      cache.start();
      expect(cache.getStatus().isRunning).toBe(true);

      await cache.stop();
      expect(cache.getStatus().isRunning).toBe(false);
      expect(cache.getStatus().isShuttingDown).toBe(true);
    });

    it('should flush pending items on stop', async () => {
      const ctx = createTestContext();

      mockScoreRepo.updateScore.mockResolvedValue(createMockScore('profile-1'));
      mockPostgresSync.mockResolvedValue({ success: 1, failed: 0 });

      cache = createWriteBehindCache(
        mockScoreRepo as unknown as ScoreRepository,
        mockPostgresSync,
        logger,
        { syncIntervalMs: 1000000 }
      );

      await cache.updateScore(ctx, {
        profileId: 'profile-1',
        convictionDelta: '100',
        eventType: 'stake',
      });

      expect(cache.getStatus().pendingCount).toBe(1);

      await cache.stop();

      expect(mockPostgresSync).toHaveBeenCalled();
      expect(cache.getStatus().pendingCount).toBe(0);
    });
  });

  describe('flushSync', () => {
    it('should sync all pending items immediately', async () => {
      const ctx = createTestContext();

      mockScoreRepo.updateScore.mockImplementation(async (_ctx, update) =>
        createMockScore(update.profileId)
      );
      mockPostgresSync.mockResolvedValue({ success: 2, failed: 0 });

      cache = createWriteBehindCache(
        mockScoreRepo as unknown as ScoreRepository,
        mockPostgresSync,
        logger,
        { syncIntervalMs: 1000000, batchSize: 2 }
      );

      // Add 4 items
      for (let i = 0; i < 4; i++) {
        await cache.updateScore(ctx, {
          profileId: `profile-${i}`,
          convictionDelta: '100',
          eventType: 'stake',
        });
      }

      // Flush should process all
      const result = await cache.flushSync();

      expect(result.success).toBe(4);
      expect(cache.getStatus().pendingCount).toBe(0);
      expect(mockPostgresSync).toHaveBeenCalledTimes(2); // 2 batches of 2
    });
  });

  describe('getPendingForCommunity', () => {
    it('should return pending items for a specific community', async () => {
      const ctx1 = createTestContext('community-1');
      const ctx2 = createTestContext('community-2');

      mockScoreRepo.updateScore.mockImplementation(async (ctx, update) =>
        createMockScore(update.profileId, ctx.communityId)
      );

      cache = createWriteBehindCache(
        mockScoreRepo as unknown as ScoreRepository,
        mockPostgresSync,
        logger,
        { syncIntervalMs: 1000000 }
      );

      await cache.updateScore(ctx1, { profileId: 'profile-1', convictionDelta: '100', eventType: 'stake' });
      await cache.updateScore(ctx2, { profileId: 'profile-2', convictionDelta: '200', eventType: 'stake' });
      await cache.updateScore(ctx1, { profileId: 'profile-3', convictionDelta: '300', eventType: 'stake' });

      const community1Items = cache.getPendingForCommunity('community-1');
      const community2Items = cache.getPendingForCommunity('community-2');

      expect(community1Items).toHaveLength(2);
      expect(community2Items).toHaveLength(1);
    });
  });

  describe('coalescing', () => {
    it('should coalesce multiple updates to same profile', async () => {
      const ctx = createTestContext();

      let callCount = 0;
      mockScoreRepo.updateScore.mockImplementation(async (_ctx, update) => {
        callCount++;
        return {
          communityId: 'test-community',
          profileId: update.profileId,
          convictionScore: `${callCount * 100}`,
          activityScore: '0',
          currentRank: callCount,
          updatedAt: new Date(),
        };
      });

      cache = createWriteBehindCache(
        mockScoreRepo as unknown as ScoreRepository,
        mockPostgresSync,
        logger,
        { syncIntervalMs: 1000000 }
      );

      // Multiple updates to same profile
      await cache.updateScore(ctx, { profileId: 'profile-1', convictionDelta: '100', eventType: 'stake' });
      await cache.updateScore(ctx, { profileId: 'profile-1', convictionDelta: '200', eventType: 'stake' });
      await cache.updateScore(ctx, { profileId: 'profile-1', convictionDelta: '300', eventType: 'stake' });

      // Should coalesce to 1 pending item (latest value)
      expect(cache.getStatus().pendingCount).toBe(1);

      const pending = cache.getPendingForCommunity('test-community');
      expect(pending[0]?.convictionScore).toBe('300');
      expect(pending[0]?.currentRank).toBe(3);
    });
  });
});

describe('createWriteBehindCache factory', () => {
  it('should create cache with default config', () => {
    const mockScoreRepo = createMockScoreRepo();
    const mockPostgresSync = vi.fn();

    const cache = createWriteBehindCache(
      mockScoreRepo as unknown as ScoreRepository,
      mockPostgresSync,
      logger
    );

    expect(cache).toBeInstanceOf(WriteBehindCache);
    const status = cache.getStatus();
    expect(status.pendingCount).toBe(0);
    expect(status.isRunning).toBe(false);
  });

  it('should create cache with custom config', () => {
    const mockScoreRepo = createMockScoreRepo();
    const mockPostgresSync = vi.fn();

    const cache = createWriteBehindCache(
      mockScoreRepo as unknown as ScoreRepository,
      mockPostgresSync,
      logger,
      { batchSize: 50, syncIntervalMs: 10000 }
    );

    expect(cache).toBeInstanceOf(WriteBehindCache);
  });
});
