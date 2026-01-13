import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { EligibilityEntry } from '../../src/types/index.js';

// Mock the database module before importing eligibility service
vi.mock('../../src/db/index.js', () => ({
  getActiveAdminOverrides: vi.fn(() => []),
  logAuditEvent: vi.fn(),
}));

// Mock the logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after mocks are set up
const { eligibilityService } = await import('../../src/services/eligibility.js');

/**
 * Helper to create test eligibility entries
 */
function createEntry(address: string, bgtHeld: bigint, rank?: number): EligibilityEntry {
  let role: 'naib' | 'fedaykin' | 'none' = 'none';
  if (rank !== undefined) {
    if (rank <= 7) role = 'naib';
    else if (rank <= 69) role = 'fedaykin';
  }

  return {
    address: address as `0x${string}`,
    bgtClaimed: bgtHeld,
    bgtBurned: 0n,
    bgtHeld,
    rank,
    role,
  };
}

describe('EligibilityService', () => {
  describe('computeDiff', () => {
    it('detects new members added to top 69', () => {
      const previous = [
        createEntry('0x1111111111111111111111111111111111111111', 100n, 1),
      ];
      const current = [
        createEntry('0x1111111111111111111111111111111111111111', 100n, 1),
        createEntry('0x2222222222222222222222222222222222222222', 50n, 2),
      ];

      const diff = eligibilityService.computeDiff(previous, current);

      expect(diff.added).toHaveLength(1);
      expect(diff.added[0]?.address.toLowerCase()).toBe(
        '0x2222222222222222222222222222222222222222'
      );
    });

    it('detects members removed from top 69', () => {
      const previous = [
        createEntry('0x1111111111111111111111111111111111111111', 100n, 1),
        createEntry('0x2222222222222222222222222222222222222222', 50n, 2),
      ];
      const current = [
        createEntry('0x1111111111111111111111111111111111111111', 100n, 1),
      ];

      const diff = eligibilityService.computeDiff(previous, current);

      expect(diff.removed).toHaveLength(1);
      expect(diff.removed[0]?.address.toLowerCase()).toBe(
        '0x2222222222222222222222222222222222222222'
      );
    });

    it('detects Naib promotions (entering top 7)', () => {
      const previous = [
        createEntry('0x1111111111111111111111111111111111111111', 100n, 1),
        createEntry('0x2222222222222222222222222222222222222222', 50n, 8), // fedaykin
      ];
      const current = [
        createEntry('0x2222222222222222222222222222222222222222', 150n, 1), // promoted to naib
        createEntry('0x1111111111111111111111111111111111111111', 100n, 2),
      ];

      const diff = eligibilityService.computeDiff(previous, current);

      expect(diff.promotedToNaib).toHaveLength(1);
      expect(diff.promotedToNaib[0]?.address.toLowerCase()).toBe(
        '0x2222222222222222222222222222222222222222'
      );
    });

    it('detects Naib demotions (leaving top 7)', () => {
      const previous = [
        createEntry('0x1111111111111111111111111111111111111111', 100n, 1), // naib
        createEntry('0x2222222222222222222222222222222222222222', 50n, 2), // naib
      ];
      const current = [
        createEntry('0x1111111111111111111111111111111111111111', 100n, 1), // still naib
        createEntry('0x2222222222222222222222222222222222222222', 50n, 8), // demoted to fedaykin
      ];

      const diff = eligibilityService.computeDiff(previous, current);

      expect(diff.demotedFromNaib).toHaveLength(1);
      expect(diff.demotedFromNaib[0]?.address.toLowerCase()).toBe(
        '0x2222222222222222222222222222222222222222'
      );
    });

    it('handles empty previous state', () => {
      const previous: EligibilityEntry[] = [];
      const current = [
        createEntry('0x1111111111111111111111111111111111111111', 100n, 1),
        createEntry('0x2222222222222222222222222222222222222222', 50n, 2),
      ];

      const diff = eligibilityService.computeDiff(previous, current);

      expect(diff.added).toHaveLength(2);
      expect(diff.removed).toHaveLength(0);
      // Both entries become Naib since they're in top 7
      expect(diff.promotedToNaib).toHaveLength(2);
    });

    it('handles empty current state', () => {
      const previous = [
        createEntry('0x1111111111111111111111111111111111111111', 100n, 1),
        createEntry('0x2222222222222222222222222222222222222222', 50n, 2),
      ];
      const current: EligibilityEntry[] = [];

      const diff = eligibilityService.computeDiff(previous, current);

      expect(diff.added).toHaveLength(0);
      expect(diff.removed).toHaveLength(2);
      // Both entries were Naib (top 7) and got demoted
      expect(diff.demotedFromNaib).toHaveLength(2);
    });

    it('handles case-insensitive address comparison', () => {
      const previous = [
        createEntry('0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 100n, 1),
      ];
      const current = [
        createEntry('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 100n, 1),
      ];

      const diff = eligibilityService.computeDiff(previous, current);

      expect(diff.added).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
    });
  });

  describe('assignRoles', () => {
    it('assigns naib role to top 7', () => {
      const entries: EligibilityEntry[] = Array.from({ length: 10 }, (_, i) =>
        createEntry(`0x${(i + 1).toString().padStart(40, '0')}`, BigInt(100 - i))
      );

      const result = eligibilityService.assignRoles(entries);

      expect(result[0]?.role).toBe('naib');
      expect(result[6]?.role).toBe('naib');
      expect(result[7]?.role).toBe('fedaykin');
    });

    it('assigns fedaykin role to ranks 8-69', () => {
      const entries: EligibilityEntry[] = Array.from({ length: 70 }, (_, i) =>
        createEntry(`0x${(i + 1).toString().padStart(40, '0')}`, BigInt(100 - i))
      );

      const result = eligibilityService.assignRoles(entries);

      expect(result[7]?.role).toBe('fedaykin');
      expect(result[68]?.role).toBe('fedaykin');
      expect(result[69]?.role).toBe('none');
      expect(result[69]?.rank).toBeUndefined();
    });

    it('assigns none role to ranks > 69', () => {
      const entries: EligibilityEntry[] = Array.from({ length: 100 }, (_, i) =>
        createEntry(`0x${(i + 1).toString().padStart(40, '0')}`, BigInt(100 - i))
      );

      const result = eligibilityService.assignRoles(entries);

      expect(result[69]?.role).toBe('none');
      expect(result[99]?.role).toBe('none');
    });
  });

  describe('getTopN', () => {
    it('returns top N eligible wallets', () => {
      const entries: EligibilityEntry[] = Array.from({ length: 100 }, (_, i) => ({
        ...createEntry(`0x${(i + 1).toString().padStart(40, '0')}`, BigInt(100 - i)),
        rank: i + 1 <= 69 ? i + 1 : undefined,
        role: i + 1 <= 7 ? 'naib' : i + 1 <= 69 ? 'fedaykin' : 'none',
      })) as EligibilityEntry[];

      const top7 = eligibilityService.getTopN(entries, 7);
      const top20 = eligibilityService.getTopN(entries, 20);

      expect(top7).toHaveLength(7);
      expect(top20).toHaveLength(20);
    });
  });

  describe('getNaibCouncil', () => {
    it('returns only naib members', () => {
      const entries: EligibilityEntry[] = Array.from({ length: 69 }, (_, i) => ({
        ...createEntry(`0x${(i + 1).toString().padStart(40, '0')}`, BigInt(100 - i)),
        rank: i + 1,
        role: i + 1 <= 7 ? 'naib' : 'fedaykin',
      })) as EligibilityEntry[];

      const council = eligibilityService.getNaibCouncil(entries);

      expect(council).toHaveLength(7);
      council.forEach((member) => {
        expect(member.role).toBe('naib');
      });
    });
  });

  describe('isEligible', () => {
    it('returns true for addresses in top 69', () => {
      const entries: EligibilityEntry[] = [
        {
          ...createEntry('0x1111111111111111111111111111111111111111', 100n),
          rank: 1,
          role: 'naib',
        },
      ];

      expect(
        eligibilityService.isEligible(
          entries,
          '0x1111111111111111111111111111111111111111' as `0x${string}`
        )
      ).toBe(true);
    });

    it('returns false for addresses not in top 69', () => {
      const entries: EligibilityEntry[] = [
        {
          ...createEntry('0x1111111111111111111111111111111111111111', 100n),
          rank: 70,
          role: 'none',
        },
      ];

      expect(
        eligibilityService.isEligible(
          entries,
          '0x1111111111111111111111111111111111111111' as `0x${string}`
        )
      ).toBe(false);
    });

    it('handles case-insensitive address matching', () => {
      const entries: EligibilityEntry[] = [
        {
          ...createEntry('0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 100n),
          rank: 1,
          role: 'naib',
        },
      ];

      expect(
        eligibilityService.isEligible(
          entries,
          '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as `0x${string}`
        )
      ).toBe(true);
    });
  });

  describe('isNaib', () => {
    it('returns true for naib members', () => {
      const entries: EligibilityEntry[] = [
        {
          ...createEntry('0x1111111111111111111111111111111111111111', 100n),
          rank: 1,
          role: 'naib',
        },
      ];

      expect(
        eligibilityService.isNaib(
          entries,
          '0x1111111111111111111111111111111111111111' as `0x${string}`
        )
      ).toBe(true);
    });

    it('returns false for fedaykin members', () => {
      const entries: EligibilityEntry[] = [
        {
          ...createEntry('0x1111111111111111111111111111111111111111', 100n),
          rank: 8,
          role: 'fedaykin',
        },
      ];

      expect(
        eligibilityService.isNaib(
          entries,
          '0x1111111111111111111111111111111111111111' as `0x${string}`
        )
      ).toBe(false);
    });
  });
});
