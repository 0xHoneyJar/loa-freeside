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
// TTY Detection & Color Control (Sprint 88: CLI Best Practices)
// =============================================================================

/**
 * Determines if colors should be used in output
 *
 * Checks environment variables and TTY status per clig.dev guidelines:
 * - NO_COLOR env var set → no color
 * - TERM=dumb → no color
 * - stdout is not a TTY → no color
 *
 * @see https://clig.dev/ "Disable color if NO_COLOR env var is set"
 * @returns true if colors should be used
 */
export function shouldUseColor(): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.TERM === 'dumb') return false;
  if (!process.stdout.isTTY) return false;
  return true;
}

/**
 * Determines if the terminal supports interactive features
 *
 * Used to decide whether to show spinners, prompts, etc.
 *
 * @returns true if running in an interactive TTY
 */
export function isInteractive(): boolean {
  return process.stdout.isTTY === true;
}

/**
 * Determines if stdin is available for prompts
 *
 * @returns true if stdin is a TTY (can accept user input)
 */
export function canPrompt(): boolean {
  return process.stdin.isTTY === true;
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

// =============================================================================
// Next-Step Suggestions (Sprint 148: CLI Ergonomics)
// =============================================================================

import chalk from 'chalk';

/**
 * Shows a next-step suggestion to the user
 *
 * Respects quiet mode and JSON output mode - only shows in interactive mode.
 *
 * @param nextCommand - The suggested next command to run
 * @param description - Brief description of what the command does
 * @param options - Command options (checks json and quiet flags)
 */
export function showNextStep(
  nextCommand: string,
  description: string,
  options: { json?: boolean; quiet?: boolean }
): void {
  // Skip suggestions in JSON or quiet mode
  if (options.json || options.quiet) {
    return;
  }

  // Only show in interactive TTY
  if (!isInteractive()) {
    return;
  }

  console.log();
  console.log(chalk.dim('Next step:'));
  console.log(`  ${chalk.cyan(nextCommand)}  ${chalk.dim(`- ${description}`)}`);
}
