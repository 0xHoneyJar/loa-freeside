/**
 * Badge Service Tests (v4.0 - Sprint 27)
 *
 * Test suite for BadgeService covering:
 * - Entitlement checking (tier-based and purchase-based)
 * - Badge purchase recording
 * - Badge display formatting (all styles)
 * - Settings management
 * - Edge cases and error handling
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { badgeService } from '../BadgeService.js';
import * as badgeQueries from '../../../db/badge-queries.js';
import * as queries from '../../../db/index.js';
import * as gatekeeperService from '../../billing/GatekeeperService.js';

// Mock dependencies
vi.mock('../../../db/badge-queries.js');
vi.mock('../../../db/queries.js');
vi.mock('../../billing/GatekeeperService.js');

describe('BadgeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('checkBadgeEntitlement', () => {
    it('should grant access for premium tier', async () => {
      // Mock premium tier
      vi.spyOn(gatekeeperService.gatekeeperService, 'getCurrentTier').mockResolvedValue({
        tier: 'premium',
        name: 'Premium',
        price: 99,
        maxMembers: 1000,
        source: 'subscription',
        inGracePeriod: false,
      });

      const result = await badgeService.checkBadgeEntitlement('test-community', 'test-member');

      expect(result.hasAccess).toBe(true);
      expect(result.reason).toBe('premium_tier');
      expect(result.purchaseRequired).toBe(false);
    });

    it('should grant access for exclusive tier (higher than premium)', async () => {
      // Mock exclusive tier
      vi.spyOn(gatekeeperService.gatekeeperService, 'getCurrentTier').mockResolvedValue({
        tier: 'exclusive',
        name: 'Exclusive',
        price: 199,
        maxMembers: 2500,
        source: 'subscription',
        inGracePeriod: false,
      });

      const result = await badgeService.checkBadgeEntitlement('test-community', 'test-member');

      expect(result.hasAccess).toBe(true);
      expect(result.reason).toBe('premium_tier');
    });

    it('should grant access via purchase for basic tier', async () => {
      // Mock basic tier (below premium)
      vi.spyOn(gatekeeperService.gatekeeperService, 'getCurrentTier').mockResolvedValue({
        tier: 'basic',
        name: 'Basic',
        price: 29,
        maxMembers: 500,
        source: 'subscription',
        inGracePeriod: false,
      });

      // Mock badge purchase exists
      vi.spyOn(badgeQueries, 'hasBadgePurchase').mockReturnValue(true);

      const result = await badgeService.checkBadgeEntitlement('test-community', 'test-member');

      expect(result.hasAccess).toBe(true);
      expect(result.reason).toBe('purchased');
      expect(result.purchaseRequired).toBe(false);
    });

    it('should require purchase for basic tier without purchase', async () => {
      // Mock basic tier
      vi.spyOn(gatekeeperService.gatekeeperService, 'getCurrentTier').mockResolvedValue({
        tier: 'basic',
        name: 'Basic',
        price: 29,
        maxMembers: 500,
        source: 'subscription',
        inGracePeriod: false,
      });

      // Mock no badge purchase
      vi.spyOn(badgeQueries, 'hasBadgePurchase').mockReturnValue(false);

      const result = await badgeService.checkBadgeEntitlement('test-community', 'test-member');

      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe('none');
      expect(result.purchaseRequired).toBe(true);
      expect(result.priceInCents).toBe(499);
    });

    it('should require purchase for starter tier without purchase', async () => {
      // Mock starter tier (free)
      vi.spyOn(gatekeeperService.gatekeeperService, 'getCurrentTier').mockResolvedValue({
        tier: 'starter',
        name: 'Starter',
        price: 0,
        maxMembers: 100,
        source: 'free',
        inGracePeriod: false,
      });

      // Mock no badge purchase
      vi.spyOn(badgeQueries, 'hasBadgePurchase').mockReturnValue(false);

      const result = await badgeService.checkBadgeEntitlement('test-community', 'test-member');

      expect(result.hasAccess).toBe(false);
      expect(result.purchaseRequired).toBe(true);
    });
  });

  describe('hasBadgeAccess', () => {
    it('should return true for premium tier', async () => {
      vi.spyOn(gatekeeperService.gatekeeperService, 'getCurrentTier').mockResolvedValue({
        tier: 'premium',
        name: 'Premium',
        price: 99,
        maxMembers: 1000,
        source: 'subscription',
        inGracePeriod: false,
      });

      const result = await badgeService.hasBadgeAccess('test-community', 'test-member');

      expect(result).toBe(true);
    });

    it('should return true for purchased badge', async () => {
      vi.spyOn(gatekeeperService.gatekeeperService, 'getCurrentTier').mockResolvedValue({
        tier: 'basic',
        name: 'Basic',
        price: 29,
        maxMembers: 500,
        source: 'subscription',
        inGracePeriod: false,
      });

      vi.spyOn(badgeQueries, 'hasBadgePurchase').mockReturnValue(true);

      const result = await badgeService.hasBadgeAccess('test-community', 'test-member');

      expect(result).toBe(true);
    });

    it('should return false without access', async () => {
      vi.spyOn(gatekeeperService.gatekeeperService, 'getCurrentTier').mockResolvedValue({
        tier: 'starter',
        name: 'Starter',
        price: 0,
        maxMembers: 100,
        source: 'free',
        inGracePeriod: false,
      });

      vi.spyOn(badgeQueries, 'hasBadgePurchase').mockReturnValue(false);

      const result = await badgeService.hasBadgeAccess('test-community', 'test-member');

      expect(result).toBe(false);
    });
  });

  describe('recordBadgePurchase', () => {
    it('should create new badge purchase', () => {
      // Mock no existing purchase
      vi.spyOn(badgeQueries, 'getBadgePurchaseByMember').mockReturnValue(null);
      vi.spyOn(badgeQueries, 'createBadgePurchase').mockReturnValue('purchase-123');

      // Mock badge settings (new settings)
      vi.spyOn(badgeQueries, 'getBadgeSettings').mockReturnValue({
        memberId: 'test-member',
        displayOnDiscord: true,
        displayOnTelegram: false,
        badgeStyle: 'default',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const purchaseId = badgeService.recordBadgePurchase({
        memberId: 'test-member',
        paymentId: 'pi_123',
      });

      expect(purchaseId).toBe('purchase-123');
      expect(badgeQueries.createBadgePurchase).toHaveBeenCalledWith({
        memberId: 'test-member',
        paymentId: 'pi_123',
      });
    });

    it('should be idempotent (return existing purchase)', () => {
      // Mock existing purchase
      vi.spyOn(badgeQueries, 'getBadgePurchaseByMember').mockReturnValue({
        id: 'existing-purchase',
        memberId: 'test-member',
        paymentId: 'pi_123',
        purchasedAt: new Date(),
        createdAt: new Date(),
      });

      const purchaseId = badgeService.recordBadgePurchase({
        memberId: 'test-member',
        paymentId: 'pi_456',
      });

      expect(purchaseId).toBe('existing-purchase');
      expect(badgeQueries.createBadgePurchase).not.toHaveBeenCalled();
    });
  });

  describe('getBadgeDisplay', () => {
    const mockProfile = {
      memberId: 'test-member',
      discordUserId: 'discord-123',
      nym: 'TestNym',
      bio: null,
      pfpUrl: null,
      pfpType: 'none' as const,
      tier: 'fedaykin' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      nymLastChanged: null,
      onboardingComplete: true,
      onboardingStep: 0,
    };

    const mockActivity = {
      memberId: 'test-member',
      activityBalance: 847.3,
      lastDecayAt: new Date(),
      totalMessages: 100,
      totalReactionsGiven: 50,
      totalReactionsReceived: 75,
      lastActiveAt: new Date(),
      peakBalance: 900.0,
      updatedAt: new Date(),
    };

    beforeEach(() => {
      vi.spyOn(queries, 'getMemberProfileById').mockReturnValue(mockProfile);
      vi.spyOn(queries, 'getMemberActivity').mockReturnValue(mockActivity);
    });

    it('should format badge with default style', () => {
      vi.spyOn(badgeQueries, 'getBadgeSettings').mockReturnValue({
        memberId: 'test-member',
        displayOnDiscord: true,
        displayOnTelegram: false,
        badgeStyle: 'default',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = badgeService.getBadgeDisplay('test-member', 'discord');

      expect(result.enabled).toBe(true);
      expect(result.display).toBe('⚡ 847 | Fedaykin');
      expect(result.style).toBe('default');
    });

    it('should format badge with minimal style', () => {
      vi.spyOn(badgeQueries, 'getBadgeSettings').mockReturnValue({
        memberId: 'test-member',
        displayOnDiscord: true,
        displayOnTelegram: false,
        badgeStyle: 'minimal',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = badgeService.getBadgeDisplay('test-member', 'discord');

      expect(result.enabled).toBe(true);
      expect(result.display).toBe('⚡847');
      expect(result.style).toBe('minimal');
    });

    it('should format badge with detailed style', () => {
      vi.spyOn(badgeQueries, 'getBadgeSettings').mockReturnValue({
        memberId: 'test-member',
        displayOnDiscord: true,
        displayOnTelegram: false,
        badgeStyle: 'detailed',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = badgeService.getBadgeDisplay('test-member', 'discord');

      expect(result.enabled).toBe(true);
      expect(result.display).toBe('⚡ Score: 847 (Fedaykin)');
      expect(result.style).toBe('detailed');
    });

    it('should return empty display when disabled for platform', () => {
      vi.spyOn(badgeQueries, 'getBadgeSettings').mockReturnValue({
        memberId: 'test-member',
        displayOnDiscord: false,
        displayOnTelegram: false,
        badgeStyle: 'default',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = badgeService.getBadgeDisplay('test-member', 'discord');

      expect(result.enabled).toBe(false);
      expect(result.display).toBe('');
    });

    it('should respect platform-specific settings', () => {
      vi.spyOn(badgeQueries, 'getBadgeSettings').mockReturnValue({
        memberId: 'test-member',
        displayOnDiscord: true,
        displayOnTelegram: false,
        badgeStyle: 'default',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const discordResult = badgeService.getBadgeDisplay('test-member', 'discord');
      const telegramResult = badgeService.getBadgeDisplay('test-member', 'telegram');

      expect(discordResult.enabled).toBe(true);
      expect(telegramResult.enabled).toBe(false);
    });

    it('should handle missing profile gracefully', () => {
      vi.spyOn(queries, 'getMemberProfileById').mockReturnValue(null);

      const result = badgeService.getBadgeDisplay('test-member', 'discord');

      expect(result.enabled).toBe(false);
      expect(result.display).toBe('');
    });

    it('should handle missing activity gracefully', () => {
      vi.spyOn(queries, 'getMemberActivity').mockReturnValue(null);

      const result = badgeService.getBadgeDisplay('test-member', 'discord');

      expect(result.enabled).toBe(false);
      expect(result.display).toBe('');
    });

    it('should round decimal scores', () => {
      vi.spyOn(badgeQueries, 'getBadgeSettings').mockReturnValue({
        memberId: 'test-member',
        displayOnDiscord: true,
        displayOnTelegram: false,
        badgeStyle: 'minimal',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = badgeService.getBadgeDisplay('test-member', 'discord');

      expect(result.display).toBe('⚡847'); // 847.3 rounded to 847
    });
  });

  describe('getBadgeSettings', () => {
    it('should return existing settings', () => {
      const mockSettings = {
        memberId: 'test-member',
        displayOnDiscord: true,
        displayOnTelegram: false,
        badgeStyle: 'default' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.spyOn(badgeQueries, 'getBadgeSettings').mockReturnValue(mockSettings);

      const result = badgeService.getBadgeSettings('test-member');

      expect(result).toEqual(mockSettings);
    });
  });

  describe('updateBadgeSettings', () => {
    it('should update display preferences', () => {
      const upsertSpy = vi.spyOn(badgeQueries, 'upsertBadgeSettings').mockImplementation(() => {});

      badgeService.updateBadgeSettings('test-member', {
        displayOnDiscord: false,
        displayOnTelegram: true,
      });

      expect(upsertSpy).toHaveBeenCalledWith('test-member', {
        displayOnDiscord: false,
        displayOnTelegram: true,
      });
    });

    it('should update badge style', () => {
      const upsertSpy = vi.spyOn(badgeQueries, 'upsertBadgeSettings').mockImplementation(() => {});

      badgeService.updateBadgeSettings('test-member', {
        badgeStyle: 'minimal',
      });

      expect(upsertSpy).toHaveBeenCalledWith('test-member', {
        badgeStyle: 'minimal',
      });
    });
  });

  describe('enableBadgeDisplay', () => {
    it('should enable discord display', () => {
      const upsertSpy = vi.spyOn(badgeQueries, 'upsertBadgeSettings').mockImplementation(() => {});

      badgeService.enableBadgeDisplay('test-member', 'discord');

      expect(upsertSpy).toHaveBeenCalledWith('test-member', {
        displayOnDiscord: true,
      });
    });

    it('should enable telegram display', () => {
      const upsertSpy = vi.spyOn(badgeQueries, 'upsertBadgeSettings').mockImplementation(() => {});

      badgeService.enableBadgeDisplay('test-member', 'telegram');

      expect(upsertSpy).toHaveBeenCalledWith('test-member', {
        displayOnTelegram: true,
      });
    });
  });

  describe('disableBadgeDisplay', () => {
    it('should disable discord display', () => {
      const upsertSpy = vi.spyOn(badgeQueries, 'upsertBadgeSettings').mockImplementation(() => {});

      badgeService.disableBadgeDisplay('test-member', 'discord');

      expect(upsertSpy).toHaveBeenCalledWith('test-member', {
        displayOnDiscord: false,
      });
    });

    it('should disable telegram display', () => {
      const upsertSpy = vi.spyOn(badgeQueries, 'upsertBadgeSettings').mockImplementation(() => {});

      badgeService.disableBadgeDisplay('test-member', 'telegram');

      expect(upsertSpy).toHaveBeenCalledWith('test-member', {
        displayOnTelegram: false,
      });
    });
  });

  describe('updateBadgeStyle', () => {
    it('should update to minimal style', () => {
      const upsertSpy = vi.spyOn(badgeQueries, 'upsertBadgeSettings').mockImplementation(() => {});

      badgeService.updateBadgeStyle('test-member', 'minimal');

      expect(upsertSpy).toHaveBeenCalledWith('test-member', {
        badgeStyle: 'minimal',
      });
    });

    it('should update to detailed style', () => {
      const upsertSpy = vi.spyOn(badgeQueries, 'upsertBadgeSettings').mockImplementation(() => {});

      badgeService.updateBadgeStyle('test-member', 'detailed');

      expect(upsertSpy).toHaveBeenCalledWith('test-member', {
        badgeStyle: 'detailed',
      });
    });
  });

  describe('getPriceInfo', () => {
    it('should return badge price information', () => {
      const priceInfo = badgeService.getPriceInfo();

      expect(priceInfo.cents).toBe(499);
      expect(priceInfo.formatted).toBe('$4.99');
    });
  });

  describe('getBadgeDisplayBatch', () => {
    it('should return displays for multiple members', () => {
      const mockProfile1 = {
        memberId: 'member-1',
        discordUserId: 'discord-1',
        nym: 'Nym1',
        bio: null,
        pfpUrl: null,
        pfpType: 'none' as const,
        tier: 'fedaykin' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        nymLastChanged: null,
        onboardingComplete: true,
        onboardingStep: 0,
      };

      const mockActivity1 = {
        memberId: 'member-1',
        activityBalance: 500.0,
        lastDecayAt: new Date(),
        totalMessages: 50,
        totalReactionsGiven: 25,
        totalReactionsReceived: 30,
        lastActiveAt: new Date(),
        peakBalance: 600.0,
        updatedAt: new Date(),
      };

      vi.spyOn(queries, 'getMemberProfileById').mockReturnValue(mockProfile1);
      vi.spyOn(queries, 'getMemberActivity').mockReturnValue(mockActivity1);
      vi.spyOn(badgeQueries, 'getBadgeSettings').mockReturnValue({
        memberId: 'member-1',
        displayOnDiscord: true,
        displayOnTelegram: false,
        badgeStyle: 'default',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const results = badgeService.getBadgeDisplayBatch(['member-1', 'member-2'], 'discord');

      expect(results.size).toBe(2);
      expect(results.has('member-1')).toBe(true);
      expect(results.has('member-2')).toBe(true);
    });
  });
});
