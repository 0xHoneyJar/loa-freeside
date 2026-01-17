/**
 * Badge Evaluators
 * Sprint S-17: Theme Interface & BasicTheme
 *
 * Implements badge evaluation logic for different badge types.
 * Each evaluator checks if a member qualifies for a specific badge
 * based on their profile and history.
 *
 * @see SDD §6.2.2 Badge Evaluators
 */

import type {
  BadgeConfig,
  BadgeEvaluatorType,
  EarnedBadge,
  Profile,
  ProfileHistory,
} from '../../core/ports/theme-provider.js';

// --------------------------------------------------------------------------
// Evaluator Function Type
// --------------------------------------------------------------------------

/**
 * Badge evaluator function signature
 *
 * @param badge - Badge configuration being evaluated
 * @param profile - Current member profile
 * @param history - Historical profile data
 * @returns EarnedBadge if earned, null otherwise
 */
export type BadgeEvaluatorFn = (
  badge: BadgeConfig,
  profile: Profile,
  history: ProfileHistory
) => EarnedBadge | null;

// --------------------------------------------------------------------------
// Basic Evaluators (S-17)
// --------------------------------------------------------------------------

/**
 * Join Order Evaluator
 *
 * Awards badges to early members based on join position.
 *
 * Parameters:
 * - maxPosition: number - Maximum join position to qualify (e.g., 100 = first 100 members)
 *
 * @example
 * { evaluator: 'join_order', parameters: { maxPosition: 100 } }
 */
export function evaluateJoinOrder(
  badge: BadgeConfig,
  profile: Profile,
  _history: ProfileHistory
): EarnedBadge | null {
  const maxPosition = badge.parameters.maxPosition as number;

  if (typeof maxPosition !== 'number' || maxPosition <= 0) {
    return null;
  }

  if (profile.joinPosition <= maxPosition) {
    return {
      badge,
      earnedAt: profile.joinedAt,
      metadata: { joinPosition: profile.joinPosition },
    };
  }

  return null;
}

/**
 * Tenure Evaluator
 *
 * Awards badges based on membership duration.
 *
 * Parameters:
 * - minDays: number - Minimum days of membership required
 *
 * @example
 * { evaluator: 'tenure', parameters: { minDays: 180 } }
 */
export function evaluateTenure(
  badge: BadgeConfig,
  _profile: Profile,
  history: ProfileHistory
): EarnedBadge | null {
  const minDays = badge.parameters.minDays as number;

  if (typeof minDays !== 'number' || minDays <= 0) {
    return null;
  }

  if (history.tenureDays >= minDays) {
    // Calculate when the badge was actually earned
    const earnedDate = new Date();
    earnedDate.setDate(earnedDate.getDate() - (history.tenureDays - minDays));

    return {
      badge,
      earnedAt: earnedDate,
      metadata: { tenureDays: history.tenureDays },
    };
  }

  return null;
}

/**
 * Tier Reached Evaluator
 *
 * Awards badges when member reaches a specific tier.
 *
 * Parameters:
 * - tierId: string - ID of the tier that must be reached
 *
 * @example
 * { evaluator: 'tier_reached', parameters: { tierId: 'gold' } }
 */
export function evaluateTierReached(
  badge: BadgeConfig,
  profile: Profile,
  history: ProfileHistory
): EarnedBadge | null {
  const tierId = badge.parameters.tierId as string;

  if (typeof tierId !== 'string' || tierId === '') {
    return null;
  }

  // Check current tier or historical tiers
  if (profile.tierId === tierId || history.tiersReached.includes(tierId)) {
    return {
      badge,
      earnedAt: null, // We don't track exact time tier was reached
      metadata: { tierId, currentTier: profile.tierId },
    };
  }

  return null;
}

/**
 * Recent Activity Evaluator
 *
 * Awards badges to members who have been active recently.
 *
 * Parameters:
 * - maxDays: number - Maximum days since last activity to qualify
 *
 * @example
 * { evaluator: 'recent_activity', parameters: { maxDays: 30 } }
 */
export function evaluateRecentActivity(
  badge: BadgeConfig,
  _profile: Profile,
  history: ProfileHistory
): EarnedBadge | null {
  const maxDays = badge.parameters.maxDays as number;

  if (typeof maxDays !== 'number' || maxDays <= 0) {
    return null;
  }

  if (history.daysSinceLastActivity <= maxDays) {
    return {
      badge,
      earnedAt: null, // Dynamic badge, recalculated each time
      metadata: { daysSinceLastActivity: history.daysSinceLastActivity },
    };
  }

  return null;
}

/**
 * Manual Grant Evaluator
 *
 * Awards badges that are manually granted by admins.
 *
 * Parameters: None (empty object)
 *
 * @example
 * { evaluator: 'manual_grant', parameters: {} }
 */
export function evaluateManualGrant(
  badge: BadgeConfig,
  profile: Profile,
  _history: ProfileHistory
): EarnedBadge | null {
  if (profile.manualBadges.includes(badge.id)) {
    return {
      badge,
      earnedAt: null, // Grant date would come from database
      metadata: { manuallyGranted: true },
    };
  }

  return null;
}

// --------------------------------------------------------------------------
// Advanced Evaluators (S-18, SietchTheme)
// --------------------------------------------------------------------------

/**
 * Balance Stability Evaluator
 *
 * Awards badges to members who never dropped their balance.
 *
 * Parameters:
 * - minRetention: number - Minimum retention percentage (0-1)
 *
 * @example
 * { evaluator: 'balance_stability', parameters: { minRetention: 1.0 } }
 */
export function evaluateBalanceStability(
  badge: BadgeConfig,
  _profile: Profile,
  history: ProfileHistory
): EarnedBadge | null {
  const minRetention = badge.parameters.minRetention as number;

  if (typeof minRetention !== 'number') {
    return null;
  }

  // If minRetention is 1.0, check if balance ever dropped
  if (minRetention >= 1.0 && !history.balanceEverDropped) {
    return {
      badge,
      earnedAt: null,
      metadata: { balanceEverDropped: false },
    };
  }

  return null;
}

/**
 * Market Survival Evaluator
 *
 * Awards badges for surviving market downturns.
 *
 * Parameters:
 * - minEvents: number - Minimum downturns survived
 *
 * @example
 * { evaluator: 'market_survival', parameters: { minEvents: 3 } }
 */
export function evaluateMarketSurvival(
  badge: BadgeConfig,
  _profile: Profile,
  history: ProfileHistory
): EarnedBadge | null {
  const minEvents = badge.parameters.minEvents as number;

  if (typeof minEvents !== 'number' || minEvents <= 0) {
    return null;
  }

  if (history.marketDownturnsSurvived >= minEvents) {
    return {
      badge,
      earnedAt: null,
      metadata: { downturns: history.marketDownturnsSurvived },
    };
  }

  return null;
}

/**
 * Activity Streak Evaluator
 *
 * Awards badges for consecutive activity periods.
 *
 * Parameters:
 * - minStreak: number - Minimum consecutive days of activity
 *
 * @example
 * { evaluator: 'activity_streak', parameters: { minStreak: 30 } }
 */
export function evaluateActivityStreak(
  badge: BadgeConfig,
  _profile: Profile,
  history: ProfileHistory
): EarnedBadge | null {
  const minStreak = badge.parameters.minStreak as number;

  if (typeof minStreak !== 'number' || minStreak <= 0) {
    return null;
  }

  if (history.activityStreakDays >= minStreak) {
    return {
      badge,
      earnedAt: null,
      metadata: { streakDays: history.activityStreakDays },
    };
  }

  return null;
}

/**
 * Event Participation Evaluator
 *
 * Awards badges for community event attendance.
 *
 * Parameters:
 * - minEvents: number - Minimum events attended
 *
 * @example
 * { evaluator: 'event_participation', parameters: { minEvents: 10 } }
 */
export function evaluateEventParticipation(
  badge: BadgeConfig,
  _profile: Profile,
  history: ProfileHistory
): EarnedBadge | null {
  const minEvents = badge.parameters.minEvents as number;

  if (typeof minEvents !== 'number' || minEvents <= 0) {
    return null;
  }

  if (history.eventsAttended >= minEvents) {
    return {
      badge,
      earnedAt: null,
      metadata: { eventsAttended: history.eventsAttended },
    };
  }

  return null;
}

/**
 * Rank Tenure Evaluator
 *
 * Awards badges for maintaining top rank over time.
 *
 * Parameters:
 * - maxRank: number - Maximum rank to qualify (e.g., 10 = top 10)
 * - minDays: number - Minimum days at that rank or better
 *
 * @example
 * { evaluator: 'rank_tenure', parameters: { maxRank: 10, minDays: 90 } }
 */
export function evaluateRankTenure(
  badge: BadgeConfig,
  profile: Profile,
  history: ProfileHistory
): EarnedBadge | null {
  const maxRank = badge.parameters.maxRank as number;
  const minDays = badge.parameters.minDays as number;

  if (
    typeof maxRank !== 'number' ||
    typeof minDays !== 'number' ||
    maxRank <= 0 ||
    minDays <= 0
  ) {
    return null;
  }

  // Check if currently at qualifying rank AND has been there long enough
  if (profile.rank <= maxRank && history.daysAtRankOrBetter >= minDays) {
    return {
      badge,
      earnedAt: null,
      metadata: {
        currentRank: profile.rank,
        daysAtRank: history.daysAtRankOrBetter,
      },
    };
  }

  return null;
}

/**
 * Referrals Evaluator
 *
 * Awards badges for member referrals.
 *
 * Parameters:
 * - minReferrals: number - Minimum successful referrals
 *
 * @example
 * { evaluator: 'referrals', parameters: { minReferrals: 5 } }
 */
export function evaluateReferrals(
  badge: BadgeConfig,
  _profile: Profile,
  history: ProfileHistory
): EarnedBadge | null {
  const minReferrals = badge.parameters.minReferrals as number;

  if (typeof minReferrals !== 'number' || minReferrals <= 0) {
    return null;
  }

  if (history.referralCount >= minReferrals) {
    return {
      badge,
      earnedAt: null,
      metadata: { referrals: history.referralCount },
    };
  }

  return null;
}

// --------------------------------------------------------------------------
// Evaluator Registry
// --------------------------------------------------------------------------

/**
 * Map of evaluator type to evaluation function
 */
export const BADGE_EVALUATORS: Record<BadgeEvaluatorType, BadgeEvaluatorFn> = {
  // Basic evaluators (S-17)
  join_order: evaluateJoinOrder,
  tenure: evaluateTenure,
  tier_reached: evaluateTierReached,
  recent_activity: evaluateRecentActivity,
  manual_grant: evaluateManualGrant,
  // Advanced evaluators (S-18)
  balance_stability: evaluateBalanceStability,
  market_survival: evaluateMarketSurvival,
  activity_streak: evaluateActivityStreak,
  event_participation: evaluateEventParticipation,
  rank_tenure: evaluateRankTenure,
  referrals: evaluateReferrals,
};

/**
 * Evaluate a single badge
 *
 * @param badge - Badge to evaluate
 * @param profile - Member profile
 * @param history - Profile history
 * @returns EarnedBadge if earned, null otherwise
 */
export function evaluateBadge(
  badge: BadgeConfig,
  profile: Profile,
  history: ProfileHistory
): EarnedBadge | null {
  const evaluator = BADGE_EVALUATORS[badge.evaluator];

  if (!evaluator) {
    // Unknown evaluator type - skip
    return null;
  }

  return evaluator(badge, profile, history);
}

/**
 * Evaluate all badges for a profile
 *
 * @param badges - Array of badge configurations
 * @param profile - Member profile
 * @param history - Profile history
 * @returns Array of earned badges
 */
export function evaluateAllBadges(
  badges: BadgeConfig[],
  profile: Profile,
  history: ProfileHistory
): EarnedBadge[] {
  const earned: EarnedBadge[] = [];

  for (const badge of badges) {
    const result = evaluateBadge(badge, profile, history);
    if (result) {
      earned.push(result);
    }
  }

  return earned;
}
