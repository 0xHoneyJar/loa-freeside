/**
 * Booster Perks Service (v4.0 - Sprint 28)
 *
 * Handles booster-specific recognition and perks:
 * - Booster badge display
 * - Booster role management (Discord integration)
 * - Booster recognition formatting
 * - Booster anniversary tracking
 *
 * Works alongside BoostService to provide individual booster benefits.
 */

import { logger } from '../../utils/logger.js';
import {
  getMemberBoosterInfo,
  isMemberBoosting,
  getCommunityBoosters,
} from '../../db/boost-queries.js';
import { boostService, BOOST_PERKS } from './BoostService.js';
import type { Booster, BoostLevel, BoostPerk } from '../../types/billing.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Booster badge display options
 */
export interface BoosterBadgeOptions {
  /** Include boost months count */
  showMonths?: boolean;
  /** Include streak indicator */
  showStreak?: boolean;
  /** Custom emoji override */
  customEmoji?: string;
}

/**
 * Booster recognition result
 */
export interface BoosterRecognition {
  /** Whether member is a booster */
  isBooster: boolean;
  /** Badge emoji */
  badgeEmoji: string;
  /** Badge text */
  badgeText: string;
  /** Full display string */
  displayString: string;
  /** Total months boosted */
  totalMonths: number;
  /** Current streak months */
  streakMonths: number;
  /** Booster tier (based on months) */
  boosterTier: 'new' | 'supporter' | 'champion' | 'legend';
  /** Discord role color (hex) */
  roleColor: string;
}

/**
 * Booster leaderboard entry
 */
export interface BoosterLeaderboardEntry {
  rank: number;
  memberId: string;
  nym?: string;
  totalMonths: number;
  isActive: boolean;
  tier: 'new' | 'supporter' | 'champion' | 'legend';
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Booster tier thresholds (months)
 */
const BOOSTER_TIERS = {
  new: { min: 0, max: 2, emoji: '🚀', color: '#9B59B6' },
  supporter: { min: 3, max: 5, emoji: '⭐', color: '#F1C40F' },
  champion: { min: 6, max: 11, emoji: '🏆', color: '#E67E22' },
  legend: { min: 12, max: Infinity, emoji: '👑', color: '#E74C3C' },
};

/**
 * Default booster badge emoji
 */
const DEFAULT_BADGE_EMOJI = '💎';

// =============================================================================
// Booster Perks Service Class
// =============================================================================

class BoosterPerksService {
  // ---------------------------------------------------------------------------
  // Badge & Recognition
  // ---------------------------------------------------------------------------

  /**
   * Get booster badge display for a member
   */
  getBoosterBadge(
    memberId: string,
    communityId: string,
    options: BoosterBadgeOptions = {}
  ): string {
    const info = getMemberBoosterInfo(memberId, communityId);

    if (!info || !info.isActive) {
      return '';
    }

    const { showMonths = false, showStreak = false, customEmoji } = options;
    const tier = this.getBoosterTier(info.totalMonthsBoosted);
    const emoji = customEmoji ?? BOOSTER_TIERS[tier].emoji;

    let badge = emoji;

    if (showMonths && info.totalMonthsBoosted > 1) {
      badge += ` ${info.totalMonthsBoosted}mo`;
    }

    if (showStreak) {
      const streak = this.calculateStreak(info);
      if (streak > 1) {
        badge += ` 🔥${streak}`;
      }
    }

    return badge;
  }

  /**
   * Get full booster recognition for a member
   */
  getBoosterRecognition(
    memberId: string,
    communityId: string
  ): BoosterRecognition {
    const info = getMemberBoosterInfo(memberId, communityId);

    if (!info) {
      return {
        isBooster: false,
        badgeEmoji: '',
        badgeText: '',
        displayString: '',
        totalMonths: 0,
        streakMonths: 0,
        boosterTier: 'new',
        roleColor: BOOSTER_TIERS.new.color,
      };
    }

    const tier = this.getBoosterTier(info.totalMonthsBoosted);
    const tierInfo = BOOSTER_TIERS[tier];
    const streak = this.calculateStreak(info);

    const badgeText = this.formatBoosterText(tier, info.totalMonthsBoosted);
    const displayString = `${tierInfo.emoji} ${badgeText}`;

    return {
      isBooster: info.isActive,
      badgeEmoji: tierInfo.emoji,
      badgeText,
      displayString,
      totalMonths: info.totalMonthsBoosted,
      streakMonths: streak,
      boosterTier: tier,
      roleColor: tierInfo.color,
    };
  }

  /**
   * Format booster text based on tier and months
   */
  private formatBoosterText(
    tier: 'new' | 'supporter' | 'champion' | 'legend',
    months: number
  ): string {
    const tierNames = {
      new: 'Booster',
      supporter: 'Supporter',
      champion: 'Champion',
      legend: 'Legend',
    };

    if (months === 1) {
      return tierNames[tier];
    }

    return `${tierNames[tier]} (${months} months)`;
  }

  // ---------------------------------------------------------------------------
  // Tier Calculation
  // ---------------------------------------------------------------------------

  /**
   * Get booster tier based on total months
   */
  getBoosterTier(
    totalMonths: number
  ): 'new' | 'supporter' | 'champion' | 'legend' {
    if (totalMonths >= BOOSTER_TIERS.legend.min) return 'legend';
    if (totalMonths >= BOOSTER_TIERS.champion.min) return 'champion';
    if (totalMonths >= BOOSTER_TIERS.supporter.min) return 'supporter';
    return 'new';
  }

  /**
   * Calculate current boost streak (consecutive months)
   */
  private calculateStreak(info: Booster): number {
    if (!info.isActive || !info.currentBoostExpiry) {
      return 0;
    }

    // Calculate months between first boost and now as a rough streak
    const now = new Date();
    const firstBoost = info.firstBoostDate;
    const monthsDiff = this.monthsBetween(firstBoost, now);

    // If they've been boosting continuously, streak = total months
    // This is a simplification - a more accurate streak would track gaps
    return Math.min(monthsDiff, info.totalMonthsBoosted);
  }

  /**
   * Calculate months between two dates
   */
  private monthsBetween(start: Date, end: Date): number {
    const years = end.getFullYear() - start.getFullYear();
    const months = end.getMonth() - start.getMonth();
    return years * 12 + months;
  }

  // ---------------------------------------------------------------------------
  // Leaderboard
  // ---------------------------------------------------------------------------

  /**
   * Get booster leaderboard for a community
   */
  getBoosterLeaderboard(
    communityId: string,
    limit: number = 10
  ): BoosterLeaderboardEntry[] {
    const boosters = getCommunityBoosters(communityId, { limit, activeOnly: false });

    return boosters.map((booster, index) => ({
      rank: index + 1,
      memberId: booster.memberId,
      nym: booster.nym,
      totalMonths: booster.totalMonthsBoosted,
      isActive: booster.isActive,
      tier: this.getBoosterTier(booster.totalMonthsBoosted),
    }));
  }

  // ---------------------------------------------------------------------------
  // Perk Eligibility
  // ---------------------------------------------------------------------------

  /**
   * Check if a member has access to a specific booster perk
   */
  hasBoosterPerk(
    memberId: string,
    communityId: string,
    perkId: string
  ): boolean {
    const perk = BOOST_PERKS.find((p) => p.id === perkId);
    if (!perk) return false;

    // Community-wide perks are available to everyone if level is met
    if (perk.scope === 'community') {
      return boostService.hasBoostLevel(communityId, perk.minLevel);
    }

    // Booster-only perks require being an active booster AND level met
    if (!isMemberBoosting(memberId, communityId)) {
      return false;
    }

    return boostService.hasBoostLevel(communityId, perk.minLevel);
  }

  /**
   * Get all perks available to a member
   */
  getMemberPerks(
    memberId: string,
    communityId: string
  ): {
    communityPerks: BoostPerk[];
    boosterPerks: BoostPerk[];
    unavailablePerks: BoostPerk[];
  } {
    const boostLevel = boostService.getBoostLevel(communityId);
    const isBooster = isMemberBoosting(memberId, communityId);

    const communityPerks: BoostPerk[] = [];
    const boosterPerks: BoostPerk[] = [];
    const unavailablePerks: BoostPerk[] = [];

    for (const perk of BOOST_PERKS) {
      if (perk.minLevel > boostLevel) {
        unavailablePerks.push(perk);
        continue;
      }

      if (perk.scope === 'community') {
        communityPerks.push(perk);
      } else if (isBooster) {
        boosterPerks.push(perk);
      } else {
        unavailablePerks.push(perk);
      }
    }

    return { communityPerks, boosterPerks, unavailablePerks };
  }

  // ---------------------------------------------------------------------------
  // Discord Integration Helpers
  // ---------------------------------------------------------------------------

  /**
   * Get Discord role configuration for booster
   */
  getBoosterRoleConfig(memberId: string, communityId: string): {
    shouldHaveRole: boolean;
    roleColor: string;
    roleName: string;
  } {
    const info = getMemberBoosterInfo(memberId, communityId);

    if (!info || !info.isActive) {
      return {
        shouldHaveRole: false,
        roleColor: BOOSTER_TIERS.new.color,
        roleName: 'Booster',
      };
    }

    const tier = this.getBoosterTier(info.totalMonthsBoosted);
    const tierInfo = BOOSTER_TIERS[tier];

    const roleNames = {
      new: 'Booster',
      supporter: 'Server Supporter',
      champion: 'Boost Champion',
      legend: 'Boost Legend',
    };

    return {
      shouldHaveRole: true,
      roleColor: tierInfo.color,
      roleName: roleNames[tier],
    };
  }

  /**
   * Get formatted booster nickname suffix
   */
  getBoosterNicknameSuffix(memberId: string, communityId: string): string {
    const info = getMemberBoosterInfo(memberId, communityId);

    if (!info || !info.isActive) {
      return '';
    }

    const tier = this.getBoosterTier(info.totalMonthsBoosted);
    return ` ${BOOSTER_TIERS[tier].emoji}`;
  }

  // ---------------------------------------------------------------------------
  // Anniversary & Milestones
  // ---------------------------------------------------------------------------

  /**
   * Check if member has an upcoming boost anniversary
   */
  checkBoostAnniversary(
    memberId: string,
    communityId: string,
    withinDays: number = 7
  ): {
    hasAnniversary: boolean;
    anniversaryDate?: Date;
    yearsAsBooster?: number;
  } {
    const info = getMemberBoosterInfo(memberId, communityId);

    if (!info) {
      return { hasAnniversary: false };
    }

    const now = new Date();
    const firstBoost = info.firstBoostDate;

    // Calculate next anniversary
    const thisYearAnniversary = new Date(firstBoost);
    thisYearAnniversary.setFullYear(now.getFullYear());

    if (thisYearAnniversary < now) {
      thisYearAnniversary.setFullYear(now.getFullYear() + 1);
    }

    const daysUntil = Math.ceil(
      (thisYearAnniversary.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysUntil <= withinDays) {
      const yearsAsBooster =
        thisYearAnniversary.getFullYear() - firstBoost.getFullYear();
      return {
        hasAnniversary: true,
        anniversaryDate: thisYearAnniversary,
        yearsAsBooster,
      };
    }

    return { hasAnniversary: false };
  }

  /**
   * Get milestone achievements for a booster
   */
  getBoosterMilestones(
    memberId: string,
    communityId: string
  ): {
    milestone: string;
    achieved: boolean;
    date?: Date;
  }[] {
    const info = getMemberBoosterInfo(memberId, communityId);

    const milestones = [
      { months: 1, name: 'First Boost' },
      { months: 3, name: 'Supporter' },
      { months: 6, name: 'Champion' },
      { months: 12, name: 'Legend' },
      { months: 24, name: 'Super Legend' },
    ];

    if (!info) {
      return milestones.map((m) => ({
        milestone: m.name,
        achieved: false,
      }));
    }

    return milestones.map((m) => ({
      milestone: m.name,
      achieved: info.totalMonthsBoosted >= m.months,
      date:
        info.totalMonthsBoosted >= m.months ? info.firstBoostDate : undefined,
    }));
  }
}

// =============================================================================
// Export Singleton
// =============================================================================

export const boosterPerksService = new BoosterPerksService();

// Export tier constants for reference
export { BOOSTER_TIERS };
