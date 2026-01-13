/**
 * Naib Service Integration Tests
 *
 * Tests for the Naib seat system including:
 * - Seat availability and assignment
 * - Bump mechanics
 * - Former Naib tracking
 * - Seat evaluation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { naibService } from '../../src/services/naib.js';
import * as queries from '../../src/db/index.js';

// Mock the database
vi.mock('../../src/db/index.js', () => {
  return {
    getCurrentNaibSeats: vi.fn(),
    getActiveSeatByMember: vi.fn(),
    getNaibSeatsByMember: vi.fn(),
    countActiveNaibSeats: vi.fn(),
    getNextAvailableSeatNumber: vi.fn(),
    getLowestBgtNaibSeat: vi.fn(),
    insertNaibSeat: vi.fn(),
    updateNaibSeat: vi.fn(),
    updateMemberFormerNaibStatus: vi.fn(),
    getFormerNaibMembers: vi.fn(),
    hasAnyNaibSeatsEver: vi.fn(),
    getMemberProfileById: vi.fn(),
    getMemberCurrentBgt: vi.fn(),
    getMemberEligibilityRank: vi.fn(),
    logAuditEvent: vi.fn(),
  };
});

describe('NaibService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getCurrentNaib', () => {
    it('should return empty array when no Naib seats exist', () => {
      vi.mocked(queries.getCurrentNaibSeats).mockReturnValue([]);

      const result = naibService.getCurrentNaib();

      expect(result).toEqual([]);
      expect(queries.getCurrentNaibSeats).toHaveBeenCalled();
    });

    it('should return Naib members sorted by BGT (highest first)', () => {
      const mockSeats = [
        { id: 1, seatNumber: 1, memberId: 'member_1', bgtAtSeating: '1000000000000000000', seatedAt: new Date('2024-01-01'), unseatedAt: null, unseatReason: null, bumpedByMemberId: null, bgtAtUnseating: null },
        { id: 2, seatNumber: 2, memberId: 'member_2', bgtAtSeating: '2000000000000000000', seatedAt: new Date('2024-01-02'), unseatedAt: null, unseatReason: null, bumpedByMemberId: null, bgtAtUnseating: null },
      ];
      const mockProfile1 = { memberId: 'member_1', discordUserId: 'discord_1', nym: 'User1', bio: null, pfpUrl: null, createdAt: new Date(), onboardingComplete: true };
      const mockProfile2 = { memberId: 'member_2', discordUserId: 'discord_2', nym: 'User2', bio: null, pfpUrl: null, createdAt: new Date(), onboardingComplete: true };

      vi.mocked(queries.getCurrentNaibSeats).mockReturnValue(mockSeats);
      vi.mocked(queries.getMemberProfileById).mockImplementation((id) => {
        if (id === 'member_1') return mockProfile1;
        if (id === 'member_2') return mockProfile2;
        return null;
      });
      vi.mocked(queries.getMemberCurrentBgt).mockImplementation((id) => {
        if (id === 'member_1') return '1000000000000000000';
        if (id === 'member_2') return '2000000000000000000';
        return null;
      });
      vi.mocked(queries.getMemberEligibilityRank).mockReturnValue(1);

      const result = naibService.getCurrentNaib();

      expect(result.length).toBe(2);
      // member_2 should be first (higher BGT)
      expect(result[0].profile.memberId).toBe('member_2');
      expect(result[1].profile.memberId).toBe('member_1');
    });
  });

  describe('getPublicCurrentNaib', () => {
    it('should return privacy-filtered Naib member info', () => {
      const mockSeats = [
        { id: 1, seatNumber: 1, memberId: 'member_1', bgtAtSeating: '1000000000000000000', seatedAt: new Date('2024-01-01'), unseatedAt: null, unseatReason: null, bumpedByMemberId: null, bgtAtUnseating: null },
      ];
      const mockProfile = { memberId: 'member_1', discordUserId: 'discord_1', nym: 'TestUser', bio: null, pfpUrl: 'https://example.com/avatar.png', createdAt: new Date(), onboardingComplete: true };

      vi.mocked(queries.getCurrentNaibSeats).mockReturnValue(mockSeats);
      vi.mocked(queries.getMemberProfileById).mockReturnValue(mockProfile);
      vi.mocked(queries.getMemberCurrentBgt).mockReturnValue('1000000000000000000');
      vi.mocked(queries.getMemberEligibilityRank).mockReturnValue(1);

      const result = naibService.getPublicCurrentNaib();

      expect(result.length).toBe(1);
      expect(result[0].nym).toBe('TestUser');
      expect(result[0].seatNumber).toBe(1);
      expect(result[0].memberId).toBe('member_1');
      // Should NOT expose wallet address (public interface)
      expect(result[0]).not.toHaveProperty('walletAddress');
    });
  });

  describe('isCurrentNaib', () => {
    it('should return true for active Naib member', () => {
      const mockSeat = { id: 1, seatNumber: 1, memberId: 'member_1', bgtAtSeating: '1000000000000000000', seatedAt: new Date(), unseatedAt: null, unseatReason: null, bumpedByMemberId: null, bgtAtUnseating: null };
      vi.mocked(queries.getActiveSeatByMember).mockReturnValue(mockSeat);

      const result = naibService.isCurrentNaib('member_1');

      expect(result).toBe(true);
    });

    it('should return false for non-Naib member', () => {
      vi.mocked(queries.getActiveSeatByMember).mockReturnValue(null);

      const result = naibService.isCurrentNaib('member_2');

      expect(result).toBe(false);
    });
  });

  describe('getAvailableSeatCount', () => {
    it('should return correct count of available seats', () => {
      vi.mocked(queries.countActiveNaibSeats).mockReturnValue(5);

      const result = naibService.getAvailableSeatCount();

      expect(result).toBe(2); // 7 - 5 = 2 seats available
    });

    it('should return 0 when all seats are filled', () => {
      vi.mocked(queries.countActiveNaibSeats).mockReturnValue(7);

      const result = naibService.getAvailableSeatCount();

      expect(result).toBe(0);
    });
  });

  describe('seatMember', () => {
    it('should seat member when seat is available', () => {
      const mockProfile = { memberId: 'member_1', discordUserId: 'discord_1', nym: 'User1', bio: null, pfpUrl: null, createdAt: new Date(), onboardingComplete: true };
      const mockSeat = { id: 1, seatNumber: 1, memberId: 'member_1', bgtAtSeating: '1000000000000000000', seatedAt: new Date(), unseatedAt: null, unseatReason: null, bumpedByMemberId: null, bgtAtUnseating: null };

      vi.mocked(queries.getNextAvailableSeatNumber).mockReturnValue(1);
      vi.mocked(queries.getMemberProfileById).mockReturnValue(mockProfile);
      vi.mocked(queries.insertNaibSeat).mockReturnValue(mockSeat);
      vi.mocked(queries.logAuditEvent).mockReturnValue(1);

      const result = naibService.seatMember('member_1', '1000000000000000000');

      expect(result).not.toBeNull();
      expect(result?.seatNumber).toBe(1);
      expect(queries.insertNaibSeat).toHaveBeenCalledWith({
        seatNumber: 1,
        memberId: 'member_1',
        bgtAtSeating: '1000000000000000000',
      });
      expect(queries.logAuditEvent).toHaveBeenCalledWith('naib_promotion', expect.any(Object));
    });

    it('should return null when no seats available', () => {
      vi.mocked(queries.getNextAvailableSeatNumber).mockReturnValue(null);

      const result = naibService.seatMember('member_1', '1000000000000000000');

      expect(result).toBeNull();
      expect(queries.insertNaibSeat).not.toHaveBeenCalled();
    });
  });

  describe('evaluateNewMember', () => {
    it('should seat member when empty seats available', () => {
      const mockProfile = { memberId: 'member_1', discordUserId: 'discord_1', nym: 'User1', bio: null, pfpUrl: null, createdAt: new Date(), onboardingComplete: true };
      const mockSeat = { id: 1, seatNumber: 1, memberId: 'member_1', bgtAtSeating: '1000000000000000000', seatedAt: new Date(), unseatedAt: null, unseatReason: null, bumpedByMemberId: null, bgtAtUnseating: null };

      vi.mocked(queries.getMemberProfileById).mockReturnValue(mockProfile);
      vi.mocked(queries.getMemberCurrentBgt).mockReturnValue('1000000000000000000');
      vi.mocked(queries.countActiveNaibSeats).mockReturnValue(5); // 2 seats available
      vi.mocked(queries.getNextAvailableSeatNumber).mockReturnValue(6);
      vi.mocked(queries.insertNaibSeat).mockReturnValue(mockSeat);
      vi.mocked(queries.logAuditEvent).mockReturnValue(1);

      const result = naibService.evaluateNewMember('member_1');

      expect(result.becameNaib).toBe(true);
      expect(result.causedBump).toBe(false);
    });

    it('should not seat member without profile', () => {
      vi.mocked(queries.getMemberProfileById).mockReturnValue(null);

      const result = naibService.evaluateNewMember('member_1');

      expect(result.becameNaib).toBe(false);
    });

    it('should not seat member without BGT', () => {
      const mockProfile = { memberId: 'member_1', discordUserId: 'discord_1', nym: 'User1', bio: null, pfpUrl: null, createdAt: new Date(), onboardingComplete: true };
      vi.mocked(queries.getMemberProfileById).mockReturnValue(mockProfile);
      vi.mocked(queries.getMemberCurrentBgt).mockReturnValue(null);

      const result = naibService.evaluateNewMember('member_1');

      expect(result.becameNaib).toBe(false);
    });
  });

  describe('getFormerNaib', () => {
    it('should return former Naib members sorted by tenure', () => {
      const mockFormerMembers = [
        { memberId: 'member_1', discordUserId: 'discord_1', nym: 'User1', bio: null, pfpUrl: null, createdAt: new Date(), onboardingComplete: true },
      ];
      const mockSeatHistory = [
        { id: 1, seatNumber: 1, memberId: 'member_1', bgtAtSeating: '1000000000000000000', seatedAt: new Date('2024-01-01'), unseatedAt: new Date('2024-02-01'), unseatReason: 'bumped', bumpedByMemberId: 'member_2', bgtAtUnseating: '900000000000000000' },
      ];

      vi.mocked(queries.getFormerNaibMembers).mockReturnValue(mockFormerMembers);
      vi.mocked(queries.getNaibSeatsByMember).mockReturnValue(mockSeatHistory);

      const result = naibService.getFormerNaib();

      expect(result.length).toBe(1);
      expect(result[0].nym).toBe('User1');
      expect(result[0].seatCount).toBe(1);
      expect(result[0].totalTenureMs).toBeGreaterThan(0);
    });

    it('should return empty array when no former Naib members', () => {
      vi.mocked(queries.getFormerNaibMembers).mockReturnValue([]);

      const result = naibService.getFormerNaib();

      expect(result).toEqual([]);
    });
  });

  describe('evaluateSeats', () => {
    it('should unseat members who are no longer eligible', () => {
      const mockSeats = [
        { id: 1, seatNumber: 1, memberId: 'member_1', bgtAtSeating: '1000000000000000000', seatedAt: new Date(), unseatedAt: null, unseatReason: null, bumpedByMemberId: null, bgtAtUnseating: null },
      ];
      const mockProfile = { memberId: 'member_1', discordUserId: 'discord_1', nym: 'User1', bio: null, pfpUrl: null, createdAt: new Date(), onboardingComplete: true };

      vi.mocked(queries.getCurrentNaibSeats).mockReturnValue(mockSeats);
      vi.mocked(queries.getMemberProfileById).mockReturnValue(mockProfile);
      vi.mocked(queries.getMemberCurrentBgt).mockReturnValue(null); // No BGT - ineligible
      vi.mocked(queries.getMemberEligibilityRank).mockReturnValue(null);
      vi.mocked(queries.getActiveSeatByMember).mockReturnValue(mockSeats[0]);
      vi.mocked(queries.updateNaibSeat).mockReturnValue({ ...mockSeats[0], unseatedAt: new Date(), unseatReason: 'ineligible' });
      vi.mocked(queries.updateMemberFormerNaibStatus).mockReturnValue(true);
      vi.mocked(queries.logAuditEvent).mockReturnValue(1);
      vi.mocked(queries.countActiveNaibSeats).mockReturnValue(0);

      const result = naibService.evaluateSeats();

      expect(result.changes.length).toBe(1);
      expect(result.changes[0].type).toBe('unseated');
      expect(result.changes[0].memberId).toBe('member_1');
    });

    it('should return current Naib list after evaluation', () => {
      vi.mocked(queries.getCurrentNaibSeats).mockReturnValue([]);
      vi.mocked(queries.countActiveNaibSeats).mockReturnValue(0);

      const result = naibService.evaluateSeats();

      expect(result.currentNaib).toEqual([]);
      expect(result.emptySeats).toBe(7);
    });
  });

  describe('isFormerNaib', () => {
    it('should return true for former Naib member', () => {
      const mockProfile = { memberId: 'member_1', discordUserId: 'discord_1', nym: 'User1', bio: null, pfpUrl: null, createdAt: new Date(), onboardingComplete: true };
      const mockSeatHistory = [
        { id: 1, seatNumber: 1, memberId: 'member_1', bgtAtSeating: '1000000000000000000', seatedAt: new Date('2024-01-01'), unseatedAt: new Date('2024-02-01'), unseatReason: 'bumped', bumpedByMemberId: 'member_2', bgtAtUnseating: '900000000000000000' },
      ];

      vi.mocked(queries.getMemberProfileById).mockReturnValue(mockProfile);
      vi.mocked(queries.getActiveSeatByMember).mockReturnValue(null); // Not currently seated
      vi.mocked(queries.getNaibSeatsByMember).mockReturnValue(mockSeatHistory);

      const result = naibService.isFormerNaib('member_1');

      expect(result).toBe(true);
    });

    it('should return false for current Naib member', () => {
      const mockProfile = { memberId: 'member_1', discordUserId: 'discord_1', nym: 'User1', bio: null, pfpUrl: null, createdAt: new Date(), onboardingComplete: true };
      const mockSeat = { id: 1, seatNumber: 1, memberId: 'member_1', bgtAtSeating: '1000000000000000000', seatedAt: new Date(), unseatedAt: null, unseatReason: null, bumpedByMemberId: null, bgtAtUnseating: null };

      vi.mocked(queries.getMemberProfileById).mockReturnValue(mockProfile);
      vi.mocked(queries.getActiveSeatByMember).mockReturnValue(mockSeat); // Currently seated

      const result = naibService.isFormerNaib('member_1');

      expect(result).toBe(false);
    });
  });
});
