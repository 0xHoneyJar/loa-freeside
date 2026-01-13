/**
 * Badge Service (v5.0 - Sprint 2 Paddle Migration)
 *
 * Manages score badge entitlement, purchase, and display.
 * Score badges allow members to display their conviction score with customization.
 *
 * Badge Access Rules:
 * - Premium+ tiers: Free badge access via subscription
 * - Basic and below: Must purchase badge ($4.99 one-time)
 *
 * Features:
 * - Entitlement checking (tier-based or purchase-based)
 * - Badge purchase flow (Paddle integration)
 * - Display formatting (default, minimal, detailed)
 * - Settings management (platform-specific display preferences)
 */

import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { gatekeeperService } from '../billing/GatekeeperService.js';
import {
  hasBadgePurchase,
  getBadgePurchaseByMember,
  createBadgePurchase,
  getBadgeSettings,
  upsertBadgeSettings,
} from '../../db/badge-queries.js';
import { getMemberProfileById, getMemberActivity } from '../../db/index.js';
import { TIER_INFO, tierSatisfiesRequirement } from '../billing/featureMatrix.js';
import type {
  BadgeEntitlementResult,
  BadgeDisplay,
  CreateBadgePurchaseParams,
  UpdateBadgeSettingsParams,
  BadgeSettings,
  BadgeStyle,
  SubscriptionTier,
} from '../../types/billing.js';

// =============================================================================
// Constants
// =============================================================================

/**
 * Minimum tier required for free badge access
 */
const BADGE_FREE_TIER: SubscriptionTier = 'premium';

/**
 * Badge purchase price in cents ($4.99)
 */
const BADGE_PRICE_CENTS = 499;

/**
 * Badge emoji (lightning bolt)
 */
const BADGE_EMOJI = '⚡';

// =============================================================================
// Badge Service Class
// =============================================================================

class BadgeService {
  // ---------------------------------------------------------------------------
  // Entitlement Checking
  // ---------------------------------------------------------------------------

  /**
   * Check if a member has badge access
   *
   * Priority:
   * 1. Premium+ tier subscription
   * 2. Badge purchase record
   * 3. No access
   *
   * @param communityId - Community identifier
   * @param memberId - Member identifier
   * @returns Badge entitlement result
   */
  async checkBadgeEntitlement(
    communityId: string,
    memberId: string
  ): Promise<BadgeEntitlementResult> {
    // Check community tier first
    const tierInfo = await gatekeeperService.getCurrentTier({ communityId });

    // Premium+ tiers get free badge access
    if (tierSatisfiesRequirement(tierInfo.tier, BADGE_FREE_TIER)) {
      logger.debug({ communityId, memberId, tier: tierInfo.tier }, 'Badge access via premium tier');
      return {
        hasAccess: true,
        reason: 'premium_tier',
        purchaseRequired: false,
      };
    }

    // Check for badge purchase
    const hasPurchase = hasBadgePurchase(memberId);
    if (hasPurchase) {
      logger.debug({ communityId, memberId }, 'Badge access via purchase');
      return {
        hasAccess: true,
        reason: 'purchased',
        purchaseRequired: false,
      };
    }

    // No access - purchase required
    logger.debug({ communityId, memberId }, 'Badge purchase required');
    return {
      hasAccess: false,
      reason: 'none',
      purchaseRequired: true,
      priceInCents: BADGE_PRICE_CENTS,
      priceId: config.paddle?.oneTimePriceIds?.badge,
    };
  }

  /**
   * Quick check if member has badge access (without detailed result)
   *
   * @param communityId - Community identifier
   * @param memberId - Member identifier
   * @returns Whether member has badge access
   */
  async hasBadgeAccess(communityId: string, memberId: string): Promise<boolean> {
    const result = await this.checkBadgeEntitlement(communityId, memberId);
    return result.hasAccess;
  }

  // ---------------------------------------------------------------------------
  // Badge Purchase
  // ---------------------------------------------------------------------------

  /**
   * Record a badge purchase
   *
   * This is called after successful payment (via Paddle webhook).
   * Creates a badge_purchases record for tracking.
   *
   * @param params - Purchase parameters
   * @returns Purchase ID
   */
  recordBadgePurchase(params: CreateBadgePurchaseParams): string {
    // Check if already purchased (idempotency)
    const existing = getBadgePurchaseByMember(params.memberId);
    if (existing) {
      logger.info({ memberId: params.memberId }, 'Badge already purchased (idempotent)');
      return existing.id;
    }

    // Create purchase record
    const purchaseId = createBadgePurchase(params);

    // Create default badge settings if they don't exist
    const settings = getBadgeSettings(params.memberId);
    if (settings.createdAt.getTime() === settings.updatedAt.getTime()) {
      // Settings were just created (not saved yet), save default settings
      upsertBadgeSettings(params.memberId, {
        displayOnDiscord: true,
        displayOnTelegram: false,
        badgeStyle: 'default',
      });
    }

    logger.info({ memberId: params.memberId, purchaseId }, 'Badge purchase recorded');
    return purchaseId;
  }

  // ---------------------------------------------------------------------------
  // Badge Display
  // ---------------------------------------------------------------------------

  /**
   * Get formatted badge display string for a member
   *
   * Formats:
   * - default: ⚡ 847 | Fedaykin
   * - minimal: ⚡847
   * - detailed: ⚡ Score: 847 (Fedaykin)
   *
   * @param memberId - Member identifier
   * @param platform - Platform (discord or telegram)
   * @returns Badge display result
   */
  getBadgeDisplay(memberId: string, platform: 'discord' | 'telegram'): BadgeDisplay {
    // Get badge settings
    const settings = getBadgeSettings(memberId);

    // Check if badge is enabled for platform
    const enabled =
      platform === 'discord' ? settings.displayOnDiscord : settings.displayOnTelegram;

    if (!enabled) {
      return {
        display: '',
        enabled: false,
        style: settings.badgeStyle,
      };
    }

    // Get member conviction score and tier
    const profile = getMemberProfileById(memberId);
    const activity = getMemberActivity(memberId);

    if (!profile || !activity) {
      logger.warn({ memberId }, 'Member profile or activity not found for badge display');
      return {
        display: '',
        enabled: false,
        style: settings.badgeStyle,
      };
    }

    const score = Math.round(activity.activityBalance);
    const tierName = this.getTierDisplayName(profile.tier);

    // Format badge based on style
    const display = this.formatBadge(score, tierName, settings.badgeStyle);

    return {
      display,
      enabled: true,
      style: settings.badgeStyle,
    };
  }

  /**
   * Format badge string based on style
   */
  private formatBadge(score: number, tier: string, style: BadgeStyle): string {
    switch (style) {
      case 'minimal':
        return `${BADGE_EMOJI}${score}`;
      case 'detailed':
        return `${BADGE_EMOJI} Score: ${score} (${tier})`;
      case 'default':
      default:
        return `${BADGE_EMOJI} ${score} | ${tier}`;
    }
  }

  /**
   * Get display-friendly tier name
   */
  private getTierDisplayName(tier: string): string {
    const tierMap: Record<string, string> = {
      traveler: 'Traveler',
      acolyte: 'Acolyte',
      fremen: 'Fremen',
      sayyadina: 'Sayyadina',
      sandrider: 'Sandrider',
      reverend_mother: 'Reverend Mother',
      usul: 'Usul',
      fedaykin: 'Fedaykin',
      naib: 'Naib',
    };
    return tierMap[tier] || tier.charAt(0).toUpperCase() + tier.slice(1);
  }

  /**
   * Get badge display for multiple members (batch operation)
   *
   * More efficient than calling getBadgeDisplay multiple times.
   *
   * @param memberIds - Array of member identifiers
   * @param platform - Platform (discord or telegram)
   * @returns Map of member ID to badge display
   */
  getBadgeDisplayBatch(
    memberIds: string[],
    platform: 'discord' | 'telegram'
  ): Map<string, BadgeDisplay> {
    const results = new Map<string, BadgeDisplay>();

    for (const memberId of memberIds) {
      results.set(memberId, this.getBadgeDisplay(memberId, platform));
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Badge Settings
  // ---------------------------------------------------------------------------

  /**
   * Get badge settings for a member
   *
   * Returns default settings if none exist.
   *
   * @param memberId - Member identifier
   * @returns Badge settings
   */
  getBadgeSettings(memberId: string): BadgeSettings {
    return getBadgeSettings(memberId);
  }

  /**
   * Update badge settings for a member
   *
   * Creates settings if they don't exist.
   *
   * @param memberId - Member identifier
   * @param params - Settings update parameters
   */
  updateBadgeSettings(memberId: string, params: UpdateBadgeSettingsParams): void {
    upsertBadgeSettings(memberId, params);
    logger.info({ memberId, params }, 'Badge settings updated');
  }

  /**
   * Enable badge display for a platform
   *
   * @param memberId - Member identifier
   * @param platform - Platform to enable
   */
  enableBadgeDisplay(memberId: string, platform: 'discord' | 'telegram'): void {
    const updates: UpdateBadgeSettingsParams =
      platform === 'discord' ? { displayOnDiscord: true } : { displayOnTelegram: true };

    upsertBadgeSettings(memberId, updates);
    logger.info({ memberId, platform }, 'Badge display enabled');
  }

  /**
   * Disable badge display for a platform
   *
   * @param memberId - Member identifier
   * @param platform - Platform to disable
   */
  disableBadgeDisplay(memberId: string, platform: 'discord' | 'telegram'): void {
    const updates: UpdateBadgeSettingsParams =
      platform === 'discord' ? { displayOnDiscord: false } : { displayOnTelegram: false };

    upsertBadgeSettings(memberId, updates);
    logger.info({ memberId, platform }, 'Badge display disabled');
  }

  /**
   * Update badge style
   *
   * @param memberId - Member identifier
   * @param style - Badge display style
   */
  updateBadgeStyle(memberId: string, style: BadgeStyle): void {
    upsertBadgeSettings(memberId, { badgeStyle: style });
    logger.info({ memberId, style }, 'Badge style updated');
  }

  // ---------------------------------------------------------------------------
  // Utility Methods
  // ---------------------------------------------------------------------------

  /**
   * Check if badge feature is enabled
   *
   * @returns Whether badge feature is enabled
   */
  isEnabled(): boolean {
    return config.features?.badgesEnabled ?? true;
  }

  /**
   * Get badge purchase price info
   *
   * @returns Price information
   */
  getPriceInfo(): { cents: number; formatted: string; priceId?: string } {
    return {
      cents: BADGE_PRICE_CENTS,
      formatted: `$${(BADGE_PRICE_CENTS / 100).toFixed(2)}`,
      priceId: config.paddle?.oneTimePriceIds?.badge,
    };
  }
}

// =============================================================================
// Export Singleton
// =============================================================================

export const badgeService = new BadgeService();
