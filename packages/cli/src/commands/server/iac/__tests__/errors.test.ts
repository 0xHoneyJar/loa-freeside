/**
 * Error Hierarchy Tests
 *
 * Sprint 101: Polish & Documentation
 *
 * Unit tests for unified error hierarchy.
 *
 * @module packages/cli/commands/server/iac/__tests__/errors.test
 */

import { describe, it, expect } from 'vitest';
import {
  GaibError,
  ConfigError,
  ConfigNotFoundError,
  ConfigValidationError,
  StateError,
  StateLockError,
  StateResourceNotFoundError,
  DiscordApiError,
  RateLimitError,
  MissingPermissionsError,
  InvalidTokenError,
  ValidationError,
  InvalidGuildIdError,
  InvalidAddressError,
  WorkspaceError,
  WorkspaceNotFoundError,
  WorkspaceExistsError,
  ErrorCodes,
  isGaibError,
  isRecoverableError,
  toGaibError,
  getErrorCode,
} from '../errors.js';

describe('GaibError', () => {
  it('creates error with code, message, and recoverable status', () => {
    const error = new GaibError('Test error', {
      code: ErrorCodes.CONFIG_NOT_FOUND,
      recoverable: true,
    });

    expect(error.message).toBe('Test error');
    expect(error.code).toBe(ErrorCodes.CONFIG_NOT_FOUND);
    expect(error.recoverable).toBe(true);
    expect(error.name).toBe('GaibError');
  });

  it('supports optional suggestion', () => {
    const error = new GaibError('Test error', {
      code: ErrorCodes.CONFIG_NOT_FOUND,
      suggestion: 'Try this instead',
    });

    expect(error.suggestion).toBe('Try this instead');
  });

  it('supports optional details array', () => {
    const error = new GaibError('Test error', {
      code: ErrorCodes.CONFIG_NOT_FOUND,
      details: ['Detail 1', 'Detail 2'],
    });

    expect(error.details).toEqual(['Detail 1', 'Detail 2']);
  });

  it('toJSON returns serializable object', () => {
    const error = new GaibError('Test error', {
      code: ErrorCodes.CONFIG_NOT_FOUND,
      recoverable: true,
      suggestion: 'Suggestion',
      details: ['Detail'],
    });
    const json = error.toJSON();

    expect(json.code).toBe(ErrorCodes.CONFIG_NOT_FOUND);
    expect(json.message).toBe('Test error');
    expect(json.recoverable).toBe(true);
    expect(json.suggestion).toBe('Suggestion');
    expect(json.details).toEqual(['Detail']);
  });

  it('toDisplayString formats error for output', () => {
    const error = new GaibError('Test error', {
      code: ErrorCodes.CONFIG_NOT_FOUND,
      suggestion: 'Try this',
      details: ['Detail 1'],
    });
    const display = error.toDisplayString();

    expect(display).toContain('Test error');
    expect(display).toContain(ErrorCodes.CONFIG_NOT_FOUND);
    expect(display).toContain('Detail 1');
    expect(display).toContain('Try this');
  });
});

// ============================================================================
// Configuration Errors
// ============================================================================

describe('ConfigError', () => {
  it('creates error with default code', () => {
    const error = new ConfigError('Config error');

    expect(error.code).toBe(ErrorCodes.CONFIG_PARSE_ERROR);
    expect(error.name).toBe('ConfigError');
  });
});

describe('ConfigNotFoundError', () => {
  it('creates error with correct code and path', () => {
    const error = new ConfigNotFoundError('/path/to/config.yaml');

    expect(error.code).toBe(ErrorCodes.CONFIG_NOT_FOUND);
    expect(error.message).toContain('/path/to/config.yaml');
    expect(error.filePath).toBe('/path/to/config.yaml');
    expect(error.suggestion).toBeDefined();
  });
});

describe('ConfigValidationError', () => {
  it('creates error with validation issues', () => {
    const issues = ['roles[0].name: Required', 'channels[0].type: Invalid'];
    const error = new ConfigValidationError(issues);

    expect(error.code).toBe(ErrorCodes.CONFIG_VALIDATION_ERROR);
    expect(error.issues).toEqual(issues);
    expect(error.details).toEqual(issues);
  });
});

// ============================================================================
// State Errors
// ============================================================================

describe('StateError', () => {
  it('creates error with default code', () => {
    const error = new StateError('State error');

    expect(error.code).toBe(ErrorCodes.STATE_NOT_FOUND);
    expect(error.name).toBe('StateError');
  });
});

describe('StateLockError', () => {
  it('creates error with lock info', () => {
    const lockInfo = {
      id: 'lock-123',
      who: 'user@host',
      operation: 'apply',
      created: new Date().toISOString(),
    };
    const error = new StateLockError(lockInfo);

    expect(error.code).toBe(ErrorCodes.STATE_LOCKED);
    expect(error.message).toContain('user@host');
    expect(error.message).toContain('apply');
    expect(error.recoverable).toBe(true);
    expect(error.lockInfo).toEqual(lockInfo);
  });
});

describe('StateResourceNotFoundError', () => {
  it('creates error with resource address', () => {
    const error = new StateResourceNotFoundError('role.Admin');

    expect(error.code).toBe(ErrorCodes.STATE_RESOURCE_NOT_FOUND);
    expect(error.message).toContain('role.Admin');
    expect(error.address).toBe('role.Admin');
  });
});

// ============================================================================
// Discord API Errors
// ============================================================================

describe('DiscordApiError', () => {
  it('creates error with status and Discord code', () => {
    const error = new DiscordApiError('Missing Access', {
      statusCode: 403,
      discordCode: 50001,
    });

    expect(error.code).toBe(ErrorCodes.DISCORD_SERVER_ERROR);
    expect(error.statusCode).toBe(403);
    expect(error.discordCode).toBe(50001);
    expect(error.message).toContain('Missing Access');
  });
});

describe('RateLimitError', () => {
  it('creates error with retry after', () => {
    const error = new RateLimitError(5000);

    expect(error.code).toBe(ErrorCodes.DISCORD_RATE_LIMITED);
    expect(error.retryAfter).toBe(5000);
    expect(error.global).toBe(false);
    expect(error.recoverable).toBe(true);
  });

  it('handles global rate limit', () => {
    const error = new RateLimitError(5000, true);

    expect(error.global).toBe(true);
    expect(error.message).toContain('global');
  });
});

describe('MissingPermissionsError', () => {
  it('creates error with missing permissions list', () => {
    const error = new MissingPermissionsError(['MANAGE_ROLES', 'MANAGE_CHANNELS']);

    expect(error.code).toBe(ErrorCodes.DISCORD_MISSING_PERMISSIONS);
    expect(error.requiredPermissions).toEqual(['MANAGE_ROLES', 'MANAGE_CHANNELS']);
    expect(error.message).toContain('MANAGE_ROLES');
  });
});

describe('InvalidTokenError', () => {
  it('creates error with correct code', () => {
    const error = new InvalidTokenError();

    expect(error.code).toBe(ErrorCodes.DISCORD_INVALID_TOKEN);
    expect(error.suggestion).toBeDefined();
  });
});

// ============================================================================
// Validation Errors
// ============================================================================

describe('ValidationError', () => {
  it('creates error with field and value', () => {
    const error = new ValidationError('Invalid input', {
      field: 'name',
      value: 'bad-value',
    });

    expect(error.code).toBe(ErrorCodes.VALIDATION_RESOURCE_NAME);
    expect(error.field).toBe('name');
    expect(error.value).toBe('bad-value');
  });
});

describe('InvalidGuildIdError', () => {
  it('creates error with invalid ID', () => {
    const error = new InvalidGuildIdError('not-a-snowflake');

    expect(error.code).toBe(ErrorCodes.VALIDATION_GUILD_ID);
    expect(error.message).toContain('not-a-snowflake');
    expect(error.field).toBe('guildId');
    expect(error.value).toBe('not-a-snowflake');
  });
});

describe('InvalidAddressError', () => {
  it('creates error with invalid address', () => {
    const error = new InvalidAddressError('invalid.address.format');

    expect(error.code).toBe(ErrorCodes.VALIDATION_ADDRESS_FORMAT);
    expect(error.message).toContain('invalid.address.format');
    expect(error.field).toBe('address');
  });
});

// ============================================================================
// Workspace Errors
// ============================================================================

describe('WorkspaceError', () => {
  it('creates error with workspace name', () => {
    const error = new WorkspaceError('Workspace error', { workspace: 'test' });

    expect(error.code).toBe(ErrorCodes.WORKSPACE_NOT_FOUND);
    expect(error.workspace).toBe('test');
  });
});

describe('WorkspaceNotFoundError', () => {
  it('creates error with workspace name', () => {
    const error = new WorkspaceNotFoundError('staging');

    expect(error.code).toBe(ErrorCodes.WORKSPACE_NOT_FOUND);
    expect(error.message).toContain('staging');
    expect(error.workspace).toBe('staging');
  });
});

describe('WorkspaceExistsError', () => {
  it('creates error with workspace name', () => {
    const error = new WorkspaceExistsError('production');

    expect(error.code).toBe(ErrorCodes.WORKSPACE_ALREADY_EXISTS);
    expect(error.message).toContain('production');
    expect(error.workspace).toBe('production');
  });
});

// ============================================================================
// Utility Functions
// ============================================================================

describe('isGaibError()', () => {
  it('returns true for GaibError', () => {
    const error = new GaibError('Test', { code: ErrorCodes.CONFIG_NOT_FOUND });
    expect(isGaibError(error)).toBe(true);
  });

  it('returns true for GaibError subclasses', () => {
    const error = new ConfigNotFoundError('/path');
    expect(isGaibError(error)).toBe(true);
  });

  it('returns false for regular Error', () => {
    const error = new Error('Regular error');
    expect(isGaibError(error)).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isGaibError('string')).toBe(false);
    expect(isGaibError(null)).toBe(false);
    expect(isGaibError(undefined)).toBe(false);
  });
});

describe('isRecoverableError()', () => {
  it('returns true for recoverable GaibError', () => {
    const error = new RateLimitError(5000);
    expect(isRecoverableError(error)).toBe(true);
  });

  it('returns false for non-recoverable GaibError', () => {
    const error = new InvalidTokenError();
    expect(isRecoverableError(error)).toBe(false);
  });

  it('returns true for network timeout errors', () => {
    const error = new Error('ETIMEDOUT');
    expect(isRecoverableError(error)).toBe(true);
  });

  it('returns false for regular Error without network keywords', () => {
    const error = new Error('Something failed');
    expect(isRecoverableError(error)).toBe(false);
  });
});

describe('toGaibError()', () => {
  it('returns GaibError as-is', () => {
    const error = new ConfigNotFoundError('/path');
    expect(toGaibError(error)).toBe(error);
  });

  it('wraps regular Error', () => {
    const error = new Error('Regular error');
    const wrapped = toGaibError(error);

    expect(isGaibError(wrapped)).toBe(true);
    expect(wrapped.message).toBe('Regular error');
  });

  it('wraps string', () => {
    const wrapped = toGaibError('String error');

    expect(isGaibError(wrapped)).toBe(true);
    expect(wrapped.message).toBe('String error');
  });
});

describe('getErrorCode()', () => {
  it('returns code from GaibError', () => {
    const error = new ConfigNotFoundError('/path');
    expect(getErrorCode(error)).toBe(ErrorCodes.CONFIG_NOT_FOUND);
  });

  it('returns code from error with code property', () => {
    const error = Object.assign(new Error('Test'), { code: 'ENOENT' });
    expect(getErrorCode(error)).toBe('ENOENT');
  });

  it('returns UNKNOWN for regular Error', () => {
    const error = new Error('Regular error');
    expect(getErrorCode(error)).toBe('UNKNOWN');
  });
});

// ============================================================================
// Error Codes
// ============================================================================

describe('ErrorCodes', () => {
  it('has unique codes for each error type', () => {
    const codes = Object.values(ErrorCodes);
    const uniqueCodes = new Set(codes);

    expect(uniqueCodes.size).toBe(codes.length);
  });

  it('has correct format for codes', () => {
    for (const code of Object.values(ErrorCodes)) {
      expect(code).toMatch(/^E\d{4}$/);
    }
  });

  it('groups codes by category', () => {
    // Config errors: E1xxx
    expect(ErrorCodes.CONFIG_NOT_FOUND).toMatch(/^E1/);
    expect(ErrorCodes.CONFIG_PARSE_ERROR).toMatch(/^E1/);
    expect(ErrorCodes.CONFIG_VALIDATION_ERROR).toMatch(/^E1/);

    // State errors: E2xxx
    expect(ErrorCodes.STATE_NOT_FOUND).toMatch(/^E2/);
    expect(ErrorCodes.STATE_LOCKED).toMatch(/^E2/);

    // Discord API errors: E3xxx
    expect(ErrorCodes.DISCORD_UNAUTHORIZED).toMatch(/^E3/);
    expect(ErrorCodes.DISCORD_RATE_LIMITED).toMatch(/^E3/);

    // Validation errors: E4xxx
    expect(ErrorCodes.VALIDATION_GUILD_ID).toMatch(/^E4/);

    // Workspace errors: E5xxx
    expect(ErrorCodes.WORKSPACE_NOT_FOUND).toMatch(/^E5/);
    expect(ErrorCodes.WORKSPACE_ALREADY_EXISTS).toMatch(/^E5/);

    // Theme errors: E6xxx
    expect(ErrorCodes.THEME_NOT_FOUND).toMatch(/^E6/);

    // Backend errors: E7xxx
    expect(ErrorCodes.BACKEND_CONFIG_ERROR).toMatch(/^E7/);
  });
});
