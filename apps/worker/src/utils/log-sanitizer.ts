/**
 * Log sanitization utilities
 *
 * Sprint SEC-2: Input Validation & Log Sanitization
 * Finding M-3: Sensitive data in logs
 * Finding M-5: Internal error details leaked
 *
 * Provides serializers and utilities to prevent sensitive data
 * from appearing in logs while maintaining debuggability.
 */

import { createHash } from 'crypto';

/**
 * Hash an identifier for logging purposes
 *
 * Preserves first 4 characters for human identification while hashing
 * the rest for privacy. Format: "1234...a1b2c3d4"
 *
 * @param id - The identifier to hash
 * @returns Hashed identifier with prefix
 */
export function hashId(id: string | null | undefined): string | null {
  if (!id || typeof id !== 'string') {
    return null;
  }

  // Keep first 4 chars for recognition, hash the rest
  const prefix = id.slice(0, 4);
  const hash = createHash('sha256').update(id).digest('hex').slice(0, 8);
  return `${prefix}...${hash}`;
}

/**
 * Completely redact a value
 *
 * @returns Redaction placeholder
 */
export function redact(): string {
  return '[REDACTED]';
}

/**
 * Truncate a string for safe logging
 *
 * @param value - The value to truncate
 * @param maxLength - Maximum length (default 100)
 * @returns Truncated string
 */
export function truncate(value: string | null | undefined, maxLength: number = 100): string | null {
  if (!value || typeof value !== 'string') {
    return null;
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...[truncated]`;
}

/**
 * Pino serializers for log sanitization
 *
 * SEC-2.5: Log sanitization serializers
 *
 * Usage in pino configuration:
 * ```typescript
 * import pino from 'pino';
 * import { logSerializers } from './utils/log-sanitizer.js';
 *
 * const logger = pino({
 *   serializers: logSerializers,
 * });
 * ```
 */
export const logSerializers = {
  // Hash user identifiers
  userId: (id: string | null | undefined): string | null => hashId(id),
  discordUserId: (id: string | null | undefined): string | null => hashId(id),

  // Hash guild identifiers
  guildId: (id: string | null | undefined): string | null => hashId(id),
  discordGuildId: (id: string | null | undefined): string | null => hashId(id),
  communityId: (id: string | null | undefined): string | null => hashId(id),

  // Hash profile identifiers
  profileId: (id: string | null | undefined): string | null => hashId(id),

  // Redact tokens and secrets
  token: (): string => redact(),
  interactionToken: (): string => redact(),
  discordToken: (): string => redact(),
  botToken: (): string => redact(),
  apiKey: (): string => redact(),
  secret: (): string => redact(),
  password: (): string => redact(),
  authorization: (): string => redact(),

  // Redact wallet addresses (privacy)
  walletAddress: (addr: string | null | undefined): string | null => {
    if (!addr || typeof addr !== 'string') return null;
    // Show first 6 and last 4 chars: 0x1234...abcd
    if (addr.length > 10) {
      return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
    }
    return hashId(addr);
  },

  // Sanitize error objects
  error: (err: unknown): Record<string, unknown> | null => sanitizeError(err),
  err: (err: unknown): Record<string, unknown> | null => sanitizeError(err),

  // Truncate large payloads
  payload: (p: unknown): unknown => {
    if (typeof p === 'string') {
      return truncate(p, 200);
    }
    if (p && typeof p === 'object') {
      return '[object]';
    }
    return p;
  },

  // Redact message content (Discord messages)
  content: (c: string | null | undefined): string | null => {
    if (!c || typeof c !== 'string') return null;
    return truncate(c, 50);
  },
};

/**
 * Sanitize an error for safe logging
 *
 * SEC-2.7: Error sanitization utility
 *
 * Extracts only safe properties from errors to prevent
 * leaking internal implementation details, file paths,
 * or sensitive data in stack traces.
 *
 * @param error - The error to sanitize
 * @returns Sanitized error object
 */
export function sanitizeError(error: unknown): Record<string, unknown> | null {
  if (!error) {
    return null;
  }

  // Handle Error objects
  if (error instanceof Error) {
    const sanitized: Record<string, unknown> = {
      name: error.name,
      message: sanitizeErrorMessage(error.message),
    };

    // Include code if present (e.g., Node.js error codes)
    if ('code' in error && typeof error.code === 'string') {
      sanitized['code'] = error.code;
    }

    // Include HTTP status if present
    if ('status' in error && typeof error.status === 'number') {
      sanitized['status'] = error.status;
    }

    if ('statusCode' in error && typeof error.statusCode === 'number') {
      sanitized['statusCode'] = error.statusCode;
    }

    // Include stack trace only in development
    if (process.env['NODE_ENV'] === 'development' && error.stack) {
      sanitized['stack'] = sanitizeStackTrace(error.stack);
    }

    return sanitized;
  }

  // Handle string errors
  if (typeof error === 'string') {
    return {
      message: sanitizeErrorMessage(error),
    };
  }

  // Handle object errors
  if (typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};

    // Copy only safe properties
    const safeProps = ['name', 'message', 'code', 'status', 'statusCode', 'type'];
    for (const prop of safeProps) {
      if (prop in obj && (typeof obj[prop] === 'string' || typeof obj[prop] === 'number')) {
        sanitized[prop] = prop === 'message' ? sanitizeErrorMessage(String(obj[prop])) : obj[prop];
      }
    }

    return Object.keys(sanitized).length > 0 ? sanitized : { type: 'unknown' };
  }

  return { type: typeof error };
}

/**
 * Sanitize an error message to remove sensitive content
 *
 * @param message - The error message to sanitize
 * @returns Sanitized message
 */
function sanitizeErrorMessage(message: string): string {
  if (!message || typeof message !== 'string') {
    return 'Unknown error';
  }

  // Patterns that might contain sensitive data
  const sensitivePatterns = [
    // File paths
    /\/home\/[^\s]+/g,
    /\/Users\/[^\s]+/g,
    /C:\\Users\\[^\s]+/g,
    // Connection strings
    /postgres:\/\/[^\s]+/gi,
    /redis:\/\/[^\s]+/gi,
    /mongodb:\/\/[^\s]+/gi,
    /amqp:\/\/[^\s]+/gi,
    /nats:\/\/[^\s]+/gi,
    // API keys and tokens
    /Bearer\s+[A-Za-z0-9\-._~+\/]+=*/gi,
    /sk_[a-zA-Z0-9]+/gi,
    /pk_[a-zA-Z0-9]+/gi,
    /api[_-]?key[=:]\s*[^\s]+/gi,
    // IP addresses
    /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    // Discord tokens (base64 encoded)
    /[A-Za-z0-9]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}/g,
  ];

  let sanitized = message;
  for (const pattern of sensitivePatterns) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }

  // Truncate long messages
  return truncate(sanitized, 500) ?? 'Unknown error';
}

/**
 * Sanitize a stack trace to remove sensitive paths
 *
 * @param stack - The stack trace to sanitize
 * @returns Sanitized stack trace
 */
function sanitizeStackTrace(stack: string): string {
  if (!stack || typeof stack !== 'string') {
    return '';
  }

  // Remove home directory paths
  let sanitized = stack
    .replace(/\/home\/[^/]+\//g, '/~/')
    .replace(/\/Users\/[^/]+\//g, '/~/')
    .replace(/C:\\Users\\[^\\]+\\/gi, 'C:\\~\\');

  // Truncate to reasonable length
  const lines = sanitized.split('\n').slice(0, 10);
  return lines.join('\n');
}

/**
 * Create a child logger with sanitized context
 *
 * Use this instead of logger.child() when adding context
 * that might contain sensitive data.
 *
 * @param logger - The parent logger
 * @param context - Context object to sanitize
 * @returns Child logger with sanitized context
 */
export function createSafeChildLogger<T extends { child: (bindings: Record<string, unknown>) => T }>(
  logger: T,
  context: Record<string, unknown>
): T {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(context)) {
    // Apply serializers based on key name
    if (key in logSerializers) {
      const serializer = logSerializers[key as keyof typeof logSerializers];
      sanitized[key] = typeof serializer === 'function' ? serializer(value as string) : value;
    } else {
      sanitized[key] = value;
    }
  }

  return logger.child(sanitized);
}

/**
 * Safe logging helper that ensures sensitive fields are sanitized
 *
 * @param obj - Object to log
 * @returns Sanitized object
 */
export function sanitizeLogObject(obj: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Check if this key has a serializer
    if (key in logSerializers) {
      const serializer = logSerializers[key as keyof typeof logSerializers];
      sanitized[key] = typeof serializer === 'function' ? serializer(value as string) : value;
    } else if (key.toLowerCase().includes('token') || key.toLowerCase().includes('secret')) {
      // Catch-all for token/secret fields
      sanitized[key] = redact();
    } else if (key.toLowerCase().includes('password') || key.toLowerCase().includes('credential')) {
      sanitized[key] = redact();
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
