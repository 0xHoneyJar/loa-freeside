/**
 * Unit Tests for DigestService (Sprint 20)
 *
 * Tests weekly digest stats collection, formatting, and posting logic
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { formatUnits } from 'viem';
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
const mockPrepare = vi.fn();
const mockGet = vi.fn();
const mockAll = vi.fn();
const mockRun = vi.fn();

const mockGetDatabase = vi.fn(() => ({
  prepare: mockPrepare,
}));

vi.mock('../../src/db/index.js', () => ({
  getDatabase: mockGetDatabase,
  logAuditEvent: vi.fn(),
}));

// Mock Discord client
const mockSend = vi.fn();
const mockFetch = vi.fn();

const mockDiscordClient = {
  channels: {
    fetch: mockFetch,
  },
};

// Import after mocks
const { digestService } = await import('../../src/services/DigestService.js');

describe('DigestService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default chain: prepare -> get/all/run
    mockPrepare.mockReturnValue({
      get: mockGet,
      all: mockAll,
      run: mockRun,
    });
  });

  describe('getWeekIdentifier', () => {
    it('returns correct week identifier for date', () => {
      const date = new Date('2025-01-06T00:00:00Z'); // Monday, week 2
      const weekId = digestService.getWeekIdentifier(date);

      expect(weekId).toMatch(/2025-W\d{2}/);
    });

    it('uses current date if no date provided', () => {
      const weekId = digestService.getWeekIdentifier();

      expect(weekId).toMatch(/\d{4}-W\d{2}/);
    });

    it('calculates correct ISO 8601 week for year boundary edge cases', () => {
      // December 29, 2025 is Monday (should be 2026-W01 per ISO 8601)
      // This week has 4+ days in 2026, so it belongs to 2026-W01
      const dec29_2025 = new Date('2025-12-29T00:00:00Z');
      expect(digestService.getWeekIdentifier(dec29_2025)).toBe('2026-W01');

      // January 4, 2026 is Sunday (should be 2026-W01)
      // This is the last day of week 2026-W01
      const jan4_2026 = new Date('2026-01-04T00:00:00Z');
      expect(digestService.getWeekIdentifier(jan4_2026)).toBe('2026-W01');

      // January 5, 2026 is Monday (should be 2026-W02)
      // This is the first day of week 2026-W02
      const jan5_2026 = new Date('2026-01-05T00:00:00Z');
      expect(digestService.getWeekIdentifier(jan5_2026)).toBe('2026-W02');

      // December 31, 2024 is Tuesday (should be 2025-W01 per ISO 8601)
      // Week with Jan 1-6, 2025 (Thursday is Jan 2) belongs to 2025
      const dec31_2024 = new Date('2024-12-31T00:00:00Z');
      expect(digestService.getWeekIdentifier(dec31_2024)).toBe('2025-W01');

      // January 1, 2025 is Wednesday (should be 2025-W01)
      const jan1_2025 = new Date('2025-01-01T00:00:00Z');
      expect(digestService.getWeekIdentifier(jan1_2025)).toBe('2025-W01');
    });

    it('handles week 53 correctly for 53-week years', () => {
      // December 28, 2020 is Monday (should be 2020-W53)
      // 2020 was a 53-week year (started on Wednesday, leap year)
      const dec28_2020 = new Date('2020-12-28T00:00:00Z');
      expect(digestService.getWeekIdentifier(dec28_2020)).toBe('2020-W53');

      // January 3, 2021 is Sunday (should be 2020-W53, last day)
      const jan3_2021 = new Date('2021-01-03T00:00:00Z');
      expect(digestService.getWeekIdentifier(jan3_2021)).toBe('2020-W53');

      // January 4, 2021 is Monday (should be 2021-W01)
      const jan4_2021 = new Date('2021-01-04T00:00:00Z');
      expect(digestService.getWeekIdentifier(jan4_2021)).toBe('2021-W01');
    });
  });

  describe('collectWeeklyStats', () => {
    it('collects comprehensive weekly stats', () => {
      // Mock total members
      mockGet.mockReturnValueOnce({ count: 150 });

      // Mock new members this week
      mockGet.mockReturnValueOnce({ count: 12 });

      // Mock total BGT
      mockGet.mockReturnValueOnce({ total_bgt: '1000000000000000000000' }); // 1000 BGT in wei

      // Mock tier distribution
      mockAll.mockReturnValueOnce([
        { tier: 'hajra', count: 50 },
        { tier: 'ichwan', count: 40 },
        { tier: 'qanat', count: 30 },
        { tier: 'sihaya', count: 20 },
        { tier: 'mushtamal', count: 10 },
      ]);

      // Mock most active tier
      mockGet.mockReturnValueOnce({ tier: 'ichwan', total_activity: 500 });

      // Mock promotions count
      mockGet.mockReturnValueOnce({ count: 8 });

      // Mock notable promotions
      mockAll.mockReturnValueOnce([
        { nym: 'Alice', new_tier: 'usul' },
        { nym: 'Bob', new_tier: 'fedaykin' },
      ]);

      // Mock badges awarded
      mockGet.mockReturnValueOnce({ count: 15 });

      // Mock top new member
      mockGet.mockReturnValueOnce({
        nym: 'Charlie',
        tier: 'sihaya',
        bgt_held: '500000000000000000000', // 500 BGT
      });

      const stats = digestService.collectWeeklyStats();

      expect(stats.totalMembers).toBe(150);
      expect(stats.newMembers).toBe(12);
      expect(stats.totalBgt).toBeCloseTo(1000, 1);
      expect(stats.tierDistribution.hajra).toBe(50);
      expect(stats.tierDistribution.ichwan).toBe(40);
      expect(stats.mostActiveTier).toBe('ichwan');
      expect(stats.promotionsCount).toBe(8);
      expect(stats.notablePromotions).toHaveLength(2);
      expect(stats.notablePromotions[0].nym).toBe('Alice');
      expect(stats.notablePromotions[0].newTier).toBe('usul');
      expect(stats.badgesAwarded).toBe(15);
      expect(stats.topNewMember?.nym).toBe('Charlie');
      expect(stats.topNewMember?.tier).toBe('sihaya');
      expect(stats.weekIdentifier).toMatch(/\d{4}-W\d{2}/);
    });

    it('handles empty data gracefully', () => {
      // Mock all queries returning zeros/nulls/undefined
      mockGet.mockReturnValueOnce({ count: 0 }); // total members
      mockGet.mockReturnValueOnce({ count: 0 }); // new members
      mockGet.mockReturnValueOnce({ total_bgt: '0' }); // total BGT
      mockAll.mockReturnValueOnce([]); // tier distribution
      mockGet.mockReturnValueOnce(null); // most active tier
      mockGet.mockReturnValueOnce({ count: 0 }); // promotions count
      mockAll.mockReturnValueOnce([]); // notable promotions
      mockGet.mockReturnValueOnce({ count: 0 }); // badges awarded
      mockGet.mockReturnValueOnce(undefined); // top new member (no rows)

      const stats = digestService.collectWeeklyStats();

      expect(stats.totalMembers).toBe(0);
      expect(stats.newMembers).toBe(0);
      expect(stats.totalBgt).toBe(0);
      expect(stats.mostActiveTier).toBeNull();
      expect(stats.promotionsCount).toBe(0);
      expect(stats.notablePromotions).toHaveLength(0);
      expect(stats.badgesAwarded).toBe(0);
      expect(stats.topNewMember).toBeNull();
    });
  });

  describe('formatDigest', () => {
    it('formats digest with all sections when data present', () => {
      const stats = {
        weekIdentifier: '2025-W03',
        totalMembers: 150,
        newMembers: 12,
        totalBgt: 1500,
        totalBgtWei: '1500000000000000000000',
        tierDistribution: {
          hajra: 50,
          ichwan: 40,
          qanat: 30,
          sihaya: 20,
          mushtamal: 10,
          sayyadina: 0,
          usul: 0,
          fedaykin: 0,
          naib: 0,
        },
        mostActiveTier: 'ichwan' as Tier,
        promotionsCount: 8,
        notablePromotions: [
          { nym: 'Alice', newTier: 'usul' as Tier },
          { nym: 'Bob', newTier: 'fedaykin' as Tier },
        ],
        badgesAwarded: 15,
        topNewMember: { nym: 'Charlie', tier: 'sihaya' as Tier },
        generatedAt: new Date('2025-01-20T00:00:00Z'),
      };

      const message = digestService.formatDigest(stats);

      expect(message).toContain('📜 **Weekly Pulse of the Sietch**');
      expect(message).toContain('Total Members: **150** (+12 new)');
      expect(message).toContain('BGT Represented: **1,500 BGT**');
      expect(message).toContain('Most Active Tier: **Ichwan**');
      expect(message).toContain('🎖️ **New Members:**');
      expect(message).toContain('12 joined this week');
      expect(message).toContain('Charlie');
      expect(message).toContain('Sihaya');
      expect(message).toContain('⬆️ **Tier Promotions:**');
      expect(message).toContain('8 members rose to higher tiers');
      expect(message).toContain('Alice');
      expect(message).toContain('Usul');
      expect(message).toContain('Bob');
      expect(message).toContain('Fedaykin');
      expect(message).toContain('🏅 **Badges Awarded:**');
      expect(message).toContain('15 badges given this week');
      expect(message).toContain('*The spice flows...*');
    });

    it('omits sections when no activity', () => {
      const stats = {
        weekIdentifier: '2025-W03',
        totalMembers: 100,
        newMembers: 0,
        totalBgt: 1000,
        totalBgtWei: '1000000000000000000000',
        tierDistribution: {
          hajra: 100,
          ichwan: 0,
          qanat: 0,
          sihaya: 0,
          mushtamal: 0,
          sayyadina: 0,
          usul: 0,
          fedaykin: 0,
          naib: 0,
        },
        mostActiveTier: null,
        promotionsCount: 0,
        notablePromotions: [],
        badgesAwarded: 0,
        topNewMember: null,
        generatedAt: new Date('2025-01-20T00:00:00Z'),
      };

      const message = digestService.formatDigest(stats);

      expect(message).toContain('Total Members: **100**');
      expect(message).not.toContain('🎖️ **New Members:**');
      expect(message).not.toContain('⬆️ **Tier Promotions:**');
      expect(message).not.toContain('🏅 **Badges Awarded:**');
      expect(message).toContain('*The spice flows...*');
    });
  });

  describe('postDigest', () => {
    it('posts digest successfully and stores record', async () => {
      const stats = {
        weekIdentifier: '2025-W03',
        totalMembers: 150,
        newMembers: 12,
        totalBgt: 1500,
        totalBgtWei: '1500000000000000000000',
        tierDistribution: {
          hajra: 50,
          ichwan: 40,
          qanat: 30,
          sihaya: 20,
          mushtamal: 10,
          sayyadina: 0,
          usul: 0,
          fedaykin: 0,
          naib: 0,
        },
        mostActiveTier: 'ichwan' as Tier,
        promotionsCount: 8,
        notablePromotions: [],
        badgesAwarded: 15,
        topNewMember: null,
        generatedAt: new Date(),
      };

      const mockChannel = {
        isTextBased: () => true,
        send: mockSend,
      };

      mockFetch.mockResolvedValue(mockChannel);
      mockSend.mockResolvedValue({
        id: 'message-123',
        channelId: 'channel-456',
      });

      const result = await digestService.postDigest(
        stats,
        mockDiscordClient as any,
        'channel-456'
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('message-123');
      expect(result.channelId).toBe('channel-456');
      expect(mockFetch).toHaveBeenCalledWith('channel-456');
      expect(mockSend).toHaveBeenCalled();
      expect(mockRun).toHaveBeenCalled(); // Database insert
    });

    it('handles channel not found error', async () => {
      const stats = {
        weekIdentifier: '2025-W03',
        totalMembers: 150,
        newMembers: 12,
        totalBgt: 1500,
        totalBgtWei: '1500000000000000000000',
        tierDistribution: {} as Record<Tier, number>,
        mostActiveTier: null,
        promotionsCount: 8,
        notablePromotions: [],
        badgesAwarded: 15,
        topNewMember: null,
        generatedAt: new Date(),
      };

      mockFetch.mockResolvedValue(null);

      const result = await digestService.postDigest(
        stats,
        mockDiscordClient as any,
        'channel-456'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Channel is not text-based');
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('handles Discord API error', async () => {
      const stats = {
        weekIdentifier: '2025-W03',
        totalMembers: 150,
        newMembers: 12,
        totalBgt: 1500,
        totalBgtWei: '1500000000000000000000',
        tierDistribution: {} as Record<Tier, number>,
        mostActiveTier: null,
        promotionsCount: 8,
        notablePromotions: [],
        badgesAwarded: 15,
        topNewMember: null,
        generatedAt: new Date(),
      };

      mockFetch.mockRejectedValue(new Error('Discord API error'));

      const result = await digestService.postDigest(
        stats,
        mockDiscordClient as any,
        'channel-456'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Discord API error');
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('digestExistsForWeek', () => {
    it('returns true when digest exists', () => {
      mockGet.mockReturnValue({ count: 1 });

      const exists = digestService.digestExistsForWeek('2025-W03');

      expect(exists).toBe(true);
      expect(mockPrepare).toHaveBeenCalled();
      expect(mockGet).toHaveBeenCalledWith('2025-W03');
    });

    it('returns false when digest does not exist', () => {
      mockGet.mockReturnValue({ count: 0 });

      const exists = digestService.digestExistsForWeek('2025-W03');

      expect(exists).toBe(false);
    });
  });

  describe('getRecentDigests', () => {
    it('returns recent digests with formatting', () => {
      mockAll.mockReturnValue([
        {
          week_identifier: '2025-W03',
          total_members: 150,
          new_members: 12,
          total_bgt: '1500000000000000000000',
          tier_distribution: JSON.stringify({ hajra: 50, ichwan: 40 }),
          most_active_tier: 'ichwan',
          promotions_count: 8,
          notable_promotions: JSON.stringify([{ nym: 'Alice', newTier: 'usul' }]),
          badges_awarded: 15,
          top_new_member_nym: 'Charlie',
          message_id: 'msg-123',
          generated_at: '2025-01-20T00:00:00Z',
        },
      ]);

      const digests = digestService.getRecentDigests(5);

      expect(digests).toHaveLength(1);
      expect(digests[0].weekIdentifier).toBe('2025-W03');
      expect(digests[0].totalMembers).toBe(150);
      expect(digests[0].newMembers).toBe(12);
      expect(digests[0].totalBgt).toBeCloseTo(1500, 1);
      expect(digests[0].mostActiveTier).toBe('ichwan');
      expect(digests[0].messageId).toBe('msg-123');
      expect(mockPrepare).toHaveBeenCalled();
      expect(mockAll).toHaveBeenCalledWith(5);
    });

    it('handles empty results', () => {
      mockAll.mockReturnValue([]);

      const digests = digestService.getRecentDigests(10);

      expect(digests).toHaveLength(0);
    });
  });
});
