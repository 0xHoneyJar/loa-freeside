/**
 * Logging Infrastructure
 *
 * Sprint 56: Shadow Mode Foundation
 * Sprint 69: Trace Context Integration
 * Sprint 75: PII Log Scrubbing (MED-2)
 *
 * Simple logging interface for packages. Uses console with
 * structured logging format until a more sophisticated solution
 * is needed.
 *
 * Now integrates with tracing infrastructure to automatically
 * include trace/span IDs in log output.
 *
 * @module packages/infrastructure/logging
 */

import { getTraceLogFields } from '../tracing/index.js';

// Export PII scrubbing utilities
export {
  PIIScrubber,
  scrubPII,
  scrubPIIObject,
  createPinoSerializer,
  createPinoHooks,
  defaultScrubber,
  DEFAULT_PII_PATTERNS,
  DEFAULT_SENSITIVE_FIELDS,
  type PIIPattern,
  type PIIScrubberConfig,
  type ScrubResult,
} from './pii-scrubber.js';

/**
 * Log level types
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Logger interface for dependency injection
 *
 * Supports two calling conventions (pino-style flexibility):
 * - `logger.info('message')` - message only
 * - `logger.info('message', { context })` - message with context
 * - `logger.info({ context }, 'message')` - context first (pino-style)
 */
export interface ILogger {
  debug(message: string, context?: Record<string, unknown>): void;
  debug(context: Record<string, unknown>, message: string): void;
  info(message: string, context?: Record<string, unknown>): void;
  info(context: Record<string, unknown>, message: string): void;
  warn(message: string, context?: Record<string, unknown>): void;
  warn(context: Record<string, unknown>, message: string): void;
  error(message: string, context?: Record<string, unknown>): void;
  error(context: Record<string, unknown>, message: string): void;
}

/**
 * Logger configuration options
 */
export interface LoggerOptions {
  /** Service name for log prefix */
  service: string;
  /** Minimum log level (default: 'info') */
  level?: LogLevel;
  /** Enable JSON output (default: false) */
  json?: boolean;
  /** Include trace context in logs (default: true) */
  includeTrace?: boolean;
}

/**
 * Log level priority (higher = more important)
 */
const LOG_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Simple console-based logger with trace context integration
 */
class ConsoleLogger implements ILogger {
  private readonly service: string;
  private readonly minLevel: number;
  private readonly json: boolean;
  private readonly includeTrace: boolean;

  constructor(options: LoggerOptions) {
    this.service = options.service;
    this.minLevel = LOG_PRIORITY[options.level ?? 'info'];
    this.json = options.json ?? false;
    this.includeTrace = options.includeTrace ?? true;
  }

  /**
   * Parse arguments to support both calling conventions:
   * - (message: string, context?: Record)
   * - (context: Record, message: string)
   */
  private parseArgs(
    arg1: string | Record<string, unknown>,
    arg2?: string | Record<string, unknown>
  ): { message: string; context?: Record<string, unknown> } {
    if (typeof arg1 === 'string') {
      // Standard: (message, context?)
      return {
        message: arg1,
        context: arg2 as Record<string, unknown> | undefined,
      };
    } else {
      // Pino-style: (context, message)
      return {
        message: arg2 as string,
        context: arg1,
      };
    }
  }

  debug(arg1: string | Record<string, unknown>, arg2?: string | Record<string, unknown>): void {
    const { message, context } = this.parseArgs(arg1, arg2);
    this.log('debug', message, context);
  }

  info(arg1: string | Record<string, unknown>, arg2?: string | Record<string, unknown>): void {
    const { message, context } = this.parseArgs(arg1, arg2);
    this.log('info', message, context);
  }

  warn(arg1: string | Record<string, unknown>, arg2?: string | Record<string, unknown>): void {
    const { message, context } = this.parseArgs(arg1, arg2);
    this.log('warn', message, context);
  }

  error(arg1: string | Record<string, unknown>, arg2?: string | Record<string, unknown>): void {
    const { message, context } = this.parseArgs(arg1, arg2);
    this.log('error', message, context);
  }

  private log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>
  ): void {
    if (LOG_PRIORITY[level] < this.minLevel) {
      return;
    }

    const timestamp = new Date().toISOString();

    // Get trace context if enabled
    const traceFields = this.includeTrace ? getTraceLogFields() : {};

    if (this.json) {
      const logEntry = {
        timestamp,
        level,
        service: this.service,
        message,
        ...traceFields,
        ...context,
      };
      console.log(JSON.stringify(logEntry));
    } else {
      // Format trace ID for text output (shortened for readability)
      const traceId = traceFields.traceId;
      const tracePrefix = traceId && traceId !== 'no-trace'
        ? ` [trace:${traceId.slice(0, 8)}]`
        : '';
      const contextStr = context
        ? ` ${JSON.stringify(context)}`
        : '';
      const prefix = `[${timestamp}] [${level.toUpperCase()}] [${this.service}]${tracePrefix}`;
      console.log(`${prefix} ${message}${contextStr}`);
    }
  }
}

/**
 * Create a new logger instance
 */
export function createLogger(options: LoggerOptions): ILogger {
  return new ConsoleLogger(options);
}

/**
 * No-op logger for testing
 */
export const nullLogger: ILogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
