import pino from 'pino';
import {
  PIIScrubber,
  createPinoSerializer,
} from '../packages/infrastructure/logging/pii-scrubber.js';

const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';
const ENABLE_PII_SCRUBBING = process.env.DISABLE_PII_SCRUBBING !== 'true';

/**
 * PII scrubber instance for log sanitization
 *
 * Sprint 75: MED-2 - PII log scrubbing
 */
const piiScrubber = new PIIScrubber({
  enabled: ENABLE_PII_SCRUBBING,
  warnOnScrub: process.env.NODE_ENV === 'development',
});

/**
 * Custom Pino serializer that scrubs PII from log objects
 */
const piiSerializer = createPinoSerializer(piiScrubber);

/**
 * Structured logger using pino
 *
 * Configuration:
 * - LOG_LEVEL environment variable controls verbosity (trace, debug, info, warn, error, fatal)
 * - ISO timestamps for consistent time formatting
 * - JSON format for structured logging
 * - PII scrubbing enabled by default (disable with DISABLE_PII_SCRUBBING=true)
 *
 * Sprint 75: MED-2 - PII log scrubbing
 * - Wallet addresses are redacted (0x[WALLET_REDACTED])
 * - Discord IDs are redacted ([DISCORD_ID])
 * - Email addresses are redacted ([EMAIL_REDACTED])
 * - IP addresses are redacted ([IP_REDACTED])
 * - API keys and tokens are redacted
 */
export const logger = pino({
  level: LOG_LEVEL,
  formatters: {
    level: (label) => ({ level: label }),
    // Custom bindings formatter to scrub PII from all log context
    bindings: (bindings) => {
      return ENABLE_PII_SCRUBBING ? piiScrubber.scrubObject(bindings) : bindings;
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Redact sensitive fields if they accidentally get logged
  redact: {
    paths: [
      '*.password',
      '*.token',
      '*.secret',
      '*.apiKey',
      '*.api_key',
      '*.privateKey',
      '*.private_key',
      '*.authorization',
      '*.cookie',
      '*.session',
      '*.creditCard',
      '*.ssn',
    ],
    censor: '[REDACTED]',
  },
  // Custom serializers for request/response objects
  serializers: {
    req: piiSerializer,
    res: piiSerializer,
    err: piiSerializer,
  },
  // Custom hook to scrub PII from log messages
  hooks: {
    logMethod(inputArgs, method) {
      if (!ENABLE_PII_SCRUBBING) {
        return method.apply(this, inputArgs);
      }

      // Scrub string arguments (log messages)
      const scrubbedArgs = inputArgs.map((arg) => {
        if (typeof arg === 'string') {
          return piiScrubber.scrub(arg);
        }
        if (typeof arg === 'object' && arg !== null) {
          return piiScrubber.scrubObject(arg);
        }
        return arg;
      }) as Parameters<pino.LogFn>;

      return method.apply(this, scrubbedArgs);
    },
  },
});

/**
 * Create a child logger with additional context
 *
 * @param bindings - Additional context to include in all log entries
 * @returns Child logger instance
 */
export function createChildLogger(bindings: Record<string, unknown>) {
  // Scrub PII from bindings before creating child logger
  const scrubbedBindings = ENABLE_PII_SCRUBBING
    ? piiScrubber.scrubObject(bindings)
    : bindings;
  return logger.child(scrubbedBindings);
}

/**
 * Export the PII scrubber for use in other modules
 */
export { piiScrubber };
