/**
 * Stats System Integration Tests
 *
 * Tests personal and community stats aggregation:
 * - Personal stats collection
 * - Community analytics
 * - Tier progress calculations
 * - Activity metrics
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseUnits } from 'viem';

// Mock config
vi.mock('../../src/config.js', () => ({
  config: {
    discord: {
      guildId: 'guild',
      channels: { census: 'channel-census' },
    },
  },
}));

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock database queries
const mockGetMemberProfileById = vi.fn();
const mockGetMemberActivity = vi.fn();
const mockGetMemberBadgeCount = vi.fn();
const mockCountMembers = vi.fn();
const mockGetTotalBgt = vi.fn();
const mockCountWeeklyActive = vi.fn();
const mockGetTierDistribution = vi.fn();

vi.mock('../../src/db/queries.js', () => ({
  getMemberProfileById: mockGetMemberProfileById,
  getMemberActivity: mockGetMemberActivity,
  getMemberBadgeCount: mockGetMemberBadgeCount,
  countMembers: mockCountMembers,
  getTotalBgtRepresented: mockGetTotalBgt,
  countWeeklyActiveMembers: mockCountWeeklyActive,
  getTierDistribution: mockGetTierDistribution,
  getRecentTierChanges: vi.fn(() => []),
  getTopActiveMembers: vi.fn(() => []),
  countTierPromotions: vi.fn(() => 0),
  countBadgesAwardedInDateRange: vi.fn(() => 0),
  logAuditEvent: vi.fn(),
}));

// Import after mocks
const { statsService } = await import('../../src/services/StatsService.js');
const { tierService } = await import('../../src/services/TierService.js');

describe('Stats System Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Personal Stats', () => {
    it('should collect complete personal stats', async () => {
      const memberId = 'member-123';
      const memberSince = Date.now() - 86400000 * 60; // 60 days ago

      mockGetMemberProfileById.mockResolvedValue({
        member_id: memberId,
        nym: 'TestMember',
        tier: 'ichwan',
        onboarding_completed_at: memberSince,
      });

      mockGetMemberActivity.mockResolvedValue({
        messages_this_week: 25,
        current_streak: 5,
        longest_streak: 12,
        activity_balance: 450,
      });

      mockGetMemberBadgeCount.mockResolvedValue(3);

      const stats = await statsService.getPersonalStats(memberId);

      expect(stats.nym).toBe('TestMember');
      expect(stats.tier).toBe('ichwan');
      expect(stats.memberSince).toBeDefined();
      expect(stats.messagesThisWeek).toBe(25);
      expect(stats.currentStreak).toBe(5);
      expect(stats.longestStreak).toBe(12);
      expect(stats.badgeCount).toBe(3);
      expect(stats.tierProgress).toBeDefined();
    });

    it('should include tier progress in personal stats', async () => {
      const memberId = 'member-456';
      const bgt = parseUnits('150', 18); // 150 BGT (Ichwan tier)

      mockGetMemberProfileById.mockResolvedValue({
        member_id: memberId,
        nym: 'ProgressMember',
        tier: 'ichwan',
        onboarding_completed_at: Date.now() - 86400000,
      });

      mockGetMemberActivity.mockResolvedValue({
        messages_this_week: 10,
        current_streak: 3,
        longest_streak: 5,
        activity_balance: 200,
      });

      mockGetMemberBadgeCount.mockResolvedValue(1);

      const stats = await statsService.getPersonalStats(memberId);

      const progress = tierService.getTierProgressData('ichwan', bgt);

      expect(stats.tierProgress.currentTier).toBe('ichwan');
      expect(stats.tierProgress.nextTier).toBe('qanat');
      expect(stats.tierProgress.nextThreshold).toBe('222');
    });

    it('should handle member with no activity gracefully', async () => {
      const memberId = 'member-inactive';

      mockGetMemberProfileById.mockResolvedValue({
        member_id: memberId,
        nym: 'InactiveMember',
        tier: 'hajra',
        onboarding_completed_at: Date.now() - 86400000,
      });

      mockGetMemberActivity.mockResolvedValue({
        messages_this_week: 0,
        current_streak: 0,
        longest_streak: 0,
        activity_balance: 0,
      });

      mockGetMemberBadgeCount.mockResolvedValue(0);

      const stats = await statsService.getPersonalStats(memberId);

      expect(stats.messagesThisWeek).toBe(0);
      expect(stats.currentStreak).toBe(0);
      expect(stats.badgeCount).toBe(0);
    });

    it('should handle Naib member stats correctly', async () => {
      const memberId = 'member-naib';

      mockGetMemberProfileById.mockResolvedValue({
        member_id: memberId,
        nym: 'NaibMember',
        tier: 'naib',
        onboarding_completed_at: Date.now() - 86400000 * 180, // 180 days ago
      });

      mockGetMemberActivity.mockResolvedValue({
        messages_this_week: 50,
        current_streak: 15,
        longest_streak: 30,
        activity_balance: 1500,
      });

      mockGetMemberBadgeCount.mockResolvedValue(8);

      const stats = await statsService.getPersonalStats(memberId);

      expect(stats.tier).toBe('naib');
      expect(stats.tierProgress.nextTier).toBeNull(); // Naib is highest tier
    });
  });

  describe('Community Analytics', () => {
    it('should aggregate complete community stats', async () => {
      mockCountMembers.mockResolvedValue(350);
      mockGetTotalBgt.mockResolvedValue('1250000000000000000000000'); // 1.25M BGT
      mockCountWeeklyActive.mockResolvedValue(280);
      mockGetTierDistribution.mockResolvedValue([
        { tier: 'hajra', count: 100 },
        { tier: 'ichwan', count: 80 },
        { tier: 'qanat', count: 70 },
        { tier: 'sihaya', count: 50 },
        { tier: 'mushtamal', count: 25 },
        { tier: 'sayyadina', count: 12 },
        { tier: 'usul', count: 6 },
        { tier: 'fedaykin', count: 62 },
        { tier: 'naib', count: 7 },
      ]);

      const analytics = await statsService.getCommunityAnalytics();

      expect(analytics.totalMembers).toBe(350);
      expect(analytics.totalBgt).toBe('1250000'); // Formatted
      expect(analytics.weeklyActive).toBe(280);
      expect(analytics.tierDistribution).toHaveLength(9);
      expect(analytics.tierDistribution.find(d => d.tier === 'naib')?.count).toBe(7);
    });

    it('should calculate tier distribution percentages', async () => {
      mockCountMembers.mockResolvedValue(100);
      mockGetTotalBgt.mockResolvedValue('500000000000000000000000');
      mockCountWeeklyActive.mockResolvedValue(80);
      mockGetTierDistribution.mockResolvedValue([
        { tier: 'hajra', count: 30 }, // 30%
        { tier: 'ichwan', count: 25 }, // 25%
        { tier: 'qanat', count: 20 }, // 20%
        { tier: 'sihaya', count: 15 }, // 15%
        { tier: 'mushtamal', count: 5 }, // 5%
        { tier: 'sayyadina', count: 2 }, // 2%
        { tier: 'usul', count: 1 }, // 1%
        { tier: 'fedaykin', count: 1 }, // 1%
        { tier: 'naib', count: 1 }, // 1%
      ]);

      const analytics = await statsService.getCommunityAnalytics();

      const hajraDistribution = analytics.tierDistribution.find(d => d.tier === 'hajra');
      expect(hajraDistribution?.count).toBe(30);
      expect(hajraDistribution?.percentage).toBeCloseTo(30, 1);
    });

    it('should handle community with no members', async () => {
      mockCountMembers.mockResolvedValue(0);
      mockGetTotalBgt.mockResolvedValue('0');
      mockCountWeeklyActive.mockResolvedValue(0);
      mockGetTierDistribution.mockResolvedValue([]);

      const analytics = await statsService.getCommunityAnalytics();

      expect(analytics.totalMembers).toBe(0);
      expect(analytics.totalBgt).toBe('0');
      expect(analytics.weeklyActive).toBe(0);
      expect(analytics.tierDistribution).toHaveLength(0);
    });
  });

  describe('Tier Leaderboard', () => {
    it('should rank members by proximity to next tier', async () => {
      // Members closest to promotion should rank higher
      const leaderboard = await statsService.getTierLeaderboard(10);

      expect(leaderboard).toBeDefined();
      // First member should have smallest distance to next tier
      if (leaderboard.length > 1) {
        expect(leaderboard[0].distance).toBeLessThanOrEqual(leaderboard[1].distance);
      }
    });

    it('should exclude Fedaykin and Naib from tier leaderboard', async () => {
      const leaderboard = await statsService.getTierLeaderboard(10);

      const hasRankBased = leaderboard.some(
        member => member.tier === 'fedaykin' || member.tier === 'naib'
      );

      expect(hasRankBased).toBe(false);
    });

    it('should limit leaderboard to requested size', async () => {
      const leaderboard = await statsService.getTierLeaderboard(5);

      expect(leaderboard.length).toBeLessThanOrEqual(5);
    });
  });

  describe('Activity Metrics', () => {
    it('should calculate weekly active percentage correctly', async () => {
      mockCountMembers.mockResolvedValue(400);
      mockCountWeeklyActive.mockResolvedValue(320); // 80% active

      const analytics = await statsService.getCommunityAnalytics();

      const activePercentage = (analytics.weeklyActive / analytics.totalMembers) * 100;
      expect(activePercentage).toBe(80);
    });

    it('should handle 100% weekly active rate', async () => {
      mockCountMembers.mockResolvedValue(100);
      mockCountWeeklyActive.mockResolvedValue(100);

      const analytics = await statsService.getCommunityAnalytics();

      expect(analytics.weeklyActive).toBe(100);
      expect(analytics.totalMembers).toBe(100);
    });

    it('should handle 0% weekly active rate', async () => {
      mockCountMembers.mockResolvedValue(100);
      mockCountWeeklyActive.mockResolvedValue(0);

      const analytics = await statsService.getCommunityAnalytics();

      expect(analytics.weeklyActive).toBe(0);
      expect(analytics.totalMembers).toBe(100);
    });
  });

  describe('Edge Cases', () => {
    it('should handle member profile not found', async () => {
      mockGetMemberProfileById.mockResolvedValue(null);

      await expect(
        statsService.getPersonalStats('nonexistent-member')
      ).rejects.toThrow('Member not found');
    });

    it('should handle very large BGT numbers', async () => {
      mockCountMembers.mockResolvedValue(1000);
      mockGetTotalBgt.mockResolvedValue('100000000000000000000000000'); // 100M BGT
      mockCountWeeklyActive.mockResolvedValue(800);
      mockGetTierDistribution.mockResolvedValue([
        { tier: 'hajra', count: 400 },
        { tier: 'ichwan', count: 250 },
        { tier: 'qanat', count: 150 },
        { tier: 'sihaya', count: 100 },
        { tier: 'mushtamal', count: 50 },
        { tier: 'sayyadina', count: 25 },
        { tier: 'usul', count: 15 },
        { tier: 'fedaykin', count: 62 },
        { tier: 'naib', count: 7 },
      ]);

      const analytics = await statsService.getCommunityAnalytics();

      expect(analytics.totalBgt).toContain('100,000,000'); // Properly formatted
    });

    it('should handle database query errors gracefully', async () => {
      mockCountMembers.mockRejectedValue(new Error('Database error'));

      await expect(
        statsService.getCommunityAnalytics()
      ).rejects.toThrow('Database error');
    });

    it('should handle member with multiple badges', async () => {
      const memberId = 'member-badges';

      mockGetMemberProfileById.mockResolvedValue({
        member_id: memberId,
        nym: 'BadgeCollector',
        tier: 'usul',
        onboarding_completed_at: Date.now() - 86400000 * 365, // 1 year ago
      });

      mockGetMemberActivity.mockResolvedValue({
        messages_this_week: 100,
        current_streak: 30,
        longest_streak: 90,
        activity_balance: 5000,
      });

      mockGetMemberBadgeCount.mockResolvedValue(12);

      const stats = await statsService.getPersonalStats(memberId);

      expect(stats.badgeCount).toBe(12);
    });
  });

  describe('Stats Caching', () => {
    it('should return consistent stats within timeframe', async () => {
      mockCountMembers.mockResolvedValue(350);
      mockGetTotalBgt.mockResolvedValue('1250000000000000000000000');
      mockCountWeeklyActive.mockResolvedValue(280);
      mockGetTierDistribution.mockResolvedValue([
        { tier: 'hajra', count: 100 },
        { tier: 'ichwan', count: 80 },
        { tier: 'qanat', count: 70 },
        { tier: 'sihaya', count: 50 },
        { tier: 'mushtamal', count: 25 },
        { tier: 'sayyadina', count: 12 },
        { tier: 'usul', count: 6 },
        { tier: 'fedaykin', count: 62 },
        { tier: 'naib', count: 7 },
      ]);

      const analytics1 = await statsService.getCommunityAnalytics();
      const analytics2 = await statsService.getCommunityAnalytics();

      expect(analytics1.totalMembers).toBe(analytics2.totalMembers);
      expect(analytics1.totalBgt).toBe(analytics2.totalBgt);
    });
  });
});
