/**
 * Naib Service
 *
 * Manages the dynamic Naib seat system for Sietch v2.1.
 *
 * Key Features:
 * - First 7 eligible members get Naib seats (first-come basis initially)
 * - Once all 7 seats filled, new members can bump lowest BGT holder
 * - Tie-breaker: tenure wins (older seated_at keeps seat)
 * - Bumped members become "Former Naib" with continued recognition
 *
 * Privacy: No wallet addresses exposed in public interfaces
 */

import { logger } from '../utils/logger.js';
import { logAuditEvent } from '../db/index.js';
import {
  getCurrentNaibSeats,
  getActiveSeatByMember,
  getNaibSeatsByMember,
  countActiveNaibSeats,
  getNextAvailableSeatNumber,
  getLowestBgtNaibSeat,
  insertNaibSeat,
  updateNaibSeat,
  updateMemberFormerNaibStatus,
  getFormerNaibMembers,
  hasAnyNaibSeatsEver,
  getMemberProfileById,
  getMemberCurrentBgt,
  getMemberEligibilityRank,
} from '../db/index.js';
import type {
  NaibSeat,
  NaibMember,
  BumpResult,
  NaibEvaluationResult,
  NaibChange,
  NaibEvaluationSyncResult,
  PublicNaibMember,
  PublicFormerNaib,
  MemberProfile,
} from '../types/index.js';

/**
 * Maximum number of Naib seats
 */
const MAX_NAIB_SEATS = 7;

/**
 * Naib Service class
 */
class NaibService {
  /**
   * Get current Naib members with full details
   */
  getCurrentNaib(): NaibMember[] {
    const seats = getCurrentNaibSeats();
    const naibMembers: NaibMember[] = [];

    for (const seat of seats) {
      const profile = getMemberProfileById(seat.memberId);
      if (!profile) {
        logger.warn({ memberId: seat.memberId }, 'Naib seat has missing profile');
        continue;
      }

      const currentBgt = getMemberCurrentBgt(seat.memberId);
      const rank = getMemberEligibilityRank(seat.memberId);

      naibMembers.push({
        seat,
        profile,
        currentBgt: currentBgt ?? '0',
        eligibilityRank: rank ?? 0,
        isFounding: this.isFounding(seat),
      });
    }

    // Sort by BGT (highest first) for display
    return naibMembers.sort((a, b) => {
      const bgtA = BigInt(a.currentBgt);
      const bgtB = BigInt(b.currentBgt);
      if (bgtB > bgtA) return 1;
      if (bgtB < bgtA) return -1;
      // Tie-breaker: older tenure first
      return a.seat.seatedAt.getTime() - b.seat.seatedAt.getTime();
    });
  }

  /**
   * Get public Naib member info (privacy-filtered)
   */
  getPublicCurrentNaib(): PublicNaibMember[] {
    const naibMembers = this.getCurrentNaib();

    return naibMembers.map((nm, index) => ({
      seatNumber: index + 1, // Display rank based on BGT order
      nym: nm.profile.nym,
      memberId: nm.profile.memberId,
      pfpUrl: nm.profile.pfpUrl,
      seatedAt: nm.seat.seatedAt,
      isFounding: nm.isFounding,
      rank: nm.eligibilityRank,
    }));
  }

  /**
   * Check if a seat is a founding Naib seat (first 7 ever)
   */
  private isFounding(seat: NaibSeat): boolean {
    // A seat is founding if it was created when there were no prior seats
    // We track this by checking if the seat was in the first batch
    // For simplicity, we check if the seated_at is within the first hour of any seat
    const seats = getCurrentNaibSeats();
    if (seats.length === 0) return false;

    // Get earliest seat time
    const earliestSeat = seats.reduce((earliest, s) =>
      s.seatedAt < earliest.seatedAt ? s : earliest
    );

    // Founding if within 1 hour of earliest seat
    const foundingWindow = 60 * 60 * 1000; // 1 hour
    return seat.seatedAt.getTime() - earliestSeat.seatedAt.getTime() < foundingWindow;
  }

  /**
   * Get Former Naib members
   */
  getFormerNaib(): PublicFormerNaib[] {
    const formerMembers = getFormerNaibMembers();
    const result: PublicFormerNaib[] = [];

    for (const profile of formerMembers) {
      const seatHistory = getNaibSeatsByMember(profile.memberId);
      if (seatHistory.length === 0) continue;

      // Calculate total tenure
      let totalTenureMs = 0;
      // We know seatHistory has at least 1 element from the check above
      let firstSeatedAt = seatHistory[seatHistory.length - 1]!.seatedAt;
      let lastUnseatedAt = seatHistory[0]!.unseatedAt || new Date();

      for (const seat of seatHistory) {
        if (seat.seatedAt < firstSeatedAt) {
          firstSeatedAt = seat.seatedAt;
        }
        if (seat.unseatedAt) {
          totalTenureMs += seat.unseatedAt.getTime() - seat.seatedAt.getTime();
          if (seat.unseatedAt > lastUnseatedAt) {
            lastUnseatedAt = seat.unseatedAt;
          }
        }
      }

      result.push({
        nym: profile.nym,
        memberId: profile.memberId,
        pfpUrl: profile.pfpUrl,
        firstSeatedAt,
        lastUnseatedAt,
        totalTenureMs,
        seatCount: seatHistory.length,
      });
    }

    // Sort by total tenure (most tenure first)
    return result.sort((a, b) => b.totalTenureMs - a.totalTenureMs);
  }

  /**
   * Get Naib history for a specific member
   */
  getMemberNaibHistory(memberId: string): NaibSeat[] {
    return getNaibSeatsByMember(memberId);
  }

  /**
   * Check if member currently holds a Naib seat
   */
  isCurrentNaib(memberId: string): boolean {
    const seat = getActiveSeatByMember(memberId);
    return seat !== null;
  }

  /**
   * Check if member is Former Naib (was Naib but isn't currently)
   */
  isFormerNaib(memberId: string): boolean {
    const profile = getMemberProfileById(memberId);
    if (!profile) return false;

    // Must have is_former_naib flag AND not currently seated
    return profile.onboardingComplete && !this.isCurrentNaib(memberId) &&
      this.getMemberNaibHistory(memberId).length > 0;
  }

  /**
   * Check if member has ever been Naib
   */
  hasEverBeenNaib(memberId: string): boolean {
    return this.getMemberNaibHistory(memberId).length > 0;
  }

  /**
   * Get the Naib member with lowest BGT (bump candidate)
   */
  getLowestNaibMember(): NaibMember | null {
    const lowestSeat = getLowestBgtNaibSeat();
    if (!lowestSeat) return null;

    const profile = getMemberProfileById(lowestSeat.memberId);
    if (!profile) return null;

    const rank = getMemberEligibilityRank(lowestSeat.memberId);

    return {
      seat: lowestSeat.seat,
      profile,
      currentBgt: lowestSeat.currentBgt,
      eligibilityRank: rank ?? 0,
      isFounding: this.isFounding(lowestSeat.seat),
    };
  }

  /**
   * Get count of available (empty) seats
   */
  getAvailableSeatCount(): number {
    return MAX_NAIB_SEATS - countActiveNaibSeats();
  }

  /**
   * Seat a member in an available seat
   */
  seatMember(memberId: string, bgt: string): NaibSeat | null {
    const seatNumber = getNextAvailableSeatNumber();
    if (seatNumber === null) {
      logger.warn({ memberId }, 'No available Naib seats');
      return null;
    }

    const profile = getMemberProfileById(memberId);
    if (!profile) {
      logger.error({ memberId }, 'Cannot seat member - profile not found');
      return null;
    }

    const seat = insertNaibSeat({
      seatNumber,
      memberId,
      bgtAtSeating: bgt,
    });

    // Log audit event
    logAuditEvent('naib_promotion', {
      memberId,
      nym: profile.nym,
      seatNumber,
      bgt,
      reason: 'available_seat',
    });

    logger.info(
      { memberId, nym: profile.nym, seatNumber, bgt },
      'Member seated as Naib'
    );

    return seat;
  }

  /**
   * Bump a member from their seat (due to higher BGT newcomer)
   */
  bumpMember(
    seatId: number,
    bumpedByMemberId: string,
    currentBgt: string
  ): BumpResult {
    const seat = updateNaibSeat(seatId, {
      unseatedAt: new Date(),
      unseatReason: 'bumped',
      bumpedByMemberId,
      bgtAtUnseating: currentBgt,
    });

    if (!seat) {
      return {
        bumped: false,
        bumpedMember: null,
        newNaib: null,
        seatNumber: 0,
      };
    }

    // Mark as Former Naib
    updateMemberFormerNaibStatus(seat.memberId, true);

    const bumpedProfile = getMemberProfileById(seat.memberId);

    // Log audit event
    logAuditEvent('naib_demotion', {
      memberId: seat.memberId,
      nym: bumpedProfile?.nym,
      seatNumber: seat.seatNumber,
      bgt: currentBgt,
      reason: 'bumped',
      bumpedBy: bumpedByMemberId,
    });

    logger.info(
      { bumpedMemberId: seat.memberId, bumpedByMemberId, seatNumber: seat.seatNumber },
      'Member bumped from Naib seat'
    );

    const bumpedMember: NaibMember | null = bumpedProfile ? {
      seat,
      profile: bumpedProfile,
      currentBgt,
      eligibilityRank: getMemberEligibilityRank(seat.memberId) ?? 0,
      isFounding: false, // No longer founding after bump
    } : null;

    return {
      bumped: true,
      bumpedMember,
      newNaib: null, // Set by caller
      seatNumber: seat.seatNumber,
    };
  }

  /**
   * Unseat a member for non-bump reasons (left server, ineligible)
   */
  unseatMember(
    memberId: string,
    reason: 'left_server' | 'ineligible' | 'manual'
  ): boolean {
    const seat = getActiveSeatByMember(memberId);
    if (!seat) {
      return false;
    }

    const currentBgt = getMemberCurrentBgt(memberId);

    updateNaibSeat(seat.id, {
      unseatedAt: new Date(),
      unseatReason: reason,
      bgtAtUnseating: currentBgt ?? '0',
    });

    // Mark as Former Naib
    updateMemberFormerNaibStatus(memberId, true);

    const profile = getMemberProfileById(memberId);

    // Log audit event
    logAuditEvent('naib_demotion', {
      memberId,
      nym: profile?.nym,
      seatNumber: seat.seatNumber,
      reason,
    });

    logger.info(
      { memberId, seatNumber: seat.seatNumber, reason },
      'Member unseated from Naib'
    );

    return true;
  }

  /**
   * Evaluate whether a new member should get a Naib seat
   * Called during onboarding completion
   */
  evaluateNewMember(memberId: string): NaibEvaluationResult {
    const profile = getMemberProfileById(memberId);
    if (!profile) {
      return {
        becameNaib: false,
        seatNumber: null,
        causedBump: false,
        bumpResult: null,
      };
    }

    const memberBgt = getMemberCurrentBgt(memberId);
    if (!memberBgt) {
      logger.warn({ memberId }, 'No BGT found for member during Naib evaluation');
      return {
        becameNaib: false,
        seatNumber: null,
        causedBump: false,
        bumpResult: null,
      };
    }

    const availableSeats = this.getAvailableSeatCount();

    // Case 1: Empty seats available - take one
    if (availableSeats > 0) {
      const seat = this.seatMember(memberId, memberBgt);
      if (seat) {
        return {
          becameNaib: true,
          seatNumber: seat.seatNumber,
          causedBump: false,
          bumpResult: null,
        };
      }
    }

    // Case 2: All seats full - check if can bump
    const lowestNaib = this.getLowestNaibMember();
    if (!lowestNaib) {
      return {
        becameNaib: false,
        seatNumber: null,
        causedBump: false,
        bumpResult: null,
      };
    }

    const newMemberBgt = BigInt(memberBgt);
    const lowestBgt = BigInt(lowestNaib.currentBgt);

    // New member needs HIGHER BGT to bump (equal = incumbent wins via tenure)
    if (newMemberBgt > lowestBgt) {
      // Bump the lowest member
      const bumpResult = this.bumpMember(
        lowestNaib.seat.id,
        memberId,
        lowestNaib.currentBgt
      );

      if (bumpResult.bumped) {
        // Seat the new member in the vacated seat
        const newSeat = insertNaibSeat({
          seatNumber: bumpResult.seatNumber,
          memberId,
          bgtAtSeating: memberBgt,
        });

        // Log audit event
        logAuditEvent('naib_promotion', {
          memberId,
          nym: profile.nym,
          seatNumber: newSeat.seatNumber,
          bgt: memberBgt,
          reason: 'bump',
          bumpedMemberId: lowestNaib.profile.memberId,
          bumpedMemberNym: lowestNaib.profile.nym,
        });

        logger.info(
          {
            newNaibId: memberId,
            newNaibNym: profile.nym,
            bumpedId: lowestNaib.profile.memberId,
            bumpedNym: lowestNaib.profile.nym,
            seatNumber: newSeat.seatNumber,
          },
          'New member bumped existing Naib'
        );

        const newNaibMember: NaibMember = {
          seat: newSeat,
          profile,
          currentBgt: memberBgt,
          eligibilityRank: getMemberEligibilityRank(memberId) ?? 0,
          isFounding: false,
        };

        bumpResult.newNaib = newNaibMember;

        return {
          becameNaib: true,
          seatNumber: newSeat.seatNumber,
          causedBump: true,
          bumpResult,
        };
      }
    }

    // Not enough BGT to become Naib
    return {
      becameNaib: false,
      seatNumber: null,
      causedBump: false,
      bumpResult: null,
    };
  }

  /**
   * Full seat evaluation during sync (handles BGT changes)
   * This re-evaluates all seats based on current BGT holdings
   */
  evaluateSeats(): NaibEvaluationSyncResult {
    const changes: NaibChange[] = [];
    const currentSeats = getCurrentNaibSeats();

    // Build list of current Naib with their BGT
    interface SeatWithBgt {
      seat: NaibSeat;
      profile: MemberProfile;
      bgt: bigint;
      rank: number;
    }

    const seatsWithBgt: SeatWithBgt[] = [];

    for (const seat of currentSeats) {
      const profile = getMemberProfileById(seat.memberId);
      if (!profile) continue;

      const bgtStr = getMemberCurrentBgt(seat.memberId);
      const rank = getMemberEligibilityRank(seat.memberId);

      // If member no longer eligible (no BGT or rank > 69), unseat them
      if (!bgtStr || !rank || rank > 69) {
        this.unseatMember(seat.memberId, 'ineligible');
        changes.push({
          type: 'unseated',
          seatNumber: seat.seatNumber,
          memberId: seat.memberId,
          memberNym: profile.nym,
          bgt: bgtStr ?? '0',
        });
        continue;
      }

      seatsWithBgt.push({
        seat,
        profile,
        bgt: BigInt(bgtStr),
        rank,
      });
    }

    // Sort by BGT descending, then by tenure (older first for ties)
    seatsWithBgt.sort((a, b) => {
      if (b.bgt > a.bgt) return 1;
      if (b.bgt < a.bgt) return -1;
      // Tie-breaker: older tenure wins
      return a.seat.seatedAt.getTime() - b.seat.seatedAt.getTime();
    });

    // Get current Naib members after any removals
    const currentNaib = this.getCurrentNaib();
    const emptySeats = this.getAvailableSeatCount();

    return {
      changes,
      currentNaib,
      emptySeats,
    };
  }
}

// Export singleton instance
export const naibService = new NaibService();
