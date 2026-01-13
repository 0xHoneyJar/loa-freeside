/**
 * Discord Module Barrel Export
 *
 * Re-exports all Discord sub-modules for clean imports.
 */

// Constants and utilities
export { COLORS, truncateAddress, formatBGT, chunkString } from './constants.js';

// Handlers
export { handleInteraction, handleAutocomplete, setupEventHandlers } from './handlers/index.js';

// Operations
export {
  getMemberById,
  assignRole,
  removeRole,
  findMemberByWallet,
  getBotChannel,
  getTextChannel,
  sendDMWithFallback,
  notifyBadgeAwarded,
  postToChannel,
} from './operations/index.js';

// Embeds
export {
  buildLeaderboardEmbed,
  buildDepartureAnnouncementEmbed,
  buildNaibDemotionAnnouncementEmbed,
  buildNaibPromotionAnnouncementEmbed,
  buildNewEligibleAnnouncementEmbed,
  buildRemovalDMEmbed,
  buildNaibDemotionDMEmbed,
  buildNaibPromotionDMEmbed,
} from './embeds/index.js';

// Processors
export { processEligibilityChanges } from './processors/index.js';
