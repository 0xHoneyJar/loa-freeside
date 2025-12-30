/**
 * Unit Tests for TierService
 *
 * Tests tier calculation logic with various BGT amounts and rank scenarios
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

// Mock database queries (not used in core calculation tests)
vi.mock('../../src/db/index.js', () => ({
  logAuditEvent: vi.fn(),
  getMemberProfileById: vi.fn(),
  updateMemberTier: vi.fn(),
  insertTierHistory: vi.fn(),
  getTierHistory: vi.fn(),
  getTierDistribution: vi.fn(),
  getRecentTierChanges: vi.fn(),
  getTierChangesInDateRange: vi.fn(),
  countTierPromotions: vi.fn(),
  getMembersByTier: vi.fn(),
}));

// Import after mocks
const { tierService, TIER_THRESHOLDS, TIER_ORDER } = await import('../../src/services/TierService.js');

describe('TierService', () => {
  describe('calculateTier - Rank Precedence', () => {
    it('assigns Naib for rank 1-7', () => {
      for (let rank = 1; rank <= 7; rank++) {
        const tier = tierService.calculateTier('1000000000000000000', rank); // 1 BGT
        expect(tier).toBe('naib');
      }
    });

    it('assigns Fedaykin for rank 8-69', () => {
      for (let rank = 8; rank <= 69; rank++) {
        const tier = tierService.calculateTier('1000000000000000000', rank); // 1 BGT
        expect(tier).toBe('fedaykin');
      }
    });

    it('rank precedence overrides BGT-based tier for Naib (rank 5 with 500 BGT)', () => {
      const bgt = parseUnits('500', 18);
      const tier = tierService.calculateTier(bgt, 5);
      expect(tier).toBe('naib'); // Rank precedence
    });

    it('rank precedence overrides BGT-based tier for Fedaykin (rank 30 with 10 BGT)', () => {
      const bgt = parseUnits('10', 18);
      const tier = tierService.calculateTier(bgt, 30);
      expect(tier).toBe('fedaykin'); // Rank precedence
    });
  });

  describe('calculateTier - BGT Thresholds', () => {
    it('assigns Hajra for 6.9 BGT (exact threshold)', () => {
      const bgt = parseUnits('6.9', 18);
      const tier = tierService.calculateTier(bgt, null);
      expect(tier).toBe('hajra');
    });

    it('assigns Ichwan for 69 BGT (exact threshold)', () => {
      const bgt = parseUnits('69', 18);
      const tier = tierService.calculateTier(bgt, null);
      expect(tier).toBe('ichwan');
    });

    it('assigns Qanat for 222 BGT (exact threshold)', () => {
      const bgt = parseUnits('222', 18);
      const tier = tierService.calculateTier(bgt, null);
      expect(tier).toBe('qanat');
    });

    it('assigns Sihaya for 420 BGT (exact threshold)', () => {
      const bgt = parseUnits('420', 18);
      const tier = tierService.calculateTier(bgt, null);
      expect(tier).toBe('sihaya');
    });

    it('assigns Mushtamal for 690 BGT (exact threshold)', () => {
      const bgt = parseUnits('690', 18);
      const tier = tierService.calculateTier(bgt, null);
      expect(tier).toBe('mushtamal');
    });

    it('assigns Sayyadina for 888 BGT (exact threshold)', () => {
      const bgt = parseUnits('888', 18);
      const tier = tierService.calculateTier(bgt, null);
      expect(tier).toBe('sayyadina');
    });

    it('assigns Usul for 1111 BGT (exact threshold)', () => {
      const bgt = parseUnits('1111', 18);
      const tier = tierService.calculateTier(bgt, null);
      expect(tier).toBe('usul');
    });

    it('assigns Usul for 5000 BGT (above highest threshold)', () => {
      const bgt = parseUnits('5000', 18);
      const tier = tierService.calculateTier(bgt, null);
      expect(tier).toBe('usul');
    });
  });

  describe('calculateTier - Boundary Cases', () => {
    it('assigns Hajra for 6.8999 BGT (just below Hajra threshold)', () => {
      const bgt = parseUnits('6.8999', 18);
      const tier = tierService.calculateTier(bgt, null);
      expect(tier).toBe('hajra'); // Default to Hajra
    });

    it('assigns Hajra for 68.9999 BGT (just below Ichwan threshold)', () => {
      const bgt = parseUnits('68.9999', 18);
      const tier = tierService.calculateTier(bgt, null);
      expect(tier).toBe('hajra');
    });

    it('assigns Ichwan for 69.0001 BGT (just above Ichwan threshold)', () => {
      const bgt = parseUnits('69.0001', 18);
      const tier = tierService.calculateTier(bgt, null);
      expect(tier).toBe('ichwan');
    });

    it('assigns Ichwan for 221.9999 BGT (just below Qanat threshold)', () => {
      const bgt = parseUnits('221.9999', 18);
      const tier = tierService.calculateTier(bgt, null);
      expect(tier).toBe('ichwan');
    });

    it('assigns Qanat for 222.0001 BGT (just above Qanat threshold)', () => {
      const bgt = parseUnits('222.0001', 18);
      const tier = tierService.calculateTier(bgt, null);
      expect(tier).toBe('qanat');
    });

    it('assigns Sayyadina for 1110.9999 BGT (just below Usul threshold)', () => {
      const bgt = parseUnits('1110.9999', 18);
      const tier = tierService.calculateTier(bgt, null);
      expect(tier).toBe('sayyadina');
    });

    it('assigns Usul for 1111.0001 BGT (just above Usul threshold)', () => {
      const bgt = parseUnits('1111.0001', 18);
      const tier = tierService.calculateTier(bgt, null);
      expect(tier).toBe('usul');
    });
  });

  describe('calculateTier - Edge Cases', () => {
    it('handles bigint input', () => {
      const bgt = 69000000000000000000n; // 69 BGT as bigint
      const tier = tierService.calculateTier(bgt, null);
      expect(tier).toBe('ichwan');
    });

    it('handles string input', () => {
      const bgt = '69000000000000000000'; // 69 BGT as string
      const tier = tierService.calculateTier(bgt, null);
      expect(tier).toBe('ichwan');
    });

    it('handles undefined rank as null', () => {
      const bgt = parseUnits('100', 18);
      const tier = tierService.calculateTier(bgt, undefined);
      expect(tier).toBe('ichwan'); // BGT-based
    });

    it('handles rank 0 (invalid) as null', () => {
      const bgt = parseUnits('100', 18);
      const tier = tierService.calculateTier(bgt, 0);
      expect(tier).toBe('ichwan'); // BGT-based (rank 0 is invalid)
    });

    it('handles very large BGT (10000)', () => {
      const bgt = parseUnits('10000', 18);
      const tier = tierService.calculateTier(bgt, null);
      expect(tier).toBe('usul'); // Still Usul (no tier above)
    });
  });

  describe('isPromotion', () => {
    it('detects promotion from Hajra to Ichwan', () => {
      expect(tierService.isPromotion('hajra', 'ichwan')).toBe(true);
    });

    it('detects promotion from Ichwan to Fedaykin', () => {
      expect(tierService.isPromotion('ichwan', 'fedaykin')).toBe(true);
    });

    it('detects promotion from Fedaykin to Naib', () => {
      expect(tierService.isPromotion('fedaykin', 'naib')).toBe(true);
    });

    it('detects promotion from Hajra to Usul (skip tiers)', () => {
      expect(tierService.isPromotion('hajra', 'usul')).toBe(true);
    });

    it('detects promotion from Usul to Fedaykin (rank-based override)', () => {
      expect(tierService.isPromotion('usul', 'fedaykin')).toBe(true);
    });

    it('does not detect promotion for same tier', () => {
      expect(tierService.isPromotion('ichwan', 'ichwan')).toBe(false);
    });

    it('does not detect promotion for demotion', () => {
      expect(tierService.isPromotion('naib', 'fedaykin')).toBe(false);
      expect(tierService.isPromotion('usul', 'sayyadina')).toBe(false);
      expect(tierService.isPromotion('ichwan', 'hajra')).toBe(false);
    });
  });

  describe('getNextTier', () => {
    it('returns Ichwan as next tier for Hajra', () => {
      expect(tierService.getNextTier('hajra')).toBe('ichwan');
    });

    it('returns Naib as next tier for Fedaykin', () => {
      expect(tierService.getNextTier('fedaykin')).toBe('naib');
    });

    it('returns null for Naib (max tier)', () => {
      expect(tierService.getNextTier('naib')).toBeNull();
    });

    it('returns correct progression through all BGT tiers', () => {
      expect(tierService.getNextTier('hajra')).toBe('ichwan');
      expect(tierService.getNextTier('ichwan')).toBe('qanat');
      expect(tierService.getNextTier('qanat')).toBe('sihaya');
      expect(tierService.getNextTier('sihaya')).toBe('mushtamal');
      expect(tierService.getNextTier('mushtamal')).toBe('sayyadina');
      expect(tierService.getNextTier('sayyadina')).toBe('usul');
      expect(tierService.getNextTier('usul')).toBe('fedaykin');
      expect(tierService.getNextTier('fedaykin')).toBe('naib');
      expect(tierService.getNextTier('naib')).toBeNull();
    });
  });

  describe('getTierProgress', () => {
    it('calculates progress from Hajra to Ichwan', () => {
      const currentBgt = parseUnits('50', 18);
      const progress = tierService.getTierProgress('hajra', currentBgt.toString(), null);

      expect(progress.currentTier).toBe('hajra');
      expect(progress.nextTier).toBe('ichwan');
      expect(progress.currentBgtFormatted).toBe(50);
      expect(progress.bgtToNextTierFormatted).toBe(19); // 69 - 50 = 19
      expect(progress.isRankBased).toBe(false);
    });

    it('calculates progress when at tier threshold', () => {
      const currentBgt = parseUnits('69', 18); // Exactly at Ichwan threshold
      const progress = tierService.getTierProgress('hajra', currentBgt.toString(), null);

      expect(progress.currentTier).toBe('hajra');
      expect(progress.nextTier).toBe('ichwan');
      expect(progress.bgtToNextTierFormatted).toBe(0); // Already at threshold
    });

    it('calculates progress for Usul to Fedaykin (rank-based)', () => {
      const currentBgt = parseUnits('1500', 18);
      const progress = tierService.getTierProgress('usul', currentBgt.toString(), null);

      expect(progress.currentTier).toBe('usul');
      expect(progress.nextTier).toBe('fedaykin');
      expect(progress.bgtToNextTier).toBeNull(); // Rank-based tier
      expect(progress.bgtToNextTierFormatted).toBeNull();
      expect(progress.isRankBased).toBe(false);
    });

    it('shows no next tier for Naib', () => {
      const currentBgt = parseUnits('2000', 18);
      const progress = tierService.getTierProgress('naib', currentBgt.toString(), 5);

      expect(progress.currentTier).toBe('naib');
      expect(progress.nextTier).toBeNull();
      expect(progress.bgtToNextTier).toBeNull();
      expect(progress.isRankBased).toBe(true);
      expect(progress.currentRank).toBe(5);
    });

    it('shows Naib as next tier for Fedaykin', () => {
      const currentBgt = parseUnits('1000', 18);
      const progress = tierService.getTierProgress('fedaykin', currentBgt.toString(), 30);

      expect(progress.currentTier).toBe('fedaykin');
      expect(progress.nextTier).toBe('naib');
      expect(progress.bgtToNextTier).toBeNull(); // Rank-based
      expect(progress.isRankBased).toBe(true);
      expect(progress.currentRank).toBe(30);
    });
  });

  describe('formatBgt', () => {
    it('formats bigint to human-readable number', () => {
      const bgt = parseUnits('69', 18);
      expect(tierService.formatBgt(bgt)).toBe(69);
    });

    it('formats string to human-readable number', () => {
      const bgt = '69000000000000000000'; // 69 BGT as string
      expect(tierService.formatBgt(bgt)).toBe(69);
    });

    it('handles decimal BGT amounts', () => {
      const bgt = parseUnits('69.42', 18);
      expect(tierService.formatBgt(bgt)).toBe(69.42);
    });
  });

  describe('getTierThreshold', () => {
    it('returns threshold for BGT-based tiers', () => {
      expect(tierService.getTierThreshold('hajra')).toBe(6.9);
      expect(tierService.getTierThreshold('ichwan')).toBe(69);
      expect(tierService.getTierThreshold('qanat')).toBe(222);
      expect(tierService.getTierThreshold('sihaya')).toBe(420);
      expect(tierService.getTierThreshold('mushtamal')).toBe(690);
      expect(tierService.getTierThreshold('sayyadina')).toBe(888);
      expect(tierService.getTierThreshold('usul')).toBe(1111);
    });

    it('returns null for rank-based tiers', () => {
      expect(tierService.getTierThreshold('fedaykin')).toBeNull();
      expect(tierService.getTierThreshold('naib')).toBeNull();
    });
  });

  describe('getAllTierInfo', () => {
    it('returns info for all 9 tiers in order', () => {
      const allTiers = tierService.getAllTierInfo();

      expect(allTiers).toHaveLength(9);
      expect(allTiers[0].name).toBe('hajra');
      expect(allTiers[8].name).toBe('naib');
    });

    it('includes rank requirements for Naib and Fedaykin', () => {
      const allTiers = tierService.getAllTierInfo();

      const naib = allTiers.find((t) => t.name === 'naib');
      const fedaykin = allTiers.find((t) => t.name === 'fedaykin');

      expect(naib?.rankRequirement).toBe('Top 7');
      expect(fedaykin?.rankRequirement).toBe('Top 8-69');
    });

    it('includes BGT thresholds for BGT-based tiers', () => {
      const allTiers = tierService.getAllTierInfo();

      const hajra = allTiers.find((t) => t.name === 'hajra');
      const usul = allTiers.find((t) => t.name === 'usul');

      expect(hajra?.bgtThreshold).toBe(6.9);
      expect(usul?.bgtThreshold).toBe(1111);
    });
  });

  describe('TIER_THRESHOLDS constant', () => {
    it('has correct number of tiers', () => {
      expect(Object.keys(TIER_THRESHOLDS)).toHaveLength(9);
    });

    it('has null thresholds for rank-based tiers', () => {
      expect(TIER_THRESHOLDS.naib).toBeNull();
      expect(TIER_THRESHOLDS.fedaykin).toBeNull();
    });

    it('has non-null thresholds for BGT-based tiers', () => {
      expect(TIER_THRESHOLDS.hajra).not.toBeNull();
      expect(TIER_THRESHOLDS.ichwan).not.toBeNull();
      expect(TIER_THRESHOLDS.qanat).not.toBeNull();
      expect(TIER_THRESHOLDS.sihaya).not.toBeNull();
      expect(TIER_THRESHOLDS.mushtamal).not.toBeNull();
      expect(TIER_THRESHOLDS.sayyadina).not.toBeNull();
      expect(TIER_THRESHOLDS.usul).not.toBeNull();
    });
  });

  describe('TIER_ORDER constant', () => {
    it('has all 9 tiers in correct progression order', () => {
      expect(TIER_ORDER).toHaveLength(9);
      expect(TIER_ORDER[0]).toBe('hajra');
      expect(TIER_ORDER[1]).toBe('ichwan');
      expect(TIER_ORDER[2]).toBe('qanat');
      expect(TIER_ORDER[3]).toBe('sihaya');
      expect(TIER_ORDER[4]).toBe('mushtamal');
      expect(TIER_ORDER[5]).toBe('sayyadina');
      expect(TIER_ORDER[6]).toBe('usul');
      expect(TIER_ORDER[7]).toBe('fedaykin');
      expect(TIER_ORDER[8]).toBe('naib');
    });
  });
});
