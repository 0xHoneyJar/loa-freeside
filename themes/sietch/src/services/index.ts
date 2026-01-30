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

// Sprint 9: Directory & Leaderboard
export { directoryService } from './directory.js';
export { leaderboardService } from './leaderboard.js';

// Sprint 10: Role Management
export {
  syncMemberRoles,
  assignOnboardedRole,
  runRoleSyncTask,
  onBadgeAwarded,
  onActivityUpdated,
  isDynamicRolesEnabled,
  // Sprint 11: Naib role management
  assignNaibRole,
  assignFormerNaibRole,
  removeNaibRole,
  isNaibRolesConfigured,
  isFormerNaibRoleConfigured,
  // Sprint 12: Taqwa role management
  assignTaqwaRole,
  removeTaqwaRole,
  isTaqwaRoleConfigured,
  // Sprint 16: Tier role management
  syncTierRole,
  assignTierRolesUpTo,
  removeAllTierRoles,
  isTierRolesConfigured,
  getUnconfiguredTierRoles,
} from './roleManager.js';

// Sprint 10: Member Migration
export {
  getPendingMigrationMembers,
  sendMigrationPrompt,
  runMigrationPromptTask,
  getMigrationStatus,
} from './memberMigration.js';

// Sprint 11: Naib Dynamics
export { naibService } from './naib.js';

// Sprint 12: Cave Entrance (Threshold & Waitlist)
export { thresholdService } from './threshold.js';

// Sprint 13: Notification System
export { notificationService } from './notification.js';

// Sprint 15: Tier System
export {
  tierService,
  TIER_THRESHOLDS,
  TIER_ORDER,
  TIER_INFO,
} from './TierService.js';

// Sprint 17: Water Sharer Badge System
export {
  canShare,
  shareBadge,
  getShareStatus,
  getShareStatusByDiscordId,
  getGrantsByGranter,
  revokeGrant,
  getBadgeLineage,
  listAllActiveGrants,
  getGrantById,
  WATER_SHARER_ERRORS,
} from './WaterSharerService.js';

// Sprint 19: Stats & Leaderboard
export { statsService } from './StatsService.js';
export type { TierProgressionEntry } from './StatsService.js';

// Sprint 20: Weekly Digest
export { digestService } from './DigestService.js';
export type { WeeklyStats, DigestPostResult } from './DigestService.js';

// Sprint 21: Story Fragments & Analytics
export { storyService } from './StoryService.js';
export { analyticsService } from './AnalyticsService.js';
export type { StoryFragment, FragmentCategory } from './StoryService.js';
export type { CommunityAnalytics } from './AnalyticsService.js';

// Sprint 23: Billing Services (v5.0 - Paddle Migration)
export { createBillingProvider, webhookService, gatekeeperService } from './billing/index.js';

// Sprint 140: Authentication Services (Gom Jabbar)
export {
  // UserService
  UserService,
  UserServiceError,
  getUserService,
  resetUserService,
  // AuthService
  AuthService,
  getAuthService,
  resetAuthService,
  // Types
  type CreateUserInput,
  type CreateUserResult,
  type UpdateUserInput,
  type ChangePasswordInput,
  type ResetPasswordResult,
  type UserServiceConfig,
  type ActorContext,
  type LoginRequest,
  type LoginResult,
  type SessionValidationResult,
  type AuthContext,
  type AuthServiceConfig,
} from './auth/index.js';

// Sprint 176: Global User Registry
export {
  // Service
  UserRegistryService,
  setUserRegistryDb,
  getUserRegistryService,
  isUserRegistryServiceInitialized,
  // Recovery
  recoverIdentityAtTimestamp,
  rebuildIdentityFromEvents,
  verifyIdentityIntegrity,
  // Types
  IdentityEventType,
  type EventSource,
  type IdentityStatus,
  type WalletStatus,
  type CreateIdentityParams,
  type VerifyWalletParams,
  type SuspendIdentityParams,
  type RestoreIdentityParams,
  type ListUsersParams,
  type PaginatedResult,
  type IdentityWithWallets,
  type IdentityEventRecord,
  type RecoveredIdentityState,
  // Errors
  UserRegistryError,
  IdentityNotFoundError,
  WalletAlreadyLinkedError,
  IdentityAlreadyExistsError,
  IdentitySuspendedError,
} from './user-registry/index.js';
