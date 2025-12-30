/**
 * Unit Tests for StatsService (Sprint 19)
 *
 * Tests stats aggregation and tier progression leaderboard logic
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseUnits } from 'viem';
import type { Tier } from '../../src/types/index.js';

// Mock the logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock database queries
const mockGetDatabase = vi.fn();
const mockGetMemberProfileByDiscordId = vi.fn();
const mockGetMemberBadges = vi.fn();
const mockGetMemberActivity = vi.fn();
const mockCalculateTenureCategory = vi.fn();

vi.mock('../../src/db/index.js', () => ({
  getDatabase: mockGetDatabase,
  getMemberProfileByDiscordId: mockGetMemberProfileByDiscordId,
  getMemberBadges: mockGetMemberBadges,
  getMemberActivity: mockGetMemberActivity,
  calculateTenureCategory: mockCalculateTenureCategory,
  getMemberBadgeCount: vi.fn(),
}));

// Mock activity service
const mockGetOwnStats = vi.fn();
vi.mock('../../src/services/activity.js', () => ({
  getOwnStats: mockGetOwnStats,
}));

// Mock tierService
const mockGetTierProgress = vi.fn();
const mockGetNextTier = vi.fn();
const mockGetAllTierInfo = vi.fn();

vi.mock('../../src/services/index.js', () => ({
  tierService: {
    getTierProgress: mockGetTierProgress,
    getNextTier: mockGetNextTier,
    getAllTierInfo: mockGetAllTierInfo,
  },
}));

// Import after mocks
const { statsService } = await import('../../src/services/StatsService.js');

describe('StatsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getPersonalStats', () => {
    it('returns null for non-existent member', () => {
      mockGetMemberProfileByDiscordId.mockReturnValue(null);

      const stats = statsService.getPersonalStats('user123');

      expect(stats).toBeNull();
      expect(mockGetMemberProfileByDiscordId).toHaveBeenCalledWith('user123');
    });

    it('returns null for member with incomplete onboarding', () => {
      mockGetMemberProfileByDiscordId.mockReturnValue({
        memberId: 'member-1',
        discordUserId: 'user123',
        nym: 'TestNym',
        tier: 'hajra',
        onboardingComplete: false,
        createdAt: new Date('2024-01-01'),
      });

      const stats = statsService.getPersonalStats('user123');

      expect(stats).toBeNull();
    });

    it('returns comprehensive stats for valid member', () => {
      const memberProfile = {
        memberId: 'member-1',
        discordUserId: 'user123',
        nym: 'TestNym',
        tier: 'ichwan' as Tier,
        onboardingComplete: true,
        createdAt: new Date('2024-01-01'),
        pfpUrl: null,
      };

      const memberActivity = {
        memberId: 'member-1',
        activityBalance: 150,
        totalMessages: 50,
        lastActiveAt: new Date(),
      };

      const badges = [
        {
          badgeId: 'badge-1',
          name: 'Early Adopter',
          description: 'Joined early',
          category: 'tenure' as const,
          emoji: '🏆',
          awardedAt: new Date('2024-01-15'),
        },
      ];

      const tierProgress = {
        currentTier: 'ichwan' as Tier,
        nextTier: 'qanat' as Tier,
        bgtToNextTier: parseUnits('153', 18).toString(),
        bgtToNextTierFormatted: 153,
        currentBgt: parseUnits('69', 18).toString(),
        currentBgtFormatted: 69,
        currentRank: null,
        isRankBased: false,
      };

      // Setup mocks
      mockGetMemberProfileByDiscordId.mockReturnValue(memberProfile);
      mockGetOwnStats.mockReturnValue(memberActivity);
      mockGetMemberBadges.mockReturnValue(badges);
      mockCalculateTenureCategory.mockReturnValue('veteran');

      // Mock database query for eligibility
      const mockPrepare = vi.fn();
      const mockGet = vi.fn().mockReturnValue({
        bgt_held: parseUnits('69', 18).toString(),
        rank: null,
      });
      mockPrepare.mockReturnValue({ get: mockGet });
      mockGetDatabase.mockReturnValue({ prepare: mockPrepare });

      mockGetTierProgress.mockReturnValue(tierProgress);

      const stats = statsService.getPersonalStats('user123');

      expect(stats).not.toBeNull();
      expect(stats?.nym).toBe('TestNym');
      expect(stats?.tier).toBe('ichwan');
      expect(stats?.badgeCount).toBe(1);
      expect(stats?.tenureCategory).toBe('veteran');
      expect(stats?.messagesThisWeek).toBe(15); // activityBalance / 10
      expect(stats?.currentStreak).toBeGreaterThanOrEqual(0);
      expect(stats?.longestStreak).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getCommunityStats', () => {
    it('returns aggregated community statistics', () => {
      const mockPrepare = vi.fn();

      // Total members query
      mockPrepare.mockReturnValueOnce({
        get: vi.fn().mockReturnValue({ count: 100 }),
      });

      // Members by tier query
      mockPrepare.mockReturnValueOnce({
        all: vi.fn().mockReturnValue([
          { tier: 'hajra', count: 30 },
          { tier: 'ichwan', count: 25 },
          { tier: 'qanat', count: 20 },
          { tier: 'sihaya', count: 10 },
          { tier: 'fedaykin', count: 8 },
          { tier: 'naib', count: 7 },
        ]),
      });

      // Total BGT query
      mockPrepare.mockReturnValueOnce({
        get: vi.fn().mockReturnValue({
          total_bgt: parseUnits('50000', 18).toString(),
        }),
      });

      // Weekly active query
      mockPrepare.mockReturnValueOnce({
        get: vi.fn().mockReturnValue({ count: 75 }),
      });

      mockGetDatabase.mockReturnValue({ prepare: mockPrepare });

      const stats = statsService.getCommunityStats();

      expect(stats.total_members).toBe(100);
      expect(stats.members_by_tier.hajra).toBe(30);
      expect(stats.members_by_tier.naib).toBe(7);
      expect(stats.total_bgt).toBeCloseTo(50000, 0);
      expect(stats.weekly_active).toBe(75);
      expect(stats.generated_at).toBeDefined();
    });
  });

  describe('getTierLeaderboard', () => {
    it('returns empty array when no members qualify', () => {
      const mockPrepare = vi.fn();
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });
      mockGetDatabase.mockReturnValue({ prepare: mockPrepare });

      const leaderboard = statsService.getTierLeaderboard(10);

      expect(leaderboard).toEqual([]);
    });

    it('excludes Fedaykin and Naib from progression leaderboard', () => {
      const mockPrepare = vi.fn();
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([
          {
            member_id: 'member-1',
            nym: 'Naib Member',
            tier: 'naib',
            bgt_held: parseUnits('2000', 18).toString(),
            rank: 3,
          },
          {
            member_id: 'member-2',
            nym: 'Fedaykin Member',
            tier: 'fedaykin',
            bgt_held: parseUnits('1500', 18).toString(),
            rank: 15,
          },
        ]),
      });
      mockGetDatabase.mockReturnValue({ prepare: mockPrepare });

      const leaderboard = statsService.getTierLeaderboard(10);

      // Should exclude both members due to tier filter
      expect(leaderboard).toEqual([]);
    });

    it('sorts members by distance to next tier (ascending)', () => {
      const members = [
        {
          member_id: 'member-1',
          nym: 'Close Member',
          tier: 'ichwan' as Tier,
          bgt_held: parseUnits('200', 18).toString(),
          rank: null,
        },
        {
          member_id: 'member-2',
          nym: 'Far Member',
          tier: 'hajra' as Tier,
          bgt_held: parseUnits('10', 18).toString(),
          rank: null,
        },
        {
          member_id: 'member-3',
          nym: 'Mid Member',
          tier: 'ichwan' as Tier,
          bgt_held: parseUnits('100', 18).toString(),
          rank: null,
        },
      ];

      const mockPrepare = vi.fn();
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(members),
      });
      mockGetDatabase.mockReturnValue({ prepare: mockPrepare });

      // Mock getNextTier
      mockGetNextTier.mockImplementation((tier: Tier) => {
        if (tier === 'hajra') return 'ichwan';
        if (tier === 'ichwan') return 'qanat';
        return null;
      });

      // Mock getTierProgress with realistic distances
      mockGetTierProgress.mockImplementation(
        (tier: Tier, bgt: string, rank: number | null) => {
          if (tier === 'hajra' && bgt === parseUnits('10', 18).toString()) {
            return {
              currentTier: 'hajra',
              nextTier: 'ichwan',
              bgtToNextTierFormatted: 59, // Need 59 BGT to reach 69
              currentBgtFormatted: 10,
            };
          }
          if (tier === 'ichwan' && bgt === parseUnits('200', 18).toString()) {
            return {
              currentTier: 'ichwan',
              nextTier: 'qanat',
              bgtToNextTierFormatted: 22, // Need 22 BGT to reach 222
              currentBgtFormatted: 200,
            };
          }
          if (tier === 'ichwan' && bgt === parseUnits('100', 18).toString()) {
            return {
              currentTier: 'ichwan',
              nextTier: 'qanat',
              bgtToNextTierFormatted: 122, // Need 122 BGT to reach 222
              currentBgtFormatted: 100,
            };
          }
          return {};
        }
      );

      // Mock getAllTierInfo
      mockGetAllTierInfo.mockReturnValue([
        { name: 'hajra', bgtThreshold: 6.9 },
        { name: 'ichwan', bgtThreshold: 69 },
        { name: 'qanat', bgtThreshold: 222 },
      ]);

      const leaderboard = statsService.getTierLeaderboard(10);

      // Verify sorted by distance (ascending)
      expect(leaderboard.length).toBeGreaterThan(0);
      if (leaderboard.length >= 2) {
        expect(leaderboard[0].distanceToNextTier).toBeLessThanOrEqual(
          leaderboard[1].distanceToNextTier
        );
      }

      // Verify ranks are assigned correctly
      if (leaderboard.length > 0) {
        expect(leaderboard[0].rank).toBe(1);
      }
    });
  });

  describe('getAdminAnalytics', () => {
    it('includes comprehensive admin metrics', () => {
      const mockPrepare = vi.fn();

      // Setup community stats mocks (reuse from getCommunityStats test)
      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ count: 100 }) }) // total
        .mockReturnValueOnce({
          all: vi.fn().mockReturnValue([
            { tier: 'hajra', count: 30 },
            { tier: 'naib', count: 7 },
          ]),
        }) // by tier
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({
            total_bgt: parseUnits('50000', 18).toString(),
          }),
        }) // total BGT
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ count: 75 }) }) // weekly active
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ count: 5 }) }) // new this week
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ count: 3 }) }) // promotions
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ count: 12 }) }) // badges
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ avg_balance: 100 }) }) // avg messages
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({ tier: 'ichwan', total_activity: 500 }),
        }) // most active tier
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({
            total_bgt: parseUnits('50000', 18).toString(),
          }),
        }); // totalBgtWei

      mockGetDatabase.mockReturnValue({ prepare: mockPrepare });

      const analytics = statsService.getAdminAnalytics();

      expect(analytics.totalMembers).toBe(100);
      expect(analytics.weeklyActive).toBe(75);
      expect(analytics.newThisWeek).toBe(5);
      expect(analytics.promotionsThisWeek).toBe(3);
      expect(analytics.badgesAwardedThisWeek).toBe(12);
      expect(analytics.avgMessagesPerMember).toBe(10); // 100 / 10
      expect(analytics.mostActiveTier).toBe('ichwan');
      expect(analytics.generatedAt).toBeInstanceOf(Date);
    });
  });
});
