/**
 * TakeoverDiscountService - Discount Incentive for Takeover
 *
 * Sprint 65: Full Social Layer & Polish
 *
 * Manages the 20% first-year pricing discount incentive for communities
 * that complete the takeover process (transition to exclusive mode).
 *
 * The discount is applied when a community:
 * 1. Successfully transitions from primary → exclusive mode
 * 2. Has not previously received a takeover discount
 *
 * The discount:
 * - 20% off first year of subscription
 * - Applied via billing provider coupon code
 * - One-time use per community
 * - Expires after 30 days if not redeemed
 *
 * @module packages/core/services/TakeoverDiscountService
 */

import type { ICoexistenceStorage } from '../ports/ICoexistenceStorage.js';
import { createLogger, type ILogger } from '../../infrastructure/logging/index.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Takeover discount status
 */
export type DiscountStatus =
  | 'eligible'      // Community eligible for discount (not yet taken over)
  | 'generated'     // Coupon code generated, awaiting redemption
  | 'redeemed'      // Discount has been applied to subscription
  | 'expired'       // Discount code expired without redemption
  | 'ineligible';   // Community not eligible (never in primary/exclusive)

/**
 * Takeover discount record
 */
export interface TakeoverDiscount {
  /** Community ID */
  communityId: string;
  /** Discord guild ID */
  guildId: string;
  /** Discount status */
  status: DiscountStatus;
  /** Billing provider coupon ID (if generated) */
  couponId?: string;
  /** Promotion code (user-facing code) */
  promotionCode?: string;
  /** Discount percentage */
  discountPercent: number;
  /** Duration in months */
  durationMonths: number;
  /** When takeover was completed */
  takeoverCompletedAt?: Date;
  /** When discount was generated */
  generatedAt?: Date;
  /** When discount was redeemed */
  redeemedAt?: Date;
  /** When discount expires */
  expiresAt?: Date;
  /** Record creation timestamp */
  createdAt: Date;
  /** Record update timestamp */
  updatedAt: Date;
}

/**
 * Discount generation result
 */
export interface DiscountGenerationResult {
  /** Whether generation succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Generated promotion code */
  promotionCode?: string;
  /** Expiration date */
  expiresAt?: Date;
  /** Message for admin notification */
  message?: string;
}

/**
 * Discount eligibility check result
 */
export interface DiscountEligibilityResult {
  /** Whether community is eligible */
  eligible: boolean;
  /** Current status */
  status: DiscountStatus;
  /** Reason for ineligibility (if not eligible) */
  reason?: string;
  /** Existing discount (if any) */
  existingDiscount?: TakeoverDiscount;
}

/**
 * Billing provider interface for discounts (for dependency injection)
 */
export interface IDiscountClient {
  /** Create a coupon for takeover discount */
  createTakeoverCoupon(
    communityId: string,
    discountPercent: number,
    durationMonths: number
  ): Promise<{ couponId: string; promotionCode: string }>;

  /** Check if a promotion code has been redeemed */
  isPromotionCodeRedeemed(promotionCode: string): Promise<boolean>;

  /** Expire a promotion code */
  expirePromotionCode(promotionCode: string): Promise<void>;
}

// =============================================================================
// Constants
// =============================================================================

/** Default discount percentage */
export const TAKEOVER_DISCOUNT_PERCENT = 20;

/** Default discount duration in months (first year) */
export const TAKEOVER_DISCOUNT_DURATION_MONTHS = 12;

/** Days until discount code expires */
export const DISCOUNT_EXPIRY_DAYS = 30;

/** Promotion code prefix for takeover discounts */
export const PROMO_CODE_PREFIX = 'ARRAKIS-TAKEOVER-';

// =============================================================================
// In-Memory Storage (until database schema is added)
// =============================================================================

/**
 * In-memory store for takeover discounts
 * NOTE: In production, this would be persisted to the database
 */
const discountStore = new Map<string, TakeoverDiscount>();

// =============================================================================
// Service Implementation
// =============================================================================

/**
 * Takeover Discount Service
 *
 * Manages the 20% first-year pricing discount for communities
 * that complete the takeover process.
 */
export class TakeoverDiscountService {
  private readonly logger: ILogger;

  constructor(
    private readonly storage: ICoexistenceStorage,
    private readonly discountClient?: IDiscountClient,
    logger?: ILogger
  ) {
    this.logger = logger ?? createLogger({ service: 'TakeoverDiscountService' });
  }

  /**
   * Check if a community is eligible for takeover discount
   *
   * @param communityId - Community UUID
   * @returns Eligibility result
   */
  async checkEligibility(communityId: string): Promise<DiscountEligibilityResult> {
    // Check for existing discount
    const existingDiscount = discountStore.get(communityId);

    if (existingDiscount) {
      // Already has a discount record
      if (existingDiscount.status === 'redeemed') {
        return {
          eligible: false,
          status: 'redeemed',
          reason: 'Takeover discount has already been redeemed',
          existingDiscount,
        };
      }

      if (existingDiscount.status === 'generated') {
        // Check if expired
        if (existingDiscount.expiresAt && new Date() > existingDiscount.expiresAt) {
          // Mark as expired
          existingDiscount.status = 'expired';
          existingDiscount.updatedAt = new Date();
          discountStore.set(communityId, existingDiscount);

          return {
            eligible: false,
            status: 'expired',
            reason: 'Takeover discount code has expired',
            existingDiscount,
          };
        }

        // Still valid - can be redeemed
        return {
          eligible: true,
          status: 'generated',
          existingDiscount,
        };
      }

      if (existingDiscount.status === 'expired') {
        return {
          eligible: false,
          status: 'expired',
          reason: 'Takeover discount code has expired',
          existingDiscount,
        };
      }
    }

    // Check migration state
    const migrationState = await this.storage.getMigrationState(communityId);

    if (!migrationState) {
      return {
        eligible: false,
        status: 'ineligible',
        reason: 'Community has no migration state (never in coexistence mode)',
      };
    }

    // Must be in exclusive mode to receive discount
    if (migrationState.currentMode !== 'exclusive') {
      return {
        eligible: false,
        status: 'eligible',
        reason: `Community must complete takeover (current mode: ${migrationState.currentMode})`,
      };
    }

    // Eligible for discount
    return {
      eligible: true,
      status: 'eligible',
    };
  }

  /**
   * Generate takeover discount for a community
   *
   * Called after successful takeover (transition to exclusive mode)
   *
   * @param communityId - Community UUID
   * @param guildId - Discord guild ID
   * @returns Generation result
   */
  async generateDiscount(
    communityId: string,
    guildId: string
  ): Promise<DiscountGenerationResult> {
    // Check eligibility
    const eligibility = await this.checkEligibility(communityId);

    // Check if discount already generated - return existing code
    if (eligibility.status === 'generated' && eligibility.existingDiscount?.promotionCode) {
      return {
        success: true,
        promotionCode: eligibility.existingDiscount.promotionCode,
        expiresAt: eligibility.existingDiscount.expiresAt,
        message: 'Your takeover discount code is still valid!',
      };
    }

    // Check if not eligible (but not because we haven't taken over yet)
    if (!eligibility.eligible && eligibility.status !== 'eligible') {
      return {
        success: false,
        error: eligibility.reason ?? 'Community is not eligible for takeover discount',
      };
    }

    // Verify mode is exclusive
    const migrationState = await this.storage.getMigrationState(communityId);
    if (migrationState?.currentMode !== 'exclusive') {
      return {
        success: false,
        error: 'Takeover not complete. Must be in exclusive mode.',
      };
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + DISCOUNT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    let promotionCode: string;
    let couponId: string | undefined;

    // Generate via billing provider if client is available
    if (this.discountClient) {
      try {
        const result = await this.discountClient.createTakeoverCoupon(
          communityId,
          TAKEOVER_DISCOUNT_PERCENT,
          TAKEOVER_DISCOUNT_DURATION_MONTHS
        );
        couponId = result.couponId;
        promotionCode = result.promotionCode;
      } catch (error) {
        this.logger.error('Failed to create coupon', { error, communityId });
        return {
          success: false,
          error: 'Failed to generate discount code. Please contact support.',
        };
      }
    } else {
      // Generate local code (for testing/development)
      promotionCode = `${PROMO_CODE_PREFIX}${guildId.slice(-8).toUpperCase()}`;
    }

    // Create discount record
    const discount: TakeoverDiscount = {
      communityId,
      guildId,
      status: 'generated',
      couponId,
      promotionCode,
      discountPercent: TAKEOVER_DISCOUNT_PERCENT,
      durationMonths: TAKEOVER_DISCOUNT_DURATION_MONTHS,
      takeoverCompletedAt: now,
      generatedAt: now,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    };

    discountStore.set(communityId, discount);

    this.logger.info('Generated takeover discount', {
      communityId,
      guildId,
      promotionCode,
      expiresAt,
    });

    return {
      success: true,
      promotionCode,
      expiresAt,
      message: `Congratulations on completing your takeover! Use code ${promotionCode} for ${TAKEOVER_DISCOUNT_PERCENT}% off your first year.`,
    };
  }

  /**
   * Mark discount as redeemed
   *
   * Called when the promotion code is used in checkout
   *
   * @param communityId - Community UUID
   * @returns Whether marking succeeded
   */
  async markRedeemed(communityId: string): Promise<boolean> {
    const discount = discountStore.get(communityId);

    if (!discount) {
      this.logger.warn('No discount found to mark as redeemed', { communityId });
      return false;
    }

    if (discount.status !== 'generated') {
      this.logger.warn('Cannot redeem discount in current status', {
        communityId,
        status: discount.status,
      });
      return false;
    }

    discount.status = 'redeemed';
    discount.redeemedAt = new Date();
    discount.updatedAt = new Date();
    discountStore.set(communityId, discount);

    this.logger.info('Marked takeover discount as redeemed', { communityId });
    return true;
  }

  /**
   * Get discount status for a community
   *
   * @param communityId - Community UUID
   * @returns Discount record or null
   */
  async getDiscount(communityId: string): Promise<TakeoverDiscount | null> {
    return discountStore.get(communityId) ?? null;
  }

  /**
   * Hook called when takeover is executed successfully
   *
   * This should be called from MigrationEngine after successful takeover
   *
   * @param communityId - Community UUID
   * @param guildId - Discord guild ID
   * @returns Generation result
   */
  async onTakeoverComplete(
    communityId: string,
    guildId: string
  ): Promise<DiscountGenerationResult> {
    this.logger.info('Takeover complete, generating discount', {
      communityId,
      guildId,
    });

    return this.generateDiscount(communityId, guildId);
  }

  /**
   * Expire stale discount codes
   *
   * Called periodically to clean up expired codes
   */
  async expireStaleDiscounts(): Promise<number> {
    const now = new Date();
    let expiredCount = 0;

    for (const [communityId, discount] of discountStore.entries()) {
      if (
        discount.status === 'generated' &&
        discount.expiresAt &&
        now > discount.expiresAt
      ) {
        discount.status = 'expired';
        discount.updatedAt = now;
        discountStore.set(communityId, discount);
        expiredCount++;

        // Expire in billing provider if client available
        if (this.discountClient && discount.promotionCode) {
          try {
            await this.discountClient.expirePromotionCode(discount.promotionCode);
          } catch (error) {
            this.logger.warn('Failed to expire promotion code', {
              error,
              communityId,
              promotionCode: discount.promotionCode,
            });
          }
        }

        this.logger.info('Expired stale takeover discount', {
          communityId,
          promotionCode: discount.promotionCode,
        });
      }
    }

    return expiredCount;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a TakeoverDiscountService instance
 */
export function createTakeoverDiscountService(
  storage: ICoexistenceStorage,
  discountClient?: IDiscountClient,
  logger?: ILogger
): TakeoverDiscountService {
  return new TakeoverDiscountService(storage, discountClient, logger);
}
