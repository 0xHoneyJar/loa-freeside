/**
 * Discord Input Validation Schemas (Sprint 74 - HIGH-3)
 *
 * Zod schemas for validating all Discord command and modal inputs.
 * Protects against:
 * - XSS attacks via malicious input
 * - Control character injection
 * - Path traversal attempts
 * - ReDoS via crafted inputs
 * - Excessive length inputs
 *
 * @security All Discord inputs MUST be validated through these schemas
 * @see https://owasp.org/www-community/attacks/Input_Validation
 */

import { z } from 'zod';

// =============================================================================
// Constants
// =============================================================================

/**
 * Blocked patterns for security
 */
const BLOCKED_PATTERNS = {
  // Path traversal attempts
  pathTraversal: /\.\.[\/\\]/,
  // Control characters (except newline/tab in bios)
  controlChars: /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/,
  // HTML/Script injection
  scriptInjection: /<script[^>]*>|<\/script>|javascript:|on\w+\s*=/i,
  // SQL injection common patterns
  sqlInjection: /(['"]?\s*(OR|AND)\s+['"]?\d+['"]?\s*=\s*['"]?\d+['"]?|;\s*(DROP|DELETE|UPDATE|INSERT|SELECT)\s)/i,
};

/**
 * Reserved nym patterns that cannot be used
 */
const RESERVED_NYMS = new Set([
  'admin',
  'administrator',
  'mod',
  'moderator',
  'system',
  'sietch',
  'naib',
  'fedaykin',
  'fremen',
  'muaddib',
  'bot',
  'official',
  'support',
  'help',
  'staff',
  'root',
  'superuser',
  'null',
  'undefined',
  'api',
  'webhook',
]);

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if string contains path traversal attempts
 */
function hasPathTraversal(value: string): boolean {
  return BLOCKED_PATTERNS.pathTraversal.test(value);
}

/**
 * Check if string contains dangerous control characters
 */
function hasControlChars(value: string): boolean {
  return BLOCKED_PATTERNS.controlChars.test(value);
}

/**
 * Check if string contains script injection attempts
 */
function hasScriptInjection(value: string): boolean {
  return BLOCKED_PATTERNS.scriptInjection.test(value);
}

/**
 * Strip dangerous characters from input (for bio/description fields)
 */
export function sanitizeText(value: string): string {
  // Remove control characters (except newlines for multi-line fields)
  let sanitized = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '');
  return sanitized.trim();
}

/**
 * Strip all HTML entities and tags
 */
export function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/&[a-z]+;/gi, '') // Remove HTML entities
    .replace(/&#\d+;/g, ''); // Remove numeric HTML entities
}

// =============================================================================
// Base Schemas
// =============================================================================

/**
 * Discord User ID schema (snowflake format)
 * Discord IDs are 17-19 digit snowflakes
 */
export const discordUserIdSchema = z
  .string()
  .regex(/^\d{17,19}$/, 'Invalid Discord user ID format')
  .describe('Discord user ID (snowflake)');

/**
 * Discord Guild ID schema (snowflake format)
 */
export const discordGuildIdSchema = z
  .string()
  .regex(/^\d{17,19}$/, 'Invalid Discord guild ID format')
  .describe('Discord guild ID (snowflake)');

/**
 * Discord Channel ID schema (snowflake format)
 */
export const discordChannelIdSchema = z
  .string()
  .regex(/^\d{17,19}$/, 'Invalid Discord channel ID format')
  .describe('Discord channel ID (snowflake)');

/**
 * Discord Role ID schema (snowflake format)
 */
export const discordRoleIdSchema = z
  .string()
  .regex(/^\d{17,19}$/, 'Invalid Discord role ID format')
  .describe('Discord role ID (snowflake)');

/**
 * UUID v4 schema
 */
export const uuidSchema = z
  .string()
  .uuid('Invalid UUID format')
  .describe('UUID v4 identifier');

// =============================================================================
// Nym (Pseudonym) Schema
// =============================================================================

/**
 * Nym validation schema
 *
 * Rules:
 * - 3-32 characters (matching sprint requirement)
 * - Alphanumeric, underscore, hyphen only
 * - Cannot start or end with underscore/hyphen
 * - Case-insensitive uniqueness (checked at database level)
 * - No reserved words
 * - No path traversal or injection attempts
 *
 * @security Validates against XSS, injection, and reserved word attacks
 */
export const nymSchema = z
  .string()
  .min(3, 'Nym must be at least 3 characters')
  .max(32, 'Nym must be at most 32 characters')
  .regex(
    /^[a-zA-Z][a-zA-Z0-9_-]*[a-zA-Z0-9]$|^[a-zA-Z0-9]{1,2}$/,
    'Nym must start with a letter, be alphanumeric (can include _ or -) and cannot end with _ or -'
  )
  .refine(
    (value) => !RESERVED_NYMS.has(value.toLowerCase()),
    'This nym is reserved and cannot be used'
  )
  .refine((value) => !hasPathTraversal(value), 'Invalid characters detected')
  .refine((value) => !hasScriptInjection(value), 'Invalid characters detected')
  .describe('Member pseudonym');

// =============================================================================
// Bio (Biography) Schema
// =============================================================================

/**
 * Bio validation schema
 *
 * Rules:
 * - Max 160 characters
 * - No control characters (except newlines stripped)
 * - No script injection
 * - URLs are stripped (done at service level)
 *
 * @security Validates against XSS and control character injection
 */
export const bioSchema = z
  .string()
  .max(160, 'Bio must be at most 160 characters')
  .transform(sanitizeText)
  .refine((value) => !hasScriptInjection(value), 'Invalid content detected')
  .describe('Member biography');

/**
 * Optional bio schema (null or valid bio)
 */
export const optionalBioSchema = z
  .string()
  .max(160, 'Bio must be at most 160 characters')
  .transform(sanitizeText)
  .refine((value) => !hasScriptInjection(value), 'Invalid content detected')
  .optional()
  .nullable();

// =============================================================================
// URL Schemas
// =============================================================================

/**
 * Trusted image URL domains
 */
const TRUSTED_IMAGE_DOMAINS = [
  'cdn.discordapp.com',
  'media.discordapp.net',
  'i.imgur.com',
] as const;

/**
 * Image URL schema (for profile pictures)
 *
 * Rules:
 * - Must be valid HTTPS URL
 * - Must be from trusted domain
 * - No path traversal
 *
 * @security Only allows images from trusted CDNs
 */
export const imageUrlSchema = z
  .string()
  .url('Invalid URL format')
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'URL must use HTTPS')
  .refine((value) => {
    try {
      const url = new URL(value);
      return TRUSTED_IMAGE_DOMAINS.some((domain) => url.hostname === domain);
    } catch {
      return false;
    }
  }, `URL must be from trusted domains: ${TRUSTED_IMAGE_DOMAINS.join(', ')}`)
  .refine((value) => !hasPathTraversal(value), 'Invalid URL path')
  .describe('Image URL from trusted CDN');

/**
 * Optional image URL schema
 */
export const optionalImageUrlSchema = imageUrlSchema.optional().nullable();

// =============================================================================
// Community Onboarding Schemas
// =============================================================================

/**
 * Community name schema
 */
export const communityNameSchema = z
  .string()
  .min(2, 'Community name must be at least 2 characters')
  .max(100, 'Community name must be at most 100 characters')
  .transform(sanitizeText)
  .refine((value) => !hasScriptInjection(value), 'Invalid content detected')
  .describe('Community name');

/**
 * Community ID schema (URL-safe identifier)
 */
export const communityIdSchema = z
  .string()
  .min(2, 'Community ID must be at least 2 characters')
  .max(50, 'Community ID must be at most 50 characters')
  .regex(
    /^[a-z0-9][a-z0-9_-]*[a-z0-9]$|^[a-z0-9]$/,
    'Community ID must be lowercase alphanumeric (can include _ or -)'
  )
  .refine((value) => !hasPathTraversal(value), 'Invalid characters detected')
  .describe('Community identifier');

/**
 * Community description schema
 */
export const communityDescriptionSchema = z
  .string()
  .max(500, 'Description must be at most 500 characters')
  .transform(sanitizeText)
  .refine((value) => !hasScriptInjection(value), 'Invalid content detected')
  .describe('Community description');

// =============================================================================
// Badge Schemas
// =============================================================================

/**
 * Badge name schema
 */
export const badgeNameSchema = z
  .string()
  .min(2, 'Badge name must be at least 2 characters')
  .max(50, 'Badge name must be at most 50 characters')
  .transform(sanitizeText)
  .refine((value) => !hasScriptInjection(value), 'Invalid content detected')
  .describe('Badge name');

/**
 * Badge reason schema
 */
export const badgeReasonSchema = z
  .string()
  .max(200, 'Reason must be at most 200 characters')
  .transform(sanitizeText)
  .refine((value) => !hasScriptInjection(value), 'Invalid content detected')
  .describe('Badge award reason');

// =============================================================================
// Search and Filter Schemas
// =============================================================================

/**
 * Search query schema (prevents ReDoS)
 */
export const searchQuerySchema = z
  .string()
  .max(100, 'Search query must be at most 100 characters')
  .transform((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) // Escape regex chars
  .describe('Search query');

/**
 * Pagination limit schema
 */
export const paginationLimitSchema = z
  .number()
  .int()
  .min(1, 'Limit must be at least 1')
  .max(100, 'Limit must be at most 100')
  .default(20)
  .describe('Pagination limit');

/**
 * Pagination offset schema
 */
export const paginationOffsetSchema = z
  .number()
  .int()
  .min(0, 'Offset must be non-negative')
  .default(0)
  .describe('Pagination offset');

// =============================================================================
// Wallet Schemas
// =============================================================================

/**
 * Ethereum address schema
 */
export const ethereumAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address format')
  .transform((value) => value.toLowerCase())
  .describe('Ethereum wallet address');

// =============================================================================
// Modal Input Schemas
// =============================================================================

/**
 * Onboard wizard modal data schema
 */
export const onboardWizardModalSchema = z.object({
  communityName: communityNameSchema,
  communityDescription: communityDescriptionSchema.optional(),
});

/**
 * Profile edit modal data schema
 */
export const profileEditModalSchema = z.object({
  nym: nymSchema.optional(),
  bio: optionalBioSchema,
});

// =============================================================================
// Command Input Schemas
// =============================================================================

/**
 * Profile view command schema
 */
export const profileViewCommandSchema = z.object({
  nym: nymSchema.optional(),
});

/**
 * Badge award command schema
 */
export const badgeAwardCommandSchema = z.object({
  targetUser: discordUserIdSchema,
  badgeName: badgeNameSchema,
  reason: badgeReasonSchema.optional(),
});

/**
 * Member search command schema
 */
export const memberSearchCommandSchema = z.object({
  query: searchQuerySchema,
  limit: paginationLimitSchema.optional(),
});

// =============================================================================
// Validation Helper Functions
// =============================================================================

/**
 * Validate Discord command input with detailed error messages
 *
 * @param schema - Zod schema to validate against
 * @param data - Data to validate
 * @returns Validation result with parsed data or error message
 */
export function validateDiscordInput<T extends z.ZodType>(
  schema: T,
  data: unknown
): { success: true; data: z.infer<T> } | { success: false; error: string } {
  const result = schema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  // Format error message for Discord
  const errors = result.error.errors.map((e) => e.message).join(', ');
  return { success: false, error: errors };
}

/**
 * Create a validation middleware for Discord command options
 */
export function createDiscordValidator<T extends z.ZodType>(schema: T) {
  return (data: unknown): z.infer<T> | null => {
    const result = schema.safeParse(data);
    return result.success ? result.data : null;
  };
}

// =============================================================================
// Export Types
// =============================================================================

export type Nym = z.infer<typeof nymSchema>;
export type Bio = z.infer<typeof bioSchema>;
export type ImageUrl = z.infer<typeof imageUrlSchema>;
export type DiscordUserId = z.infer<typeof discordUserIdSchema>;
export type DiscordGuildId = z.infer<typeof discordGuildIdSchema>;
export type DiscordChannelId = z.infer<typeof discordChannelIdSchema>;
export type DiscordRoleId = z.infer<typeof discordRoleIdSchema>;
export type EthereumAddress = z.infer<typeof ethereumAddressSchema>;
export type CommunityId = z.infer<typeof communityIdSchema>;
export type OnboardWizardModalData = z.infer<typeof onboardWizardModalSchema>;
export type ProfileEditModalData = z.infer<typeof profileEditModalSchema>;
