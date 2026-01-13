/**
 * IncumbentDetector Unit Tests
 *
 * Sprint 56: Shadow Mode Foundation - Incumbent Detection
 *
 * Tests for detecting incumbent token-gating bots in Discord guilds.
 * Uses mock Discord.js client and in-memory storage.
 *
 * @module tests/unit/packages/adapters/coexistence/IncumbentDetector.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  IncumbentDetector,
  KNOWN_INCUMBENTS,
  CONFIDENCE,
  type DetectionResult,
} from '../../../../../src/packages/adapters/coexistence/IncumbentDetector.js';
import type { ICoexistenceStorage } from '../../../../../src/packages/core/ports/ICoexistenceStorage.js';
import { nullLogger } from '../../../../../src/packages/infrastructure/logging/index.js';

// =============================================================================
// Mock Discord.js Types
// =============================================================================

interface MockGuildMember {
  id: string;
  user: {
    id: string;
    username: string;
    bot: boolean;
  };
  joinedAt: Date | null;
}

interface MockChannel {
  id: string;
  name: string;
}

interface MockRole {
  id: string;
  name: string;
  managed: boolean;
  members: { size: number };
}

/**
 * Mock Discord.js Collection that extends Map with find/filter methods
 */
class MockCollection<K, V> extends Map<K, V> {
  find(fn: (value: V, key: K, collection: this) => boolean): V | undefined {
    for (const [key, value] of this) {
      if (fn(value, key, this)) {
        return value;
      }
    }
    return undefined;
  }

  filter(fn: (value: V, key: K, collection: this) => boolean): MockCollection<K, V> {
    const result = new MockCollection<K, V>();
    for (const [key, value] of this) {
      if (fn(value, key, this)) {
        result.set(key, value);
      }
    }
    return result;
  }

  map<T>(fn: (value: V, key: K, collection: this) => T): T[] {
    const result: T[] = [];
    for (const [key, value] of this) {
      result.push(fn(value, key, this));
    }
    return result;
  }
}

interface MockGuild {
  id: string;
  members: {
    cache: MockCollection<string, MockGuildMember>;
    fetch: () => Promise<void>;
  };
  channels: {
    cache: MockCollection<string, MockChannel>;
  };
  roles: {
    cache: MockCollection<string, MockRole>;
  };
}

interface MockDiscordClient {
  guilds: {
    fetch: (guildId: string) => Promise<MockGuild | null>;
  };
}

// =============================================================================
// Test Helpers
// =============================================================================

function createMockGuild(overrides: Partial<MockGuild> = {}): MockGuild {
  const rolesCache = new MockCollection<string, MockRole>();
  rolesCache.set('role-everyone', { id: 'role-everyone', name: '@everyone', managed: false, members: { size: 100 } });

  return {
    id: 'test-guild-id',
    members: {
      cache: new MockCollection(),
      fetch: vi.fn().mockResolvedValue(undefined),
    },
    channels: {
      cache: new MockCollection(),
    },
    roles: {
      cache: rolesCache,
    },
    ...overrides,
  };
}

function createMockMember(id: string, username: string, isBot: boolean): MockGuildMember {
  return {
    id,
    user: { id, username, bot: isBot },
    joinedAt: new Date('2024-01-01'),
  };
}

function createMockChannel(id: string, name: string): MockChannel {
  return { id, name };
}

function createMockRole(id: string, name: string, memberCount: number): MockRole {
  return { id, name, managed: false, members: { size: memberCount } };
}

function createMockStorage(): ICoexistenceStorage {
  return {
    getIncumbentConfig: vi.fn().mockResolvedValue(null),
    saveIncumbentConfig: vi.fn().mockImplementation(async (input) => ({
      id: 'test-id',
      ...input,
      detectedAt: new Date(),
      lastHealthCheck: null,
      healthStatus: 'unknown',
      detectedRoles: input.detectedRoles ?? [],
      capabilities: input.capabilities ?? {},
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    updateIncumbentHealth: vi.fn().mockResolvedValue(undefined),
    deleteIncumbentConfig: vi.fn().mockResolvedValue(undefined),
    hasIncumbent: vi.fn().mockResolvedValue(false),
    getMigrationState: vi.fn().mockResolvedValue(null),
    saveMigrationState: vi.fn().mockImplementation(async (input) => ({
      id: 'test-id',
      ...input,
      rollbackCount: 0,
      lastRollbackAt: null,
      lastRollbackReason: null,
      readinessCheckPassed: false,
      accuracyPercent: null,
      shadowDays: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    getCurrentMode: vi.fn().mockResolvedValue('shadow'),
    updateMode: vi.fn().mockResolvedValue(undefined),
    recordRollback: vi.fn().mockResolvedValue(undefined),
    initializeShadowMode: vi.fn().mockImplementation(async (communityId) => ({
      id: 'test-id',
      communityId,
      currentMode: 'shadow',
      targetMode: null,
      strategy: null,
      shadowStartedAt: new Date(),
      parallelEnabledAt: null,
      primaryEnabledAt: null,
      exclusiveEnabledAt: null,
      rollbackCount: 0,
      lastRollbackAt: null,
      lastRollbackReason: null,
      readinessCheckPassed: false,
      accuracyPercent: null,
      shadowDays: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    getCommunitiesByMode: vi.fn().mockResolvedValue([]),
    getReadyCommunities: vi.fn().mockResolvedValue([]),
    getIncumbentHealthOverview: vi.fn().mockResolvedValue(new Map()),
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('IncumbentDetector', () => {
  let detector: IncumbentDetector;
  let mockStorage: ICoexistenceStorage;
  let mockClient: MockDiscordClient;
  let mockGuild: MockGuild;

  beforeEach(() => {
    mockStorage = createMockStorage();
    mockGuild = createMockGuild();
    mockClient = {
      guilds: {
        fetch: vi.fn().mockResolvedValue(mockGuild),
      },
    };
    detector = new IncumbentDetector(
      mockStorage,
      mockClient as unknown as Parameters<typeof IncumbentDetector['prototype']['constructor']>[1],
      nullLogger
    );
  });

  describe('KNOWN_INCUMBENTS configuration', () => {
    it('should have Collab.Land bot ID configured', () => {
      expect(KNOWN_INCUMBENTS.collabland.botIds).toContain('704521096837464076');
    });

    it('should have channel patterns for all known incumbents', () => {
      expect(KNOWN_INCUMBENTS.collabland.channelPatterns.length).toBeGreaterThan(0);
      expect(KNOWN_INCUMBENTS.matrica.channelPatterns.length).toBeGreaterThan(0);
      expect(KNOWN_INCUMBENTS['guild.xyz'].channelPatterns.length).toBeGreaterThan(0);
    });

    it('should define capabilities for each incumbent', () => {
      expect(KNOWN_INCUMBENTS.collabland.capabilities.hasBalanceCheck).toBe(true);
      expect(KNOWN_INCUMBENTS.collabland.capabilities.hasTierSystem).toBe(true);
      expect(KNOWN_INCUMBENTS.collabland.capabilities.hasConvictionScoring).toBe(false);
    });
  });

  describe('detectIncumbent', () => {
    describe('bot ID detection', () => {
      it('should detect Collab.Land by bot ID with highest confidence', async () => {
        // Add Collab.Land bot to guild
        const collabLandBot = createMockMember(
          '704521096837464076',
          'Collab.Land',
          true
        );
        mockGuild.members.cache.set('704521096837464076', collabLandBot);

        const result = await detector.detectIncumbent('test-guild-id');

        expect(result.detected).toBe(true);
        expect(result.provider).toBe('collabland');
        expect(result.confidence).toBe(CONFIDENCE.BOT_ID_MATCH);
        expect(result.detectionMethod).toBe('bot_id');
        expect(result.info?.bot?.id).toBe('704521096837464076');
      });

      it('should not detect by bot ID if bot is not in guild', async () => {
        // Empty guild - no bots
        const result = await detector.detectIncumbent('test-guild-id');

        expect(result.detected).toBe(false);
        expect(result.provider).toBeNull();
      });
    });

    describe('username pattern detection', () => {
      it('should detect by bot username pattern', async () => {
        // Add a bot with Collab.Land-like username
        const suspectBot = createMockMember('bot-123', 'collab.land-verify', true);
        mockGuild.members.cache.set('bot-123', suspectBot);

        const result = await detector.detectIncumbent('test-guild-id');

        expect(result.detected).toBe(true);
        expect(result.provider).toBe('collabland');
        expect(result.confidence).toBe(CONFIDENCE.USERNAME_MATCH);
        expect(result.detectionMethod).toBe('username');
      });

      it('should detect Matrica by username', async () => {
        const matricaBot = createMockMember('bot-456', 'matrica-bot', true);
        mockGuild.members.cache.set('bot-456', matricaBot);

        const result = await detector.detectIncumbent('test-guild-id');

        expect(result.detected).toBe(true);
        expect(result.provider).toBe('matrica');
      });

      it('should not match non-bot users', async () => {
        // Regular user with suspicious username
        const user = createMockMember('user-123', 'collab.land-fan', false);
        mockGuild.members.cache.set('user-123', user);

        const result = await detector.detectIncumbent('test-guild-id');

        expect(result.detected).toBe(false);
      });
    });

    describe('channel pattern detection', () => {
      it('should detect by verification channel name', async () => {
        // Add collabland-join channel
        const channel = createMockChannel('channel-123', 'collabland-join');
        mockGuild.channels.cache.set('channel-123', channel);

        const result = await detector.detectIncumbent('test-guild-id');

        expect(result.detected).toBe(true);
        expect(result.provider).toBe('collabland');
        expect(result.confidence).toBe(CONFIDENCE.CHANNEL_MATCH);
        expect(result.detectionMethod).toBe('channel');
        expect(result.info?.channels.verification).toBe('channel-123');
      });

      it('should detect Guild.xyz by channel pattern', async () => {
        // Use 'guild-join' which is unique to Guild.xyz (not shared with collabland)
        const channel = createMockChannel('channel-789', 'guild-join');
        mockGuild.channels.cache.set('channel-789', channel);

        const result = await detector.detectIncumbent('test-guild-id');

        expect(result.detected).toBe(true);
        expect(result.provider).toBe('guild.xyz');
      });

      it('should match case-insensitively', async () => {
        const channel = createMockChannel('channel-123', 'COLLABLAND-JOIN');
        mockGuild.channels.cache.set('channel-123', channel);

        const result = await detector.detectIncumbent('test-guild-id');

        expect(result.detected).toBe(true);
        expect(result.provider).toBe('collabland');
      });
    });

    describe('generic suspect detection', () => {
      it('should detect generic token-gating bot by keywords', async () => {
        const genericBot = createMockMember('bot-999', 'token-gate-bot', true);
        mockGuild.members.cache.set('bot-999', genericBot);

        const result = await detector.detectIncumbent('test-guild-id');

        expect(result.detected).toBe(true);
        expect(result.provider).toBe('other');
        expect(result.confidence).toBe(CONFIDENCE.GENERIC_SUSPECT);
        expect(result.detectionMethod).toBe('generic');
      });

      it('should detect bots with "verify" in name', async () => {
        const verifyBot = createMockMember('bot-888', 'verify-bot', true);
        mockGuild.members.cache.set('bot-888', verifyBot);

        const result = await detector.detectIncumbent('test-guild-id');

        expect(result.detected).toBe(true);
        expect(result.provider).toBe('other');
      });

      it('should detect bots with "holder" in name', async () => {
        const holderBot = createMockMember('bot-777', 'nft-holder-checker', true);
        mockGuild.members.cache.set('bot-777', holderBot);

        const result = await detector.detectIncumbent('test-guild-id');

        expect(result.detected).toBe(true);
        expect(result.provider).toBe('other');
      });
    });

    describe('detection priority', () => {
      it('should prefer bot ID over username when both match', async () => {
        // Add both Collab.Land bot and a generic verify bot
        const collabLandBot = createMockMember('704521096837464076', 'Collab.Land', true);
        const genericBot = createMockMember('bot-123', 'verify-bot', true);

        mockGuild.members.cache.set('704521096837464076', collabLandBot);
        mockGuild.members.cache.set('bot-123', genericBot);

        const result = await detector.detectIncumbent('test-guild-id');

        expect(result.provider).toBe('collabland');
        expect(result.detectionMethod).toBe('bot_id');
        expect(result.confidence).toBe(CONFIDENCE.BOT_ID_MATCH);
      });

      it('should prefer username over channel when both match', async () => {
        const matricaBot = createMockMember('bot-456', 'matrica-verify', true);
        const channel = createMockChannel('channel-123', 'collabland-join');

        mockGuild.members.cache.set('bot-456', matricaBot);
        mockGuild.channels.cache.set('channel-123', channel);

        const result = await detector.detectIncumbent('test-guild-id');

        // Matrica username should be detected first
        expect(result.provider).toBe('matrica');
        expect(result.detectionMethod).toBe('username');
      });
    });

    describe('existing detection handling', () => {
      it('should skip detection if incumbent already exists', async () => {
        vi.mocked(mockStorage.getIncumbentConfig).mockResolvedValue({
          id: 'existing-id',
          communityId: 'test-community',
          provider: 'collabland',
          botId: '704521096837464076',
          botUsername: 'Collab.Land',
          verificationChannelId: null,
          detectedAt: new Date(),
          confidence: 0.95,
          manualOverride: false,
          lastHealthCheck: null,
          healthStatus: 'unknown',
          detectedRoles: [],
          capabilities: KNOWN_INCUMBENTS.collabland.capabilities,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        const result = await detector.detectIncumbent('test-guild-id');

        expect(result.detected).toBe(true);
        expect(result.provider).toBe('collabland');
        expect(mockClient.guilds.fetch).not.toHaveBeenCalled();
      });

      it('should force re-detection when option is set', async () => {
        vi.mocked(mockStorage.getIncumbentConfig).mockResolvedValue({
          id: 'existing-id',
          communityId: 'test-community',
          provider: 'collabland',
          botId: '704521096837464076',
          botUsername: 'Collab.Land',
          verificationChannelId: null,
          detectedAt: new Date(),
          confidence: 0.95,
          manualOverride: false,
          lastHealthCheck: null,
          healthStatus: 'unknown',
          detectedRoles: [],
          capabilities: KNOWN_INCUMBENTS.collabland.capabilities,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // Add Matrica bot (different from stored)
        const matricaBot = createMockMember('bot-456', 'matrica-verify', true);
        mockGuild.members.cache.set('bot-456', matricaBot);

        const result = await detector.detectIncumbent('test-guild-id', {
          forceRedetect: true,
        });

        expect(mockClient.guilds.fetch).toHaveBeenCalled();
        expect(result.provider).toBe('matrica'); // New detection
      });
    });

    describe('no incumbent scenarios', () => {
      it('should return no detection for clean guild', async () => {
        const result = await detector.detectIncumbent('test-guild-id');

        expect(result.detected).toBe(false);
        expect(result.provider).toBeNull();
        expect(result.confidence).toBe(0);
        expect(result.detectionMethod).toBe('none');
      });

      it('should handle guild not found', async () => {
        vi.mocked(mockClient.guilds.fetch).mockResolvedValue(null);

        const result = await detector.detectIncumbent('nonexistent-guild');

        expect(result.detected).toBe(false);
      });
    });
  });

  describe('buildIncumbentInfo', () => {
    it('should build complete incumbent info with bot', async () => {
      const collabLandBot = createMockMember('704521096837464076', 'Collab.Land', true);
      mockGuild.members.cache.set('704521096837464076', collabLandBot);

      // Add some roles
      mockGuild.roles.cache.set('holder-role', createMockRole('holder-role', 'Holder', 50));
      mockGuild.roles.cache.set('whale-role', createMockRole('whale-role', 'Whale', 10));
      mockGuild.roles.cache.set('regular-role', createMockRole('regular-role', 'Member', 200));

      // Pass the bot info as a plain object (matches actual detection result)
      const botInfo = {
        id: '704521096837464076',
        username: 'Collab.Land',
        joinedAt: new Date('2024-01-01'),
      };

      const info = await detector.buildIncumbentInfo(
        mockGuild as unknown as Parameters<typeof detector.buildIncumbentInfo>[0],
        'collabland',
        botInfo
      );

      expect(info.provider).toBe('collabland');
      expect(info.confidence).toBe(CONFIDENCE.BOT_ID_MATCH);
      expect(info.bot?.id).toBe('704521096837464076');
      expect(info.capabilities.hasBalanceCheck).toBe(true);
      expect(info.capabilities.hasTierSystem).toBe(true);
      expect(info.roles.length).toBeGreaterThan(0);
    });

    it('should identify likely token-gated roles', async () => {
      mockGuild.roles.cache.set('holder-role', createMockRole('holder-role', 'NFT Holder', 50));
      mockGuild.roles.cache.set('verified-role', createMockRole('verified-role', 'Verified Member', 100));
      mockGuild.roles.cache.set('admin-role', createMockRole('admin-role', 'Admin', 5));

      const info = await detector.buildIncumbentInfo(
        mockGuild as unknown as Parameters<typeof detector.buildIncumbentInfo>[0],
        'collabland',
        null
      );

      const holderRole = info.roles.find(r => r.name === 'NFT Holder');
      const adminRole = info.roles.find(r => r.name === 'Admin');

      expect(holderRole?.likelyTokenGated).toBe(true);
      expect(holderRole?.confidence).toBe(CONFIDENCE.ROLE_LIKELY_GATED);
      expect(adminRole?.likelyTokenGated).toBe(false);
    });
  });

  describe('detectAndSave', () => {
    it('should save detection result to storage', async () => {
      const collabLandBot = createMockMember('704521096837464076', 'Collab.Land', true);
      mockGuild.members.cache.set('704521096837464076', collabLandBot);

      const info = await detector.detectAndSave('community-uuid', 'test-guild-id');

      expect(info).not.toBeNull();
      expect(mockStorage.saveIncumbentConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          communityId: 'community-uuid',
          provider: 'collabland',
          botId: '704521096837464076',
        })
      );
      expect(mockStorage.initializeShadowMode).toHaveBeenCalledWith('community-uuid');
    });

    it('should return null if no incumbent detected', async () => {
      const info = await detector.detectAndSave('community-uuid', 'clean-guild');

      expect(info).toBeNull();
      expect(mockStorage.saveIncumbentConfig).not.toHaveBeenCalled();
    });
  });

  describe('CONFIDENCE constants', () => {
    it('should have proper confidence ordering', () => {
      expect(CONFIDENCE.BOT_ID_MATCH).toBeGreaterThan(CONFIDENCE.USERNAME_MATCH);
      expect(CONFIDENCE.USERNAME_MATCH).toBeGreaterThan(CONFIDENCE.CHANNEL_MATCH);
      expect(CONFIDENCE.CHANNEL_MATCH).toBeGreaterThan(CONFIDENCE.ROLE_PATTERN_ONLY);
      expect(CONFIDENCE.ROLE_PATTERN_ONLY).toBeGreaterThan(CONFIDENCE.GENERIC_SUSPECT);
    });

    it('should have confidence values between 0 and 1', () => {
      Object.values(CONFIDENCE).forEach(value => {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      });
    });
  });
});

describe('CoexistenceStorage Integration', () => {
  // These tests verify the contract between IncumbentDetector and ICoexistenceStorage
  it('should use correct storage method signatures', () => {
    const storage = createMockStorage();

    // Verify method signatures match interface
    expect(storage.getIncumbentConfig).toBeDefined();
    expect(storage.saveIncumbentConfig).toBeDefined();
    expect(storage.initializeShadowMode).toBeDefined();
    expect(storage.getCurrentMode).toBeDefined();
  });
});
