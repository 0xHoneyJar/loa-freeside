/**
 * TakeoverDiscountService Unit Tests
 *
 * Sprint 65: Full Social Layer & Polish
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  TakeoverDiscountService,
  createTakeoverDiscountService,
  TAKEOVER_DISCOUNT_PERCENT,
  TAKEOVER_DISCOUNT_DURATION_MONTHS,
  DISCOUNT_EXPIRY_DAYS,
  PROMO_CODE_PREFIX,
  type TakeoverDiscount,
  type IStripeDiscountClient,
} from '../../../../../src/packages/core/services/TakeoverDiscountService.js';
import type {
  ICoexistenceStorage,
  StoredMigrationState,
} from '../../../../../src/packages/core/ports/ICoexistenceStorage.js';
import type { CoexistenceMode } from '../../../../../src/packages/adapters/storage/schema.js';

// Use unique community IDs per test to avoid state pollution
let testCounter = 0;
function uniqueCommunityId(): string {
  testCounter++;
  return `community-${testCounter}-${Date.now()}`;
}

// =============================================================================
// Mock Factory
// =============================================================================

function createMockStorage(overrides: Partial<ICoexistenceStorage> = {}): ICoexistenceStorage {
  return {
    getMigrationState: vi.fn().mockResolvedValue(null),
    saveMigrationState: vi.fn().mockResolvedValue(undefined),
    updateMigrationMode: vi.fn().mockResolvedValue(undefined),
    recordTransition: vi.fn().mockResolvedValue(undefined),
    getTransitionHistory: vi.fn().mockResolvedValue([]),
    saveIncumbentConfig: vi.fn().mockResolvedValue(undefined),
    getIncumbentConfig: vi.fn().mockResolvedValue(null),
    updateIncumbentHealth: vi.fn().mockResolvedValue(undefined),
    recordShadowEntry: vi.fn().mockResolvedValue(undefined),
    getShadowLedger: vi.fn().mockResolvedValue([]),
    getShadowEntry: vi.fn().mockResolvedValue(null),
    recordDivergence: vi.fn().mockResolvedValue(undefined),
    getDivergences: vi.fn().mockResolvedValue([]),
    resolveDivergence: vi.fn().mockResolvedValue(undefined),
    getDivergenceSummary: vi.fn().mockResolvedValue({
      totalDivergences: 0,
      unresolvedCount: 0,
      resolvedCount: 0,
      divergenceRate: 0,
      byType: {
        false_positive: 0,
        false_negative: 0,
        timing_difference: 0,
        threshold_mismatch: 0,
      },
    }),
    saveSnapshot: vi.fn().mockResolvedValue(undefined),
    getSnapshot: vi.fn().mockResolvedValue(null),
    getLatestSnapshot: vi.fn().mockResolvedValue(null),
    markSnapshotVerified: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as ICoexistenceStorage;
}

function createMockMigrationState(mode: CoexistenceMode, communityId: string = 'community-1'): StoredMigrationState {
  return {
    communityId,
    currentMode: mode,
    previousMode: mode === 'exclusive' ? 'primary' : undefined,
    lastTransition: new Date(),
    shadowStartedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
    parallelStartedAt: mode !== 'shadow' ? new Date(Date.now() - 20 * 24 * 60 * 60 * 1000) : undefined,
    accuracyPercent: 98,
    totalMembers: 1000,
    syncedMembers: 980,
    autoRollbackCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createMockStripeClient(): IStripeDiscountClient {
  return {
    createTakeoverCoupon: vi.fn().mockResolvedValue({
      couponId: 'coupon_test123',
      promotionCode: 'ARRAKIS-TAKEOVER-TEST123',
    }),
    isPromotionCodeRedeemed: vi.fn().mockResolvedValue(false),
    expirePromotionCode: vi.fn().mockResolvedValue(undefined),
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('TakeoverDiscountService', () => {
  let service: TakeoverDiscountService;
  let mockStorage: ICoexistenceStorage;
  let mockStripeClient: IStripeDiscountClient;

  beforeEach(() => {
    // Reset any stored discounts between tests
    // Note: In production, this would be database-backed
    vi.clearAllMocks();
    mockStorage = createMockStorage();
    mockStripeClient = createMockStripeClient();
    service = createTakeoverDiscountService(mockStorage, mockStripeClient);
  });

  describe('Constants', () => {
    it('should have correct discount percentage', () => {
      expect(TAKEOVER_DISCOUNT_PERCENT).toBe(20);
    });

    it('should have correct duration in months', () => {
      expect(TAKEOVER_DISCOUNT_DURATION_MONTHS).toBe(12);
    });

    it('should have correct expiry days', () => {
      expect(DISCOUNT_EXPIRY_DAYS).toBe(30);
    });

    it('should have correct promo code prefix', () => {
      expect(PROMO_CODE_PREFIX).toBe('ARRAKIS-TAKEOVER-');
    });
  });

  describe('checkEligibility', () => {
    it('should return ineligible if no migration state', async () => {
      const communityId = uniqueCommunityId();
      const result = await service.checkEligibility(communityId);

      expect(result.eligible).toBe(false);
      expect(result.status).toBe('ineligible');
      expect(result.reason).toContain('no migration state');
    });

    it('should return eligible status if not in exclusive mode', async () => {
      const communityId = uniqueCommunityId();
      mockStorage.getMigrationState = vi.fn().mockResolvedValue(
        createMockMigrationState('primary', communityId)
      );

      const result = await service.checkEligibility(communityId);

      expect(result.eligible).toBe(false);
      expect(result.status).toBe('eligible');
      expect(result.reason).toContain('must complete takeover');
    });

    it('should return eligible if in exclusive mode', async () => {
      const communityId = uniqueCommunityId();
      mockStorage.getMigrationState = vi.fn().mockResolvedValue(
        createMockMigrationState('exclusive', communityId)
      );

      const result = await service.checkEligibility(communityId);

      expect(result.eligible).toBe(true);
      expect(result.status).toBe('eligible');
    });

    it('should return eligible with existing generated discount', async () => {
      const communityId = uniqueCommunityId();
      mockStorage.getMigrationState = vi.fn().mockResolvedValue(
        createMockMigrationState('exclusive', communityId)
      );

      // Generate a discount first
      await service.generateDiscount(communityId, 'guild-1');

      const result = await service.checkEligibility(communityId);

      expect(result.eligible).toBe(true);
      expect(result.status).toBe('generated');
      expect(result.existingDiscount).toBeDefined();
    });
  });

  describe('generateDiscount', () => {
    it('should fail if not in exclusive mode', async () => {
      const communityId = uniqueCommunityId();
      mockStorage.getMigrationState = vi.fn().mockResolvedValue(
        createMockMigrationState('primary', communityId)
      );

      const result = await service.generateDiscount(communityId, 'guild-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Takeover not complete');
    });

    it('should generate discount when in exclusive mode', async () => {
      const communityId = uniqueCommunityId();
      mockStorage.getMigrationState = vi.fn().mockResolvedValue(
        createMockMigrationState('exclusive', communityId)
      );

      const result = await service.generateDiscount(communityId, 'guild-1');

      expect(result.success).toBe(true);
      expect(result.promotionCode).toBe('ARRAKIS-TAKEOVER-TEST123');
      expect(result.expiresAt).toBeDefined();
      expect(result.message).toContain('20%');
    });

    it('should return existing code if already generated', async () => {
      const communityId = uniqueCommunityId();
      mockStorage.getMigrationState = vi.fn().mockResolvedValue(
        createMockMigrationState('exclusive', communityId)
      );

      // Generate first time
      const first = await service.generateDiscount(communityId, 'guild-1');
      expect(first.success).toBe(true);

      // Try to generate again
      const second = await service.generateDiscount(communityId, 'guild-1');

      expect(second.success).toBe(true);
      expect(second.promotionCode).toBe(first.promotionCode);
      expect(second.message).toContain('still valid');
    });

    it('should generate local code without Stripe client', async () => {
      // Create service without Stripe client
      const localService = createTakeoverDiscountService(mockStorage);
      const communityId = uniqueCommunityId();

      mockStorage.getMigrationState = vi.fn().mockResolvedValue(
        createMockMigrationState('exclusive', communityId)
      );

      const result = await localService.generateDiscount(communityId, 'guild-123456789');

      expect(result.success).toBe(true);
      expect(result.promotionCode).toMatch(/^ARRAKIS-TAKEOVER-/);
    });

    it('should handle Stripe errors gracefully', async () => {
      const communityId = uniqueCommunityId();
      mockStorage.getMigrationState = vi.fn().mockResolvedValue(
        createMockMigrationState('exclusive', communityId)
      );

      mockStripeClient.createTakeoverCoupon = vi.fn().mockRejectedValue(
        new Error('Stripe API error')
      );

      const result = await service.generateDiscount(communityId, 'guild-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to generate discount');
    });
  });

  describe('markRedeemed', () => {
    it('should return false if no discount exists', async () => {
      const result = await service.markRedeemed(uniqueCommunityId());

      expect(result).toBe(false);
    });

    it('should mark generated discount as redeemed', async () => {
      const communityId = uniqueCommunityId();
      mockStorage.getMigrationState = vi.fn().mockResolvedValue(
        createMockMigrationState('exclusive', communityId)
      );

      // Generate discount
      await service.generateDiscount(communityId, 'guild-1');

      // Mark as redeemed
      const result = await service.markRedeemed(communityId);

      expect(result).toBe(true);

      // Verify status changed
      const discount = await service.getDiscount(communityId);
      expect(discount?.status).toBe('redeemed');
      expect(discount?.redeemedAt).toBeDefined();
    });

    it('should not allow redeeming already redeemed discount', async () => {
      const communityId = uniqueCommunityId();
      mockStorage.getMigrationState = vi.fn().mockResolvedValue(
        createMockMigrationState('exclusive', communityId)
      );

      // Generate and redeem
      await service.generateDiscount(communityId, 'guild-1');
      await service.markRedeemed(communityId);

      // Try to redeem again
      const result = await service.markRedeemed(communityId);

      expect(result).toBe(false);
    });
  });

  describe('getDiscount', () => {
    it('should return null if no discount exists', async () => {
      const result = await service.getDiscount(uniqueCommunityId());

      expect(result).toBeNull();
    });

    it('should return existing discount', async () => {
      const communityId = uniqueCommunityId();
      mockStorage.getMigrationState = vi.fn().mockResolvedValue(
        createMockMigrationState('exclusive', communityId)
      );

      await service.generateDiscount(communityId, 'guild-1');

      const result = await service.getDiscount(communityId);

      expect(result).toBeDefined();
      expect(result?.communityId).toBe(communityId);
      expect(result?.status).toBe('generated');
      expect(result?.discountPercent).toBe(20);
      expect(result?.durationMonths).toBe(12);
    });
  });

  describe('onTakeoverComplete', () => {
    it('should generate discount on takeover completion', async () => {
      const communityId = uniqueCommunityId();
      mockStorage.getMigrationState = vi.fn().mockResolvedValue(
        createMockMigrationState('exclusive', communityId)
      );

      const result = await service.onTakeoverComplete(communityId, 'guild-1');

      expect(result.success).toBe(true);
      expect(result.promotionCode).toBeDefined();
    });
  });

  describe('expireStaleDiscounts', () => {
    it('should expire old discount codes', async () => {
      const communityId = uniqueCommunityId();
      mockStorage.getMigrationState = vi.fn().mockResolvedValue(
        createMockMigrationState('exclusive', communityId)
      );

      // Generate discount
      await service.generateDiscount(communityId, 'guild-1');

      // Get the discount and manually set expiry to past
      // Note: This works because we're modifying the object in the Map directly
      const discount = await service.getDiscount(communityId);
      expect(discount).not.toBeNull();
      if (discount) {
        discount.expiresAt = new Date(Date.now() - 1000); // 1 second ago
      }

      // Run expiration
      const expiredCount = await service.expireStaleDiscounts();

      expect(expiredCount).toBe(1);

      // Verify status changed
      const updatedDiscount = await service.getDiscount(communityId);
      expect(updatedDiscount?.status).toBe('expired');
    });

    it('should call Stripe to expire promotion code', async () => {
      const communityId = uniqueCommunityId();
      mockStorage.getMigrationState = vi.fn().mockResolvedValue(
        createMockMigrationState('exclusive', communityId)
      );

      // Generate discount
      await service.generateDiscount(communityId, 'guild-1');

      // Get the discount and manually set expiry to past
      const discount = await service.getDiscount(communityId);
      expect(discount).not.toBeNull();
      if (discount) {
        discount.expiresAt = new Date(Date.now() - 1000);
      }

      // Run expiration
      await service.expireStaleDiscounts();

      expect(mockStripeClient.expirePromotionCode).toHaveBeenCalled();
    });
  });

  describe('factory function', () => {
    it('should create service instance', () => {
      const service = createTakeoverDiscountService(mockStorage);

      expect(service).toBeInstanceOf(TakeoverDiscountService);
    });

    it('should create service with Stripe client', () => {
      const service = createTakeoverDiscountService(mockStorage, mockStripeClient);

      expect(service).toBeInstanceOf(TakeoverDiscountService);
    });
  });
});
