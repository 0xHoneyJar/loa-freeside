/**
 * Badge Service
 *
 * Handles badge awards, revocations, and automatic badge checks.
 *
 * Badge Categories:
 * - Tenure: OG, Veteran, Elder (based on membership duration)
 * - Engagement: Consistent, Dedicated, Devoted (based on activity balance)
 * - Contribution: Helper, Builder, Teacher (admin-awarded)
 * - Special: Founding Fedaykin (first 69 members)
 */

import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import {
  getMemberProfileById,
  getMemberProfileByDiscordId,
  getMemberActivity,
  getMemberBadges,
  getMemberBadgeCount,
  memberHasBadge,
  awardBadge as dbAwardBadge,
  revokeBadge as dbRevokeBadge,
  getAllBadges,
  getBadgeById,
  calculateTenureCategory,
  getDatabase,
} from '../db/queries.js';
import { ACTIVITY_BADGE_THRESHOLDS } from './activity.js';
import type { Badge, MemberBadge, MemberProfile } from '../types/index.js';

/**
 * Badge IDs (must match database seed data)
 */
export const BADGE_IDS = {
  // Tenure badges
  og: 'og',
  veteran: 'veteran',
  elder: 'elder',
  // Engagement badges
  consistent: 'consistent',
  dedicated: 'dedicated',
  devoted: 'devoted',
  // Contribution badges (admin-awarded)
  helper: 'helper',
  builder: 'builder',
  teacher: 'teacher',
  waterSharer: 'water-sharer',
  // Special badges
  foundingFedaykin: 'founding-fedaykin',
  // Tier badges (Sprint 18)
  usulAscended: 'usul-ascended',
} as const;

/**
 * Tenure thresholds (in days)
 */
export const TENURE_THRESHOLDS = {
  og: 30, // Joined within 30 days of launch
  veteran: 90, // 90+ days membership
  elder: 180, // 180+ days membership
} as const;

/**
 * Role thresholds for automatic role assignment
 */
export const ROLE_THRESHOLDS = {
  engaged: {
    badgeCount: 5,
    activityBalance: 200,
  },
  veteran: {
    tenureDays: 90,
  },
  trusted: {
    badgeCount: 10,
    helperBadge: true,
  },
} as const;

/**
 * Get all badges for a member by Discord ID
 */
export function getMemberBadgesByDiscordId(discordUserId: string): Badge[] {
  const profile = getMemberProfileByDiscordId(discordUserId);
  if (!profile) {
    return [];
  }

  return getMemberBadges(profile.memberId);
}

/**
 * Get all badges for a member by member ID
 */
export function getMemberBadgesByMemberId(memberId: string): Badge[] {
  return getMemberBadges(memberId);
}

/**
 * Award a badge to a member (automatic or manual)
 * Returns the badge record if awarded, null if already has badge or error
 */
export function awardBadge(
  memberId: string,
  badgeId: string,
  options: { awardedBy?: string; reason?: string } = {}
): MemberBadge | null {
  // Check if member exists
  const profile = getMemberProfileById(memberId);
  if (!profile) {
    logger.warn({ memberId, badgeId }, 'Cannot award badge: member not found');
    return null;
  }

  // Check if badge exists
  const badge = getBadgeById(badgeId);
  if (!badge) {
    logger.warn({ badgeId }, 'Cannot award badge: badge not found');
    return null;
  }

  // Check if already has badge
  if (memberHasBadge(memberId, badgeId)) {
    logger.debug({ memberId, badgeId }, 'Member already has badge');
    return null;
  }

  // Award the badge
  const result = dbAwardBadge(memberId, badgeId, options);

  if (result) {
    logger.info(
      { memberId, badgeId, badgeName: badge.name, awardedBy: options.awardedBy },
      'Badge awarded'
    );

    // Trigger role sync after badge award (async, don't wait)
    import('./roleManager.js').then(({ onBadgeAwarded }) => {
      onBadgeAwarded(memberId).catch((error) => {
        logger.error({ error, memberId }, 'Failed to sync roles after badge award');
      });
    });
  }

  return result;
}

/**
 * Admin awards a contribution badge
 */
export function adminAwardBadge(
  memberId: string,
  badgeId: string,
  adminDiscordId: string,
  reason: string
): MemberBadge | null {
  // Validate it's a contribution badge (admin-awardable)
  const badge = getBadgeById(badgeId);
  if (!badge) {
    return null;
  }

  // Only contribution badges can be manually awarded
  if (badge.category !== 'contribution' && badge.category !== 'special') {
    logger.warn(
      { badgeId, category: badge.category },
      'Cannot manually award non-contribution badge'
    );
    return null;
  }

  return awardBadge(memberId, badgeId, {
    awardedBy: adminDiscordId,
    reason,
  });
}

/**
 * Revoke a badge from a member (admin only)
 */
export function revokeBadge(
  memberId: string,
  badgeId: string,
  revokedBy: string
): boolean {
  const result = dbRevokeBadge(memberId, badgeId, revokedBy);

  if (result) {
    logger.info({ memberId, badgeId, revokedBy }, 'Badge revoked');
  }

  return result;
}

/**
 * Check and award tenure badges for a member
 * Returns list of newly awarded badges
 */
export function checkTenureBadges(memberId: string): Badge[] {
  const profile = getMemberProfileById(memberId);
  if (!profile || !profile.onboardingComplete) {
    return [];
  }

  const awarded: Badge[] = [];
  const launchDate = config.socialLayer.profile.launchDate
    ? new Date(config.socialLayer.profile.launchDate)
    : new Date('2025-01-01');

  const now = new Date();
  const membershipDays = Math.floor(
    (now.getTime() - profile.createdAt.getTime()) / (1000 * 60 * 60 * 24)
  );
  const daysAfterLaunch = Math.floor(
    (profile.createdAt.getTime() - launchDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  // OG badge: joined within 30 days of launch
  if (daysAfterLaunch <= TENURE_THRESHOLDS.og) {
    if (!memberHasBadge(memberId, BADGE_IDS.og)) {
      const result = awardBadge(memberId, BADGE_IDS.og, {
        reason: 'Joined within 30 days of launch',
      });
      if (result) {
        const badge = getBadgeById(BADGE_IDS.og);
        if (badge) awarded.push(badge);
      }
    }
  }

  // Veteran badge: 90+ days membership
  if (membershipDays >= TENURE_THRESHOLDS.veteran) {
    if (!memberHasBadge(memberId, BADGE_IDS.veteran)) {
      const result = awardBadge(memberId, BADGE_IDS.veteran, {
        reason: `${membershipDays} days of membership`,
      });
      if (result) {
        const badge = getBadgeById(BADGE_IDS.veteran);
        if (badge) awarded.push(badge);
      }
    }
  }

  // Elder badge: 180+ days membership
  if (membershipDays >= TENURE_THRESHOLDS.elder) {
    if (!memberHasBadge(memberId, BADGE_IDS.elder)) {
      const result = awardBadge(memberId, BADGE_IDS.elder, {
        reason: `${membershipDays} days of membership`,
      });
      if (result) {
        const badge = getBadgeById(BADGE_IDS.elder);
        if (badge) awarded.push(badge);
      }
    }
  }

  return awarded;
}

/**
 * Check and award activity badges for a member
 * Returns list of newly awarded badges
 */
export function checkActivityBadges(memberId: string): Badge[] {
  const profile = getMemberProfileById(memberId);
  if (!profile || !profile.onboardingComplete) {
    return [];
  }

  const activity = getMemberActivity(memberId);
  if (!activity) {
    return [];
  }

  const awarded: Badge[] = [];
  const balance = activity.activityBalance;

  // Check activity thresholds (only award highest eligible)
  // Badges are NOT removed when balance drops - once earned, kept forever

  // Devoted (500+)
  if (balance >= ACTIVITY_BADGE_THRESHOLDS.devoted) {
    if (!memberHasBadge(memberId, BADGE_IDS.devoted)) {
      const result = awardBadge(memberId, BADGE_IDS.devoted, {
        reason: `Activity balance reached ${balance.toFixed(0)}`,
      });
      if (result) {
        const badge = getBadgeById(BADGE_IDS.devoted);
        if (badge) awarded.push(badge);
      }
    }
  }

  // Dedicated (250+)
  if (balance >= ACTIVITY_BADGE_THRESHOLDS.dedicated) {
    if (!memberHasBadge(memberId, BADGE_IDS.dedicated)) {
      const result = awardBadge(memberId, BADGE_IDS.dedicated, {
        reason: `Activity balance reached ${balance.toFixed(0)}`,
      });
      if (result) {
        const badge = getBadgeById(BADGE_IDS.dedicated);
        if (badge) awarded.push(badge);
      }
    }
  }

  // Consistent (100+)
  if (balance >= ACTIVITY_BADGE_THRESHOLDS.consistent) {
    if (!memberHasBadge(memberId, BADGE_IDS.consistent)) {
      const result = awardBadge(memberId, BADGE_IDS.consistent, {
        reason: `Activity balance reached ${balance.toFixed(0)}`,
      });
      if (result) {
        const badge = getBadgeById(BADGE_IDS.consistent);
        if (badge) awarded.push(badge);
      }
    }
  }

  return awarded;
}

/**
 * Check all automatic badges for a member
 * Called after activity changes or periodically
 */
export function checkAllBadges(memberId: string): Badge[] {
  const tenureBadges = checkTenureBadges(memberId);
  const activityBadges = checkActivityBadges(memberId);
  return [...tenureBadges, ...activityBadges];
}

/**
 * Check if member qualifies for role upgrades based on badges/activity
 * Returns list of role names that should be assigned
 */
export function checkRoleUpgrades(memberId: string): string[] {
  const profile = getMemberProfileById(memberId);
  if (!profile || !profile.onboardingComplete) {
    return [];
  }

  const badgeCount = getMemberBadgeCount(memberId);
  const activity = getMemberActivity(memberId);
  const membershipDays = Math.floor(
    (Date.now() - profile.createdAt.getTime()) / (1000 * 60 * 60 * 24)
  );

  const roles: string[] = [];

  // Engaged role: 5+ badges OR activity balance > 200
  const qualifiesForEngaged =
    badgeCount >= ROLE_THRESHOLDS.engaged.badgeCount ||
    (activity && activity.activityBalance >= ROLE_THRESHOLDS.engaged.activityBalance);

  if (qualifiesForEngaged) {
    roles.push('engaged');
  }

  // Veteran role: 90+ days tenure
  if (membershipDays >= ROLE_THRESHOLDS.veteran.tenureDays) {
    roles.push('veteran');
  }

  // Trusted role: 10+ badges OR has Helper badge
  const hasHelperBadge = memberHasBadge(memberId, BADGE_IDS.helper);
  const qualifiesForTrusted =
    badgeCount >= ROLE_THRESHOLDS.trusted.badgeCount || hasHelperBadge;

  if (qualifiesForTrusted) {
    roles.push('trusted');
  }

  return roles;
}

/**
 * Run badge check task for all members (batch operation)
 * Called by scheduled task daily
 */
export async function runBadgeCheckTask(): Promise<{
  membersChecked: number;
  badgesAwarded: number;
  badgesByType: Record<string, number>;
}> {
  const database = getDatabase();

  // Get all onboarded members
  const members = database
    .prepare(
      `
    SELECT member_id FROM member_profiles
    WHERE onboarding_complete = 1
  `
    )
    .all() as Array<{ member_id: string }>;

  let badgesAwarded = 0;
  const badgesByType: Record<string, number> = {};

  for (const member of members) {
    const awarded = checkAllBadges(member.member_id);
    badgesAwarded += awarded.length;

    for (const badge of awarded) {
      badgesByType[badge.badgeId] = (badgesByType[badge.badgeId] ?? 0) + 1;
    }
  }

  logger.info(
    { membersChecked: members.length, badgesAwarded, badgesByType },
    'Completed badge check task'
  );

  return {
    membersChecked: members.length,
    badgesAwarded,
    badgesByType,
  };
}

/**
 * Get all available badge definitions
 */
export function getAllBadgeDefinitions(): Badge[] {
  return getAllBadges();
}

/**
 * Get badge by ID
 */
export function getBadge(badgeId: string): Badge | null {
  return getBadgeById(badgeId);
}

/**
 * Award Founding Fedaykin badge to early members
 * Called during initial onboarding for first 69 members
 */
export function checkFoundingFedaykin(memberId: string): Badge | null {
  const database = getDatabase();

  // Count total onboarded members
  const row = database
    .prepare(
      `
    SELECT COUNT(*) as count FROM member_profiles
    WHERE onboarding_complete = 1
  `
    )
    .get() as { count: number };

  // If fewer than 69 members, award the badge
  if (row.count <= 69) {
    if (!memberHasBadge(memberId, BADGE_IDS.foundingFedaykin)) {
      const result = awardBadge(memberId, BADGE_IDS.foundingFedaykin, {
        reason: `Member #${row.count} of the founding group`,
      });
      if (result) {
        return getBadgeById(BADGE_IDS.foundingFedaykin);
      }
    }
  }

  return null;
}
