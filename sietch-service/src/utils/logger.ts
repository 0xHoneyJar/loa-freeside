import pino from 'pino';

const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';

/**
 * Structured logger using pino
 *
 * Configuration:
 * - LOG_LEVEL environment variable controls verbosity (trace, debug, info, warn, error, fatal)
 * - ISO timestamps for consistent time formatting
 * - JSON format for structured logging
 * - No PII or sensitive data should be logged
 */
export const logger = pino({
  level: LOG_LEVEL,
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Redact sensitive fields if they accidentally get logged
  redact: {
    paths: ['*.password', '*.token', '*.secret', '*.apiKey', '*.privateKey'],
    censor: '[REDACTED]',
  },
});

/**
 * Create a child logger with additional context
 */
export function createChildLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
