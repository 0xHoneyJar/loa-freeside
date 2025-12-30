/**
 * Logging Infrastructure
 *
 * Sprint 56: Shadow Mode Foundation
 *
 * Simple logging interface for packages. Uses console with
 * structured logging format until a more sophisticated solution
 * is needed.
 *
 * @module packages/infrastructure/logging
 */

/**
 * Log level types
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Logger interface for dependency injection
 */
export interface ILogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
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
 * Simple console-based logger
 */
class ConsoleLogger implements ILogger {
  private readonly service: string;
  private readonly minLevel: number;
  private readonly json: boolean;

  constructor(options: LoggerOptions) {
    this.service = options.service;
    this.minLevel = LOG_PRIORITY[options.level ?? 'info'];
    this.json = options.json ?? false;
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
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

    if (this.json) {
      const logEntry = {
        timestamp,
        level,
        service: this.service,
        message,
        ...context,
      };
      console.log(JSON.stringify(logEntry));
    } else {
      const contextStr = context
        ? ` ${JSON.stringify(context)}`
        : '';
      const prefix = `[${timestamp}] [${level.toUpperCase()}] [${this.service}]`;
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
