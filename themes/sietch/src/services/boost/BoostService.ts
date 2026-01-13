/**
 * Boost Service (v5.0 - Sprint 2 Paddle Migration)
 *
 * Core service for community boost management:
 * - Boost purchase processing
 * - Level calculation and threshold management
 * - Booster recognition and perks
 * - Provider-agnostic billing integration (Paddle)
 *
 * Boost Levels:
 * - Level 1: 2+ boosters - Basic perks
 * - Level 2: 7+ boosters - Enhanced perks
 * - Level 3: 15+ boosters - Premium perks
 */

import { logger } from '../../utils/logger.js';
import { gatekeeperService } from '../billing/GatekeeperService.js';
import { createBillingProvider } from '../../packages/adapters/billing/index.js';
import { config, isPaddleEnabled } from '../../config.js';
import type { IBillingProvider } from '../../packages/core/ports/IBillingProvider.js';
import {
  createBoostPurchase,
  extendMemberBoost,
  getMemberActiveBoost,
  getMemberBoosterInfo,
  getBoostPurchaseById,
  getBoostPurchaseByPaymentId,
  getCommunityBoosters,
  getCommunityBoostStats,
  getCommunityBoostLevel,
  getActiveBoosterCount,
  calculateBoostLevel,
  calculateProgressToNextLevel,
  updateCommunityBoostStats,
  deactivateExpiredBoosts,
  getTopBoosters,
  getBoostPurchaseStats,
  isMemberBoosting,
} from '../../db/boost-queries.js';
import { DEFAULT_BOOST_THRESHOLDS, DEFAULT_BOOST_PRICING } from '../../db/migrations/011_boosts.js';
import type {
  BoostLevel,
  BoostPurchase,
  CommunityBoostStatus,
  Booster,
  BoostPerk,
  BoostPricing,
  BoostBundle,
  BoostLevelThresholds,
} from '../../types/billing.js';

// =============================================================================
// Constants
// =============================================================================

/**
 * Default boost perks by level
 */
const BOOST_PERKS: BoostPerk[] = [
  // Level 1 Perks (2+ boosters)
  {
    id: 'custom_emojis',
    name: 'Custom Emojis',
    description: 'Upload custom emojis for the community',
    minLevel: 1,
    scope: 'community',
  },
  {
    id: 'booster_badge',
    name: 'Booster Badge',
    description: 'Special booster badge on your profile',
    minLevel: 1,
    scope: 'booster',
  },
  {
    id: 'booster_role',
    name: 'Booster Role',
    description: 'Exclusive Discord role with unique color',
    minLevel: 1,
    scope: 'booster',
  },

  // Level 2 Perks (7+ boosters)
  {
    id: 'animated_banner',
    name: 'Animated Banner',
    description: 'Community can use animated server banner',
    minLevel: 2,
    scope: 'community',
  },
  {
    id: 'priority_queue',
    name: 'Priority Queue',
    description: 'Priority access to community events',
    minLevel: 2,
    scope: 'booster',
  },
  {
    id: 'custom_role_icon',
    name: 'Custom Role Icon',
    description: 'Custom icon for booster role',
    minLevel: 2,
    scope: 'booster',
  },

  // Level 3 Perks (15+ boosters)
  {
    id: 'vanity_url',
    name: 'Vanity URL',
    description: 'Custom invite link for the community',
    minLevel: 3,
    scope: 'community',
  },
  {
    id: 'hd_streaming',
    name: 'HD Streaming',
    description: 'Higher quality voice/video streaming',
    minLevel: 3,
    scope: 'community',
  },
  {
    id: 'exclusive_channels',
    name: 'Exclusive Channels',
    description: 'Access to booster-only channels',
    minLevel: 3,
    scope: 'booster',
  },
];

// =============================================================================
// Types
// =============================================================================

export interface PurchaseBoostParams {
  memberId: string;
  communityId: string;
  months: number;
  successUrl: string;
  cancelUrl: string;
}

export interface PurchaseBoostResult {
  purchaseId?: string;
  checkoutUrl?: string;
  success: boolean;
  error?: string;
}

export interface ProcessBoostPaymentParams {
  sessionId?: string;
  paymentId: string;
  memberId: string;
  communityId: string;
  months: number;
  amountPaidCents: number;
}

// =============================================================================
// Boost Service Class
// =============================================================================

class BoostService {
  private thresholds: BoostLevelThresholds;
  private pricing: BoostPricing;
  private billingProvider: IBillingProvider | null = null;

  constructor() {
    // Initialize with defaults, can be overridden via config
    this.thresholds = {
      level1: parseInt(process.env.BOOST_LEVEL1_THRESHOLD ?? String(DEFAULT_BOOST_THRESHOLDS.level1)),
      level2: parseInt(process.env.BOOST_LEVEL2_THRESHOLD ?? String(DEFAULT_BOOST_THRESHOLDS.level2)),
      level3: parseInt(process.env.BOOST_LEVEL3_THRESHOLD ?? String(DEFAULT_BOOST_THRESHOLDS.level3)),
    };

    this.pricing = {
      pricePerMonthCents: parseInt(
        process.env.BOOST_PRICE_PER_MONTH_CENTS ?? String(DEFAULT_BOOST_PRICING.pricePerMonthCents)
      ),
      bundles: this.loadBundlePricing(),
    };
  }

  /**
   * Get or initialize the billing provider (lazy initialization)
   */
  private getBillingProvider(): IBillingProvider {
    if (!this.billingProvider) {
      if (!isPaddleEnabled()) {
        throw new Error('Paddle billing is not configured');
      }

      this.billingProvider = createBillingProvider({
        provider: 'paddle',
        paddle: config.paddle,
      });
    }
    return this.billingProvider;
  }

  /**
   * Load bundle pricing from environment or defaults
   */
  private loadBundlePricing(): BoostBundle[] {
    const envBundles = process.env.BOOST_BUNDLES;
    if (envBundles) {
      try {
        return JSON.parse(envBundles);
      } catch {
        logger.warn('Invalid BOOST_BUNDLES env var, using defaults');
      }
    }
    return DEFAULT_BOOST_PRICING.bundles;
  }

  // ---------------------------------------------------------------------------
  // Boost Purchase
  // ---------------------------------------------------------------------------

  /**
   * Initiate a boost purchase via Paddle Checkout
   */
  async purchaseBoost(params: PurchaseBoostParams): Promise<PurchaseBoostResult> {
    const { memberId, communityId, months, successUrl, cancelUrl } = params;

    // Validate months
    if (months < 1 || months > 12) {
      return { success: false, error: 'Invalid boost duration. Must be 1-12 months.' };
    }

    // Find matching bundle or calculate price
    const bundle = this.pricing.bundles.find((b) => b.months === months);
    const priceCents = bundle?.priceCents ?? this.pricing.pricePerMonthCents * months;

    // Get or validate price ID from Paddle configuration
    const priceId = bundle?.priceId ?? config.paddle?.oneTimePriceIds?.boost;
    if (!priceId) {
      logger.error({ months }, 'No price ID configured for boost purchase');
      return { success: false, error: 'Boost purchase not configured' };
    }

    try {
      const provider = this.getBillingProvider();

      // Get or create customer in Paddle
      const customerId = await provider.getOrCreateCustomer(communityId, undefined, memberId);

      // Create Paddle Checkout session for one-time purchase
      const session = await provider.createOneTimeCheckoutSession({
        customerId,
        priceId,
        successUrl,
        cancelUrl,
        metadata: {
          type: 'boost_purchase',
          member_id: memberId,
          community_id: communityId,
          months: String(months),
          amount_cents: String(priceCents),
        },
      });

      logger.info(
        { memberId, communityId, months, sessionId: session.sessionId },
        'Created boost checkout session'
      );

      return {
        checkoutUrl: session.url,
        success: true,
      };
    } catch (error) {
      logger.error({ memberId, communityId, months, error }, 'Failed to create boost checkout');
      return { success: false, error: 'Failed to create checkout session' };
    }
  }

  /**
   * Process a successful boost payment (called from webhook)
   */
  async processBoostPayment(params: ProcessBoostPaymentParams): Promise<BoostPurchase> {
    const { paymentId, memberId, communityId, months, amountPaidCents } = params;

    // Check for duplicate processing
    const existing = getBoostPurchaseByPaymentId(paymentId);
    if (existing) {
      logger.warn({ paymentId }, 'Boost payment already processed');
      return existing;
    }

    // Check if member has active boost to extend
    const activeBoost = getMemberActiveBoost(memberId, communityId);

    let purchaseId: string;
    if (activeBoost) {
      // Extend existing boost
      purchaseId = extendMemberBoost(
        memberId,
        communityId,
        months,
        amountPaidCents,
        paymentId
      );
      logger.info(
        { memberId, communityId, months, extended: true },
        'Extended existing boost'
      );
    } else {
      // Create new boost
      purchaseId = createBoostPurchase({
        memberId,
        communityId,
        paymentId,
        monthsPurchased: months,
        amountPaidCents,
      });
      logger.info(
        { memberId, communityId, months, extended: false },
        'Created new boost'
      );
    }

    const purchase = getBoostPurchaseById(purchaseId);
    if (!purchase) {
      throw new Error('Failed to retrieve created boost purchase');
    }

    // Invalidate entitlements cache for community
    await gatekeeperService.invalidateCache(communityId);

    return purchase;
  }

  /**
   * Grant a free boost (admin action)
   */
  grantFreeBoost(
    memberId: string,
    communityId: string,
    months: number,
    grantedBy: string
  ): BoostPurchase {
    const purchaseId = createBoostPurchase({
      memberId,
      communityId,
      monthsPurchased: months,
      amountPaidCents: 0, // Free boost
    });

    logger.info(
      { memberId, communityId, months, grantedBy },
      'Granted free boost'
    );

    const purchase = getBoostPurchaseById(purchaseId);
    if (!purchase) {
      throw new Error('Failed to retrieve created boost purchase');
    }

    return purchase;
  }

  // ---------------------------------------------------------------------------
  // Community Boost Status
  // ---------------------------------------------------------------------------

  /**
   * Get full boost status for a community
   */
  getCommunityBoostStatus(communityId: string): CommunityBoostStatus {
    // Ensure stats are fresh
    updateCommunityBoostStats(communityId);

    const stats = getCommunityBoostStats(communityId);
    const boosterCount = stats?.totalBoosters ?? getActiveBoosterCount(communityId);
    const totalMonths = stats?.totalBoostMonths ?? 0;
    const level = calculateBoostLevel(boosterCount, this.thresholds);
    const progress = calculateProgressToNextLevel(boosterCount, this.thresholds);

    return {
      communityId,
      totalBoosters: boosterCount,
      level,
      totalBoostMonths: totalMonths,
      progressToNextLevel: progress.progressPercent,
      boostsNeededForNextLevel: progress.boostersNeeded,
      perks: this.getPerksForLevel(level),
    };
  }

  /**
   * Get current boost level for a community
   */
  getBoostLevel(communityId: string): BoostLevel | 0 {
    return getCommunityBoostLevel(communityId, true);
  }

  /**
   * Check if community has reached a specific boost level
   */
  hasBoostLevel(communityId: string, minLevel: BoostLevel): boolean {
    const currentLevel = this.getBoostLevel(communityId);
    return currentLevel >= minLevel;
  }

  // ---------------------------------------------------------------------------
  // Booster Information
  // ---------------------------------------------------------------------------

  /**
   * Get all boosters for a community
   */
  getBoosters(
    communityId: string,
    options: { activeOnly?: boolean; limit?: number } = {}
  ): Booster[] {
    return getCommunityBoosters(communityId, options);
  }

  /**
   * Get top boosters for a community
   */
  getTopBoosters(communityId: string, limit: number = 10): Booster[] {
    return getTopBoosters(communityId, limit);
  }

  /**
   * Check if a member is currently boosting
   */
  isBooster(memberId: string, communityId: string): boolean {
    return isMemberBoosting(memberId, communityId);
  }

  /**
   * Get booster info for a member
   */
  getBoosterInfo(memberId: string, communityId: string): Booster | null {
    return getMemberBoosterInfo(memberId, communityId);
  }

  /**
   * Get member's active boost
   */
  getMemberBoost(memberId: string, communityId: string): BoostPurchase | null {
    return getMemberActiveBoost(memberId, communityId);
  }

  // ---------------------------------------------------------------------------
  // Perks
  // ---------------------------------------------------------------------------

  /**
   * Get all perks available at a boost level
   */
  getPerksForLevel(level: BoostLevel | 0): BoostPerk[] {
    if (level === 0) return [];
    return BOOST_PERKS.filter((perk) => perk.minLevel <= level);
  }

  /**
   * Get community-wide perks at current level
   */
  getCommunityPerks(communityId: string): BoostPerk[] {
    const level = this.getBoostLevel(communityId);
    return this.getPerksForLevel(level).filter((p) => p.scope === 'community');
  }

  /**
   * Get perks available to a booster
   */
  getBoosterPerks(memberId: string, communityId: string): {
    boosterPerks: BoostPerk[];
    communityPerks: BoostPerk[];
    isBooster: boolean;
  } {
    const level = this.getBoostLevel(communityId);
    const isBooster = this.isBooster(memberId, communityId);

    const allPerks = this.getPerksForLevel(level);
    const communityPerks = allPerks.filter((p) => p.scope === 'community');
    const boosterPerks = isBooster
      ? allPerks.filter((p) => p.scope === 'booster')
      : [];

    return { boosterPerks, communityPerks, isBooster };
  }

  /**
   * Check if a specific perk is unlocked
   */
  isPerkUnlocked(
    perkId: string,
    communityId: string,
    memberId?: string
  ): boolean {
    const perk = BOOST_PERKS.find((p) => p.id === perkId);
    if (!perk) return false;

    const level = this.getBoostLevel(communityId);
    if (level < perk.minLevel) return false;

    if (perk.scope === 'booster' && memberId) {
      return this.isBooster(memberId, communityId);
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Pricing
  // ---------------------------------------------------------------------------

  /**
   * Get current boost pricing
   */
  getPricing(): BoostPricing {
    return { ...this.pricing };
  }

  /**
   * Get price for a specific duration
   */
  getPriceForMonths(months: number): number {
    const bundle = this.pricing.bundles.find((b) => b.months === months);
    return bundle?.priceCents ?? this.pricing.pricePerMonthCents * months;
  }

  /**
   * Get level thresholds
   */
  getThresholds(): BoostLevelThresholds {
    return { ...this.thresholds };
  }

  // ---------------------------------------------------------------------------
  // Analytics
  // ---------------------------------------------------------------------------

  /**
   * Get boost statistics for a community
   */
  getBoostStats(communityId: string): {
    totalPurchases: number;
    totalRevenueCents: number;
    averagePurchaseMonths: number;
    uniqueBoosters: number;
    currentLevel: BoostLevel | 0;
    activeBoosters: number;
  } {
    const purchaseStats = getBoostPurchaseStats(communityId);
    const level = this.getBoostLevel(communityId);
    const activeBoosters = getActiveBoosterCount(communityId);

    return {
      ...purchaseStats,
      currentLevel: level,
      activeBoosters,
    };
  }

  // ---------------------------------------------------------------------------
  // Maintenance
  // ---------------------------------------------------------------------------

  /**
   * Deactivate expired boosts and update stats
   * Should be called periodically via cron job
   */
  async runMaintenanceTasks(): Promise<{ expiredCount: number }> {
    const expiredCount = deactivateExpiredBoosts();

    if (expiredCount > 0) {
      logger.info({ expiredCount }, 'Deactivated expired boosts');
    }

    return { expiredCount };
  }
}

// =============================================================================
// Export Singleton
// =============================================================================

export const boostService = new BoostService();

// Export perks for reference
export { BOOST_PERKS };
