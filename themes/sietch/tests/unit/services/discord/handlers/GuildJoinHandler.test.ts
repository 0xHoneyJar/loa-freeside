/**
 * GuildJoinHandler Unit Tests
 *
 * Sprint 102: Foundation - Sandworm Sense
 *
 * Tests the guild join orchestration for intelligent onboarding:
 * - Config skip behavior
 * - Error handling with safe defaults
 * - Result structure
 *
 * Note: Full integration testing with IncumbentDetector is done in
 * guild-join.integration.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  GuildJoinHandler,
  createGuildJoinHandler,
  type GuildJoinHandlerOptions,
} from '../../../../../src/services/discord/handlers/GuildJoinHandler.js';
import type { Guild, Client } from 'discord.js';
import type { ICoexistenceStorage } from '../../../../../src/packages/core/ports/ICoexistenceStorage.js';

// Mock the logger module
vi.mock('../../../../../src/utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Mock the IncumbentDetector - returns greenfield by default
vi.mock('../../../../../src/packages/adapters/coexistence/IncumbentDetector.js', () => ({
  createIncumbentDetector: vi.fn(() => ({
    detectIncumbent: vi.fn().mockResolvedValue({
      detected: false,
      provider: null,
      confidence: 0,
      detectionMethod: null,
      info: null,
    }),
  })),
}));

// =============================================================================
// Mock Factories
// =============================================================================

function createMockGuild(overrides: Partial<Guild> = {}): Guild {
  return {
    id: '123456789012345678',
    name: 'Test Guild',
    memberCount: 100,
    ...overrides,
  } as Guild;
}

function createMockClient(): Client {
  return {} as Client;
}

function createMockStorage(
  overrides: Partial<ICoexistenceStorage> = {}
): ICoexistenceStorage {
  return {
    getIncumbentConfig: vi.fn().mockResolvedValue(null),
    saveIncumbentConfig: vi.fn().mockResolvedValue({}),
    initializeShadowMode: vi.fn().mockResolvedValue({}),
    ...overrides,
  } as unknown as ICoexistenceStorage;
}

// =============================================================================
// Tests
// =============================================================================

describe('GuildJoinHandler', () => {
  let storage: ICoexistenceStorage;
  let client: Client;
  let handler: GuildJoinHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = createMockStorage();
    client = createMockClient();
    handler = createGuildJoinHandler(storage, client);
  });

  describe('Basic Flow', () => {
    it('should handle guild join and return onboarding result', async () => {
      const guild = createMockGuild();

      const result = await handler.handleGuildJoin(guild);

      expect(result).toBeDefined();
      expect(result.guildId).toBe(guild.id);
      expect(result.guildName).toBe(guild.name);
      expect(result.completedAt).toBeInstanceOf(Date);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should default to greenfield when no incumbent detected', async () => {
      const guild = createMockGuild({ memberCount: 500 });

      const result = await handler.handleGuildJoin(guild);

      // With mock returning no detection, should be greenfield
      expect(result.mode).toBe('greenfield');
      expect(result.incumbentProvider).toBeNull();
    });
  });

  describe('Existing Config Handling', () => {
    it('should skip detection if config exists and skipIfConfigExists is true', async () => {
      const existingConfig = {
        provider: 'matrica',
        confidence: 85,
      };
      storage = createMockStorage({
        getIncumbentConfig: vi.fn().mockResolvedValue(existingConfig),
      });
      handler = createGuildJoinHandler(storage, client, { skipIfConfigExists: true });
      const guild = createMockGuild();

      const result = await handler.handleGuildJoin(guild);

      expect(result.mode).toBe('shadow');
      expect(result.incumbentProvider).toBe('matrica');
      expect(result.explanation).toContain('Previously detected');
    });

    it('should convert stored confidence from 0-100 to 0-1 scale', async () => {
      const existingConfig = {
        provider: 'collabland',
        confidence: 95, // Stored as 0-100
      };
      storage = createMockStorage({
        getIncumbentConfig: vi.fn().mockResolvedValue(existingConfig),
      });
      handler = createGuildJoinHandler(storage, client, { skipIfConfigExists: true });
      const guild = createMockGuild();

      const result = await handler.handleGuildJoin(guild);

      expect(result.confidence).toBe(0.95); // Converted to 0-1
    });
  });

  describe('Error Handling', () => {
    it('should return greenfield mode on storage error with admin confirmation', async () => {
      storage = createMockStorage({
        getIncumbentConfig: vi.fn().mockRejectedValue(new Error('Database error')),
      });
      handler = createGuildJoinHandler(storage, client);
      const guild = createMockGuild();

      const result = await handler.handleGuildJoin(guild);

      expect(result.mode).toBe('greenfield');
      expect(result.confidence).toBe(0);
      expect(result.requiresAdminConfirmation).toBe(true);
      expect(result.explanation).toContain('Detection failed');
    });

    it('should include error message in explanation', async () => {
      storage = createMockStorage({
        getIncumbentConfig: vi.fn().mockRejectedValue(new Error('Network timeout')),
      });
      handler = createGuildJoinHandler(storage, client);
      const guild = createMockGuild();

      const result = await handler.handleGuildJoin(guild);

      expect(result.explanation).toContain('Network timeout');
    });

    it('should set incumbentProvider to null on error', async () => {
      storage = createMockStorage({
        getIncumbentConfig: vi.fn().mockRejectedValue(new Error('Error')),
      });
      handler = createGuildJoinHandler(storage, client);
      const guild = createMockGuild();

      const result = await handler.handleGuildJoin(guild);

      expect(result.incumbentProvider).toBeNull();
    });
  });

  describe('Factory Function', () => {
    it('should create handler with createGuildJoinHandler', () => {
      const handler = createGuildJoinHandler(storage, client);

      expect(handler).toBeInstanceOf(GuildJoinHandler);
    });

    it('should accept optional options', () => {
      const options: GuildJoinHandlerOptions = {
        detectionTimeoutMs: 3000,
        skipIfConfigExists: false,
      };

      const handler = createGuildJoinHandler(storage, client, options);

      expect(handler).toBeInstanceOf(GuildJoinHandler);
    });
  });

  describe('Result Structure', () => {
    it('should include all required fields in OnboardingResult', async () => {
      const guild = createMockGuild();

      const result = await handler.handleGuildJoin(guild);

      // Verify structure
      expect(result).toHaveProperty('guildId');
      expect(result).toHaveProperty('guildName');
      expect(result).toHaveProperty('mode');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('incumbentProvider');
      expect(result).toHaveProperty('requiresAdminConfirmation');
      expect(result).toHaveProperty('explanation');
      expect(result).toHaveProperty('completedAt');
      expect(result).toHaveProperty('durationMs');
    });

    it('should track duration accurately', async () => {
      const guild = createMockGuild();

      const startTime = Date.now();
      const result = await handler.handleGuildJoin(guild);
      const endTime = Date.now();

      // Duration should be reasonable (not negative, not longer than total time)
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.durationMs).toBeLessThanOrEqual(endTime - startTime + 50); // Small buffer
    });
  });
});
