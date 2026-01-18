/**
 * ConfigParser Unit Tests
 *
 * Sprint 91: Discord Infrastructure-as-Code - Config Parsing & State Reading
 *
 * Tests YAML configuration parsing and Zod schema validation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  parseConfigFile,
  parseConfigString,
  validateConfig,
  createEmptyConfig,
  serializeConfig,
  ConfigError,
  ConfigErrorCode,
} from '../ConfigParser.js';

describe('ConfigParser', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iac-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ==========================================================================
  // parseConfigString Tests
  // ==========================================================================

  describe('parseConfigString', () => {
    it('should parse minimal valid config', () => {
      const yaml = `
version: "1"
`;
      const result = parseConfigString(yaml);
      expect(result.config.version).toBe('1');
      expect(result.config.roles).toEqual([]);
      expect(result.config.categories).toEqual([]);
      expect(result.config.channels).toEqual([]);
    });

    it('should parse complete config with roles', () => {
      const yaml = `
version: "1"
roles:
  - name: Admin
    color: "#FF0000"
    hoist: true
    mentionable: true
    permissions:
      - ADMINISTRATOR
  - name: Moderator
    color: "#00FF00"
    permissions:
      - KICK_MEMBERS
      - BAN_MEMBERS
`;
      const result = parseConfigString(yaml);
      expect(result.config.roles).toHaveLength(2);
      expect(result.config.roles[0].name).toBe('Admin');
      expect(result.config.roles[0].color).toBe('#FF0000');
      expect(result.config.roles[0].hoist).toBe(true);
      expect(result.config.roles[0].permissions).toContain('ADMINISTRATOR');
      expect(result.config.roles[1].name).toBe('Moderator');
      expect(result.config.roles[1].permissions).toHaveLength(2);
    });

    it('should parse config with categories and channels', () => {
      const yaml = `
version: "1"
categories:
  - name: General
    position: 0
  - name: Voice Channels
    position: 1

channels:
  - name: general
    type: text
    category: General
    topic: "General discussion"
  - name: announcements
    type: announcement
    category: General
  - name: voice-chat
    type: voice
    category: Voice Channels
    bitrate: 64000
    userLimit: 10
`;
      const result = parseConfigString(yaml);
      expect(result.config.categories).toHaveLength(2);
      expect(result.config.channels).toHaveLength(3);
      expect(result.config.channels[0].category).toBe('General');
      expect(result.config.channels[2].bitrate).toBe(64000);
      expect(result.config.channels[2].userLimit).toBe(10);
    });

    it('should parse config with permission overwrites', () => {
      const yaml = `
version: "1"
roles:
  - name: Member

categories:
  - name: Private
    permissions:
      "@everyone":
        deny:
          - VIEW_CHANNEL
      Member:
        allow:
          - VIEW_CHANNEL
          - SEND_MESSAGES

channels:
  - name: members-only
    category: Private
    permissions:
      Member:
        allow:
          - VIEW_CHANNEL
`;
      const result = parseConfigString(yaml);
      expect(result.config.categories[0].permissions).toBeDefined();
      expect(result.config.categories[0].permissions!['@everyone'].deny).toContain('VIEW_CHANNEL');
      expect(result.config.channels[0].permissions!['Member'].allow).toContain('VIEW_CHANNEL');
    });

    it('should normalize 3-digit hex colors to 6-digit', () => {
      const yaml = `
version: "1"
roles:
  - name: Test
    color: "#F00"
`;
      const result = parseConfigString(yaml);
      expect(result.config.roles[0].color).toBe('#FF0000');
    });

    it('should reject invalid version', () => {
      const yaml = `
version: "2"
`;
      expect(() => parseConfigString(yaml)).toThrow(ConfigError);
    });

    it('should reject invalid YAML syntax', () => {
      const yaml = `
version: "1"
roles:
  - name: [invalid
`;
      expect(() => parseConfigString(yaml)).toThrow(ConfigError);
      try {
        parseConfigString(yaml);
      } catch (error) {
        expect((error as ConfigError).code).toBe(ConfigErrorCode.YAML_PARSE_ERROR);
      }
    });

    it('should reject invalid permission flag', () => {
      const yaml = `
version: "1"
roles:
  - name: Test
    permissions:
      - INVALID_PERMISSION
`;
      expect(() => parseConfigString(yaml)).toThrow(ConfigError);
    });

    it('should reject invalid color format', () => {
      const yaml = `
version: "1"
roles:
  - name: Test
    color: "red"
`;
      expect(() => parseConfigString(yaml)).toThrow(ConfigError);
    });

    it('should reject duplicate role names', () => {
      const yaml = `
version: "1"
roles:
  - name: Admin
  - name: admin
`;
      expect(() => parseConfigString(yaml)).toThrow(ConfigError);
      try {
        parseConfigString(yaml);
      } catch (error) {
        expect((error as ConfigError).code).toBe(ConfigErrorCode.VALIDATION_ERROR);
      }
    });

    it('should reject duplicate category names', () => {
      const yaml = `
version: "1"
categories:
  - name: General
  - name: general
`;
      expect(() => parseConfigString(yaml)).toThrow(ConfigError);
    });

    it('should reject duplicate channel names', () => {
      const yaml = `
version: "1"
channels:
  - name: general
  - name: general
`;
      expect(() => parseConfigString(yaml)).toThrow(ConfigError);
    });

    it('should reject unknown category reference', () => {
      const yaml = `
version: "1"
channels:
  - name: test
    category: NonExistent
`;
      expect(() => parseConfigString(yaml)).toThrow(ConfigError);
      try {
        parseConfigString(yaml);
      } catch (error) {
        // Zod's superRefine catches this as a validation error
        expect((error as ConfigError).code).toBe(ConfigErrorCode.VALIDATION_ERROR);
      }
    });

    it('should reject unknown role reference in permissions', () => {
      const yaml = `
version: "1"
channels:
  - name: test
    permissions:
      NonExistentRole:
        allow:
          - VIEW_CHANNEL
`;
      expect(() => parseConfigString(yaml)).toThrow(ConfigError);
    });

    it('should allow @everyone in permissions without defining it as role', () => {
      const yaml = `
version: "1"
channels:
  - name: test
    permissions:
      "@everyone":
        deny:
          - SEND_MESSAGES
`;
      const result = parseConfigString(yaml);
      expect(result.config.channels[0].permissions!['@everyone'].deny).toContain('SEND_MESSAGES');
    });

    it('should generate warnings for admin permissions', () => {
      const yaml = `
version: "1"
roles:
  - name: Admin
    permissions:
      - ADMINISTRATOR
`;
      const result = parseConfigString(yaml);
      expect(result.warnings.some((w) => w.includes('Administrator permission'))).toBe(true);
    });

    it('should handle empty file gracefully', () => {
      const result = parseConfigString('');
      expect(result.config.version).toBe('1');
      expect(result.warnings.some((w) => w.includes('empty'))).toBe(true);
    });

    it('should validate channel name format (lowercase only)', () => {
      const yaml = `
version: "1"
channels:
  - name: Invalid Name
`;
      expect(() => parseConfigString(yaml)).toThrow(ConfigError);
    });

    it('should accept valid channel names with hyphens and underscores', () => {
      const yaml = `
version: "1"
channels:
  - name: valid-channel_name123
`;
      const result = parseConfigString(yaml);
      expect(result.config.channels[0].name).toBe('valid-channel_name123');
    });
  });

  // ==========================================================================
  // parseConfigFile Tests
  // ==========================================================================

  describe('parseConfigFile', () => {
    it('should parse config from file', () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const yaml = `
version: "1"
roles:
  - name: TestRole
`;
      fs.writeFileSync(configPath, yaml);

      const result = parseConfigFile(configPath);
      expect(result.config.roles[0].name).toBe('TestRole');
      expect(result.sourcePath).toBe(configPath);
    });

    it('should throw for non-existent file', () => {
      expect(() => parseConfigFile('/nonexistent/path.yaml')).toThrow(ConfigError);
      try {
        parseConfigFile('/nonexistent/path.yaml');
      } catch (error) {
        expect((error as ConfigError).code).toBe(ConfigErrorCode.FILE_NOT_FOUND);
      }
    });

    it('should resolve relative paths', () => {
      const configPath = path.join(tempDir, 'config.yaml');
      fs.writeFileSync(configPath, 'version: "1"');

      // Use absolute path since process.chdir is not supported in workers
      const result = parseConfigFile(configPath);
      expect(result.sourcePath).toBe(configPath);
    });
  });

  // ==========================================================================
  // validateConfig Tests
  // ==========================================================================

  describe('validateConfig', () => {
    it('should return valid for correct config', () => {
      const config = {
        version: '1',
        roles: [{ name: 'Test', permissions: [] }],
        categories: [],
        channels: [],
      };
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return errors for invalid config', () => {
      const config = {
        version: '2', // Invalid version
      };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should detect reference errors', () => {
      const config = {
        version: '1',
        roles: [],
        categories: [],
        channels: [{ name: 'test', category: 'NonExistent' }],
      };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
    });
  });

  // ==========================================================================
  // createEmptyConfig Tests
  // ==========================================================================

  describe('createEmptyConfig', () => {
    it('should create valid empty config', () => {
      const config = createEmptyConfig();
      expect(config.version).toBe('1');
      expect(config.roles).toEqual([]);
      expect(config.categories).toEqual([]);
      expect(config.channels).toEqual([]);
    });

    it('should pass validation', () => {
      const config = createEmptyConfig();
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
    });
  });

  // ==========================================================================
  // serializeConfig Tests
  // ==========================================================================

  describe('serializeConfig', () => {
    it('should serialize minimal config', () => {
      const config = createEmptyConfig();
      const yaml = serializeConfig(config);
      expect(yaml).toContain("version: '1'");
    });

    it('should serialize and re-parse to same config', () => {
      const yaml = `
version: "1"
roles:
  - name: Admin
    color: "#FF0000"
    hoist: true
    permissions:
      - ADMINISTRATOR
categories:
  - name: General
channels:
  - name: general
    category: General
    topic: "General chat"
`;
      const original = parseConfigString(yaml);
      const serialized = serializeConfig(original.config);
      const reparsed = parseConfigString(serialized);

      expect(reparsed.config.roles[0].name).toBe(original.config.roles[0].name);
      expect(reparsed.config.roles[0].color).toBe(original.config.roles[0].color);
      expect(reparsed.config.categories[0].name).toBe(original.config.categories[0].name);
      expect(reparsed.config.channels[0].name).toBe(original.config.channels[0].name);
    });

    it('should omit empty arrays and default values', () => {
      const config = createEmptyConfig();
      const yaml = serializeConfig(config);
      expect(yaml).not.toContain('roles:');
      expect(yaml).not.toContain('categories:');
      expect(yaml).not.toContain('channels:');
    });

    it('should include server metadata when present', () => {
      const config = {
        ...createEmptyConfig(),
        server: { name: 'Test Server', description: 'A test' },
      };
      const yaml = serializeConfig(config);
      expect(yaml).toContain('server:');
      expect(yaml).toContain('Test Server');
    });
  });

  // ==========================================================================
  // ConfigError Tests
  // ==========================================================================

  describe('ConfigError', () => {
    it('should format error message correctly', () => {
      const error = new ConfigError('Test error', ConfigErrorCode.VALIDATION_ERROR, [
        { message: 'Detail 1', path: ['roles', 0, 'name'] },
        { message: 'Detail 2', path: ['channels'] },
      ]);

      const formatted = error.format();
      expect(formatted).toContain('Test error');
      expect(formatted).toContain('Detail 1');
      expect(formatted).toContain('roles.0.name');
      expect(formatted).toContain('Detail 2');
    });

    it('should handle errors without details', () => {
      const error = new ConfigError('Simple error', ConfigErrorCode.FILE_NOT_FOUND);
      const formatted = error.format();
      expect(formatted).toContain('Simple error');
      expect(formatted).not.toContain('Details:');
    });
  });
});
