/**
 * Tier System Integration Tests
 *
 * Tests end-to-end tier calculation flow including:
 * - Tier assignment based on BGT and rank
 * - Tier history tracking
 * - Tier promotions and notifications
 * - Tier progress calculations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseUnits } from 'viem';

// Mock config
vi.mock('../../src/config.js', () => ({
  config: {
    discord: {
      roles: {
        hajra: 'role-hajra',
        ichwan: 'role-ichwan',
        qanat: 'role-qanat',
        sihaya: 'role-sihaya',
        mushtamal: 'role-mushtamal',
        sayyadina: 'role-sayyadina',
        usul: 'role-usul',
        fedaykin: 'role-fedaykin',
        naib: 'role-naib',
      },
      guildId: 'guild',
      channels: { theDoor: 'channel', census: 'channel' },
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
const mockUpdateMemberTier = vi.fn();
const mockInsertTierHistory = vi.fn();
const mockGetMemberProfileById = vi.fn();
const mockGetTierHistory = vi.fn();
const mockGetTierDistribution = vi.fn();
const mockLogAuditEvent = vi.fn();

vi.mock('../../src/db/index.js', () => ({
  updateMemberTier: mockUpdateMemberTier,
  insertTierHistory: mockInsertTierHistory,
  getMemberProfileById: mockGetMemberProfileById,
  getTierHistory: mockGetTierHistory,
  getTierDistribution: mockGetTierDistribution,
  logAuditEvent: mockLogAuditEvent,
  getRecentTierChanges: vi.fn(() => []),
  getTierChangesInDateRange: vi.fn(() => []),
  countTierPromotions: vi.fn(() => 0),
  getMembersByTier: vi.fn(() => []),
}));

// Import after mocks
const { tierService } = await import('../../src/services/TierService.js');

describe('Tier System Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Tier Calculation Flow', () => {
    it('should calculate correct tier for new Hajra member (6.9 BGT)', () => {
      const bgt = parseUnits('6.9', 18);
      const tier = tierService.calculateTier(bgt, null);

      expect(tier).toBe('hajra');
    });

    it('should calculate correct tier for Ichwan member (69 BGT)', () => {
      const bgt = parseUnits('69', 18);
      const tier = tierService.calculateTier(bgt, null);

      expect(tier).toBe('ichwan');
    });

    it('should calculate correct tier for Qanat member (222 BGT)', () => {
      const bgt = parseUnits('222', 18);
      const tier = tierService.calculateTier(bgt, null);

      expect(tier).toBe('qanat');
    });

    it('should prioritize rank for Fedaykin (rank 30 with 50 BGT)', () => {
      const bgt = parseUnits('50', 18);
      const tier = tierService.calculateTier(bgt, 30);

      expect(tier).toBe('fedaykin'); // Rank precedence over Ichwan
    });

    it('should prioritize rank for Naib (rank 5 with 100 BGT)', () => {
      const bgt = parseUnits('100', 18);
      const tier = tierService.calculateTier(bgt, 5);

      expect(tier).toBe('naib'); // Rank precedence over Ichwan
    });
  });

  describe('Tier Progression Detection', () => {
    it('should detect promotion from Hajra to Ichwan', () => {
      const isPromotion = tierService.isPromotion('hajra', 'ichwan');
      expect(isPromotion).toBe(true);
    });

    it('should detect promotion from Qanat to Sihaya', () => {
      const isPromotion = tierService.isPromotion('qanat', 'sihaya');
      expect(isPromotion).toBe(true);
    });

    it('should detect promotion from Usul to Fedaykin', () => {
      const isPromotion = tierService.isPromotion('usul', 'fedaykin');
      expect(isPromotion).toBe(true);
    });

    it('should detect promotion from Fedaykin to Naib', () => {
      const isPromotion = tierService.isPromotion('fedaykin', 'naib');
      expect(isPromotion).toBe(true);
    });

    it('should not detect promotion for same tier', () => {
      const isPromotion = tierService.isPromotion('ichwan', 'ichwan');
      expect(isPromotion).toBe(false);
    });

    it('should handle null oldTier as initial assignment', () => {
      const isPromotion = tierService.isPromotion(null, 'hajra');
      expect(isPromotion).toBe(false); // Initial assignment, not promotion
    });
  });

  describe('Tier Progress Calculation', () => {
    it('should calculate progress from Hajra to Ichwan', () => {
      const bgt = parseUnits('30', 18); // 30 BGT
      const progress = tierService.getTierProgressData('hajra', bgt);

      expect(progress.currentTier).toBe('hajra');
      expect(progress.nextTier).toBe('ichwan');
      expect(progress.nextThreshold).toBe('69');
      expect(progress.distance).toBe('39'); // 69 - 30 = 39
    });

    it('should calculate progress from Ichwan to Qanat', () => {
      const bgt = parseUnits('150', 18); // 150 BGT
      const progress = tierService.getTierProgressData('ichwan', bgt);

      expect(progress.currentTier).toBe('ichwan');
      expect(progress.nextTier).toBe('qanat');
      expect(progress.nextThreshold).toBe('222');
      expect(progress.distance).toBe('72'); // 222 - 150 = 72
    });

    it('should return null nextTier for Naib (highest tier)', () => {
      const bgt = parseUnits('5000', 18);
      const progress = tierService.getTierProgressData('naib', bgt);

      expect(progress.currentTier).toBe('naib');
      expect(progress.nextTier).toBeNull();
      expect(progress.nextThreshold).toBeNull();
      expect(progress.distance).toBeNull();
    });

    it('should calculate progress for Usul to Fedaykin (rank-based)', () => {
      const bgt = parseUnits('1200', 18);
      const progress = tierService.getTierProgressData('usul', bgt);

      expect(progress.currentTier).toBe('usul');
      expect(progress.nextTier).toBe('fedaykin');
      expect(progress.nextThreshold).toBeNull(); // Rank-based, no BGT threshold
      expect(progress.distance).toBeNull();
    });
  });

  describe('Tier Update with History', () => {
    it('should update member tier and log history on promotion', async () => {
      const memberId = 'member-123';
      const newTier = 'ichwan';
      const bgt = parseUnits('100', 18);
      const rank = null;

      mockGetMemberProfileById.mockResolvedValue({
        member_id: memberId,
        tier: 'hajra',
        tier_updated_at: Date.now() - 86400000, // 1 day ago
      });

      await tierService.updateMemberTier(memberId, bgt.toString(), rank);

      expect(mockUpdateMemberTier).toHaveBeenCalledWith(
        memberId,
        'ichwan',
        expect.any(Number)
      );

      expect(mockInsertTierHistory).toHaveBeenCalledWith({
        member_id: memberId,
        from_tier: 'hajra',
        to_tier: 'ichwan',
        changed_at: expect.any(Number),
        bgt_at_change: bgt.toString(),
        rank_at_change: null,
      });
    });

    it('should not log history if tier unchanged', async () => {
      const memberId = 'member-456';
      const bgt = parseUnits('80', 18);
      const rank = null;

      mockGetMemberProfileById.mockResolvedValue({
        member_id: memberId,
        tier: 'ichwan',
        tier_updated_at: Date.now() - 3600000, // 1 hour ago
      });

      await tierService.updateMemberTier(memberId, bgt.toString(), rank);

      expect(mockUpdateMemberTier).not.toHaveBeenCalled();
      expect(mockInsertTierHistory).not.toHaveBeenCalled();
    });
  });

  describe('Tier Distribution', () => {
    it('should aggregate tier distribution correctly', async () => {
      mockGetTierDistribution.mockResolvedValue([
        { tier: 'hajra', count: 100 },
        { tier: 'ichwan', count: 80 },
        { tier: 'qanat', count: 50 },
        { tier: 'sihaya', count: 30 },
        { tier: 'mushtamal', count: 15 },
        { tier: 'sayyadina', count: 10 },
        { tier: 'usul', count: 5 },
        { tier: 'fedaykin', count: 62 },
        { tier: 'naib', count: 7 },
      ]);

      const distribution = await tierService.getTierDistribution();

      expect(distribution).toHaveLength(9);
      expect(distribution.find(d => d.tier === 'naib')?.count).toBe(7);
      expect(distribution.find(d => d.tier === 'fedaykin')?.count).toBe(62);
      expect(distribution.find(d => d.tier === 'hajra')?.count).toBe(100);
    });
  });

  describe('Edge Cases', () => {
    it('should handle BGT exactly at threshold boundary', () => {
      const bgt = parseUnits('222', 18); // Exact Qanat threshold
      const tier = tierService.calculateTier(bgt, null);
      expect(tier).toBe('qanat');
    });

    it('should handle very high BGT without rank (Usul)', () => {
      const bgt = parseUnits('10000', 18);
      const tier = tierService.calculateTier(bgt, null);
      expect(tier).toBe('usul');
    });

    it('should handle rank 69 boundary (last Fedaykin)', () => {
      const bgt = parseUnits('500', 18);
      const tier = tierService.calculateTier(bgt, 69);
      expect(tier).toBe('fedaykin');
    });

    it('should handle rank 70 (not Fedaykin)', () => {
      const bgt = parseUnits('500', 18);
      const tier = tierService.calculateTier(bgt, 70);
      expect(tier).toBe('sihaya'); // Falls back to BGT-based
    });

    it('should handle minimal BGT below threshold (returns null)', () => {
      const bgt = parseUnits('5', 18); // Below 6.9 threshold
      const tier = tierService.calculateTier(bgt, null);
      expect(tier).toBeNull();
    });
  });

  describe('Tier History Retrieval', () => {
    it('should retrieve member tier history in chronological order', async () => {
      const memberId = 'member-789';
      const mockHistory = [
        { from_tier: null, to_tier: 'hajra', changed_at: 1000000 },
        { from_tier: 'hajra', to_tier: 'ichwan', changed_at: 2000000 },
        { from_tier: 'ichwan', to_tier: 'qanat', changed_at: 3000000 },
      ];

      mockGetTierHistory.mockResolvedValue(mockHistory);

      const history = await tierService.getTierHistory(memberId);

      expect(history).toHaveLength(3);
      expect(history[0].to_tier).toBe('hajra');
      expect(history[1].to_tier).toBe('ichwan');
      expect(history[2].to_tier).toBe('qanat');
    });
  });
});
