/**
 * Sandbox CLI Utilities
 *
 * Sprint 85: Discord Server Sandboxes - CLI Commands
 *
 * Shared utilities for sandbox CLI commands.
 *
 * @see SDD §6.0 CLI Commands
 * @module packages/cli/commands/sandbox/utils
 */

import { SandboxManager } from '@arrakis/sandbox';
import type { Logger } from 'pino';
import postgres from 'postgres';

// ms types for parse mode (string -> number)
import ms from 'ms';

// =============================================================================
// Database Connection
// =============================================================================

/**
 * Gets the database connection string from environment
 * @throws Error if DATABASE_URL is not set
 */
export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL environment variable is not set.\n' +
        'Please set it to your PostgreSQL connection string.'
    );
  }
  return url;
}

/**
 * Creates a postgres client from the environment
 */
export function createSqlClient(): ReturnType<typeof postgres> {
  return postgres(getDatabaseUrl());
}

// =============================================================================
// SandboxManager Factory
// =============================================================================

let cachedManager: SandboxManager | null = null;

/**
 * Gets a SandboxManager instance
 *
 * Caches the instance for reuse within the same process.
 * Uses environment variables for configuration.
 *
 * @param logger - Pino logger instance
 * @returns SandboxManager instance
 */
export function getSandboxManager(logger: Logger): SandboxManager {
  if (cachedManager) {
    return cachedManager;
  }

  const sql = createSqlClient();

  cachedManager = new SandboxManager({
    sql,
    logger,
    maxSandboxesPerOwner: parseInt(process.env.MAX_SANDBOXES_PER_OWNER || '5', 10),
    defaultTtlHours: parseInt(process.env.DEFAULT_TTL_HOURS || '24', 10),
    maxTtlHours: parseInt(process.env.MAX_TTL_HOURS || '168', 10),
  });

  return cachedManager;
}

/**
 * Closes the cached manager's database connection
 */
export async function closeSandboxManager(): Promise<void> {
  if (cachedManager) {
    // The manager doesn't expose close(), but we should clean up postgres
    cachedManager = null;
  }
}

// =============================================================================
// User Identity
// =============================================================================

/**
 * Gets the current developer username
 *
 * Resolution order:
 * 1. SANDBOX_OWNER environment variable
 * 2. USER environment variable
 * 3. USERNAME environment variable (Windows)
 * 4. 'unknown' as fallback
 *
 * @returns Developer username
 */
export function getCurrentUser(): string {
  return (
    process.env.SANDBOX_OWNER ||
    process.env.USER ||
    process.env.USERNAME ||
    'unknown'
  );
}

// =============================================================================
// TTL Parsing
// =============================================================================

/**
 * Default TTL in hours
 */
export const DEFAULT_TTL_HOURS = 24;

/**
 * Maximum TTL in hours (7 days)
 */
export const MAX_TTL_HOURS = 168;

/**
 * Parses a TTL string into hours
 *
 * Supports formats:
 * - Number: interpreted as hours (e.g., "24" → 24)
 * - Duration string: parsed with ms library (e.g., "7d" → 168, "48h" → 48)
 *
 * @param ttlString - TTL string to parse
 * @returns TTL in hours
 * @throws Error if format is invalid or value is out of range
 *
 * @example
 * parseTTL('24')    // 24
 * parseTTL('24h')   // 24
 * parseTTL('7d')    // 168
 * parseTTL('2d')    // 48
 * parseTTL('1w')    // 168
 */
export function parseTTL(ttlString: string): number {
  // Try parsing as a plain number (hours)
  const asNumber = parseInt(ttlString, 10);
  if (!isNaN(asNumber) && String(asNumber) === ttlString) {
    return validateTTL(asNumber);
  }

  // Parse as duration string
  // Cast to any because ms types are very strict (template literal types)
  // but we want to allow any string and handle invalid input ourselves
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const milliseconds = (ms as any)(ttlString);
  if (typeof milliseconds !== 'number' || isNaN(milliseconds)) {
    throw new Error(
      `Invalid TTL format: "${ttlString}". ` +
        'Use hours (e.g., "24") or duration (e.g., "24h", "7d").'
    );
  }

  // Convert to hours
  const hours = Math.ceil(milliseconds / (1000 * 60 * 60));
  return validateTTL(hours);
}

/**
 * Validates TTL is within acceptable range
 *
 * @param hours - TTL in hours
 * @returns Validated hours
 * @throws Error if value is out of range
 */
function validateTTL(hours: number): number {
  if (hours < 1) {
    throw new Error('TTL must be at least 1 hour.');
  }
  if (hours > MAX_TTL_HOURS) {
    throw new Error(`TTL cannot exceed ${MAX_TTL_HOURS} hours (7 days).`);
  }
  return hours;
}

// =============================================================================
// Output Formatting
// =============================================================================

/**
 * Formats a date for display
 *
 * @param date - Date to format
 * @returns Formatted date string (ISO 8601)
 */
export function formatDate(date: Date | null): string {
  if (!date) {
    return '-';
  }
  return date.toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * Formats a duration in a human-readable way
 *
 * @param milliseconds - Duration in milliseconds
 * @returns Human-readable duration (e.g., "2h 30m")
 */
export function formatDuration(milliseconds: number): string {
  if (milliseconds < 0) {
    return 'expired';
  }

  const hours = Math.floor(milliseconds / (1000 * 60 * 60));
  const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

/**
 * Calculates time until a date
 *
 * @param date - Target date
 * @returns Milliseconds until date (negative if past)
 */
export function timeUntil(date: Date): number {
  return date.getTime() - Date.now();
}

// =============================================================================
// Error Handling
// =============================================================================

/**
 * Handles errors in CLI commands
 *
 * @param error - Error to handle
 * @param json - Whether to output as JSON
 */
export function handleError(error: unknown, json: boolean = false): never {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string }).code;

  if (json) {
    console.log(
      JSON.stringify(
        {
          success: false,
          error: {
            message,
            code: code || 'UNKNOWN',
          },
        },
        null,
        2
      )
    );
  } else {
    console.error(`Error: ${message}`);
    if (code) {
      console.error(`Code: ${code}`);
    }
  }

  process.exit(1);
}

// =============================================================================
// Silent Logger
// =============================================================================

/**
 * Creates a silent logger for CLI usage
 *
 * Returns a logger that discards all output except errors,
 * useful for clean CLI output.
 */
export function createSilentLogger(): Logger {
  return {
    info: () => {},
    warn: () => {},
    error: console.error,
    debug: () => {},
    trace: () => {},
    fatal: console.error,
    child: function () {
      return this;
    },
    level: 'silent',
  } as unknown as Logger;
}
