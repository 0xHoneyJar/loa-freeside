/**
 * PostgresScoreSync Tests
 * Sprint S-10: Write-Behind Cache
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import pino from 'pino';

// Mock TenantMetrics to avoid prom-client dependency
vi.mock('../../src/services/TenantMetrics.js', () => ({
  recordCommand: vi.fn(),
}));

import { PostgresScoreSync, createPostgresScoreSync } from '../../src/services/PostgresScoreSync.js';
import type { PendingSyncItem } from '../../src/services/WriteBehindCache.js';

const logger = pino({ level: 'silent' });

const createSyncItem = (
  profileId: string,
  communityId = 'test-community',
  overrides: Partial<PendingSyncItem> = {}
): PendingSyncItem => ({
  communityId,
  profileId,
  convictionScore: '500.5',
  activityScore: '100.3',
  currentRank: 5,
  updatedAt: new Date(),
  retryCount: 0,
  createdAt: new Date(),
  ...overrides,
});

describe('PostgresScoreSync', () => {
  describe('syncBatch', () => {
    it('should sync items to PostgreSQL via transaction', async () => {
      // Create mock that tracks calls
      const mockReturning = vi.fn().mockResolvedValue([{ id: 'profile-1' }]);
      const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
      const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
      const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

      const mockTransaction = vi.fn().mockImplementation(async (fn) => {
        await fn({ update: mockUpdate });
      });

      const mockDb = {
        update: mockUpdate,
        transaction: mockTransaction,
      };

      const sync = new PostgresScoreSync(mockDb as any, logger);
      const items = [createSyncItem('profile-1'), createSyncItem('profile-2')];

      const result = await sync.syncBatch(items);

      expect(result.success).toBe(2);
      expect(result.failed).toBe(0);
      expect(mockTransaction).toHaveBeenCalled();
    });

    it('should return empty result for empty batch', async () => {
      const mockDb = {
        update: vi.fn(),
        transaction: vi.fn(),
      };

      const sync = new PostgresScoreSync(mockDb as any, logger);
      const result = await sync.syncBatch([]);

      expect(result.success).toBe(0);
      expect(result.failed).toBe(0);
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('should handle transaction errors gracefully', async () => {
      const mockTransaction = vi.fn().mockRejectedValue(new Error('DB error'));
      const mockDb = {
        transaction: mockTransaction,
      };

      const sync = new PostgresScoreSync(mockDb as any, logger);
      const items = [createSyncItem('profile-1')];

      const result = await sync.syncBatch(items);

      expect(result.success).toBe(0);
      expect(result.failed).toBe(1);
    });

    it('should work without transaction when configured', async () => {
      const mockReturning = vi.fn().mockResolvedValue([{ id: 'profile-1' }]);
      const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
      const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
      const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

      const mockDb = {
        update: mockUpdate,
        transaction: vi.fn(),
      };

      const sync = new PostgresScoreSync(mockDb as any, logger, {
        useTransaction: false,
      });
      const items = [createSyncItem('profile-1')];

      const result = await sync.syncBatch(items);

      expect(result.success).toBe(1);
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('should handle partial failures in batch', async () => {
      let callCount = 0;
      const mockReturning = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          throw new Error('PostgreSQL error');
        }
        return Promise.resolve([{ id: `profile-${callCount}` }]);
      });
      const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
      const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
      const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

      const mockTransaction = vi.fn().mockImplementation(async (fn) => {
        await fn({ update: mockUpdate });
      });

      const mockDb = {
        update: mockUpdate,
        transaction: mockTransaction,
      };

      const sync = new PostgresScoreSync(mockDb as any, logger);
      const items = [createSyncItem('profile-1'), createSyncItem('profile-2')];

      const result = await sync.syncBatch(items);

      expect(result.success).toBe(1);
      expect(result.failed).toBe(1);
    });
  });

  describe('getSyncFn', () => {
    it('should return a sync function for WriteBehindCache', async () => {
      const mockReturning = vi.fn().mockResolvedValue([{ id: 'profile-1' }]);
      const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
      const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
      const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

      const mockTransaction = vi.fn().mockImplementation(async (fn) => {
        await fn({ update: mockUpdate });
      });

      const mockDb = {
        update: mockUpdate,
        transaction: mockTransaction,
      };

      const sync = new PostgresScoreSync(mockDb as any, logger);
      const syncFn = sync.getSyncFn();

      expect(typeof syncFn).toBe('function');

      const items = [createSyncItem('profile-1')];
      const result = await syncFn(items);

      expect(result.success).toBe(1);
      expect(result.failed).toBe(0);
    });
  });

  describe('score conversion', () => {
    it('should round string scores to integers', async () => {
      let capturedSet: any = null;
      const mockReturning = vi.fn().mockResolvedValue([{ id: 'profile-1' }]);
      const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
      const mockSet = vi.fn().mockImplementation((data) => {
        capturedSet = data;
        return { where: mockWhere };
      });
      const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

      const mockDb = {
        update: mockUpdate,
        transaction: vi.fn(),
      };

      const sync = new PostgresScoreSync(mockDb as any, logger, { useTransaction: false });
      const items = [
        createSyncItem('profile-1', 'test-community', {
          convictionScore: '123.9',   // Should round to 124
          activityScore: '45.1',      // Should round to 45
        }),
      ];

      await sync.syncBatch(items);

      expect(capturedSet?.convictionScore).toBe(124);
      expect(capturedSet?.activityScore).toBe(45);
    });

    it('should handle NaN scores gracefully', async () => {
      let capturedSet: any = null;
      const mockReturning = vi.fn().mockResolvedValue([{ id: 'profile-1' }]);
      const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
      const mockSet = vi.fn().mockImplementation((data) => {
        capturedSet = data;
        return { where: mockWhere };
      });
      const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

      const mockDb = {
        update: mockUpdate,
        transaction: vi.fn(),
      };

      const sync = new PostgresScoreSync(mockDb as any, logger, { useTransaction: false });
      const items = [
        createSyncItem('profile-1', 'test-community', {
          convictionScore: 'invalid',
          activityScore: 'NaN',
        }),
      ];

      await sync.syncBatch(items);

      expect(capturedSet?.convictionScore).toBe(0);
      expect(capturedSet?.activityScore).toBe(0);
    });
  });
});

describe('createPostgresScoreSync factory', () => {
  it('should create sync service with default config', () => {
    const mockDb = { update: vi.fn(), transaction: vi.fn() };
    const sync = createPostgresScoreSync(mockDb as any, logger);

    expect(sync).toBeInstanceOf(PostgresScoreSync);
  });

  it('should create sync service with custom config', () => {
    const mockDb = { update: vi.fn(), transaction: vi.fn() };
    const sync = createPostgresScoreSync(mockDb as any, logger, {
      useTransaction: false,
      verboseLogging: true,
    });

    expect(sync).toBeInstanceOf(PostgresScoreSync);
  });
});
