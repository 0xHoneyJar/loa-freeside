/**
 * ScyllaDB Client Tests
 * Sprint S-3: ScyllaDB & Observability Foundation
 *
 * Unit tests for ScyllaClient operations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import pino from 'pino';
import type { Score, ScoreHistoryEntry, LeaderboardEntry, EligibilitySnapshot } from '../../../src/infrastructure/scylla/types.js';

// Create test logger
const logger = pino({ level: 'silent' });

// Mock cassandra-driver
const mockExecute = vi.fn();
const mockBatch = vi.fn();
const mockConnect = vi.fn();
const mockShutdown = vi.fn();

vi.mock('cassandra-driver', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    execute: mockExecute,
    batch: mockBatch,
    shutdown: mockShutdown,
  })),
  auth: {
    PlainTextAuthProvider: vi.fn(),
  },
  types: {
    distance: { local: 0, remote: 1 },
    consistencies: { localQuorum: 6 },
  },
  mapping: {},
}));

// Import after mocks
import { ScyllaClient } from '../../../src/infrastructure/scylla/scylla-client.js';
import { ScyllaMetrics } from '../../../src/infrastructure/scylla/metrics.js';
import type { ScyllaConfig } from '../../../src/infrastructure/scylla/types.js';

const testConfig: ScyllaConfig = {
  contactPoints: ['localhost'],
  localDataCenter: 'datacenter1',
  keyspace: 'arrakis_test',
  username: 'test',
  password: 'test',
};

describe('ScyllaClient', () => {
  let client: ScyllaClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    client = new ScyllaClient(testConfig, logger);
  });

  afterEach(async () => {
    mockShutdown.mockResolvedValue(undefined);
    await client.close();
  });

  describe('connection', () => {
    it('should connect successfully', async () => {
      await client.connect();

      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('should handle connection failure', async () => {
      mockConnect.mockRejectedValueOnce(new Error('Connection refused'));

      await expect(client.connect()).rejects.toThrow('Connection refused');
    });

    it('should check health via system query', async () => {
      await client.connect();
      mockExecute.mockResolvedValueOnce({ rows: [{ now: new Date() }] });

      const healthy = await client.isHealthy();

      expect(healthy).toBe(true);
      expect(mockExecute).toHaveBeenCalledWith('SELECT now() FROM system.local');
    });

    it('should return unhealthy when not connected', async () => {
      const healthy = await client.isHealthy();

      expect(healthy).toBe(false);
    });
  });

  describe('scores', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should get score by profile', async () => {
      const mockRow = {
        get: (col: string) => {
          const data: Record<string, unknown> = {
            community_id: { toString: () => 'comm-123' },
            profile_id: { toString: () => 'prof-456' },
            conviction_score: { toString: () => '1000.50' },
            activity_score: { toString: () => '250.25' },
            current_rank: 5,
            updated_at: new Date('2026-01-15T10:00:00Z'),
          };
          return data[col];
        },
      };

      mockExecute.mockResolvedValueOnce({
        rowLength: 1,
        first: () => mockRow,
        rows: [mockRow],
      });

      const score = await client.getScore('comm-123', 'prof-456');

      expect(score).not.toBeNull();
      expect(score!.communityId).toBe('comm-123');
      expect(score!.convictionScore).toBe('1000.50');
      expect(score!.currentRank).toBe(5);
    });

    it('should return null for non-existent score', async () => {
      mockExecute.mockResolvedValueOnce({
        rowLength: 0,
        first: () => null,
        rows: [],
      });

      const score = await client.getScore('comm-123', 'prof-nonexistent');

      expect(score).toBeNull();
    });

    it('should update score in both tables', async () => {
      mockBatch.mockResolvedValueOnce(undefined);

      const score: Score = {
        communityId: 'comm-123',
        profileId: 'prof-456',
        convictionScore: '1500.00',
        activityScore: '300.00',
        currentRank: 3,
        updatedAt: new Date(),
      };

      await client.updateScore(score);

      expect(mockBatch).toHaveBeenCalledTimes(1);
      const batchCall = mockBatch.mock.calls[0];
      expect(batchCall[0]).toHaveLength(2); // Two queries (scores + scores_by_profile)
    });

    it('should batch update scores efficiently', async () => {
      mockBatch.mockResolvedValue(undefined);

      const scores: Score[] = Array.from({ length: 100 }, (_, i) => ({
        communityId: 'comm-123',
        profileId: `prof-${i}`,
        convictionScore: `${1000 + i}.00`,
        activityScore: `${100 + i}.00`,
        currentRank: i + 1,
        updatedAt: new Date(),
      }));

      const result = await client.batchUpdateScores(scores);

      expect(result.success).toBe(100);
      expect(result.failed).toBe(0);
      // Should batch in groups of 50
      expect(mockBatch).toHaveBeenCalledTimes(4); // 100 scores * 2 tables / 50 = 4 batches
    });
  });

  describe('leaderboard', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should get leaderboard page', async () => {
      const mockRows = Array.from({ length: 10 }, (_, i) => ({
        get: (col: string) => {
          const data: Record<string, unknown> = {
            community_id: { toString: () => 'comm-123' },
            leaderboard_type: 'conviction',
            bucket: 0,
            rank: i + 1,
            profile_id: { toString: () => `prof-${i}` },
            display_name: `User ${i}`,
            score: { toString: () => `${1000 - i * 10}.00` },
            tier: 'sietch',
            updated_at: new Date(),
          };
          return data[col];
        },
      }));

      mockExecute.mockResolvedValueOnce({
        rowLength: 10,
        rows: mockRows,
      });

      const result = await client.getLeaderboard('comm-123', 'conviction', 0, 10);

      expect(result.data).toHaveLength(10);
      expect(result.data[0].rank).toBe(1);
      expect(result.hasMore).toBe(true);
    });

    it('should update leaderboard entry', async () => {
      mockExecute.mockResolvedValueOnce(undefined);

      const entry: LeaderboardEntry = {
        communityId: 'comm-123',
        leaderboardType: 'conviction',
        bucket: 0,
        rank: 1,
        profileId: 'prof-456',
        displayName: 'Top User',
        score: '10000.00',
        tier: 'naib',
        updatedAt: new Date(),
      };

      await client.updateLeaderboardEntry(entry);

      expect(mockExecute).toHaveBeenCalledTimes(1);
    });
  });

  describe('eligibility snapshots', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should get cached eligibility snapshot', async () => {
      const mockRow = {
        get: (col: string) => {
          const data: Record<string, unknown> = {
            community_id: { toString: () => 'comm-123' },
            profile_id: { toString: () => 'prof-456' },
            wallet_address: '0x1234567890123456789012345678901234567890',
            rule_id: { toString: () => 'rule-789' },
            is_eligible: true,
            token_balance: '1000000000000000000',
            checked_at: new Date(),
            block_number: { toString: () => '12345678' },
          };
          return data[col];
        },
      };

      mockExecute.mockResolvedValueOnce({
        rowLength: 1,
        first: () => mockRow,
        rows: [mockRow],
      });

      const snapshot = await client.getEligibilitySnapshot('comm-123', 'prof-456', 'rule-789');

      expect(snapshot).not.toBeNull();
      expect(snapshot!.isEligible).toBe(true);
      expect(snapshot!.walletAddress).toBe('0x1234567890123456789012345678901234567890');
    });

    it('should record cache miss for non-existent snapshot', async () => {
      mockExecute.mockResolvedValueOnce({
        rowLength: 0,
        first: () => null,
        rows: [],
      });

      const snapshot = await client.getEligibilitySnapshot('comm-123', 'prof-456', 'rule-nonexistent');

      expect(snapshot).toBeNull();

      // Verify cache miss was recorded
      const metrics = client.getMetrics().toJSON() as { cache: { misses: number } };
      expect(metrics.cache.misses).toBeGreaterThan(0);
    });

    it('should save eligibility snapshot', async () => {
      mockExecute.mockResolvedValueOnce(undefined);

      const snapshot: EligibilitySnapshot = {
        communityId: 'comm-123',
        profileId: 'prof-456',
        walletAddress: '0x1234567890123456789012345678901234567890',
        ruleId: 'rule-789',
        isEligible: true,
        tokenBalance: '1000000000000000000',
        checkedAt: new Date(),
        blockNumber: 12345678n,
      };

      await client.saveEligibilitySnapshot(snapshot);

      expect(mockExecute).toHaveBeenCalledTimes(1);
    });
  });
});

describe('ScyllaMetrics', () => {
  let metrics: ScyllaMetrics;

  beforeEach(() => {
    metrics = new ScyllaMetrics();
  });

  describe('query metrics', () => {
    it('should track query counts', () => {
      metrics.recordQuery('getScore', 10, true);
      metrics.recordQuery('getScore', 15, true);
      metrics.recordQuery('getScore', 20, false);

      const json = metrics.toJSON() as {
        queries: {
          total: Record<string, number>;
          successes: Record<string, number>;
          failures: Record<string, number>;
        };
      };

      expect(json.queries.total.getScore).toBe(3);
      expect(json.queries.successes.getScore).toBe(2);
      expect(json.queries.failures.getScore).toBe(1);
    });

    it('should calculate average latency', () => {
      metrics.recordQuery('updateScore', 10, true);
      metrics.recordQuery('updateScore', 20, true);
      metrics.recordQuery('updateScore', 30, true);

      const avg = metrics.getAverageLatency('updateScore');

      expect(avg).toBe(20);
    });

    it('should calculate error rate', () => {
      metrics.recordQuery('getLeaderboard', 10, true);
      metrics.recordQuery('getLeaderboard', 10, true);
      metrics.recordQuery('getLeaderboard', 10, false);
      metrics.recordQuery('getLeaderboard', 10, false);

      const errorRate = metrics.getErrorRate('getLeaderboard');

      expect(errorRate).toBe(0.5);
    });
  });

  describe('cache metrics', () => {
    it('should track cache hit rate', () => {
      metrics.recordCacheHit();
      metrics.recordCacheHit();
      metrics.recordCacheMiss();

      const hitRate = metrics.getCacheHitRate();

      expect(hitRate).toBeCloseTo(0.666, 2);
    });
  });

  describe('prometheus format', () => {
    it('should export metrics in prometheus format', () => {
      metrics.recordConnection(true);
      metrics.recordQuery('getScore', 50, true);
      metrics.recordCacheHit();

      const prometheus = metrics.toPrometheusFormat();

      expect(prometheus).toContain('scylla_connection_successes_total 1');
      expect(prometheus).toContain('scylla_queries_total{operation="getScore"} 1');
      expect(prometheus).toContain('scylla_eligibility_cache_hits_total 1');
    });
  });
});
