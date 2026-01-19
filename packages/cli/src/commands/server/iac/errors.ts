/**
 * Gaib CLI Error Hierarchy
 *
 * Sprint 101: Polish & Documentation
 *
 * Comprehensive error types for better error handling and recovery.
 * All errors extend GaibError with error codes and recoverable flags.
 *
 * @see SDD §6.0 CLI Commands
 * @module packages/cli/commands/server/iac/errors
 */

// ============================================================================
// Error Codes
// ============================================================================

/**
 * Error code categories:
 * - CONFIG_*: Configuration errors (1xxx)
 * - STATE_*: State management errors (2xxx)
 * - DISCORD_*: Discord API errors (3xxx)
 * - VALIDATION_*: Validation errors (4xxx)
 * - WORKSPACE_*: Workspace errors (5xxx)
 * - THEME_*: Theme errors (6xxx)
 * - BACKEND_*: Backend storage errors (7xxx)
 */
export const ErrorCodes = {
  // Configuration errors (1xxx)
  CONFIG_NOT_FOUND: 'E1001',
  CONFIG_PARSE_ERROR: 'E1002',
  CONFIG_VALIDATION_ERROR: 'E1003',
  CONFIG_SCHEMA_ERROR: 'E1004',

  // State errors (2xxx)
  STATE_NOT_FOUND: 'E2001',
  STATE_LOCKED: 'E2002',
  STATE_CORRUPT: 'E2003',
  STATE_LINEAGE_MISMATCH: 'E2004',
  STATE_SERIAL_MISMATCH: 'E2005',
  STATE_RESOURCE_NOT_FOUND: 'E2006',

  // Discord API errors (3xxx)
  DISCORD_UNAUTHORIZED: 'E3001',
  DISCORD_FORBIDDEN: 'E3002',
  DISCORD_NOT_FOUND: 'E3003',
  DISCORD_RATE_LIMITED: 'E3004',
  DISCORD_SERVER_ERROR: 'E3005',
  DISCORD_NETWORK_ERROR: 'E3006',
  DISCORD_INVALID_TOKEN: 'E3007',
  DISCORD_MISSING_PERMISSIONS: 'E3008',

  // Validation errors (4xxx)
  VALIDATION_GUILD_ID: 'E4001',
  VALIDATION_RESOURCE_NAME: 'E4002',
  VALIDATION_ADDRESS_FORMAT: 'E4003',
  VALIDATION_PERMISSION_FLAG: 'E4004',
  VALIDATION_COLOR_FORMAT: 'E4005',

  // Workspace errors (5xxx)
  WORKSPACE_NOT_FOUND: 'E5001',
  WORKSPACE_ALREADY_EXISTS: 'E5002',
  WORKSPACE_NOT_EMPTY: 'E5003',
  WORKSPACE_IS_DEFAULT: 'E5004',
  WORKSPACE_IS_CURRENT: 'E5005',

  // Theme errors (6xxx)
  THEME_NOT_FOUND: 'E6001',
  THEME_MANIFEST_INVALID: 'E6002',
  THEME_VARIABLE_MISSING: 'E6003',
  THEME_VARIABLE_INVALID: 'E6004',
  THEME_FILE_NOT_FOUND: 'E6005',
  THEME_CIRCULAR_EXTENDS: 'E6006',

  // Backend errors (7xxx)
  BACKEND_CONFIG_ERROR: 'E7001',
  BACKEND_NOT_CONFIGURED: 'E7002',
  BACKEND_S3_ERROR: 'E7003',
  BACKEND_DYNAMODB_ERROR: 'E7004',
  BACKEND_LOCAL_ERROR: 'E7005',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// ============================================================================
// Base Error Class
// ============================================================================

/**
 * Base error class for all Gaib CLI errors
 *
 * Features:
 * - Unique error code for identification
 * - Recoverable flag for retry logic
 * - Cause chain for root cause analysis
 * - Suggestion text for user guidance
 */
export class GaibError extends Error {
  /** Error code for programmatic handling */
  readonly code: ErrorCode;

  /** Whether this error is recoverable (e.g., retry may succeed) */
  readonly recoverable: boolean;

  /** Suggested action for the user */
  readonly suggestion?: string;

  /** Additional details about the error */
  readonly details?: string[];

  constructor(
    message: string,
    options: {
      code: ErrorCode;
      recoverable?: boolean;
      suggestion?: string;
      details?: string[];
      cause?: Error;
    }
  ) {
    super(message, { cause: options.cause });
    this.name = 'GaibError';
    this.code = options.code;
    this.recoverable = options.recoverable ?? false;
    this.suggestion = options.suggestion;
    this.details = options.details;
  }

  /**
   * Format error for display
   */
  toDisplayString(): string {
    let output = `${this.message} [${this.code}]`;
    if (this.details && this.details.length > 0) {
      output += '\n' + this.details.map((d) => `  - ${d}`).join('\n');
    }
    if (this.suggestion) {
      output += `\n\nSuggestion: ${this.suggestion}`;
    }
    return output;
  }

  /**
   * Format error for JSON output
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      recoverable: this.recoverable,
      suggestion: this.suggestion,
      details: this.details,
      cause: this.cause instanceof Error ? this.cause.message : undefined,
    };
  }
}

// ============================================================================
// Configuration Errors
// ============================================================================

/**
 * Configuration-related errors
 */
export class ConfigError extends GaibError {
  constructor(
    message: string,
    options: {
      code?: ErrorCode;
      suggestion?: string;
      details?: string[];
      cause?: Error;
    } = {}
  ) {
    super(message, {
      code: options.code ?? ErrorCodes.CONFIG_PARSE_ERROR,
      recoverable: false,
      suggestion:
        options.suggestion ??
        'Check your configuration file for syntax errors.',
      details: options.details,
      cause: options.cause,
    });
    this.name = 'ConfigError';
  }
}

/**
 * Configuration file not found
 */
export class ConfigNotFoundError extends ConfigError {
  readonly filePath: string;

  constructor(filePath: string) {
    super(`Configuration file not found: ${filePath}`, {
      code: ErrorCodes.CONFIG_NOT_FOUND,
      suggestion:
        'Run "gaib server init" to create a configuration file, ' +
        'or specify a path with -f/--file.',
    });
    this.name = 'ConfigNotFoundError';
    this.filePath = filePath;
  }
}

/**
 * Configuration validation failed
 */
export class ConfigValidationError extends ConfigError {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Configuration validation failed`, {
      code: ErrorCodes.CONFIG_VALIDATION_ERROR,
      details: issues,
      suggestion: 'Fix the validation errors listed above.',
    });
    this.name = 'ConfigValidationError';
    this.issues = issues;
  }
}

// ============================================================================
// State Errors
// ============================================================================

/**
 * State-related errors
 */
export class StateError extends GaibError {
  constructor(
    message: string,
    options: {
      code?: ErrorCode;
      recoverable?: boolean;
      suggestion?: string;
      details?: string[];
      cause?: Error;
    } = {}
  ) {
    super(message, {
      code: options.code ?? ErrorCodes.STATE_NOT_FOUND,
      recoverable: options.recoverable ?? false,
      suggestion: options.suggestion,
      details: options.details,
      cause: options.cause,
    });
    this.name = 'StateError';
  }
}

/**
 * State is locked by another operation
 */
export class StateLockError extends StateError {
  readonly lockInfo: {
    id: string;
    who: string;
    operation: string;
    created: string;
  };

  constructor(lockInfo: {
    id: string;
    who: string;
    operation: string;
    created: string;
  }) {
    super(
      `State is locked by another operation.\n` +
        `  Lock ID: ${lockInfo.id}\n` +
        `  Held by: ${lockInfo.who}\n` +
        `  Operation: ${lockInfo.operation}\n` +
        `  Since: ${lockInfo.created}`,
      {
        code: ErrorCodes.STATE_LOCKED,
        recoverable: true,
        suggestion:
          'Wait for the other operation to complete, or run ' +
          '"gaib server force-unlock" if the lock is stale.',
      }
    );
    this.name = 'StateLockError';
    this.lockInfo = lockInfo;
  }
}

/**
 * Resource not found in state
 */
export class StateResourceNotFoundError extends StateError {
  readonly address: string;

  constructor(address: string) {
    super(`Resource not found in state: ${address}`, {
      code: ErrorCodes.STATE_RESOURCE_NOT_FOUND,
      suggestion:
        'Run "gaib server state list" to see available resources, ' +
        'or import the resource with "gaib server import".',
    });
    this.name = 'StateResourceNotFoundError';
    this.address = address;
  }
}

// ============================================================================
// Discord API Errors
// ============================================================================

/**
 * Discord API errors
 */
export class DiscordApiError extends GaibError {
  readonly statusCode?: number;
  readonly discordCode?: number;

  constructor(
    message: string,
    options: {
      code?: ErrorCode;
      statusCode?: number;
      discordCode?: number;
      recoverable?: boolean;
      suggestion?: string;
      cause?: Error;
    } = {}
  ) {
    super(message, {
      code: options.code ?? ErrorCodes.DISCORD_SERVER_ERROR,
      recoverable: options.recoverable ?? false,
      suggestion: options.suggestion,
      cause: options.cause,
    });
    this.name = 'DiscordApiError';
    this.statusCode = options.statusCode;
    this.discordCode = options.discordCode;
  }
}

/**
 * Rate limited by Discord
 */
export class RateLimitError extends DiscordApiError {
  readonly retryAfter: number;
  readonly global: boolean;

  constructor(retryAfter: number, global: boolean = false) {
    super(
      `Rate limited by Discord. Retry after ${retryAfter}ms${global ? ' (global)' : ''}.`,
      {
        code: ErrorCodes.DISCORD_RATE_LIMITED,
        statusCode: 429,
        recoverable: true,
        suggestion: `Wait ${Math.ceil(retryAfter / 1000)} seconds before retrying.`,
      }
    );
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
    this.global = global;
  }
}

/**
 * Missing permissions to perform operation
 */
export class MissingPermissionsError extends DiscordApiError {
  readonly requiredPermissions: string[];

  constructor(requiredPermissions: string[]) {
    super(
      `Bot is missing required permissions: ${requiredPermissions.join(', ')}`,
      {
        code: ErrorCodes.DISCORD_MISSING_PERMISSIONS,
        statusCode: 403,
        suggestion:
          'Ensure your bot has the required permissions in the Discord server. ' +
          'You may need to reinvite the bot with updated permissions.',
      }
    );
    this.name = 'MissingPermissionsError';
    this.requiredPermissions = requiredPermissions;
  }
}

/**
 * Invalid or expired bot token
 */
export class InvalidTokenError extends DiscordApiError {
  constructor() {
    super('Invalid or expired Discord bot token.', {
      code: ErrorCodes.DISCORD_INVALID_TOKEN,
      statusCode: 401,
      suggestion:
        'Check your DISCORD_BOT_TOKEN environment variable. ' +
        'You may need to regenerate your bot token in the Discord Developer Portal.',
    });
    this.name = 'InvalidTokenError';
  }
}

// ============================================================================
// Validation Errors
// ============================================================================

/**
 * Input validation errors
 */
export class ValidationError extends GaibError {
  readonly field: string;
  readonly value?: string;

  constructor(
    message: string,
    options: {
      code?: ErrorCode;
      field: string;
      value?: string;
      suggestion?: string;
    }
  ) {
    super(message, {
      code: options.code ?? ErrorCodes.VALIDATION_RESOURCE_NAME,
      recoverable: false,
      suggestion: options.suggestion,
    });
    this.name = 'ValidationError';
    this.field = options.field;
    this.value = options.value;
  }
}

/**
 * Invalid guild ID format
 */
export class InvalidGuildIdError extends ValidationError {
  constructor(guildId: string) {
    super(`Invalid guild ID format: "${guildId}"`, {
      code: ErrorCodes.VALIDATION_GUILD_ID,
      field: 'guildId',
      value: guildId,
      suggestion:
        'Guild IDs are 17-19 digit numbers. ' +
        'Example: 123456789012345678',
    });
    this.name = 'InvalidGuildIdError';
  }
}

/**
 * Invalid resource address format
 */
export class InvalidAddressError extends ValidationError {
  constructor(address: string) {
    super(`Invalid resource address format: "${address}"`, {
      code: ErrorCodes.VALIDATION_ADDRESS_FORMAT,
      field: 'address',
      value: address,
      suggestion:
        'Address format: <type>.<name>\n' +
        'Examples: discord_role.admin, discord_channel.general',
    });
    this.name = 'InvalidAddressError';
  }
}

// ============================================================================
// Workspace Errors
// ============================================================================

/**
 * Workspace-related errors
 */
export class WorkspaceError extends GaibError {
  readonly workspace: string;

  constructor(
    message: string,
    options: {
      code?: ErrorCode;
      workspace: string;
      suggestion?: string;
    }
  ) {
    super(message, {
      code: options.code ?? ErrorCodes.WORKSPACE_NOT_FOUND,
      recoverable: false,
      suggestion: options.suggestion,
    });
    this.name = 'WorkspaceError';
    this.workspace = options.workspace;
  }
}

/**
 * Workspace not found
 */
export class WorkspaceNotFoundError extends WorkspaceError {
  constructor(workspace: string) {
    super(`Workspace not found: "${workspace}"`, {
      code: ErrorCodes.WORKSPACE_NOT_FOUND,
      workspace,
      suggestion:
        'Run "gaib server workspace list" to see available workspaces, ' +
        'or create it with "gaib server workspace new".',
    });
    this.name = 'WorkspaceNotFoundError';
  }
}

/**
 * Workspace already exists
 */
export class WorkspaceExistsError extends WorkspaceError {
  constructor(workspace: string) {
    super(`Workspace already exists: "${workspace}"`, {
      code: ErrorCodes.WORKSPACE_ALREADY_EXISTS,
      workspace,
      suggestion:
        'Choose a different name, or switch to the existing workspace ' +
        'with "gaib server workspace select".',
    });
    this.name = 'WorkspaceExistsError';
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if an error is a GaibError
 */
export function isGaibError(error: unknown): error is GaibError {
  return error instanceof GaibError;
}

/**
 * Check if an error is recoverable
 */
export function isRecoverableError(error: unknown): boolean {
  if (error instanceof GaibError) {
    return error.recoverable;
  }
  // Network errors are generally recoverable
  if (error instanceof Error) {
    return (
      error.message.includes('ETIMEDOUT') ||
      error.message.includes('ECONNRESET') ||
      error.message.includes('ENOTFOUND')
    );
  }
  return false;
}

/**
 * Convert any error to a GaibError
 */
export function toGaibError(error: unknown): GaibError {
  if (error instanceof GaibError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? error : undefined;

  return new GaibError(message, {
    code: ErrorCodes.CONFIG_PARSE_ERROR,
    cause,
  });
}

/**
 * Extract error code from any error
 */
export function getErrorCode(error: unknown): ErrorCode | string {
  if (error instanceof GaibError) {
    return error.code;
  }
  if (error instanceof Error && 'code' in error) {
    return String(error.code);
  }
  return 'UNKNOWN';
}
