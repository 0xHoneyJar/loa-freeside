/**
 * Services module exports
 */

export { chainService } from './chain.js';
export { eligibilityService } from './eligibility.js';
export { discordService } from './discord.js';
export { profileService } from './profile.js';
export { avatarService } from './avatar.js';
export { onboardingService, ONBOARDING_BUTTONS, ONBOARDING_MODALS } from './onboarding.js';

// Sprint 8: Activity & Badges
export {
  recordMessage,
  recordReactionGiven,
  recordReactionReceived,
  getOwnStats,
  runDecayTask,
  cleanupRateLimitCache,
  ACTIVITY_BADGE_THRESHOLDS,
} from './activity.js';
export {
  awardBadge,
  adminAwardBadge,
  revokeBadge,
  checkTenureBadges,
  checkActivityBadges,
  checkAllBadges,
  checkRoleUpgrades,
  runBadgeCheckTask,
  getAllBadgeDefinitions,
  BADGE_IDS,
  TENURE_THRESHOLDS,
  ROLE_THRESHOLDS,
} from './badge.js';
