/**
 * HotPathService Tests
 * Sprint S-9: Hot-Path Migration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import pino from 'pino';
import { HotPathService } from '../../src/services/HotPathService.js';
import type { ScoreRepository } from '../../src/repositories/ScoreRepository.js';
import type { LeaderboardRepository, ProfileRank, LeaderboardPage } from '../../src/repositories/LeaderboardRepository.js';
import type { EligibilityRepository } from '../../src/repositories/EligibilityRepository.js';
import type { TenantRequestContext } from '../../src/services/TenantContext.js';
import type { Score, LeaderboardEntry } from '../../src/infrastructure/scylla/types.js';

// Mock repositories
const createMockScoreRepo = () => ({
  getScore: vi.fn(),
  getScores: vi.fn(),
  updateScore: vi.fn(),
  batchUpdateScores: vi.fn(),
  updateRanks: vi.fn(),
  getScoreHistory: vi.fn(),
});

const createMockLeaderboardRepo = () => ({
  getLeaderboard: vi.fn(),
  getProfileRank: vi.fn(),
  getProfilesAroundRank: vi.fn(),
  recalculateLeaderboard: vi.fn(),
  updateEntry: vi.fn(),
  getTopEntries: vi.fn(),
});

const createMockEligibilityRepo = () => ({
  checkEligibility: vi.fn(),
  batchCheckEligibility: vi.fn(),
  invalidateCache: vi.fn(),
  getCachedSnapshot: vi.fn(),
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

describe('HotPathService', () => {
  let mockScoreRepo: ReturnType<typeof createMockScoreRepo>;
  let mockLeaderboardRepo: ReturnType<typeof createMockLeaderboardRepo>;
  let mockEligibilityRepo: ReturnType<typeof createMockEligibilityRepo>;
  let service: HotPathService;

  beforeEach(() => {
    mockScoreRepo = createMockScoreRepo();
    mockLeaderboardRepo = createMockLeaderboardRepo();
    mockEligibilityRepo = createMockEligibilityRepo();
    service = new HotPathService(
      mockScoreRepo as unknown as ScoreRepository,
      mockLeaderboardRepo as unknown as LeaderboardRepository,
      mockEligibilityRepo as unknown as EligibilityRepository,
      logger
    );
    vi.clearAllMocks();
  });

  describe('getScore', () => {
    it('should return score from repository', async () => {
      const ctx = createTestContext();
      const expectedScore: Score = {
        communityId: ctx.communityId,
        profileId: 'profile-1',
        convictionScore: '500',
        activityScore: '100',
        currentRank: 5,
        updatedAt: new Date(),
      };

      mockScoreRepo.getScore.mockResolvedValue(expectedScore);

      const result = await service.getScore(ctx, 'profile-1');

      expect(result).toEqual(expectedScore);
      expect(mockScoreRepo.getScore).toHaveBeenCalledWith(ctx, 'profile-1');
    });

    it('should return null when score not found', async () => {
      const ctx = createTestContext();
      mockScoreRepo.getScore.mockResolvedValue(null);

      const result = await service.getScore(ctx, 'unknown-profile');

      expect(result).toBeNull();
    });
  });

  describe('getPositionData', () => {
    it('should return position data for a profile', async () => {
      const ctx = createTestContext();

      // Mock profile rank
      mockLeaderboardRepo.getProfileRank.mockResolvedValue({
        rank: 10,
        score: '500',
        tier: 'diamond',
        profileId: 'profile-1',
      });

      // Mock surrounding entries
      const nearbyEntries: LeaderboardEntry[] = [
        {
          communityId: ctx.communityId,
          leaderboardType: 'conviction',
          bucket: 0,
          rank: 9,
          profileId: 'profile-9',
          displayName: 'User 9',
          score: '550',
          tier: 'diamond',
          updatedAt: new Date(),
        },
        {
          communityId: ctx.communityId,
          leaderboardType: 'conviction',
          bucket: 0,
          rank: 10,
          profileId: 'profile-1',
          displayName: 'User 10',
          score: '500',
          tier: 'diamond',
          updatedAt: new Date(),
        },
        {
          communityId: ctx.communityId,
          leaderboardType: 'conviction',
          bucket: 0,
          rank: 11,
          profileId: 'profile-11',
          displayName: 'User 11',
          score: '450',
          tier: 'platinum',
          updatedAt: new Date(),
        },
      ];
      mockLeaderboardRepo.getProfilesAroundRank.mockResolvedValue(nearbyEntries);

      const result = await service.getPositionData(ctx, 'profile-1');

      expect(result).not.toBeNull();
      expect(result?.position).toBe(10);
      expect(result?.convictionScore).toBe(500);
      expect(result?.distanceToAbove).toBe(50); // 550 - 500
      expect(result?.distanceToBelow).toBe(50); // 500 - 450
      expect(result?.isFedaykin).toBe(true); // Position 10 is within top 69
      expect(result?.isNaib).toBe(false); // Position 10 is not within top 7
    });

    it('should return null when profile not in leaderboard', async () => {
      const ctx = createTestContext();
      mockLeaderboardRepo.getProfileRank.mockResolvedValue(null);

      const result = await service.getPositionData(ctx, 'unknown-profile');

      expect(result).toBeNull();
    });

    it('should calculate distanceToEntry for non-fedaykin positions', async () => {
      const ctx = createTestContext();

      // Mock profile at position 75 (outside fedaykin threshold of 69)
      mockLeaderboardRepo.getProfileRank.mockResolvedValue({
        rank: 75,
        score: '100',
        tier: 'gold',
        profileId: 'profile-75',
      });

      // Mock surrounding entries
      mockLeaderboardRepo.getProfilesAroundRank.mockResolvedValue([]);

      // Mock entry threshold at position 69
      const entryEntries: LeaderboardEntry[] = [
        {
          communityId: ctx.communityId,
          leaderboardType: 'conviction',
          bucket: 0,
          rank: 69,
          profileId: 'profile-69',
          displayName: 'User 69',
          score: '200',
          tier: 'gold',
          updatedAt: new Date(),
        },
      ];
      mockLeaderboardRepo.getProfilesAroundRank
        .mockResolvedValueOnce([]) // First call for surrounding
        .mockResolvedValueOnce(entryEntries); // Second call for entry threshold

      const result = await service.getPositionData(ctx, 'profile-75');

      expect(result).not.toBeNull();
      expect(result?.position).toBe(75);
      expect(result?.isFedaykin).toBe(false);
      expect(result?.distanceToEntry).toBe(100); // 200 - 100
    });
  });

  describe('getThresholdData', () => {
    it('should return threshold data', async () => {
      const ctx = createTestContext();

      // Mock top entries (100 positions)
      const topEntries: LeaderboardEntry[] = Array.from({ length: 100 }, (_, i) => ({
        communityId: ctx.communityId,
        leaderboardType: 'conviction' as const,
        bucket: 0,
        rank: i + 1,
        profileId: `profile-${i + 1}`,
        displayName: `User ${i + 1}`,
        score: `${1000 - i * 10}`,
        tier: i < 10 ? 'diamond' : i < 50 ? 'platinum' : 'gold',
        updatedAt: new Date(),
      }));

      mockLeaderboardRepo.getTopEntries.mockResolvedValue(topEntries);

      const result = await service.getThresholdData(ctx);

      expect(result.eligibleCount).toBe(69);
      expect(result.waitlistCount).toBe(31);
      // Entry threshold is score at position 69: 1000 - (69-1)*10 = 320
      expect(result.entryThreshold).toBe(320);
      // Gap to first waitlist (position 70): 320 - 310 = 10
      expect(result.gapToEntry).toBe(10);
    });

    it('should handle empty leaderboard', async () => {
      const ctx = createTestContext();
      mockLeaderboardRepo.getTopEntries.mockResolvedValue([]);

      const result = await service.getThresholdData(ctx);

      expect(result.eligibleCount).toBe(0);
      expect(result.waitlistCount).toBe(0);
      expect(result.entryThreshold).toBe(0);
    });
  });

  describe('getTopWaitlistPositions', () => {
    it('should return waitlist positions', async () => {
      const ctx = createTestContext();

      // Mock entries including waitlist
      const entries: LeaderboardEntry[] = [
        // Entry at position 69 (fedaykin threshold)
        {
          communityId: ctx.communityId,
          leaderboardType: 'conviction',
          bucket: 0,
          rank: 69,
          profileId: 'profile-69',
          displayName: 'User 69',
          score: '200',
          tier: 'gold',
          updatedAt: new Date(),
        },
        // Waitlist positions
        {
          communityId: ctx.communityId,
          leaderboardType: 'conviction',
          bucket: 0,
          rank: 70,
          profileId: 'profile-70',
          displayName: 'User 70',
          score: '190',
          tier: 'silver',
          updatedAt: new Date(),
        },
        {
          communityId: ctx.communityId,
          leaderboardType: 'conviction',
          bucket: 0,
          rank: 71,
          profileId: 'profile-71',
          displayName: 'User 71',
          score: '180',
          tier: 'silver',
          updatedAt: new Date(),
        },
      ];

      mockLeaderboardRepo.getTopEntries.mockResolvedValue(entries);

      const result = await service.getTopWaitlistPositions(ctx, 2);

      expect(result).toHaveLength(2);
      expect(result[0].position).toBe(70);
      expect(result[0].distanceToEntry).toBe(10); // 200 - 190
      expect(result[1].position).toBe(71);
      expect(result[1].distanceToEntry).toBe(20); // 200 - 180
    });
  });

  describe('getConvictionLeaderboard', () => {
    it('should return leaderboard page', async () => {
      const ctx = createTestContext();
      const mockPage: LeaderboardPage = {
        entries: [
          {
            communityId: ctx.communityId,
            leaderboardType: 'conviction',
            bucket: 0,
            rank: 1,
            profileId: 'profile-1',
            displayName: 'User 1',
            score: '1000',
            tier: 'diamond',
            updatedAt: new Date(),
          },
        ],
        page: 0,
        pageSize: 100,
        hasMore: false,
      };

      mockLeaderboardRepo.getLeaderboard.mockResolvedValue(mockPage);

      const result = await service.getConvictionLeaderboard(ctx, 0, 100);

      expect(result).toEqual(mockPage);
      expect(mockLeaderboardRepo.getLeaderboard).toHaveBeenCalledWith(ctx, 'conviction', 0, 100);
    });
  });

  describe('getTopEntries', () => {
    it('should return handler-formatted entries', async () => {
      const ctx = createTestContext();
      const entries: LeaderboardEntry[] = [
        {
          communityId: ctx.communityId,
          leaderboardType: 'conviction',
          bucket: 0,
          rank: 1,
          profileId: 'profile-1',
          displayName: 'User One',
          score: '1000',
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
          score: '900',
          tier: 'diamond',
          updatedAt: new Date(),
        },
      ];

      mockLeaderboardRepo.getTopEntries.mockResolvedValue(entries);

      const result = await service.getTopEntries(ctx, 'conviction', 10);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        rank: 1,
        profileId: 'profile-1',
        displayName: 'User One',
        score: '1000',
        tier: 'diamond',
      });
    });
  });

  describe('getProfileRank', () => {
    it('should return member rank data', async () => {
      const ctx = createTestContext();
      const mockRank: ProfileRank = {
        rank: 5,
        score: '750',
        tier: 'diamond',
        profileId: 'profile-1',
      };

      mockLeaderboardRepo.getProfileRank.mockResolvedValue(mockRank);

      const result = await service.getProfileRank(ctx, 'profile-1', 'conviction');

      expect(result).toEqual({
        rank: 5,
        score: '750',
        tier: 'diamond',
        profileId: 'profile-1',
      });
    });

    it('should return null when profile not found', async () => {
      const ctx = createTestContext();
      mockLeaderboardRepo.getProfileRank.mockResolvedValue(null);

      const result = await service.getProfileRank(ctx, 'unknown', 'conviction');

      expect(result).toBeNull();
    });
  });

  describe('eligibility operations', () => {
    it('should delegate checkEligibility to repository', async () => {
      const ctx = createTestContext();
      const request = { profileId: 'p1', walletAddress: '0x123', ruleId: 'rule-1' };
      const rule = { ruleId: 'rule-1', contractAddress: '0xabc', minBalance: '100', chainId: 1 };
      const checker = vi.fn().mockResolvedValue({ isEligible: true, balance: '200', blockNumber: BigInt(1) });

      mockEligibilityRepo.checkEligibility.mockResolvedValue({
        profileId: 'p1',
        ruleId: 'rule-1',
        isEligible: true,
        tokenBalance: '200',
        checkedAt: new Date(),
        fromCache: false,
      });

      await service.checkEligibility(ctx, request, rule, checker);

      expect(mockEligibilityRepo.checkEligibility).toHaveBeenCalledWith(ctx, request, rule, checker);
    });

    it('should delegate invalidateCache to repository', async () => {
      const ctx = createTestContext();

      await service.invalidateEligibilityCache(ctx, 'profile-1', 'rule-1');

      expect(mockEligibilityRepo.invalidateCache).toHaveBeenCalledWith(ctx, 'profile-1', 'rule-1');
    });
  });

  describe('recalculateLeaderboard', () => {
    it('should recalculate and return count', async () => {
      const ctx = createTestContext();
      const scores: Score[] = [
        {
          communityId: ctx.communityId,
          profileId: 'profile-1',
          convictionScore: '500',
          activityScore: '100',
          currentRank: 1,
          updatedAt: new Date(),
        },
      ];

      mockLeaderboardRepo.recalculateLeaderboard.mockResolvedValue(1);

      const result = await service.recalculateLeaderboard(ctx, scores, 'conviction', 100);

      expect(result).toBe(1);
      expect(mockLeaderboardRepo.recalculateLeaderboard).toHaveBeenCalledWith(ctx, scores, {
        type: 'conviction',
        limit: 100,
      });
    });
  });
});
