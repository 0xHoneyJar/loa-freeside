/**
 * PII Log Scrubbing Utility
 *
 * Sprint 75: MED-2 - Logger statements include PII without redaction
 *
 * Provides utilities to redact Personally Identifiable Information (PII)
 * from log messages before they are persisted. This ensures compliance
 * with GDPR, CCPA, and SOC 2 requirements.
 *
 * Redacted PII Types:
 * - Ethereum wallet addresses (0x...)
 * - Discord user IDs (17-19 digit snowflakes)
 * - Email addresses
 * - IP addresses (IPv4 and IPv6)
 * - API keys (sk_, pk_, api_ prefixes)
 * - JWT tokens (Bearer tokens)
 *
 * @module packages/infrastructure/logging/pii-scrubber
 */

// =============================================================================
// Types
// =============================================================================

/**
 * PII pattern configuration
 */
export interface PIIPattern {
  /** Regex pattern to match PII */
  pattern: RegExp;
  /** Replacement string */
  replacement: string;
  /** Human-readable description */
  description: string;
}

/**
 * Scrubber configuration options
 */
export interface PIIScrubberConfig {
  /** Enable/disable scrubbing (useful for development) */
  enabled?: boolean;
  /** Additional custom patterns */
  customPatterns?: PIIPattern[];
  /** Fields to completely redact (no partial match) */
  sensitiveFields?: string[];
  /** Log level for scrubbing warnings */
  warnOnScrub?: boolean;
}

/**
 * Scrub result with metadata
 */
export interface ScrubResult {
  /** Scrubbed value */
  value: string;
  /** Whether any PII was found */
  scrubbed: boolean;
  /** Types of PII found */
  piiTypesFound: string[];
}

// =============================================================================
// Default PII Patterns
// =============================================================================

/**
 * Standard PII patterns for log scrubbing
 *
 * Order matters: More specific patterns should come before general ones.
 */
export const DEFAULT_PII_PATTERNS: PIIPattern[] = [
  // Ethereum wallet addresses (40 hex chars after 0x)
  {
    pattern: /0x[a-fA-F0-9]{40}/g,
    replacement: '0x[WALLET_REDACTED]',
    description: 'Ethereum wallet address',
  },
  // Discord user IDs (17-19 digit snowflakes)
  // More strict to avoid matching random numbers
  {
    pattern: /(?<![0-9])\d{17,19}(?![0-9])/g,
    replacement: '[DISCORD_ID]',
    description: 'Discord snowflake ID',
  },
  // Email addresses
  {
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: '[EMAIL_REDACTED]',
    description: 'Email address',
  },
  // IPv4 addresses
  {
    pattern: /(?<![0-9])(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?![0-9])/g,
    replacement: '[IP_REDACTED]',
    description: 'IPv4 address',
  },
  // IPv6 addresses (simplified pattern)
  {
    pattern: /(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}/g,
    replacement: '[IPV6_REDACTED]',
    description: 'IPv6 address',
  },
  // API keys with common prefixes
  {
    pattern: /(?:sk_|pk_|api_|key_)[a-zA-Z0-9_-]{20,}/g,
    replacement: '[API_KEY_REDACTED]',
    description: 'API key',
  },
  // Bearer tokens (JWT-like)
  {
    pattern: /Bearer\s+[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/gi,
    replacement: 'Bearer [TOKEN_REDACTED]',
    description: 'Bearer token',
  },
  // Generic JWT tokens
  {
    pattern: /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g,
    replacement: '[JWT_REDACTED]',
    description: 'JWT token',
  },
  // Note: Phone numbers and credit cards removed - too aggressive for web3 context
  // and would match version numbers, counts, and other numeric data.
  // If needed, add more specific patterns based on actual data formats.
];

/**
 * Fields that should be completely redacted if present
 */
export const DEFAULT_SENSITIVE_FIELDS = [
  'password',
  'secret',
  'token',
  'apiKey',
  'api_key',
  'privateKey',
  'private_key',
  'authorization',
  'cookie',
  'session',
  'creditCard',
  'credit_card',
  'ssn',
  'socialSecurityNumber',
];

// =============================================================================
// PIIScrubber Class
// =============================================================================

/**
 * PII Scrubber for log sanitization
 *
 * @example
 * ```typescript
 * const scrubber = new PIIScrubber();
 *
 * // Scrub a string
 * const clean = scrubber.scrub('User 0x1234...abcd logged in');
 * // Output: 'User 0x[WALLET_REDACTED] logged in'
 *
 * // Scrub an object (deep)
 * const cleanObj = scrubber.scrubObject({
 *   userId: '123456789012345678',
 *   wallet: '0xabcdef1234567890abcdef1234567890abcdef12'
 * });
 * ```
 */
export class PIIScrubber {
  private readonly patterns: PIIPattern[];
  private readonly sensitiveFields: Set<string>;
  private readonly enabled: boolean;
  private readonly warnOnScrub: boolean;

  constructor(config: PIIScrubberConfig = {}) {
    this.enabled = config.enabled ?? true;
    this.warnOnScrub = config.warnOnScrub ?? false;
    this.patterns = [...DEFAULT_PII_PATTERNS, ...(config.customPatterns ?? [])];
    this.sensitiveFields = new Set([
      ...DEFAULT_SENSITIVE_FIELDS,
      ...(config.sensitiveFields ?? []),
    ].map((f) => f.toLowerCase()));
  }

  /**
   * Scrub PII from a string
   *
   * @param input - String to scrub
   * @returns Scrubbed string
   */
  scrub(input: string): string {
    if (!this.enabled || !input) {
      return input;
    }

    let result = input;

    for (const { pattern, replacement } of this.patterns) {
      // Create new regex instance to reset lastIndex
      const regex = new RegExp(pattern.source, pattern.flags);
      result = result.replace(regex, replacement);
    }

    return result;
  }

  /**
   * Scrub PII from a string with metadata
   *
   * @param input - String to scrub
   * @returns Scrub result with metadata
   */
  scrubWithMetadata(input: string): ScrubResult {
    if (!this.enabled || !input) {
      return { value: input, scrubbed: false, piiTypesFound: [] };
    }

    let result = input;
    const piiTypesFound: string[] = [];

    for (const { pattern, replacement, description } of this.patterns) {
      const regex = new RegExp(pattern.source, pattern.flags);
      if (regex.test(input)) {
        piiTypesFound.push(description);
        // Reset regex for replacement
        const replaceRegex = new RegExp(pattern.source, pattern.flags);
        result = result.replace(replaceRegex, replacement);
      }
    }

    const scrubbed = piiTypesFound.length > 0;

    if (scrubbed && this.warnOnScrub) {
      console.warn('[PIIScrubber] PII detected and scrubbed:', piiTypesFound.join(', '));
    }

    return { value: result, scrubbed, piiTypesFound };
  }

  /**
   * Scrub PII from an object (deep)
   *
   * Recursively traverses objects and arrays to scrub all string values.
   * Also completely redacts sensitive fields.
   *
   * @param obj - Object to scrub
   * @returns Scrubbed object (new object, original unchanged)
   */
  scrubObject<T>(obj: T): T {
    if (!this.enabled) {
      return obj;
    }

    return this.deepScrub(obj) as T;
  }

  /**
   * Check if a field name is sensitive (should be fully redacted)
   */
  isSensitiveField(fieldName: string): boolean {
    return this.sensitiveFields.has(fieldName.toLowerCase());
  }

  /**
   * Deep scrub implementation
   */
  private deepScrub(value: unknown, fieldName?: string): unknown {
    // Check if field should be completely redacted
    if (fieldName && this.isSensitiveField(fieldName)) {
      return '[REDACTED]';
    }

    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === 'string') {
      return this.scrub(value);
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.deepScrub(item));
    }

    if (typeof value === 'object') {
      const scrubbed: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        scrubbed[key] = this.deepScrub(val, key);
      }
      return scrubbed;
    }

    // Numbers, booleans, etc. pass through unchanged
    return value;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

/**
 * Default PII scrubber instance
 *
 * Use this for most cases. Create a custom instance only if you need
 * different configuration.
 */
export const defaultScrubber = new PIIScrubber();

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Scrub PII from a string using the default scrubber
 *
 * @param input - String to scrub
 * @returns Scrubbed string
 */
export function scrubPII(input: string): string {
  return defaultScrubber.scrub(input);
}

/**
 * Scrub PII from an object using the default scrubber
 *
 * @param obj - Object to scrub
 * @returns Scrubbed object
 */
export function scrubPIIObject<T>(obj: T): T {
  return defaultScrubber.scrubObject(obj);
}

/**
 * Create a Pino serializer that scrubs PII
 *
 * @param scrubber - Optional custom scrubber instance
 * @returns Pino serializer function
 *
 * @example
 * ```typescript
 * import pino from 'pino';
 * import { createPinoSerializer } from './pii-scrubber';
 *
 * const logger = pino({
 *   serializers: {
 *     req: createPinoSerializer(),
 *     res: createPinoSerializer(),
 *   }
 * });
 * ```
 */
export function createPinoSerializer(scrubber: PIIScrubber = defaultScrubber) {
  return (obj: unknown) => scrubber.scrubObject(obj);
}

// =============================================================================
// Pino Hook for Automatic Scrubbing
// =============================================================================

/**
 * Create a Pino hooks configuration for automatic PII scrubbing
 *
 * This hooks into Pino's logging pipeline to scrub PII from all log messages.
 *
 * @param scrubber - Optional custom scrubber instance
 * @returns Pino hooks configuration
 *
 * @example
 * ```typescript
 * import pino from 'pino';
 * import { createPinoHooks } from './pii-scrubber';
 *
 * const logger = pino({
 *   hooks: createPinoHooks()
 * });
 * ```
 */
export function createPinoHooks(scrubber: PIIScrubber = defaultScrubber) {
  return {
    logMethod(
      this: pino.Logger,
      inputArgs: Parameters<pino.LogFn>,
      method: pino.LogFn
    ) {
      // Scrub all string arguments
      const scrubbedArgs = inputArgs.map((arg) => {
        if (typeof arg === 'string') {
          return scrubber.scrub(arg);
        }
        if (typeof arg === 'object' && arg !== null) {
          return scrubber.scrubObject(arg);
        }
        return arg;
      });

      return method.apply(this, scrubbedArgs as Parameters<pino.LogFn>);
    },
  };
}

// Type import for Pino (runtime optional)
import type pino from 'pino';
