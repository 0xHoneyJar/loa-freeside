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
} from './queries.js';
