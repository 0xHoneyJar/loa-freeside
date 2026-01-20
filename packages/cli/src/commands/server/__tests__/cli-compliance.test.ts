/**
 * Server CLI Compliance Tests
 *
 * Sprint 93: Discord Infrastructure-as-Code - CLI Commands & Polish
 *
 * Tests for clig.dev compliance features:
 * - TTY detection
 * - Color control
 * - Error handling
 * - Exit codes
 *
 * @see https://clig.dev/
 * @see S-93.8 acceptance criteria
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  shouldUseColor,
  isInteractive,
  handleError,
  ExitCodes,
  formatDiffOutput,
  formatPlanOutput,
  formatChange,
  formatPermissionChange,
  generateDefaultConfig,
  getDiscordToken,
  getGuildId,
  validateGuildId,
  GuildValidationErrors,
  resolveConfigPath,
  configExists,
} from '../utils.js';
import type { ServerDiff, RoleChange, PermissionChange } from '../iac/types.js';

// =============================================================================
// TTY Detection Tests
// =============================================================================

describe('TTY Detection (S-93.8)', () => {
  describe('isInteractive', () => {
    it('should return true when stdout is a TTY', () => {
      const originalIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

      expect(isInteractive()).toBe(true);

      Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
    });

    it('should return false when stdout is not a TTY', () => {
      const originalIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

      expect(isInteractive()).toBe(false);

      Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
    });
  });
});

// =============================================================================
// Color Control Tests
// =============================================================================

describe('Color Control (S-93.8)', () => {
  const originalEnv = { ...process.env };
  let originalStdoutIsTTY: boolean | undefined;

  beforeEach(() => {
    originalStdoutIsTTY = process.stdout.isTTY;
    delete process.env.NO_COLOR;
    delete process.env.TERM;
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  });

  afterEach(() => {
    process.env.NO_COLOR = originalEnv.NO_COLOR;
    process.env.TERM = originalEnv.TERM;
    Object.defineProperty(process.stdout, 'isTTY', { value: originalStdoutIsTTY, configurable: true });
  });

  describe('shouldUseColor', () => {
    it('should return true in normal TTY environment', () => {
      expect(shouldUseColor()).toBe(true);
    });

    it('should return false when NO_COLOR is set', () => {
      process.env.NO_COLOR = '1';
      expect(shouldUseColor()).toBe(false);
    });

    it('should return false when TERM=dumb', () => {
      process.env.TERM = 'dumb';
      expect(shouldUseColor()).toBe(false);
    });

    it('should return false when stdout is not a TTY', () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
      expect(shouldUseColor()).toBe(false);
    });
  });
});

// =============================================================================
// Exit Codes Tests
// =============================================================================

describe('Exit Codes (S-93.8)', () => {
  it('should define standard exit codes', () => {
    expect(ExitCodes.SUCCESS).toBe(0);
    expect(ExitCodes.VALIDATION_ERROR).toBe(1);
    expect(ExitCodes.PARTIAL_FAILURE).toBe(2);
    expect(ExitCodes.API_ERROR).toBe(3);
    expect(ExitCodes.CONFIG_ERROR).toBe(4);
  });
});

// =============================================================================
// Config Path Resolution Tests
// =============================================================================

describe('Config Path Resolution (S-93.8)', () => {
  it('should resolve relative paths', () => {
    const resolved = resolveConfigPath('test.yaml');
    expect(resolved).toContain('test.yaml');
    expect(resolved.startsWith('/')).toBe(true);
  });

  it('should keep absolute paths unchanged', () => {
    const resolved = resolveConfigPath('/absolute/path/config.yaml');
    expect(resolved).toBe('/absolute/path/config.yaml');
  });

  it('should report non-existent files', () => {
    expect(configExists('/non/existent/file.yaml')).toBe(false);
  });
});

// =============================================================================
// Environment Variable Tests
// =============================================================================

describe('Environment Variables (S-93.8)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env.DISCORD_BOT_TOKEN = originalEnv.DISCORD_BOT_TOKEN;
    process.env.DISCORD_TOKEN = originalEnv.DISCORD_TOKEN;
    process.env.DISCORD_GUILD_ID = originalEnv.DISCORD_GUILD_ID;
  });

  describe('getDiscordToken', () => {
    it('should throw when neither DISCORD_BOT_TOKEN nor DISCORD_TOKEN is set', () => {
      delete process.env.DISCORD_BOT_TOKEN;
      delete process.env.DISCORD_TOKEN;
      expect(() => getDiscordToken()).toThrow('Discord bot token not found');
    });

    it('should return token when set', () => {
      process.env.DISCORD_BOT_TOKEN = 'test-token';
      expect(getDiscordToken()).toBe('test-token');
    });
  });

  describe('getGuildId', () => {
    it('should prefer CLI option over environment variable', () => {
      process.env.DISCORD_GUILD_ID = '123456789012345678';
      expect(getGuildId({ guild: '987654321098765432' })).toBe('987654321098765432');
    });

    it('should fallback to environment variable', () => {
      process.env.DISCORD_GUILD_ID = '123456789012345678';
      expect(getGuildId({})).toBe('123456789012345678');
    });

    it('should return undefined when neither is set', () => {
      delete process.env.DISCORD_GUILD_ID;
      expect(getGuildId({})).toBeUndefined();
    });
  });
});

// =============================================================================
// Guild ID Validation Tests (Sprint 94 - H-3)
// =============================================================================

describe('Guild ID Validation (S-94.3)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env.DISCORD_GUILD_ID = originalEnv.DISCORD_GUILD_ID;
  });

  describe('validateGuildId', () => {
    it('should accept valid 17-digit snowflake IDs', () => {
      expect(validateGuildId('12345678901234567')).toBe(true);
    });

    it('should accept valid 18-digit snowflake IDs', () => {
      expect(validateGuildId('123456789012345678')).toBe(true);
    });

    it('should accept valid 19-digit snowflake IDs', () => {
      expect(validateGuildId('1234567890123456789')).toBe(true);
    });

    it('should reject IDs that are too short', () => {
      expect(validateGuildId('1234567890123456')).toBe(false); // 16 digits
      expect(validateGuildId('12345')).toBe(false);
      expect(validateGuildId('')).toBe(false);
    });

    it('should reject IDs that are too long', () => {
      expect(validateGuildId('12345678901234567890')).toBe(false); // 20 digits
    });

    it('should reject non-numeric IDs', () => {
      expect(validateGuildId('abc123456789012345')).toBe(false);
      expect(validateGuildId('1234567890abcdefgh')).toBe(false);
    });

    it('should reject IDs with special characters', () => {
      expect(validateGuildId('123456789-12345678')).toBe(false);
      expect(validateGuildId('123456789_12345678')).toBe(false);
      expect(validateGuildId('123456789.12345678')).toBe(false);
    });

    it('should reject IDs with whitespace', () => {
      expect(validateGuildId(' 123456789012345678')).toBe(false);
      expect(validateGuildId('123456789012345678 ')).toBe(false);
      expect(validateGuildId('12345678 9012345678')).toBe(false);
    });

    it('should reject potential injection attempts', () => {
      // SQL injection attempts
      expect(validateGuildId("123' OR '1'='1")).toBe(false);
      expect(validateGuildId('123; DROP TABLE users;')).toBe(false);

      // Path traversal attempts
      expect(validateGuildId('../../../etc/passwd')).toBe(false);

      // XSS attempts
      expect(validateGuildId('<script>alert(1)</script>')).toBe(false);

      // Command injection attempts
      expect(validateGuildId('$(whoami)')).toBe(false);
      expect(validateGuildId('`id`')).toBe(false);
    });
  });

  describe('getGuildId with validation', () => {
    it('should throw error with code for invalid CLI option', () => {
      expect(() => getGuildId({ guild: 'invalid-guild' })).toThrow();
      try {
        getGuildId({ guild: 'invalid-guild' });
      } catch (error) {
        expect((error as Error & { code: string }).code).toBe(GuildValidationErrors.INVALID_FORMAT);
      }
    });

    it('should throw error with code for invalid environment variable', () => {
      delete process.env.DISCORD_GUILD_ID;
      process.env.DISCORD_GUILD_ID = 'malicious-input';
      expect(() => getGuildId({})).toThrow();
      try {
        getGuildId({});
      } catch (error) {
        expect((error as Error & { code: string }).code).toBe(GuildValidationErrors.INVALID_FORMAT);
      }
    });

    it('should include error code in error message', () => {
      expect(() => getGuildId({ guild: 'invalid' })).toThrow(/E1001/);
    });

    it('should accept valid snowflake IDs', () => {
      expect(getGuildId({ guild: '123456789012345678' })).toBe('123456789012345678');
    });

    it('should return undefined for missing guild ID (not an error)', () => {
      delete process.env.DISCORD_GUILD_ID;
      expect(getGuildId({})).toBeUndefined();
    });
  });
});

// =============================================================================
// Default Config Generation Tests
// =============================================================================

describe('Default Config Generation (S-93.8)', () => {
  it('should generate valid YAML config', () => {
    const config = generateDefaultConfig();
    expect(config).toContain('version: "1.0"');
    expect(config).toContain('server:');
    expect(config).toContain('roles:');
    expect(config).toContain('categories:');
    expect(config).toContain('channels:');
  });

  it('should include guild ID when provided', () => {
    const config = generateDefaultConfig('123456789012345678');
    expect(config).toContain('id: "123456789012345678"');
  });

  it('should include server name when provided', () => {
    const config = generateDefaultConfig('123456789012345678', 'Test Server');
    expect(config).toContain('name: "Test Server"');
  });
});

// =============================================================================
// Diff Output Formatting Tests
// =============================================================================

describe('Diff Output Formatting (S-93.8)', () => {
  it('should format empty diff', () => {
    const diff: ServerDiff = {
      guildId: '123456789012345678',
      hasChanges: false,
      summary: { total: 0, create: 0, update: 0, delete: 0, noop: 0 },
      roles: [],
      categories: [],
      channels: [],
      permissions: [],
    };

    const output = formatDiffOutput(diff);
    expect(output).toContain('Diff Summary');
    expect(output).toContain('No changes detected');
  });

  it('should format diff with changes', () => {
    const diff: ServerDiff = {
      guildId: '123456789012345678',
      hasChanges: true,
      summary: { total: 1, create: 1, update: 0, delete: 0, noop: 0 },
      roles: [
        {
          operation: 'create',
          name: 'Test Role',
          desired: {
            id: '987654321098765432',
            name: 'Test Role',
            color: '#FF0000',
            permissions: [],
            position: 1,
            hoist: false,
            mentionable: false,
            managed: false,
            isEveryone: false,
            isIacManaged: true,
          },
        },
      ],
      categories: [],
      channels: [],
      permissions: [],
    };

    const output = formatDiffOutput(diff);
    expect(output).toContain('1 creates');
    expect(output).toContain('Roles:');
    expect(output).toContain('Test Role');
  });

  it('should format plan output with apply hint', () => {
    const diff: ServerDiff = {
      guildId: '123456789012345678',
      hasChanges: true,
      summary: { total: 1, create: 1, update: 0, delete: 0, noop: 0 },
      roles: [
        {
          operation: 'create',
          name: 'Test Role',
          desired: {
            id: '987654321098765432',
            name: 'Test Role',
            color: '#FF0000',
            permissions: [],
            position: 1,
            hoist: false,
            mentionable: false,
            managed: false,
            isEveryone: false,
            isIacManaged: true,
          },
        },
      ],
      categories: [],
      channels: [],
      permissions: [],
    };

    const output = formatPlanOutput(diff);
    expect(output).toContain('Execution Plan');
    expect(output).toContain('gaib server apply');
  });
});

// =============================================================================
// Change Formatting Tests
// =============================================================================

describe('Change Formatting (S-93.8)', () => {
  it('should format create operation', () => {
    const change: RoleChange = {
      operation: 'create',
      name: 'New Role',
      desired: {
        id: '987654321098765432',
        name: 'New Role',
        color: '#00FF00',
        permissions: [],
        position: 1,
        hoist: false,
        mentionable: false,
        managed: false,
        isEveryone: false,
        isIacManaged: true,
      },
    };

    const output = formatChange(change, 'role');
    expect(output).toContain('New Role');
  });

  it('should format update operation with field changes', () => {
    const change: RoleChange = {
      operation: 'update',
      name: 'Updated Role',
      current: {
        id: '987654321098765432',
        name: 'Updated Role',
        color: '#FF0000',
        permissions: [],
        position: 1,
        hoist: false,
        mentionable: false,
        managed: false,
        isEveryone: false,
        isIacManaged: true,
      },
      desired: {
        id: '987654321098765432',
        name: 'Updated Role',
        color: '#00FF00',
        permissions: [],
        position: 1,
        hoist: false,
        mentionable: false,
        managed: false,
        isEveryone: false,
        isIacManaged: true,
      },
      changes: [{ field: 'color', from: '#FF0000', to: '#00FF00' }],
    };

    const output = formatChange(change, 'role');
    expect(output).toContain('Updated Role');
    expect(output).toContain('color');
    expect(output).toContain('#FF0000');
    expect(output).toContain('#00FF00');
  });

  it('should format delete operation', () => {
    const change: RoleChange = {
      operation: 'delete',
      name: 'Deleted Role',
      current: {
        id: '987654321098765432',
        name: 'Deleted Role',
        color: '#FF0000',
        permissions: [],
        position: 1,
        hoist: false,
        mentionable: false,
        managed: false,
        isEveryone: false,
        isIacManaged: true,
      },
    };

    const output = formatChange(change, 'role');
    expect(output).toContain('Deleted Role');
  });

  it('should format permission change', () => {
    const change: PermissionChange = {
      operation: 'create',
      targetId: '111111111111111111',
      targetName: 'general',
      targetType: 'channel',
      subjectId: '222222222222222222',
      subjectName: '@everyone',
      subjectType: 'role',
    };

    const output = formatPermissionChange(change);
    expect(output).toContain('general');
    expect(output).toContain('@everyone');
  });
});
