/**
 * Database Queries Barrel Export
 *
 * Re-exports all query modules for backward compatibility.
 * Extracted from queries.ts as part of Sprint 54 code organization refactor.
 *
 * @module db/queries
 */

// =============================================================================
// Eligibility Snapshot Queries
// =============================================================================
export {
  saveEligibilitySnapshot,
  getLatestEligibilitySnapshot,
  getEligibilityByAddress,
  getCurrentEligibility,
} from './eligibility-queries.js';

// =============================================================================
// Health Status Queries
// =============================================================================
export {
  getHealthStatus,
  updateHealthStatusSuccess,
  updateHealthStatusFailure,
  enterGracePeriod,
  exitGracePeriod,
} from './health-queries.js';

// =============================================================================
// Admin Override Queries
// =============================================================================
export {
  createAdminOverride,
  getActiveAdminOverrides,
  deactivateAdminOverride,
} from './admin-queries.js';

// =============================================================================
// Audit Log Queries
// =============================================================================
export {
  logAuditEvent,
  getAuditLog,
} from './audit-queries.js';

// =============================================================================
// Wallet Mapping Queries
// =============================================================================
export {
  saveWalletMapping,
  getWalletByDiscordId,
  getDiscordIdByWallet,
  deleteWalletMapping,
} from './wallet-queries.js';

// =============================================================================
// Maintenance & Event Cache Queries
// =============================================================================
export {
  cleanupOldSnapshots,
  getLastSyncedBlock,
  updateLastSyncedBlock,
  saveCachedClaimEvents,
  saveCachedBurnEvents,
  getCachedClaimEvents,
  getCachedBurnEvents,
  clearEventCache,
} from './maintenance-queries.js';

// Re-export types from maintenance
export type { CachedClaimEvent, CachedBurnEvent } from './maintenance-queries.js';

// =============================================================================
// Member Profile Queries (Social Layer v2.0)
// =============================================================================
export {
  createMemberProfile,
  getMemberProfileById,
  getMemberProfileByDiscordId,
  getMemberProfileByNym,
  isNymAvailable,
  updateMemberProfile,
  deleteMemberProfile,
  calculateTenureCategory,
  getPublicProfile,
} from './profile-queries.js';

// =============================================================================
// Badge Queries (Social Layer v2.0)
// =============================================================================
export {
  getAllBadges,
  getBadgeById,
  getBadgesByCategory,
  getMemberBadges,
  memberHasBadge,
  awardBadge,
  revokeBadge,
  getMemberBadgeCount,
} from './badge-queries.js';

// =============================================================================
// Member Activity Queries (Social Layer v2.0)
// =============================================================================
export {
  getMemberActivity,
  applyActivityDecay,
  addActivityPoints,
  getActivityLeaderboard,
} from './activity-queries.js';

// =============================================================================
// Directory Queries (Social Layer v2.0)
// =============================================================================
export {
  getBatchMemberBadges,
  getMemberDirectory,
  getMemberCount,
  getMemberCountByTier,
  searchMembersByNym,
} from './directory-queries.js';

// =============================================================================
// Naib Seat Queries (v2.1 - Sprint 11)
// =============================================================================
export {
  initNaibThresholdSchema,
  insertNaibSeat,
  getNaibSeatById,
  updateNaibSeat,
  getCurrentNaibSeats,
  getActiveSeatByMember,
  getNaibSeatsByMember,
  countActiveNaibSeats,
  getNextAvailableSeatNumber,
  getLowestBgtNaibSeat,
  updateMemberFormerNaibStatus,
  getFormerNaibMembers,
  hasAnyNaibSeatsEver,
  getTotalNaibMembersEver,
  getNaibSeatHistory,
  getMemberCurrentBgt,
  getMemberEligibilityRank,
} from './naib-queries.js';

// =============================================================================
// Waitlist Registration Queries (Sprint 12: Cave Entrance)
// =============================================================================
export {
  insertWaitlistRegistration,
  getWaitlistRegistrationByDiscord,
  getWaitlistRegistrationByWallet,
  updateWaitlistNotified,
  deleteWaitlistRegistration,
  getActiveWaitlistRegistrations,
  getAllActiveWaitlistRegistrations,
  isWalletAssociatedWithMember,
} from './waitlist-queries.js';

// =============================================================================
// Threshold Snapshot Queries (Sprint 12: Cave Entrance)
// =============================================================================
export {
  insertThresholdSnapshot,
  getLatestThresholdSnapshot,
  getThresholdSnapshots,
  getWaitlistPositions,
  getEntryThresholdBgt,
  getWalletPosition,
} from './threshold-queries.js';

// =============================================================================
// Notification Preferences Queries (Sprint 13: Notification System)
// =============================================================================
export {
  getNotificationPreferences,
  upsertNotificationPreferences,
  incrementAlertCounter,
  resetWeeklyAlertCounters,
  getMembersForPositionAlerts,
  getMembersForAtRiskAlerts,
  getNotificationPreferencesStats,
} from './notification-queries.js';

// =============================================================================
// Alert History Queries (Sprint 13: Notification System)
// =============================================================================
export {
  insertAlertRecord,
  updateAlertDeliveryStatus,
  getAlertHistory,
  countAlertsThisWeek,
  getAlertStats,
  getRecentAlerts,
} from './notification-queries.js';

// =============================================================================
// Tier System Queries (v3.0 - Sprint 15: Tier Foundation)
// =============================================================================
export {
  updateMemberTier,
  insertTierHistory,
  getTierHistory,
  getRecentTierChanges,
  getTierDistribution,
  getTierChangesInDateRange,
  countTierPromotions,
  getMembersByTier,
} from './tier-queries.js';

// =============================================================================
// User Management Queries (Sprint 139: Gom Jabbar)
// =============================================================================
export {
  // User CRUD
  createUser,
  getUserById,
  getUserByUsername,
  listUsers,
  updateUser,
  updateUserPassword,
  updateLastLogin,
  deleteUser,
  // Session Management
  createSession,
  getSessionById,
  getSessionByTokenHash,
  getActiveSession,
  getUserSessions,
  updateSessionActivity,
  revokeSession,
  revokeAllUserSessions,
  cleanupExpiredSessions,
  // Audit Logging
  logUserAuditEvent,
  queryUserAuditLog,
  getRecentLoginFailures,
  // Rate Limiting
  getRateLimitStatus,
  recordFailedLogin,
  clearRateLimit,
  isRateLimited,
  cleanupOldRateLimits,
} from './user-queries.js';

// Re-export user types
export type {
  User,
  UserPublic,
  UserSession,
  UserAuditEntry,
  LoginRateLimit,
  UserRole,
  SessionType,
  AuditAction,
  AuditMetadata,
  CreateUserInput,
  UpdateUserInput,
  ChangePasswordInput,
  ResetPasswordInput,
  LoginInput,
  LoginResult,
  ListUsersQuery,
  AuditLogQuery,
  PaginatedResult,
} from '../types/user.types.js';

// =============================================================================
// Theme Builder Queries (Sprint 1 - WYSIWYG Theme Builder)
// =============================================================================
export {
  // Theme CRUD
  createTheme,
  getThemeById,
  getThemesByCommunity,
  listThemes,
  updateTheme,
  updateThemeConfig,
  publishTheme,
  unpublishTheme,
  deleteTheme,
  // Theme Versions
  getThemeVersions,
  getThemeVersion,
  rollbackTheme,
  // Theme Audit Log
  getThemeAuditLog,
  getAuditLogByActor,
  // Utilities
  themeExists,
  communityHasThemes,
  getPublishedTheme,
  countThemesByStatus,
} from './theme-queries.js';
