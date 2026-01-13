/**
 * Threshold Service
 *
 * Manages the Cave Entrance waitlist and threshold calculations for Sietch v2.1.
 *
 * Key Features:
 * - Entry threshold: BGT required to enter top 69
 * - Waitlist positions: Tracks positions 70-100
 * - Distance calculations: Shows how far from entry/bump
 * - Registration: Allows users to register for eligibility alerts
 * - Snapshots: Historical threshold data for trends
 *
 * Privacy: Wallet addresses are only shown truncated in public views
 */

import { logger } from '../utils/logger.js';
import { logAuditEvent } from '../db/index.js';
import {
  insertWaitlistRegistration,
  getWaitlistRegistrationByDiscord,
  getWaitlistRegistrationByWallet,
  updateWaitlistNotified,
  deleteWaitlistRegistration,
  getActiveWaitlistRegistrations,
  getAllActiveWaitlistRegistrations,
  isWalletAssociatedWithMember,
  insertThresholdSnapshot,
  getLatestThresholdSnapshot,
  getThresholdSnapshots,
  getWaitlistPositions as getWaitlistPositionsFromDb,
  getEntryThresholdBgt,
  getWalletPosition as getWalletPositionFromDb,
  getCurrentEligibility,
} from '../db/index.js';
import type {
  WaitlistRegistration,
  ThresholdSnapshot,
  ThresholdData,
  WaitlistPosition,
  WaitlistRegistrationResult,
  WaitlistEligibilityCheck,
  PositionDistance,
} from '../types/index.js';

/**
 * Waitlist range constants
 */
const WAITLIST_MIN_POSITION = 70;
const WAITLIST_MAX_POSITION = 100;
const ENTRY_THRESHOLD_POSITION = 69;

/**
 * Convert wei string to human-readable BGT (18 decimals)
 */
function weiToHuman(wei: string): number {
  return Number(BigInt(wei)) / 1e18;
}

/**
 * Truncate wallet address for display: 0x1234...5678
 */
function truncateAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Threshold Service class
 */
class ThresholdService {
  /**
   * Get the current entry threshold (position 69's BGT)
   */
  getEntryThreshold(): { bgt: string; human: number } | null {
    const bgt = getEntryThresholdBgt();
    if (!bgt) return null;

    return {
      bgt,
      human: weiToHuman(bgt),
    };
  }

  /**
   * Get waitlist positions (70-100) with distance calculations
   */
  getWaitlistPositions(): WaitlistPosition[] {
    const positions = getWaitlistPositionsFromDb();
    const entryThreshold = this.getEntryThreshold();
    const registrations = getAllActiveWaitlistRegistrations();

    // Create a set of registered wallet addresses for quick lookup
    const registeredWallets = new Set(
      registrations.map((r) => r.walletAddress.toLowerCase())
    );

    return positions.map((pos) => {
      const distanceToEntry = entryThreshold
        ? BigInt(entryThreshold.bgt) - BigInt(pos.bgt)
        : BigInt(0);

      return {
        position: pos.position,
        addressDisplay: truncateAddress(pos.address),
        address: pos.address,
        bgt: weiToHuman(pos.bgt),
        distanceToEntry: Number(distanceToEntry) / 1e18,
        isRegistered: registeredWallets.has(pos.address.toLowerCase()),
      };
    });
  }

  /**
   * Get top N waitlist positions (for embeds)
   */
  getTopWaitlistPositions(limit: number = 5): WaitlistPosition[] {
    return this.getWaitlistPositions().slice(0, limit);
  }

  /**
   * Get distance information for a specific member
   * Calculates distance to position above and below
   */
  getMemberDistances(walletAddress: string): PositionDistance | null {
    const walletPos = getWalletPositionFromDb(walletAddress);
    if (!walletPos) return null;

    const eligibility = getCurrentEligibility();
    const entryThreshold = this.getEntryThreshold();

    // Find positions above and below
    const positionAbove = eligibility.find(
      (e) => e.rank === walletPos.position - 1
    );
    const positionBelow = eligibility.find(
      (e) => e.rank === walletPos.position + 1
    );

    // Calculate distances
    const distanceToAbove = positionAbove
      ? (BigInt(positionAbove.bgtHeld.toString()) - BigInt(walletPos.bgt)).toString()
      : null;

    const distanceToBelow = positionBelow
      ? (BigInt(walletPos.bgt) - BigInt(positionBelow.bgtHeld.toString())).toString()
      : null;

    const distanceToEntry =
      walletPos.position > ENTRY_THRESHOLD_POSITION && entryThreshold
        ? (BigInt(entryThreshold.bgt) - BigInt(walletPos.bgt)).toString()
        : null;

    return {
      address: walletAddress,
      position: walletPos.position,
      bgt: walletPos.bgt,
      distanceToAbove,
      distanceToBelow,
      distanceToEntry,
    };
  }

  /**
   * Calculate distances for all positions
   * Returns full eligibility list with distance info
   */
  calculateDistances(): PositionDistance[] {
    const eligibility = getCurrentEligibility();
    const entryThreshold = this.getEntryThreshold();

    return eligibility.map((entry, index) => {
      const positionAbove = index > 0 ? eligibility[index - 1] : null;
      const positionBelow =
        index < eligibility.length - 1 ? eligibility[index + 1] : null;

      const distanceToAbove = positionAbove
        ? (BigInt(positionAbove.bgtHeld.toString()) - BigInt(entry.bgtHeld.toString())).toString()
        : null;

      const distanceToBelow = positionBelow
        ? (BigInt(entry.bgtHeld.toString()) - BigInt(positionBelow.bgtHeld.toString())).toString()
        : null;

      const position = entry.rank ?? index + 1;
      const distanceToEntry =
        position > ENTRY_THRESHOLD_POSITION && entryThreshold
          ? (BigInt(entryThreshold.bgt) - BigInt(entry.bgtHeld.toString())).toString()
          : null;

      return {
        address: entry.address,
        position,
        bgt: entry.bgtHeld.toString(),
        distanceToAbove,
        distanceToBelow,
        distanceToEntry,
      };
    });
  }

  /**
   * Save a threshold snapshot to the database
   */
  saveSnapshot(): ThresholdSnapshot {
    const entryThreshold = this.getEntryThreshold();
    const eligibility = getCurrentEligibility();
    const waitlistPositions = getWaitlistPositionsFromDb();

    const eligibleCount = eligibility.filter(
      (e) => e.rank !== undefined && e.rank <= ENTRY_THRESHOLD_POSITION
    ).length;

    const waitlistTop = waitlistPositions.find(
      (p) => p.position === WAITLIST_MIN_POSITION
    );
    const waitlistBottom = waitlistPositions.find(
      (p) => p.position === WAITLIST_MAX_POSITION
    );

    // Calculate gap to entry
    let gapToEntry: string | null = null;
    if (entryThreshold && waitlistTop) {
      gapToEntry = (
        BigInt(entryThreshold.bgt) - BigInt(waitlistTop.bgt)
      ).toString();
    }

    const snapshot = insertThresholdSnapshot({
      entryThresholdBgt: entryThreshold?.bgt ?? '0',
      eligibleCount,
      waitlistCount: waitlistPositions.length,
      waitlistTopBgt: waitlistTop?.bgt ?? null,
      waitlistBottomBgt: waitlistBottom?.bgt ?? null,
      gapToEntry,
    });

    logger.info(
      {
        entryThreshold: entryThreshold?.human,
        eligibleCount,
        waitlistCount: waitlistPositions.length,
      },
      'Threshold snapshot saved'
    );

    return snapshot;
  }

  /**
   * Get the latest threshold snapshot
   */
  getLatestSnapshot(): ThresholdSnapshot | null {
    return getLatestThresholdSnapshot();
  }

  /**
   * Get threshold data for API/embed display
   */
  getThresholdData(): ThresholdData {
    const entryThreshold = this.getEntryThreshold();
    const eligibility = getCurrentEligibility();
    const waitlistPositions = getWaitlistPositionsFromDb();

    const eligibleCount = eligibility.filter(
      (e) => e.rank !== undefined && e.rank <= ENTRY_THRESHOLD_POSITION
    ).length;

    const waitlistTop = waitlistPositions.find(
      (p) => p.position === WAITLIST_MIN_POSITION
    );

    let gapToEntry: number | null = null;
    if (entryThreshold && waitlistTop) {
      gapToEntry =
        (Number(BigInt(entryThreshold.bgt) - BigInt(waitlistTop.bgt))) / 1e18;
    }

    return {
      entryThreshold: entryThreshold?.human ?? 0,
      entryThresholdWei: entryThreshold?.bgt ?? '0',
      eligibleCount,
      waitlistCount: waitlistPositions.length,
      gapToEntry,
      updatedAt: new Date(),
    };
  }

  /**
   * Get historical threshold snapshots
   */
  getHistory(options: { limit?: number; since?: Date } = {}): ThresholdSnapshot[] {
    return getThresholdSnapshots(options);
  }

  /**
   * Get historical threshold snapshots (alias for API compatibility)
   */
  getSnapshotHistory(limit: number = 24, since?: Date): ThresholdSnapshot[] {
    return getThresholdSnapshots({ limit, since });
  }

  /**
   * Get wallet position info (public method wrapper)
   */
  getWalletPosition(walletAddress: string): WaitlistPosition | null {
    const pos = getWalletPositionFromDb(walletAddress);
    if (!pos) return null;

    const entryThreshold = this.getEntryThreshold();
    const registrations = getAllActiveWaitlistRegistrations();
    const isRegistered = registrations.some(
      (r) => r.walletAddress.toLowerCase() === walletAddress.toLowerCase()
    );

    const distanceToEntry = entryThreshold
      ? (Number(BigInt(entryThreshold.bgt) - BigInt(pos.bgt))) / 1e18
      : 0;

    return {
      position: pos.position,
      addressDisplay: truncateAddress(walletAddress),
      address: walletAddress,
      bgt: weiToHuman(pos.bgt),
      distanceToEntry,
      isRegistered,
    };
  }

  /**
   * Get all active waitlist registrations
   */
  getActiveRegistrations(): WaitlistRegistration[] {
    return getAllActiveWaitlistRegistrations();
  }

  // ===========================================================================
  // Waitlist Registration Methods
  // ===========================================================================

  /**
   * Register a wallet for eligibility alerts
   * Validates:
   * - Wallet format
   * - Position is 70-100
   * - Wallet not already associated with a member
   * - Discord user not already registered
   */
  registerWaitlist(
    discordUserId: string,
    walletAddress: string
  ): WaitlistRegistrationResult {
    // Validate wallet format
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return {
        success: false,
        registration: null,
        error: 'Invalid wallet address format',
        position: null,
      };
    }

    // Check if Discord user already registered
    const existingByDiscord = getWaitlistRegistrationByDiscord(discordUserId);
    if (existingByDiscord) {
      return {
        success: false,
        registration: null,
        error: 'You are already registered for waitlist alerts',
        position: null,
      };
    }

    // Check if wallet already registered
    const existingByWallet = getWaitlistRegistrationByWallet(walletAddress);
    if (existingByWallet) {
      return {
        success: false,
        registration: null,
        error: 'This wallet is already registered for alerts',
        position: null,
      };
    }

    // Check if wallet is already associated with a Sietch member
    if (isWalletAssociatedWithMember(walletAddress)) {
      return {
        success: false,
        registration: null,
        error: 'This wallet is already linked to a Sietch member',
        position: null,
      };
    }

    // Get wallet's current position
    const walletPos = getWalletPositionFromDb(walletAddress);
    if (!walletPos) {
      return {
        success: false,
        registration: null,
        error: 'Wallet not found in eligibility rankings. You need some BGT first!',
        position: null,
      };
    }

    // Validate position is in waitlist range (70-100)
    if (
      walletPos.position < WAITLIST_MIN_POSITION ||
      walletPos.position > WAITLIST_MAX_POSITION
    ) {
      if (walletPos.position < WAITLIST_MIN_POSITION) {
        return {
          success: false,
          registration: null,
          error: `You're already eligible (position ${walletPos.position})! Use the onboarding process instead.`,
          position: null,
        };
      }
      return {
        success: false,
        registration: null,
        error: `Position ${walletPos.position} is outside waitlist range (70-100)`,
        position: null,
      };
    }

    // Create registration
    const registration = insertWaitlistRegistration({
      discordUserId,
      walletAddress,
      position: walletPos.position,
      bgt: walletPos.bgt,
    });

    // Log audit event
    logAuditEvent('waitlist_registration', {
      discordUserId,
      walletAddress: truncateAddress(walletAddress),
      position: walletPos.position,
    });

    logger.info(
      {
        discordUserId,
        walletAddress: truncateAddress(walletAddress),
        position: walletPos.position,
      },
      'Waitlist registration created'
    );

    // Get entry threshold for distance calculation
    const entryThreshold = this.getEntryThreshold();
    const distanceToEntry = entryThreshold
      ? (Number(BigInt(entryThreshold.bgt) - BigInt(walletPos.bgt))) / 1e18
      : 0;

    return {
      success: true,
      registration,
      error: null,
      position: {
        position: walletPos.position,
        addressDisplay: truncateAddress(walletAddress),
        address: walletAddress,
        bgt: weiToHuman(walletPos.bgt),
        distanceToEntry,
        isRegistered: true,
      },
    };
  }

  /**
   * Unregister from waitlist alerts
   */
  unregisterWaitlist(discordUserId: string): boolean {
    const existing = getWaitlistRegistrationByDiscord(discordUserId);
    if (!existing) {
      return false;
    }

    const success = deleteWaitlistRegistration(discordUserId);

    if (success) {
      logAuditEvent('waitlist_unregistration', {
        discordUserId,
        walletAddress: truncateAddress(existing.walletAddress),
      });

      logger.info(
        {
          discordUserId,
          walletAddress: truncateAddress(existing.walletAddress),
        },
        'Waitlist registration removed'
      );
    }

    return success;
  }

  /**
   * Get registration by Discord user ID
   */
  getRegistration(discordUserId: string): WaitlistRegistration | null {
    return getWaitlistRegistrationByDiscord(discordUserId);
  }

  /**
   * Get registration by wallet address
   */
  getRegistrationByWallet(walletAddress: string): WaitlistRegistration | null {
    return getWaitlistRegistrationByWallet(walletAddress);
  }

  /**
   * Check waitlist for newly eligible members
   * Called during sync to identify registrations that can now onboard
   */
  checkWaitlistEligibility(): WaitlistEligibilityCheck {
    const registrations = getActiveWaitlistRegistrations();
    const newlyEligible: WaitlistRegistration[] = [];
    const droppedOut: WaitlistRegistration[] = [];

    for (const reg of registrations) {
      const currentPos = getWalletPositionFromDb(reg.walletAddress);

      if (!currentPos) {
        // Wallet no longer in rankings - dropped out
        droppedOut.push(reg);
        continue;
      }

      if (currentPos.position <= ENTRY_THRESHOLD_POSITION) {
        // Now eligible!
        newlyEligible.push(reg);
      } else if (currentPos.position > WAITLIST_MAX_POSITION) {
        // Dropped below position 100
        droppedOut.push(reg);
      }
    }

    return { newlyEligible, droppedOut };
  }

  /**
   * Mark a registration as notified (when user becomes eligible)
   */
  markNotified(registrationId: number): boolean {
    return updateWaitlistNotified(registrationId);
  }

  /**
   * Get current position info for a registered wallet
   */
  getRegistrationStatus(
    discordUserId: string
  ): { registration: WaitlistRegistration; position: WaitlistPosition | null } | null {
    const registration = getWaitlistRegistrationByDiscord(discordUserId);
    if (!registration) return null;

    const currentPos = getWalletPositionFromDb(registration.walletAddress);
    if (!currentPos) {
      return { registration, position: null };
    }

    const entryThreshold = this.getEntryThreshold();
    const distanceToEntry = entryThreshold
      ? (Number(BigInt(entryThreshold.bgt) - BigInt(currentPos.bgt))) / 1e18
      : 0;

    return {
      registration,
      position: {
        position: currentPos.position,
        addressDisplay: truncateAddress(registration.walletAddress),
        address: registration.walletAddress,
        bgt: weiToHuman(currentPos.bgt),
        distanceToEntry,
        isRegistered: true,
      },
    };
  }
}

// Export singleton instance
export const thresholdService = new ThresholdService();
