/**
 * Input Sanitization Utilities (Sprint 74 - HIGH-3)
 *
 * Provides comprehensive input sanitization to protect against:
 * - XSS (Cross-Site Scripting) attacks
 * - Control character injection
 * - Path traversal attacks
 * - SQL injection patterns
 * - ReDoS (Regular Expression Denial of Service)
 *
 * @security All user inputs should be sanitized before use
 * @see https://owasp.org/www-community/attacks/xss/
 */

// =============================================================================
// Constants
// =============================================================================

/**
 * Control characters that should be stripped (except allowed whitespace)
 * - 0x00-0x08: C0 control characters
 * - 0x0B: Vertical tab
 * - 0x0C: Form feed
 * - 0x0E-0x1F: More C0 controls
 * - 0x7F: DEL character
 *
 * Note: Use functions instead of regex with /g flag to avoid state issues
 */
function getControlCharRegex(): RegExp {
  return /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
}

/**
 * HTML tags pattern (including self-closing)
 */
function getHtmlTagRegex(): RegExp {
  return /<[^>]*>/g;
}

/**
 * HTML entities (named and numeric)
 */
function getHtmlEntityRegex(): RegExp {
  return /&(?:[a-z]+|#\d+|#x[a-f0-9]+);/gi;
}

/**
 * URL patterns for stripping
 */
function getUrlRegex(): RegExp {
  return /https?:\/\/[^\s]+/gi;
}

/**
 * Path traversal patterns (supports both forward and back slashes)
 */
function getPathTraversalRegex(): RegExp {
  return /\.\.[/\\]/g;
}

/**
 * Characters that need escaping for use in regex
 */
const REGEX_SPECIAL_CHARS = /[.*+?^${}()|[\]\\]/g;

/**
 * Potentially dangerous script patterns
 */
const SCRIPT_PATTERNS = [
  /<script[^>]*>/i,
  /<\/script>/i,
  /javascript:/i,
  /on\w+\s*=/i,
  /data:\s*text\/html/i,
  /vbscript:/i,
];

/**
 * SQL injection patterns (common attack vectors)
 */
const SQL_INJECTION_PATTERNS = [
  /'\s*(OR|AND)\s+'?\d+'\s*=\s*'?\d+/i,
  /;\s*(DROP|DELETE|UPDATE|INSERT|SELECT|UNION)\s/i,
  /--\s*$/,
  /\/\*.*\*\//,
];

// =============================================================================
// Core Sanitization Functions
// =============================================================================

/**
 * Remove control characters from string
 *
 * Strips C0 control characters except:
 * - 0x09 (tab) - often intentional
 * - 0x0A (newline) - often intentional
 * - 0x0D (carriage return) - often intentional
 *
 * @param input - String to sanitize
 * @returns Sanitized string with control characters removed
 */
export function stripControlChars(input: string): string {
  return input.replace(getControlCharRegex(), '');
}

/**
 * Remove all HTML tags from string
 *
 * @param input - String potentially containing HTML
 * @returns String with all HTML tags removed
 */
export function stripHtmlTags(input: string): string {
  return input.replace(getHtmlTagRegex(), '');
}

/**
 * Remove HTML entities from string
 *
 * @param input - String potentially containing HTML entities
 * @returns String with entities removed
 */
export function stripHtmlEntities(input: string): string {
  return input.replace(getHtmlEntityRegex(), '');
}

/**
 * Remove URLs from string
 *
 * @param input - String potentially containing URLs
 * @param replacement - Optional replacement string (default: '[link removed]')
 * @returns String with URLs replaced
 */
export function stripUrls(input: string, replacement = '[link removed]'): string {
  return input.replace(getUrlRegex(), replacement);
}

/**
 * Remove path traversal sequences from string
 *
 * @param input - String potentially containing path traversal
 * @returns Sanitized string
 */
export function stripPathTraversal(input: string): string {
  return input.replace(getPathTraversalRegex(), '');
}

/**
 * Escape regex special characters for safe use in RegExp
 *
 * Prevents ReDoS attacks by escaping characters that have special
 * meaning in regular expressions.
 *
 * @param input - String to be used in regex
 * @returns Escaped string safe for regex use
 */
export function escapeRegex(input: string): string {
  return input.replace(REGEX_SPECIAL_CHARS, '\\$&');
}

/**
 * Escape HTML entities for safe display
 *
 * Converts potentially dangerous characters to HTML entities:
 * - & -> &amp;
 * - < -> &lt;
 * - > -> &gt;
 * - " -> &quot;
 * - ' -> &#x27;
 * - / -> &#x2F;
 *
 * @param input - String to escape
 * @returns HTML-escaped string
 */
export function escapeHtml(input: string): string {
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
  };

  return input.replace(/[&<>"'/]/g, (char) => htmlEscapes[char] || char);
}

// =============================================================================
// Detection Functions
// =============================================================================

/**
 * Check if string contains control characters
 *
 * @param input - String to check
 * @returns True if control characters are present
 */
export function hasControlChars(input: string): boolean {
  return getControlCharRegex().test(input);
}

/**
 * Check if string contains path traversal attempts
 *
 * @param input - String to check
 * @returns True if path traversal patterns detected
 */
export function hasPathTraversal(input: string): boolean {
  return getPathTraversalRegex().test(input);
}

/**
 * Check if string contains script injection attempts
 *
 * @param input - String to check
 * @returns True if script injection patterns detected
 */
export function hasScriptInjection(input: string): boolean {
  return SCRIPT_PATTERNS.some((pattern) => pattern.test(input));
}

/**
 * Check if string contains SQL injection patterns
 *
 * Note: This is a supplementary check, not a replacement for
 * parameterized queries. Always use parameterized queries!
 *
 * @param input - String to check
 * @returns True if SQL injection patterns detected
 */
export function hasSqlInjection(input: string): boolean {
  return SQL_INJECTION_PATTERNS.some((pattern) => pattern.test(input));
}

/**
 * Check if input contains any dangerous patterns
 *
 * @param input - String to check
 * @returns Object with detection results
 */
export function detectDangerousPatterns(input: string): {
  hasControlChars: boolean;
  hasPathTraversal: boolean;
  hasScriptInjection: boolean;
  hasSqlInjection: boolean;
  isDangerous: boolean;
} {
  const results = {
    hasControlChars: hasControlChars(input),
    hasPathTraversal: hasPathTraversal(input),
    hasScriptInjection: hasScriptInjection(input),
    hasSqlInjection: hasSqlInjection(input),
    isDangerous: false,
  };

  results.isDangerous =
    results.hasControlChars ||
    results.hasPathTraversal ||
    results.hasScriptInjection ||
    results.hasSqlInjection;

  return results;
}

// =============================================================================
// Composite Sanitization Functions
// =============================================================================

/**
 * Sanitize general text input
 *
 * Applies:
 * - Control character stripping
 * - HTML tag stripping
 * - HTML entity stripping
 * - Trimming
 *
 * @param input - String to sanitize
 * @returns Sanitized string
 */
export function sanitizeText(input: string): string {
  let sanitized = input;
  sanitized = stripControlChars(sanitized);
  sanitized = stripHtmlTags(sanitized);
  sanitized = stripHtmlEntities(sanitized);
  return sanitized.trim();
}

/**
 * Sanitize bio/description text
 *
 * Applies all text sanitization plus URL removal.
 *
 * @param input - Bio text to sanitize
 * @param maxLength - Maximum length (default: 160)
 * @returns Sanitized bio
 */
export function sanitizeBio(input: string, maxLength = 160): string {
  let sanitized = sanitizeText(input);
  sanitized = stripUrls(sanitized);
  return sanitized.slice(0, maxLength).trim();
}

/**
 * Sanitize nym (pseudonym) input
 *
 * Validates against nym rules and strips dangerous characters.
 *
 * @param input - Nym to sanitize
 * @returns Sanitized nym or null if invalid
 */
export function sanitizeNym(input: string): string | null {
  // Strip control chars first
  let sanitized = stripControlChars(input);

  // Trim whitespace
  sanitized = sanitized.trim();

  // Check for dangerous patterns
  if (hasPathTraversal(sanitized) || hasScriptInjection(sanitized)) {
    return null;
  }

  // Validate format: alphanumeric with _ and -, 3-32 chars
  // Cannot start or end with _ or -
  const nymRegex = /^[a-zA-Z0-9][a-zA-Z0-9_-]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/;

  if (!nymRegex.test(sanitized)) {
    return null;
  }

  if (sanitized.length < 3 || sanitized.length > 32) {
    return null;
  }

  return sanitized;
}

/**
 * Sanitize search query to prevent ReDoS
 *
 * @param input - Search query
 * @param maxLength - Maximum length (default: 100)
 * @returns Sanitized search query safe for regex use
 */
export function sanitizeSearchQuery(input: string, maxLength = 100): string {
  let sanitized = stripControlChars(input);
  sanitized = escapeRegex(sanitized);
  return sanitized.slice(0, maxLength).trim();
}

/**
 * Sanitize file path to prevent traversal
 *
 * @param input - File path
 * @returns Sanitized path or null if dangerous
 */
export function sanitizeFilePath(input: string): string | null {
  // Strip control chars
  let sanitized = stripControlChars(input);

  // Check for path traversal
  if (hasPathTraversal(sanitized)) {
    return null;
  }

  // Remove any remaining .. sequences
  sanitized = sanitized.replace(/\.\./g, '');

  // Normalize path separators
  sanitized = sanitized.replace(/\\/g, '/');

  // Remove leading slashes (prevent absolute paths)
  sanitized = sanitized.replace(/^\/+/, '');

  return sanitized;
}

// =============================================================================
// Validation Result Types
// =============================================================================

export interface SanitizationResult {
  success: boolean;
  sanitized: string;
  warnings: string[];
}

/**
 * Full sanitization with warnings
 *
 * @param input - Input to sanitize
 * @param options - Sanitization options
 * @returns Result with sanitized string and warnings
 */
export function sanitizeWithWarnings(
  input: string,
  options: {
    stripHtml?: boolean;
    stripUrls?: boolean;
    maxLength?: number;
    escapeOutput?: boolean;
  } = {}
): SanitizationResult {
  const {
    stripHtml = true,
    stripUrls: shouldStripUrls = false,
    maxLength,
    escapeOutput = false,
  } = options;

  const warnings: string[] = [];
  let sanitized = input;

  // Check for dangerous patterns first
  const patterns = detectDangerousPatterns(input);

  if (patterns.hasControlChars) {
    warnings.push('Control characters detected and removed');
    sanitized = stripControlChars(sanitized);
  }

  if (patterns.hasPathTraversal) {
    warnings.push('Path traversal attempt detected');
    sanitized = stripPathTraversal(sanitized);
  }

  if (patterns.hasScriptInjection) {
    warnings.push('Script injection attempt detected');
  }

  if (patterns.hasSqlInjection) {
    warnings.push('SQL injection pattern detected');
  }

  // Apply requested sanitization
  if (stripHtml) {
    const beforeHtml = sanitized;
    sanitized = stripHtmlTags(sanitized);
    sanitized = stripHtmlEntities(sanitized);
    if (beforeHtml !== sanitized) {
      warnings.push('HTML content removed');
    }
  }

  if (shouldStripUrls) {
    const beforeUrls = sanitized;
    sanitized = stripUrls(sanitized);
    if (beforeUrls !== sanitized) {
      warnings.push('URLs removed');
    }
  }

  if (maxLength && sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength);
    warnings.push(`Truncated to ${maxLength} characters`);
  }

  if (escapeOutput) {
    sanitized = escapeHtml(sanitized);
  }

  sanitized = sanitized.trim();

  return {
    success: !patterns.isDangerous,
    sanitized,
    warnings,
  };
}
