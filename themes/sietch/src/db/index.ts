/**
 * Database Module Exports
 *
 * Central barrel export for all database functionality.
 * Refactored in Sprint 54 to use modular query structure.
 *
 * @module db
 */

// =============================================================================
// Connection Management
// =============================================================================
export {
  initDatabase,
  getDatabase,
  closeDatabase,
} from './connection.js';

// =============================================================================
// Domain Query Modules (Sprint 54 Refactor)
// =============================================================================

// Eligibility
export {
  saveEligibilitySnapshot,
  getLatestEligibilitySnapshot,
  getEligibilityByAddress,
  getCurrentEligibility,
} from './queries/eligibility-queries.js';

// Health Status
export {
  getHealthStatus,
  updateHealthStatusSuccess,
  updateHealthStatusFailure,
  enterGracePeriod,
  exitGracePeriod,
} from './queries/health-queries.js';

// Admin Overrides
export {
  createAdminOverride,
  getActiveAdminOverrides,
  deactivateAdminOverride,
} from './queries/admin-queries.js';

// Audit Log
export {
  logAuditEvent,
  getAuditLog,
} from './queries/audit-queries.js';

// Wallet Mappings
export {
  saveWalletMapping,
  getWalletByDiscordId,
  getDiscordIdByWallet,
  deleteWalletMapping,
} from './queries/wallet-queries.js';

// Maintenance & Event Cache
export {
  cleanupOldSnapshots,
  getLastSyncedBlock,
  updateLastSyncedBlock,
  saveCachedClaimEvents,
  saveCachedBurnEvents,
  getCachedClaimEvents,
  getCachedBurnEvents,
  clearEventCache,
} from './queries/maintenance-queries.js';

// Re-export types from maintenance
export type { CachedClaimEvent, CachedBurnEvent } from './queries/maintenance-queries.js';

// Member Profiles (Social Layer v2.0)
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
} from './queries/profile-queries.js';

// Badges (Social Layer v2.0)
export {
  getAllBadges,
  getBadgeById,
  getBadgesByCategory,
  getMemberBadges,
  memberHasBadge,
  awardBadge,
  revokeBadge,
  getMemberBadgeCount,
} from './queries/badge-queries.js';

// Activity (Social Layer v2.0)
export {
  getMemberActivity,
  applyActivityDecay,
  addActivityPoints,
  getActivityLeaderboard,
} from './queries/activity-queries.js';

// Directory (Social Layer v2.0)
export {
  getBatchMemberBadges,
  getMemberDirectory,
  getMemberCount,
  getMemberCountByTier,
  searchMembersByNym,
} from './queries/directory-queries.js';

// Naib Seats (v2.1 - Sprint 11)
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
} from './queries/naib-queries.js';

// Waitlist Registration (Sprint 12: Cave Entrance)
export {
  insertWaitlistRegistration,
  getWaitlistRegistrationByDiscord,
  getWaitlistRegistrationByWallet,
  updateWaitlistNotified,
  deleteWaitlistRegistration,
  getActiveWaitlistRegistrations,
  getAllActiveWaitlistRegistrations,
  isWalletAssociatedWithMember,
} from './queries/waitlist-queries.js';

// Threshold Snapshots (Sprint 12: Cave Entrance)
export {
  insertThresholdSnapshot,
  getLatestThresholdSnapshot,
  getThresholdSnapshots,
  getWaitlistPositions,
  getEntryThresholdBgt,
  getWalletPosition,
} from './queries/threshold-queries.js';

// Notification Preferences (Sprint 13: Notification System)
export {
  getNotificationPreferences,
  upsertNotificationPreferences,
  incrementAlertCounter,
  resetWeeklyAlertCounters,
  getMembersForPositionAlerts,
  getMembersForAtRiskAlerts,
  getNotificationPreferencesStats,
} from './queries/notification-queries.js';

// Alert History (Sprint 13: Notification System)
export {
  insertAlertRecord,
  updateAlertDeliveryStatus,
  getAlertHistory,
  countAlertsThisWeek,
  getAlertStats,
  getRecentAlerts,
} from './queries/notification-queries.js';

// Tier System (v3.0 - Sprint 15: Tier Foundation)
export {
  updateMemberTier,
  insertTierHistory,
  getTierHistory,
  getRecentTierChanges,
  getTierDistribution,
  getTierChangesInDateRange,
  countTierPromotions,
  getMembersByTier,
} from './queries/tier-queries.js';

// =============================================================================
// Billing Queries (v4.0 - Sprint 23) - Separate module, unchanged
// =============================================================================
export {
  // Subscriptions
  getSubscriptionByCommunityId,
  getSubscriptionByPaymentId,
  getSubscriptionById,
  createSubscription,
  updateSubscription,
  deleteSubscription,
  getSubscriptionsInGracePeriod,
  getExpiredGracePeriodSubscriptions,
  // Fee Waivers
  getActiveFeeWaiver,
  getFeeWaiversByCommunity,
  createFeeWaiver,
  revokeFeeWaiver,
  getAllActiveFeeWaivers,
  // Webhook Events
  isWebhookEventProcessed,
  recordWebhookEvent,
  updateWebhookEventStatus,
  getFailedWebhookEvents,
  getWebhookEvent,
  // Billing Audit
  logBillingAuditEvent,
  getBillingAuditLog,
  // Entitlements
  getEffectiveTier,
} from './billing-queries.js';

// =============================================================================
// Boost Queries (v4.0 - Sprint 28) - Separate module, unchanged
// =============================================================================
export * from './boost-queries.js';

// =============================================================================
// Badge Queries from separate file (v4.0 - Sprint 27)
// =============================================================================
export * from './badge-queries.js';

// =============================================================================
// Legacy re-export from queries.ts for backward compatibility
// Will be removed after all consumers migrate to new structure
// =============================================================================
// NOTE: The original queries.ts is kept for now but should be deleted
// once all tests pass with the new modular structure
