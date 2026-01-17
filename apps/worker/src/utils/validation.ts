/**
 * Input validation utilities
 *
 * Sprint SEC-2: Input Validation & Log Sanitization
 * Finding M-2: User inputs lack validation
 *
 * Provides validation functions for all user-provided inputs to prevent
 * injection attacks, data corruption, and resource exhaustion.
 */

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  sanitized?: string;
}

/**
 * Validation options
 */
export interface ValidationOptions {
  /** Allow empty/null values (returns valid with sanitized='') */
  allowEmpty?: boolean;
  /** Custom max length (overrides default) */
  maxLength?: number;
}

// Constants for validation limits
export const VALIDATION_LIMITS = {
  NYM_MAX_LENGTH: 32,
  BADGE_ID_MAX_LENGTH: 64,
  BADGE_NAME_MAX_LENGTH: 100,
  QUERY_MAX_LENGTH: 100,
  REASON_MAX_LENGTH: 500,
  BIO_MAX_LENGTH: 500,
  GENERIC_MAX_LENGTH: 200,
} as const;

// Character patterns
const NYM_PATTERN = /^[a-zA-Z0-9_\-\s.]+$/;
const BADGE_ID_PATTERN = /^[a-zA-Z0-9_\-]+$/;
const SAFE_TEXT_PATTERN = /^[\p{L}\p{N}\p{P}\p{S}\p{Z}]+$/u;

/**
 * Validate a nym (member display name)
 *
 * SEC-2.2: Nym validation with length and character whitelist
 *
 * @param nym - The nym to validate
 * @param options - Validation options
 * @returns ValidationResult with sanitized value if valid
 */
export function validateNym(
  nym: string | undefined | null,
  options: ValidationOptions = {}
): ValidationResult {
  const { allowEmpty = false, maxLength = VALIDATION_LIMITS.NYM_MAX_LENGTH } = options;

  // Handle null/undefined
  if (nym === null || nym === undefined) {
    if (allowEmpty) {
      return { valid: true, sanitized: '' };
    }
    return { valid: false, error: 'Nym is required' };
  }

  // Type check
  if (typeof nym !== 'string') {
    return { valid: false, error: 'Nym must be a string' };
  }

  // Trim whitespace
  const trimmed = nym.trim();

  // Check empty
  if (trimmed.length === 0) {
    if (allowEmpty) {
      return { valid: true, sanitized: '' };
    }
    return { valid: false, error: 'Nym cannot be empty' };
  }

  // Check length
  if (trimmed.length > maxLength) {
    return {
      valid: false,
      error: `Nym must be ${maxLength} characters or less`,
    };
  }

  // Check character whitelist (alphanumeric, underscore, hyphen, space, period)
  if (!NYM_PATTERN.test(trimmed)) {
    return {
      valid: false,
      error: 'Nym contains invalid characters. Only letters, numbers, spaces, underscores, hyphens, and periods are allowed.',
    };
  }

  // Unicode normalization check
  const normalized = trimmed.normalize('NFC');
  if (trimmed !== normalized) {
    return {
      valid: false,
      error: 'Nym contains invalid unicode sequences',
    };
  }

  return { valid: true, sanitized: normalized };
}

/**
 * Validate a badge ID
 *
 * SEC-2.3: Badge ID validation
 *
 * @param badgeId - The badge ID to validate
 * @param options - Validation options
 * @returns ValidationResult with sanitized value if valid
 */
export function validateBadgeId(
  badgeId: string | undefined | null,
  options: ValidationOptions = {}
): ValidationResult {
  const { allowEmpty = false, maxLength = VALIDATION_LIMITS.BADGE_ID_MAX_LENGTH } = options;

  // Handle null/undefined
  if (badgeId === null || badgeId === undefined) {
    if (allowEmpty) {
      return { valid: true, sanitized: '' };
    }
    return { valid: false, error: 'Badge ID is required' };
  }

  // Type check
  if (typeof badgeId !== 'string') {
    return { valid: false, error: 'Badge ID must be a string' };
  }

  // Trim whitespace
  const trimmed = badgeId.trim();

  // Check empty
  if (trimmed.length === 0) {
    if (allowEmpty) {
      return { valid: true, sanitized: '' };
    }
    return { valid: false, error: 'Badge ID cannot be empty' };
  }

  // Check length
  if (trimmed.length > maxLength) {
    return {
      valid: false,
      error: `Badge ID must be ${maxLength} characters or less`,
    };
  }

  // Check character whitelist (alphanumeric, underscore, hyphen only)
  if (!BADGE_ID_PATTERN.test(trimmed)) {
    return {
      valid: false,
      error: 'Badge ID contains invalid characters. Only letters, numbers, underscores, and hyphens are allowed.',
    };
  }

  return { valid: true, sanitized: trimmed };
}

/**
 * Validate a badge name (display name)
 *
 * SEC-2.3: Badge name validation
 *
 * @param name - The badge name to validate
 * @param options - Validation options
 * @returns ValidationResult with sanitized value if valid
 */
export function validateBadgeName(
  name: string | undefined | null,
  options: ValidationOptions = {}
): ValidationResult {
  const { allowEmpty = false, maxLength = VALIDATION_LIMITS.BADGE_NAME_MAX_LENGTH } = options;

  // Handle null/undefined
  if (name === null || name === undefined) {
    if (allowEmpty) {
      return { valid: true, sanitized: '' };
    }
    return { valid: false, error: 'Badge name is required' };
  }

  // Type check
  if (typeof name !== 'string') {
    return { valid: false, error: 'Badge name must be a string' };
  }

  // Trim whitespace
  const trimmed = name.trim();

  // Check empty
  if (trimmed.length === 0) {
    if (allowEmpty) {
      return { valid: true, sanitized: '' };
    }
    return { valid: false, error: 'Badge name cannot be empty' };
  }

  // Check length
  if (trimmed.length > maxLength) {
    return {
      valid: false,
      error: `Badge name must be ${maxLength} characters or less`,
    };
  }

  // Unicode normalization
  const normalized = trimmed.normalize('NFC');

  // Check for safe text (letters, numbers, punctuation, symbols, whitespace in any language)
  if (!SAFE_TEXT_PATTERN.test(normalized)) {
    return {
      valid: false,
      error: 'Badge name contains invalid characters',
    };
  }

  return { valid: true, sanitized: normalized };
}

/**
 * Validate a query/search string (autocomplete, search inputs)
 *
 * SEC-2.4: Query parameter validation
 *
 * @param query - The query string to validate
 * @param options - Validation options
 * @returns ValidationResult with sanitized value if valid
 */
export function validateQuery(
  query: string | undefined | null,
  options: ValidationOptions = {}
): ValidationResult {
  const { allowEmpty = true, maxLength = VALIDATION_LIMITS.QUERY_MAX_LENGTH } = options;

  // Handle null/undefined - queries are often optional
  if (query === null || query === undefined) {
    return { valid: true, sanitized: '' };
  }

  // Type check
  if (typeof query !== 'string') {
    return { valid: false, error: 'Query must be a string' };
  }

  // Check length first (before any processing)
  if (query.length > maxLength) {
    return {
      valid: false,
      error: `Query must be ${maxLength} characters or less`,
    };
  }

  // Trim whitespace
  const trimmed = query.trim();

  // Check empty
  if (trimmed.length === 0) {
    if (allowEmpty) {
      return { valid: true, sanitized: '' };
    }
    return { valid: false, error: 'Query cannot be empty' };
  }

  // Unicode normalization
  const normalized = trimmed.normalize('NFC');

  // Remove SQL wildcards that could affect LIKE queries
  // This is defense-in-depth - parameterized queries should handle this
  const sanitized = normalized
    .replace(/%/g, '')   // Remove SQL LIKE wildcard
    .replace(/_/g, ' '); // Replace underscore with space (SQL single-char wildcard)

  return { valid: true, sanitized };
}

/**
 * Validate a reason/text field (admin actions, reports)
 *
 * @param reason - The reason text to validate
 * @param options - Validation options
 * @returns ValidationResult with sanitized value if valid
 */
export function validateReason(
  reason: string | undefined | null,
  options: ValidationOptions = {}
): ValidationResult {
  const { allowEmpty = false, maxLength = VALIDATION_LIMITS.REASON_MAX_LENGTH } = options;

  // Handle null/undefined
  if (reason === null || reason === undefined) {
    if (allowEmpty) {
      return { valid: true, sanitized: '' };
    }
    return { valid: false, error: 'Reason is required' };
  }

  // Type check
  if (typeof reason !== 'string') {
    return { valid: false, error: 'Reason must be a string' };
  }

  // Trim whitespace
  const trimmed = reason.trim();

  // Check empty
  if (trimmed.length === 0) {
    if (allowEmpty) {
      return { valid: true, sanitized: '' };
    }
    return { valid: false, error: 'Reason cannot be empty' };
  }

  // Check length
  if (trimmed.length > maxLength) {
    return {
      valid: false,
      error: `Reason must be ${maxLength} characters or less`,
    };
  }

  // Unicode normalization
  const normalized = trimmed.normalize('NFC');

  // Check for safe text
  if (!SAFE_TEXT_PATTERN.test(normalized)) {
    return {
      valid: false,
      error: 'Reason contains invalid characters',
    };
  }

  return { valid: true, sanitized: normalized };
}

/**
 * Validate a bio/description field
 *
 * @param bio - The bio text to validate
 * @param options - Validation options
 * @returns ValidationResult with sanitized value if valid
 */
export function validateBio(
  bio: string | undefined | null,
  options: ValidationOptions = {}
): ValidationResult {
  const { allowEmpty = true, maxLength = VALIDATION_LIMITS.BIO_MAX_LENGTH } = options;

  // Handle null/undefined - bios are often optional
  if (bio === null || bio === undefined) {
    return { valid: true, sanitized: '' };
  }

  // Type check
  if (typeof bio !== 'string') {
    return { valid: false, error: 'Bio must be a string' };
  }

  // Trim whitespace
  const trimmed = bio.trim();

  // Check empty
  if (trimmed.length === 0) {
    if (allowEmpty) {
      return { valid: true, sanitized: '' };
    }
    return { valid: false, error: 'Bio cannot be empty' };
  }

  // Check length
  if (trimmed.length > maxLength) {
    return {
      valid: false,
      error: `Bio must be ${maxLength} characters or less`,
    };
  }

  // Unicode normalization
  const normalized = trimmed.normalize('NFC');

  return { valid: true, sanitized: normalized };
}

/**
 * Validate a Discord snowflake ID (user ID, guild ID, etc.)
 *
 * Discord snowflakes are 64-bit integers represented as strings.
 *
 * @param id - The snowflake ID to validate
 * @param fieldName - Name of the field for error messages
 * @returns ValidationResult
 */
export function validateSnowflake(
  id: string | undefined | null,
  fieldName: string = 'ID'
): ValidationResult {
  // Handle null/undefined
  if (id === null || id === undefined) {
    return { valid: false, error: `${fieldName} is required` };
  }

  // Type check
  if (typeof id !== 'string') {
    return { valid: false, error: `${fieldName} must be a string` };
  }

  // Discord snowflakes are numeric strings, 17-20 characters
  if (!/^\d{17,20}$/.test(id)) {
    return { valid: false, error: `${fieldName} is not a valid Discord ID` };
  }

  // Verify it's a valid 64-bit integer
  try {
    const num = BigInt(id);
    // Discord epoch is 2015-01-01, so IDs should be > 0
    if (num <= 0n) {
      return { valid: false, error: `${fieldName} is not a valid Discord ID` };
    }
  } catch {
    return { valid: false, error: `${fieldName} is not a valid Discord ID` };
  }

  return { valid: true, sanitized: id };
}

/**
 * Validate and sanitize generic text input
 *
 * @param text - The text to validate
 * @param fieldName - Name of the field for error messages
 * @param options - Validation options
 * @returns ValidationResult with sanitized value if valid
 */
export function validateText(
  text: string | undefined | null,
  fieldName: string = 'Text',
  options: ValidationOptions = {}
): ValidationResult {
  const { allowEmpty = false, maxLength = VALIDATION_LIMITS.GENERIC_MAX_LENGTH } = options;

  // Handle null/undefined
  if (text === null || text === undefined) {
    if (allowEmpty) {
      return { valid: true, sanitized: '' };
    }
    return { valid: false, error: `${fieldName} is required` };
  }

  // Type check
  if (typeof text !== 'string') {
    return { valid: false, error: `${fieldName} must be a string` };
  }

  // Trim whitespace
  const trimmed = text.trim();

  // Check empty
  if (trimmed.length === 0) {
    if (allowEmpty) {
      return { valid: true, sanitized: '' };
    }
    return { valid: false, error: `${fieldName} cannot be empty` };
  }

  // Check length
  if (trimmed.length > maxLength) {
    return {
      valid: false,
      error: `${fieldName} must be ${maxLength} characters or less`,
    };
  }

  // Unicode normalization
  const normalized = trimmed.normalize('NFC');

  return { valid: true, sanitized: normalized };
}
