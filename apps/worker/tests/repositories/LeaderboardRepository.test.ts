/**
 * Leaderboard Repository Tests
 * Sprint S-8: ScyllaDB Integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import pino from 'pino';
import { LeaderboardRepository } from '../../src/repositories/LeaderboardRepository.js';
import type { ScyllaClient } from '../../src/infrastructure/scylla/scylla-client.js';
import type { LeaderboardEntry, Score } from '../../src/infrastructure/scylla/types.js';
import type { TenantRequestContext } from '../../src/services/TenantContext.js';

// Mock ScyllaClient
const createMockScyllaClient = () => ({
  getLeaderboard: vi.fn(),
  updateLeaderboardEntry: vi.fn(),
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

describe('LeaderboardRepository', () => {
  let mockScylla: ReturnType<typeof createMockScyllaClient>;
  let repo: LeaderboardRepository;

  beforeEach(() => {
    mockScylla = createMockScyllaClient();
    repo = new LeaderboardRepository(mockScylla as unknown as ScyllaClient, logger);
    vi.clearAllMocks();
  });

  describe('getLeaderboard', () => {
    it('should return leaderboard page', async () => {
      const ctx = createTestContext();
      const entries: LeaderboardEntry[] = [
        {
          communityId: ctx.communityId,
          leaderboardType: 'conviction',
          bucket: 0,
          rank: 1,
          profileId: 'profile-1',
          displayName: 'User One',
          score: '500',
          tier: 'diamond',
          updatedAt: new Date(),
        },
        {
          communityId: ctx.communityId,
          leaderboardType: 'conviction',
          bucket: 0,
          rank: 2,
          profileId: 'profile-2',
          displayName: 'User Two',
          score: '450',
          tier: 'diamond',
          updatedAt: new Date(),
        },
      ];

      mockScylla.getLeaderboard.mockResolvedValue({
        data: entries,
        hasMore: true,
      });

      const result = await repo.getLeaderboard(ctx, 'conviction', 0, 100);

      expect(result.entries).toEqual(entries);
      expect(result.page).toBe(0);
      expect(result.pageSize).toBe(100);
      expect(result.hasMore).toBe(true);
    });

    it('should handle empty leaderboard', async () => {
      const ctx = createTestContext();

      mockScylla.getLeaderboard.mockResolvedValue({
        data: [],
        hasMore: false,
      });

      const result = await repo.getLeaderboard(ctx, 'activity', 0, 100);

      expect(result.entries).toEqual([]);
      expect(result.hasMore).toBe(false);
    });
  });

  describe('getProfileRank', () => {
    it('should find profile rank in leaderboard', async () => {
      const ctx = createTestContext();
      const entries: LeaderboardEntry[] = [
        {
          communityId: ctx.communityId,
          leaderboardType: 'conviction',
          bucket: 0,
          rank: 1,
          profileId: 'profile-1',
          displayName: 'User One',
          score: '500',
          tier: 'diamond',
          updatedAt: new Date(),
        },
        {
          communityId: ctx.communityId,
          leaderboardType: 'conviction',
          bucket: 0,
          rank: 2,
          profileId: 'target-profile',
          displayName: 'Target User',
          score: '450',
          tier: 'diamond',
          updatedAt: new Date(),
        },
      ];

      mockScylla.getLeaderboard.mockResolvedValue({
        data: entries,
        hasMore: false,
      });

      const result = await repo.getProfileRank(ctx, 'target-profile', 'conviction');

      expect(result).not.toBeNull();
      expect(result?.rank).toBe(2);
      expect(result?.score).toBe('450');
      expect(result?.tier).toBe('diamond');
    });

    it('should return null when profile not found', async () => {
      const ctx = createTestContext();

      mockScylla.getLeaderboard.mockResolvedValue({
        data: [],
        hasMore: false,
      });

      const result = await repo.getProfileRank(ctx, 'unknown-profile', 'conviction');

      expect(result).toBeNull();
    });
  });

  describe('getTopEntries', () => {
    it('should return top N entries', async () => {
      const ctx = createTestContext();
      const entries: LeaderboardEntry[] = Array.from({ length: 10 }, (_, i) => ({
        communityId: ctx.communityId,
        leaderboardType: 'conviction' as const,
        bucket: 0,
        rank: i + 1,
        profileId: `profile-${i + 1}`,
        displayName: `User ${i + 1}`,
        score: `${500 - i * 10}`,
        tier: i < 3 ? 'diamond' : 'platinum',
        updatedAt: new Date(),
      }));

      mockScylla.getLeaderboard.mockResolvedValue({
        data: entries,
        hasMore: false,
      });

      const result = await repo.getTopEntries(ctx, 'conviction', 10);

      expect(result).toHaveLength(10);
      expect(result[0].rank).toBe(1);
      expect(result[9].rank).toBe(10);
    });
  });

  describe('recalculateLeaderboard', () => {
    it('should recalculate leaderboard from scores', async () => {
      const ctx = createTestContext();
      const scores: Score[] = [
        {
          communityId: ctx.communityId,
          profileId: 'profile-2',
          convictionScore: '500',
          activityScore: '100',
          currentRank: 0,
          updatedAt: new Date(),
        },
        {
          communityId: ctx.communityId,
          profileId: 'profile-1',
          convictionScore: '300',
          activityScore: '200',
          currentRank: 0,
          updatedAt: new Date(),
        },
      ];

      mockScylla.updateLeaderboardEntry.mockResolvedValue(undefined);

      const updated = await repo.recalculateLeaderboard(ctx, scores, {
        type: 'conviction',
        limit: 100,
      });

      expect(updated).toBe(2);
      expect(mockScylla.updateLeaderboardEntry).toHaveBeenCalledTimes(2);

      // First call should be highest score (profile-2)
      const firstCall = mockScylla.updateLeaderboardEntry.mock.calls[0][0];
      expect(firstCall.profileId).toBe('profile-2');
      expect(firstCall.rank).toBe(1);
    });

    it('should calculate correct tiers', async () => {
      const ctx = createTestContext();
      const scores: Score[] = Array.from({ length: 100 }, (_, i) => ({
        communityId: ctx.communityId,
        profileId: `profile-${i}`,
        convictionScore: `${1000 - i}`,
        activityScore: '0',
        currentRank: 0,
        updatedAt: new Date(),
      }));

      mockScylla.updateLeaderboardEntry.mockResolvedValue(undefined);

      await repo.recalculateLeaderboard(ctx, scores, {
        type: 'conviction',
        limit: 100,
      });

      // Check tier assignments
      const calls = mockScylla.updateLeaderboardEntry.mock.calls;

      // Rank 1-10 should be diamond
      expect(calls[0][0].tier).toBe('diamond');
      expect(calls[9][0].tier).toBe('diamond');

      // Rank 11-50 should be platinum
      expect(calls[10][0].tier).toBe('platinum');
      expect(calls[49][0].tier).toBe('platinum');

      // Rank 51-100 should be gold
      expect(calls[50][0].tier).toBe('gold');
      expect(calls[99][0].tier).toBe('gold');
    });
  });

  describe('updateEntry', () => {
    it('should update a single leaderboard entry', async () => {
      const ctx = createTestContext();
      const entry: LeaderboardEntry = {
        communityId: ctx.communityId,
        leaderboardType: 'conviction',
        bucket: 0,
        rank: 1,
        profileId: 'profile-1',
        displayName: 'Updated User',
        score: '999',
        tier: 'diamond',
        updatedAt: new Date(),
      };

      mockScylla.updateLeaderboardEntry.mockResolvedValue(undefined);

      await repo.updateEntry(ctx, entry);

      expect(mockScylla.updateLeaderboardEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          communityId: ctx.communityId,
          profileId: 'profile-1',
          score: '999',
        })
      );
    });
  });
});
