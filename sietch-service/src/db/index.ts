/**
 * Database module exports
 */

export {
  initDatabase,
  getDatabase,
  closeDatabase,
  // Eligibility
  saveEligibilitySnapshot,
  getLatestEligibilitySnapshot,
  getEligibilityByAddress,
  getCurrentEligibility,
  // Health Status
  getHealthStatus,
  updateHealthStatusSuccess,
  updateHealthStatusFailure,
  enterGracePeriod,
  exitGracePeriod,
  // Admin Overrides
  createAdminOverride,
  getActiveAdminOverrides,
  deactivateAdminOverride,
  // Audit Log
  logAuditEvent,
  getAuditLog,
  // Wallet Mappings
  saveWalletMapping,
  getWalletByDiscordId,
  getDiscordIdByWallet,
  deleteWalletMapping,
  // Maintenance
  cleanupOldSnapshots,
  // Member Profiles (Social Layer v2.0)
  createMemberProfile,
  getMemberProfileById,
  getMemberProfileByDiscordId,
  getMemberProfileByNym,
  updateMemberProfile,
  deleteMemberProfile,
  isNymAvailable,
  getPublicProfile,
  calculateTenureCategory,
  // Badges (Social Layer v2.0)
  getAllBadges,
  getBadgeById,
  getBadgesByCategory,
  getMemberBadges,
  memberHasBadge,
  awardBadge,
  revokeBadge,
  getMemberBadgeCount,
  // Activity (Social Layer v2.0)
  getMemberActivity,
  applyActivityDecay,
  addActivityPoints,
  getActivityLeaderboard,
  // Directory (Social Layer v2.0)
  getMemberDirectory,
  getMemberCount,
  getMemberCountByTier,
  searchMembersByNym,
  getBatchMemberBadges,
} from './queries.js';
