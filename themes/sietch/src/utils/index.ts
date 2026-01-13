/**
 * Utils module exports
 */

export { logger } from './logger.js';
export {
  processProfilePicture,
  fetchAndProcessImage,
  bufferToDataUrl,
  generatePlaceholder,
  isValidDiscordCdnUrl,
  parseDiscordCdnUrl,
  isAllowedMimeType,
  getExtensionForMimeType,
  ImageProcessingError,
  IMAGE_CONFIG,
  type ProcessedImage,
} from './image.js';
export {
  AppError,
  DiscordAPIError,
  DatabaseError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  RateLimitError,
  withRetry,
  safeExecute,
  formatUserError,
  formatApiError,
  logError,
  isRetryableError,
  DEFAULT_RETRY_CONFIG,
  type RetryConfig,
} from './errors.js';
export {
  SimpleCache,
  badgeCache,
  statsCache,
  profileCache,
  directoryCache,
  invalidateMemberCaches,
  invalidateAllCaches,
  type CacheConfig,
} from './cache.js';
export {
  SqlInjectionAttemptError,
  getPlatformDisplayColumn,
  validateBadgeSettingsColumn,
  validateSubscriptionColumn,
  buildBadgeSettingsSetClause,
  buildSubscriptionSetClause,
  BADGE_SETTINGS_COLUMNS,
  SUBSCRIPTION_UPDATE_COLUMNS,
  PLATFORM_DISPLAY_COLUMNS,
  type BadgeSettingsColumn,
  type SubscriptionUpdateColumn,
  type Platform,
} from './sql-safety.js';
// Sprint 74: Input Sanitization
export {
  stripControlChars,
  stripHtmlTags,
  stripHtmlEntities,
  stripUrls,
  stripPathTraversal,
  escapeRegex,
  escapeHtml,
  hasControlChars,
  hasPathTraversal,
  hasScriptInjection,
  hasSqlInjection,
  detectDangerousPatterns,
  sanitizeText,
  sanitizeBio,
  sanitizeNym,
  sanitizeSearchQuery,
  sanitizeFilePath,
  sanitizeWithWarnings,
  type SanitizationResult,
} from './sanitization.js';
