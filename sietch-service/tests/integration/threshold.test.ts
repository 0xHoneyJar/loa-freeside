/**
 * Threshold Service Integration Tests
 *
 * Tests for the Cave Entrance threshold and waitlist system:
 * - Entry threshold calculation
 * - Waitlist positions
 * - Waitlist registration
 * - Threshold snapshots
 * - Distance calculations
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { thresholdService } from '../../src/services/threshold.js';
import * as queries from '../../src/db/queries.js';

// Mock the database queries
vi.mock('../../src/db/queries.js', () => {
  return {
    insertWaitlistRegistration: vi.fn(),
    getWaitlistRegistrationByDiscord: vi.fn(),
    getWaitlistRegistrationByWallet: vi.fn(),
    updateWaitlistNotified: vi.fn(),
    deleteWaitlistRegistration: vi.fn(),
    getActiveWaitlistRegistrations: vi.fn(),
    getAllActiveWaitlistRegistrations: vi.fn(),
    isWalletAssociatedWithMember: vi.fn(),
    insertThresholdSnapshot: vi.fn(),
    getLatestThresholdSnapshot: vi.fn(),
    getThresholdSnapshots: vi.fn(),
    getWaitlistPositions: vi.fn(),
    getEntryThresholdBgt: vi.fn(),
    getWalletPosition: vi.fn(),
    getCurrentEligibility: vi.fn(),
    logAuditEvent: vi.fn(),
  };
});

describe('ThresholdService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getEntryThreshold', () => {
    it('should return entry threshold when available', () => {
      vi.mocked(queries.getEntryThresholdBgt).mockReturnValue('1000000000000000000'); // 1 BGT

      const result = thresholdService.getEntryThreshold();

      expect(result).not.toBeNull();
      expect(result?.bgt).toBe('1000000000000000000');
      expect(result?.human).toBe(1);
    });

    it('should return null when no threshold data', () => {
      vi.mocked(queries.getEntryThresholdBgt).mockReturnValue(null);

      const result = thresholdService.getEntryThreshold();

      expect(result).toBeNull();
    });
  });

  describe('getWaitlistPositions', () => {
    it('should return waitlist positions with distance calculations', () => {
      vi.mocked(queries.getWaitlistPositions).mockReturnValue([
        { position: 70, address: '0x1234567890123456789012345678901234567890', bgt: '900000000000000000' },
        { position: 71, address: '0x0987654321098765432109876543210987654321', bgt: '850000000000000000' },
      ]);
      vi.mocked(queries.getEntryThresholdBgt).mockReturnValue('1000000000000000000');
      vi.mocked(queries.getAllActiveWaitlistRegistrations).mockReturnValue([]);

      const result = thresholdService.getWaitlistPositions();

      expect(result.length).toBe(2);
      expect(result[0].position).toBe(70);
      expect(result[0].addressDisplay).toBe('0x1234...7890');
      expect(result[0].bgt).toBe(0.9); // Human-readable
      expect(result[0].distanceToEntry).toBeCloseTo(0.1); // 0.1 BGT needed
    });

    it('should mark registered wallets', () => {
      vi.mocked(queries.getWaitlistPositions).mockReturnValue([
        { position: 70, address: '0x1234567890123456789012345678901234567890', bgt: '900000000000000000' },
      ]);
      vi.mocked(queries.getEntryThresholdBgt).mockReturnValue('1000000000000000000');
      vi.mocked(queries.getAllActiveWaitlistRegistrations).mockReturnValue([
        { id: 1, discordUserId: 'discord_1', walletAddress: '0x1234567890123456789012345678901234567890', positionAtRegistration: 70, bgtAtRegistration: '900000000000000000', registeredAt: new Date(), notified: false, notifiedAt: null, active: true },
      ]);

      const result = thresholdService.getWaitlistPositions();

      expect(result[0].isRegistered).toBe(true);
    });
  });

  describe('registerWaitlist', () => {
    it('should successfully register valid waitlist entry', () => {
      const mockRegistration = {
        id: 1,
        discordUserId: 'discord_1',
        walletAddress: '0x1234567890123456789012345678901234567890',
        positionAtRegistration: 75,
        bgtAtRegistration: '800000000000000000',
        registeredAt: new Date(),
        notified: false,
        notifiedAt: null,
        active: true,
      };

      vi.mocked(queries.getWaitlistRegistrationByDiscord).mockReturnValue(null);
      vi.mocked(queries.getWaitlistRegistrationByWallet).mockReturnValue(null);
      vi.mocked(queries.isWalletAssociatedWithMember).mockReturnValue(false);
      vi.mocked(queries.getWalletPosition).mockReturnValue({ position: 75, bgt: '800000000000000000' });
      vi.mocked(queries.insertWaitlistRegistration).mockReturnValue(mockRegistration);
      vi.mocked(queries.getEntryThresholdBgt).mockReturnValue('1000000000000000000');
      vi.mocked(queries.logAuditEvent).mockReturnValue(1);

      const result = thresholdService.registerWaitlist('discord_1', '0x1234567890123456789012345678901234567890');

      expect(result.success).toBe(true);
      expect(result.registration).not.toBeNull();
      expect(result.position?.position).toBe(75);
    });

    it('should reject invalid wallet address format', () => {
      const result = thresholdService.registerWaitlist('discord_1', 'invalid-address');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid wallet address format');
    });

    it('should reject already registered Discord user', () => {
      vi.mocked(queries.getWaitlistRegistrationByDiscord).mockReturnValue({
        id: 1, discordUserId: 'discord_1', walletAddress: '0x1234567890123456789012345678901234567890',
        positionAtRegistration: 75, bgtAtRegistration: '800000000000000000', registeredAt: new Date(),
        notified: false, notifiedAt: null, active: true,
      });

      const result = thresholdService.registerWaitlist('discord_1', '0x0987654321098765432109876543210987654321');

      expect(result.success).toBe(false);
      expect(result.error).toBe('You are already registered for waitlist alerts');
    });

    it('should reject wallet already registered', () => {
      vi.mocked(queries.getWaitlistRegistrationByDiscord).mockReturnValue(null);
      vi.mocked(queries.getWaitlistRegistrationByWallet).mockReturnValue({
        id: 1, discordUserId: 'discord_2', walletAddress: '0x1234567890123456789012345678901234567890',
        positionAtRegistration: 75, bgtAtRegistration: '800000000000000000', registeredAt: new Date(),
        notified: false, notifiedAt: null, active: true,
      });

      const result = thresholdService.registerWaitlist('discord_1', '0x1234567890123456789012345678901234567890');

      expect(result.success).toBe(false);
      expect(result.error).toBe('This wallet is already registered for alerts');
    });

    it('should reject wallet linked to existing member', () => {
      vi.mocked(queries.getWaitlistRegistrationByDiscord).mockReturnValue(null);
      vi.mocked(queries.getWaitlistRegistrationByWallet).mockReturnValue(null);
      vi.mocked(queries.isWalletAssociatedWithMember).mockReturnValue(true);

      const result = thresholdService.registerWaitlist('discord_1', '0x1234567890123456789012345678901234567890');

      expect(result.success).toBe(false);
      expect(result.error).toBe('This wallet is already linked to a Sietch member');
    });

    it('should reject wallet not in rankings', () => {
      vi.mocked(queries.getWaitlistRegistrationByDiscord).mockReturnValue(null);
      vi.mocked(queries.getWaitlistRegistrationByWallet).mockReturnValue(null);
      vi.mocked(queries.isWalletAssociatedWithMember).mockReturnValue(false);
      vi.mocked(queries.getWalletPosition).mockReturnValue(null);

      const result = thresholdService.registerWaitlist('discord_1', '0x1234567890123456789012345678901234567890');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Wallet not found in eligibility rankings. You need some BGT first!');
    });

    it('should reject already eligible wallet (position < 70)', () => {
      vi.mocked(queries.getWaitlistRegistrationByDiscord).mockReturnValue(null);
      vi.mocked(queries.getWaitlistRegistrationByWallet).mockReturnValue(null);
      vi.mocked(queries.isWalletAssociatedWithMember).mockReturnValue(false);
      vi.mocked(queries.getWalletPosition).mockReturnValue({ position: 50, bgt: '2000000000000000000' });

      const result = thresholdService.registerWaitlist('discord_1', '0x1234567890123456789012345678901234567890');

      expect(result.success).toBe(false);
      expect(result.error).toContain("You're already eligible");
    });

    it('should reject wallet outside waitlist range (position > 100)', () => {
      vi.mocked(queries.getWaitlistRegistrationByDiscord).mockReturnValue(null);
      vi.mocked(queries.getWaitlistRegistrationByWallet).mockReturnValue(null);
      vi.mocked(queries.isWalletAssociatedWithMember).mockReturnValue(false);
      vi.mocked(queries.getWalletPosition).mockReturnValue({ position: 150, bgt: '100000000000000000' });

      const result = thresholdService.registerWaitlist('discord_1', '0x1234567890123456789012345678901234567890');

      expect(result.success).toBe(false);
      expect(result.error).toContain('outside waitlist range');
    });
  });

  describe('unregisterWaitlist', () => {
    it('should successfully unregister', () => {
      vi.mocked(queries.getWaitlistRegistrationByDiscord).mockReturnValue({
        id: 1, discordUserId: 'discord_1', walletAddress: '0x1234567890123456789012345678901234567890',
        positionAtRegistration: 75, bgtAtRegistration: '800000000000000000', registeredAt: new Date(),
        notified: false, notifiedAt: null, active: true,
      });
      vi.mocked(queries.deleteWaitlistRegistration).mockReturnValue(true);
      vi.mocked(queries.logAuditEvent).mockReturnValue(1);

      const result = thresholdService.unregisterWaitlist('discord_1');

      expect(result).toBe(true);
      expect(queries.deleteWaitlistRegistration).toHaveBeenCalledWith('discord_1');
    });

    it('should return false if not registered', () => {
      vi.mocked(queries.getWaitlistRegistrationByDiscord).mockReturnValue(null);

      const result = thresholdService.unregisterWaitlist('discord_1');

      expect(result).toBe(false);
    });
  });

  describe('checkWaitlistEligibility', () => {
    it('should identify newly eligible members', () => {
      vi.mocked(queries.getActiveWaitlistRegistrations).mockReturnValue([
        {
          id: 1, discordUserId: 'discord_1', walletAddress: '0x1234567890123456789012345678901234567890',
          positionAtRegistration: 75, bgtAtRegistration: '800000000000000000', registeredAt: new Date(),
          notified: false, notifiedAt: null, active: true,
        },
      ]);
      vi.mocked(queries.getWalletPosition).mockReturnValue({ position: 65, bgt: '1100000000000000000' }); // Now eligible!

      const result = thresholdService.checkWaitlistEligibility();

      expect(result.newlyEligible.length).toBe(1);
      expect(result.droppedOut.length).toBe(0);
    });

    it('should identify dropped out members', () => {
      vi.mocked(queries.getActiveWaitlistRegistrations).mockReturnValue([
        {
          id: 1, discordUserId: 'discord_1', walletAddress: '0x1234567890123456789012345678901234567890',
          positionAtRegistration: 75, bgtAtRegistration: '800000000000000000', registeredAt: new Date(),
          notified: false, notifiedAt: null, active: true,
        },
      ]);
      vi.mocked(queries.getWalletPosition).mockReturnValue(null); // No longer in rankings

      const result = thresholdService.checkWaitlistEligibility();

      expect(result.newlyEligible.length).toBe(0);
      expect(result.droppedOut.length).toBe(1);
    });
  });

  describe('saveSnapshot', () => {
    it('should save threshold snapshot', () => {
      const mockSnapshot = {
        id: 1,
        entryThresholdBgt: '1000000000000000000',
        eligibleCount: 69,
        waitlistCount: 31,
        waitlistTopBgt: '900000000000000000',
        waitlistBottomBgt: '500000000000000000',
        gapToEntry: '100000000000000000',
        snapshotAt: new Date(),
      };

      vi.mocked(queries.getEntryThresholdBgt).mockReturnValue('1000000000000000000');
      vi.mocked(queries.getCurrentEligibility).mockReturnValue([]);
      vi.mocked(queries.getWaitlistPositions).mockReturnValue([]);
      vi.mocked(queries.insertThresholdSnapshot).mockReturnValue(mockSnapshot);

      const result = thresholdService.saveSnapshot();

      expect(result).toEqual(mockSnapshot);
      expect(queries.insertThresholdSnapshot).toHaveBeenCalled();
    });
  });

  describe('getThresholdData', () => {
    it('should return formatted threshold data', () => {
      vi.mocked(queries.getEntryThresholdBgt).mockReturnValue('1000000000000000000');
      vi.mocked(queries.getCurrentEligibility).mockReturnValue([
        { address: '0x1', bgtClaimed: BigInt(0), bgtBurned: BigInt(0), bgtHeld: BigInt('1000000000000000000'), rank: 1, role: 'naib' as const },
      ]);
      vi.mocked(queries.getWaitlistPositions).mockReturnValue([
        { position: 70, address: '0x2', bgt: '900000000000000000' },
      ]);

      const result = thresholdService.getThresholdData();

      expect(result.entryThreshold).toBe(1); // 1 BGT
      expect(result.eligibleCount).toBe(1);
      expect(result.waitlistCount).toBe(1);
      expect(result.gapToEntry).toBeCloseTo(0.1); // 0.1 BGT gap
    });
  });

  describe('getWalletPosition', () => {
    it('should return position info for wallet', () => {
      vi.mocked(queries.getWalletPosition).mockReturnValue({ position: 75, bgt: '800000000000000000' });
      vi.mocked(queries.getEntryThresholdBgt).mockReturnValue('1000000000000000000');
      vi.mocked(queries.getAllActiveWaitlistRegistrations).mockReturnValue([]);

      const result = thresholdService.getWalletPosition('0x1234567890123456789012345678901234567890');

      expect(result).not.toBeNull();
      expect(result?.position).toBe(75);
      expect(result?.bgt).toBe(0.8); // Human-readable
      expect(result?.distanceToEntry).toBeCloseTo(0.2); // Need 0.2 more BGT
    });

    it('should return null for unknown wallet', () => {
      vi.mocked(queries.getWalletPosition).mockReturnValue(null);

      const result = thresholdService.getWalletPosition('0x0000000000000000000000000000000000000000');

      expect(result).toBeNull();
    });
  });

  describe('markNotified', () => {
    it('should mark registration as notified', () => {
      vi.mocked(queries.updateWaitlistNotified).mockReturnValue(true);

      const result = thresholdService.markNotified(1);

      expect(result).toBe(true);
      expect(queries.updateWaitlistNotified).toHaveBeenCalledWith(1);
    });
  });
});
