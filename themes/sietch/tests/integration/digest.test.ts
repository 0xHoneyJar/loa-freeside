/**
 * Weekly Digest Integration Tests
 *
 * Tests end-to-end weekly digest generation and posting:
 * - Stats collection from various sources
 * - Digest formatting
 * - Discord posting
 * - Digest storage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config
vi.mock('../../src/config.js', () => ({
  config: {
    discord: {
      channels: { announcements: 'channel-announcements' },
      guildId: 'guild',
      botToken: 'token',
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
const mockCountMembers = vi.fn();
const mockCountNewMembers = vi.fn();
const mockGetTotalBgt = vi.fn();
const mockGetTierDistribution = vi.fn();
const mockCountTierPromotions = vi.fn();
const mockCountBadgesAwarded = vi.fn();
const mockGetRecentTierChanges = vi.fn();
const mockGetTopActiveMembers = vi.fn();
const mockInsertWeeklyDigest = vi.fn();

vi.mock('../../src/db/index.js', () => ({
  getDatabase: vi.fn(() => ({
    prepare: vi.fn(() => ({
      get: vi.fn(() => ({ count: 350 })),
      all: vi.fn(() => []),
    })),
  })),
  countMembers: mockCountMembers,
  countNewMembersInDateRange: mockCountNewMembers,
  getTotalBgtRepresented: mockGetTotalBgt,
  getTierDistribution: mockGetTierDistribution,
  countTierPromotions: mockCountTierPromotions,
  countBadgesAwardedInDateRange: mockCountBadgesAwarded,
  getRecentTierChanges: mockGetRecentTierChanges,
  getTopActiveMembers: mockGetTopActiveMembers,
  insertWeeklyDigest: mockInsertWeeklyDigest,
  logAuditEvent: vi.fn(),
}));

// Import after mocks
const { digestService } = await import('../../src/services/DigestService.js');

describe('Weekly Digest Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Stats Collection', () => {
    it('should collect all required weekly stats', async () => {
      // Setup mock data
      mockCountMembers.mockResolvedValue(350);
      mockCountNewMembers.mockResolvedValue(25);
      mockGetTotalBgt.mockResolvedValue('1250000000000000000000000'); // 1.25M BGT
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
      mockCountTierPromotions.mockResolvedValue(18);
      mockCountBadgesAwarded.mockResolvedValue(12);
      mockGetRecentTierChanges.mockResolvedValue([
        { member_id: 'm1', nym: 'Member1', to_tier: 'fedaykin' },
        { member_id: 'm2', nym: 'Member2', to_tier: 'usul' },
      ]);
      mockGetTopActiveMembers.mockResolvedValue([
        { member_id: 'm3', nym: 'ActiveMember', activity_balance: 1500 },
      ]);

      const stats = await digestService.collectWeeklyStats();

      expect(stats.totalMembers).toBe(350);
      expect(stats.newMembers).toBe(25);
      expect(stats.totalBgt).toBe('1250000'); // Formatted
      expect(stats.promotions).toBe(18);
      expect(stats.badgesAwarded).toBe(12);
      expect(stats.tierDistribution).toHaveLength(9);
    });

    it('should handle zero new members gracefully', async () => {
      mockCountMembers.mockResolvedValue(300);
      mockCountNewMembers.mockResolvedValue(0);
      mockGetTotalBgt.mockResolvedValue('1000000000000000000000000');
      mockGetTierDistribution.mockResolvedValue([
        { tier: 'hajra', count: 100 },
        { tier: 'ichwan', count: 80 },
        { tier: 'qanat', count: 50 },
        { tier: 'sihaya', count: 30 },
        { tier: 'mushtamal', count: 20 },
        { tier: 'sayyadina', count: 10 },
        { tier: 'usul', count: 5 },
        { tier: 'fedaykin', count: 60 },
        { tier: 'naib', count: 7 },
      ]);
      mockCountTierPromotions.mockResolvedValue(0);
      mockCountBadgesAwarded.mockResolvedValue(0);
      mockGetRecentTierChanges.mockResolvedValue([]);
      mockGetTopActiveMembers.mockResolvedValue([]);

      const stats = await digestService.collectWeeklyStats();

      expect(stats.newMembers).toBe(0);
      expect(stats.promotions).toBe(0);
      expect(stats.badgesAwarded).toBe(0);
    });
  });

  describe('Digest Formatting', () => {
    it('should format digest with all stats sections', async () => {
      const mockStats = {
        totalMembers: 350,
        newMembers: 25,
        totalBgt: '1250000',
        tierDistribution: [
          { tier: 'hajra', count: 100 },
          { tier: 'ichwan', count: 80 },
          { tier: 'qanat', count: 70 },
          { tier: 'sihaya', count: 50 },
          { tier: 'mushtamal', count: 25 },
          { tier: 'sayyadina', count: 12 },
          { tier: 'usul', count: 6 },
          { tier: 'fedaykin', count: 62 },
          { tier: 'naib', count: 7 },
        ],
        mostActiveTier: 'ichwan',
        promotions: 18,
        badgesAwarded: 12,
        notablePromotions: [
          { nym: 'Member1', tier: 'fedaykin' },
          { nym: 'Member2', tier: 'usul' },
        ],
        topNewMember: { nym: 'NewMember', tier: 'qanat' },
      };

      const formatted = digestService.formatDigest(mockStats);

      expect(formatted).toContain('350'); // Total members
      expect(formatted).toContain('25'); // New members
      expect(formatted).toContain('1,250,000'); // BGT formatted
      expect(formatted).toContain('18'); // Promotions
      expect(formatted).toContain('12'); // Badges
      expect(formatted).toContain('Member1'); // Notable promotion
      expect(formatted).toContain('fedaykin'); // Tier name
    });

    it('should handle digest with no notable events', async () => {
      const mockStats = {
        totalMembers: 300,
        newMembers: 0,
        totalBgt: '1000000',
        tierDistribution: [
          { tier: 'hajra', count: 100 },
          { tier: 'ichwan', count: 80 },
          { tier: 'qanat', count: 50 },
          { tier: 'sihaya', count: 30 },
          { tier: 'mushtamal', count: 20 },
          { tier: 'sayyadina', count: 10 },
          { tier: 'usul', count: 5 },
          { tier: 'fedaykin', count: 60 },
          { tier: 'naib', count: 7 },
        ],
        mostActiveTier: 'hajra',
        promotions: 0,
        badgesAwarded: 0,
        notablePromotions: [],
        topNewMember: null,
      };

      const formatted = digestService.formatDigest(mockStats);

      expect(formatted).toContain('300'); // Total members
      expect(formatted).toBeDefined();
      expect(formatted.length).toBeGreaterThan(0);
    });
  });

  describe('Digest Posting', () => {
    it('should post digest to announcements channel', async () => {
      const mockClient = {
        channels: {
          fetch: vi.fn().mockResolvedValue({
            id: 'channel-announcements',
            isTextBased: () => true,
            send: vi.fn().mockResolvedValue({
              id: 'message-123',
              url: 'https://discord.com/channels/guild/channel/message-123',
            }),
          }),
        },
      };

      mockCountMembers.mockResolvedValue(350);
      mockCountNewMembers.mockResolvedValue(25);
      mockGetTotalBgt.mockResolvedValue('1250000000000000000000000');
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
      mockCountTierPromotions.mockResolvedValue(18);
      mockCountBadgesAwarded.mockResolvedValue(12);
      mockGetRecentTierChanges.mockResolvedValue([]);
      mockGetTopActiveMembers.mockResolvedValue([]);

      const result = await digestService.postDigest(mockClient as any);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('message-123');
      expect(mockInsertWeeklyDigest).toHaveBeenCalledWith(
        expect.objectContaining({
          posted_at: expect.any(Number),
          message_id: 'message-123',
          stats: expect.any(String),
        })
      );
    });

    it('should handle posting failure gracefully', async () => {
      const mockClient = {
        channels: {
          fetch: vi.fn().mockRejectedValue(new Error('Channel not found')),
        },
      };

      const result = await digestService.postDigest(mockClient as any);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(mockInsertWeeklyDigest).not.toHaveBeenCalled();
    });
  });

  describe('Digest Storage', () => {
    it('should store digest with all metadata', async () => {
      const digestData = {
        posted_at: Date.now(),
        message_id: 'msg-123',
        stats: JSON.stringify({ totalMembers: 350 }),
      };

      mockInsertWeeklyDigest.mockResolvedValue({ id: 'digest-1' });

      await digestService.storeDigest(digestData);

      expect(mockInsertWeeklyDigest).toHaveBeenCalledWith(digestData);
    });
  });

  describe('Edge Cases', () => {
    it('should handle database query failures', async () => {
      mockCountMembers.mockRejectedValue(new Error('Database error'));

      await expect(digestService.collectWeeklyStats()).rejects.toThrow('Database error');
    });

    it('should handle missing announcements channel ID', async () => {
      // This would be handled by graceful degradation in config
      const mockClient = {
        channels: {
          fetch: vi.fn().mockResolvedValue(null),
        },
      };

      const result = await digestService.postDigest(mockClient as any);

      expect(result.success).toBe(false);
    });

    it('should format large BGT numbers correctly', async () => {
      mockCountMembers.mockResolvedValue(500);
      mockCountNewMembers.mockResolvedValue(50);
      mockGetTotalBgt.mockResolvedValue('10000000000000000000000000'); // 10M BGT
      mockGetTierDistribution.mockResolvedValue([
        { tier: 'hajra', count: 200 },
        { tier: 'ichwan', count: 150 },
        { tier: 'qanat', count: 100 },
        { tier: 'sihaya', count: 50 },
        { tier: 'mushtamal', count: 25 },
        { tier: 'sayyadina', count: 12 },
        { tier: 'usul', count: 6 },
        { tier: 'fedaykin', count: 62 },
        { tier: 'naib', count: 7 },
      ]);
      mockCountTierPromotions.mockResolvedValue(30);
      mockCountBadgesAwarded.mockResolvedValue(20);
      mockGetRecentTierChanges.mockResolvedValue([]);
      mockGetTopActiveMembers.mockResolvedValue([]);

      const stats = await digestService.collectWeeklyStats();

      expect(stats.totalBgt).toContain('10,000,000'); // 10M formatted
    });
  });
});
