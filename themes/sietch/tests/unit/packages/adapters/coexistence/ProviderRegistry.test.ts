/**
 * ProviderRegistry Unit Tests
 *
 * Sprint 103: Provider Registry
 *
 * Tests the extensible provider detection system:
 * - Builtin provider loading (filesystem + fallback)
 * - Custom provider matching
 * - Pattern validation (ReDoS safety)
 * - Provider lookup
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  ProviderRegistry,
  createProviderRegistry,
  MATCH_CONFIDENCE,
  type CustomProviderRecord,
} from '../../../../../src/packages/adapters/coexistence/ProviderRegistry.js';

// Mock the logger module
vi.mock('../../../../../src/packages/infrastructure/logging/index.js', () => ({
  createLogger: vi.fn(() => ({
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Mock fs module for provider loading tests
vi.mock('node:fs', async () => {
  const actual = await vi.importActual('node:fs');
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false), // Default: providers dir doesn't exist
    readdirSync: vi.fn().mockReturnValue([]),
    readFileSync: vi.fn(),
  };
});

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = createProviderRegistry();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Initialization', () => {
    it('should create registry with createProviderRegistry', () => {
      const registry = createProviderRegistry();
      expect(registry).toBeInstanceOf(ProviderRegistry);
    });

    it('should not be initialized before calling initialize()', () => {
      expect(registry.isInitialized()).toBe(false);
    });

    it('should be initialized after calling initialize()', async () => {
      await registry.initialize();
      expect(registry.isInitialized()).toBe(true);
    });

    it('should only initialize once', async () => {
      await registry.initialize();
      await registry.initialize();
      expect(registry.isInitialized()).toBe(true);
    });
  });

  describe('Fallback Providers', () => {
    it('should load fallback providers when filesystem unavailable', async () => {
      await registry.initialize();

      const providers = registry.getBuiltinProviders();

      expect(providers.length).toBeGreaterThanOrEqual(3);
      expect(providers.map(p => p.slug)).toContain('collabland');
      expect(providers.map(p => p.slug)).toContain('matrica');
      expect(providers.map(p => p.slug)).toContain('guild.xyz');
    });

    it('should have correct Collab.Land bot ID', async () => {
      await registry.initialize();

      const provider = await registry.getProvider('collabland');

      expect(provider).not.toBeNull();
      expect(provider?.botIds).toContain('704521096837464076');
    });

    it('should mark all fallback providers as builtin', async () => {
      await registry.initialize();

      const providers = registry.getBuiltinProviders();

      for (const provider of providers) {
        expect(provider.isBuiltin).toBe(true);
        expect(provider.communityId).toBeNull();
      }
    });
  });

  describe('Provider Lookup', () => {
    it('should find builtin provider by slug', async () => {
      await registry.initialize();

      const collabland = await registry.getProvider('collabland');
      const matrica = await registry.getProvider('matrica');
      const guildxyz = await registry.getProvider('guild.xyz');

      expect(collabland?.name).toBe('Collab.Land');
      expect(matrica?.name).toBe('Matrica');
      expect(guildxyz?.name).toBe('Guild.xyz');
    });

    it('should return null for unknown provider', async () => {
      await registry.initialize();

      const unknown = await registry.getProvider('unknown-provider');

      expect(unknown).toBeNull();
    });
  });

  describe('Provider Matching', () => {
    beforeEach(async () => {
      await registry.initialize();
    });

    it('should match by bot ID with highest confidence', async () => {
      const matches = await registry.matchAllProviders(null, {
        botIds: ['704521096837464076'],
      });

      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].provider.slug).toBe('collabland');
      expect(matches[0].matchType).toBe('bot_id');
      expect(matches[0].confidence).toBe(MATCH_CONFIDENCE.BOT_ID * 1.0); // weight 1.0
    });

    it('should match by username pattern', async () => {
      const matches = await registry.matchAllProviders(null, {
        botUsernames: ['collab.land#1234'],
      });

      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].provider.slug).toBe('collabland');
      expect(matches[0].matchType).toBe('username');
    });

    it('should match by channel pattern', async () => {
      const matches = await registry.matchAllProviders(null, {
        channelNames: ['collabland-join', 'general', 'guild-verify'],
      });

      expect(matches.length).toBeGreaterThan(0);
      // Should find both collabland and guild.xyz
      const slugs = matches.map(m => m.provider.slug);
      expect(slugs).toContain('collabland');
      expect(slugs).toContain('guild.xyz');
    });

    it('should match by role pattern', async () => {
      const matches = await registry.matchAllProviders(null, {
        roleNames: ['holder', 'whale', 'admin'],
      });

      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].matchType).toBe('role');
    });

    it('should return highest confidence match first', async () => {
      const matches = await registry.matchAllProviders(null, {
        botIds: ['704521096837464076'],
        channelNames: ['guild-verify'],
        roleNames: ['holder'],
      });

      // Bot ID match should be first (highest confidence)
      expect(matches[0].matchType).toBe('bot_id');
      expect(matches[0].confidence).toBeGreaterThan(matches[matches.length - 1].confidence);
    });

    it('should dedupe matches keeping highest confidence per provider', async () => {
      const matches = await registry.matchAllProviders(null, {
        botIds: ['704521096837464076'],
        channelNames: ['collabland-join', 'verify'],
        roleNames: ['holder', 'verified'],
      });

      // Should only have one match per provider
      const slugCounts = matches.reduce((acc, m) => {
        acc[m.provider.slug] = (acc[m.provider.slug] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      for (const slug of Object.keys(slugCounts)) {
        expect(slugCounts[slug]).toBe(1);
      }
    });
  });

  describe('Custom Providers', () => {
    it('should load custom providers from getter', async () => {
      const customProviders: CustomProviderRecord[] = [
        {
          id: 'custom-1',
          slug: 'my-custom-bot',
          name: 'My Custom Bot',
          communityId: 'community-123',
          botIds: ['999888777666555444'],
          channelPatterns: ['custom-verify'],
          rolePatterns: ['custom-holder'],
          weight: 0.85,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const getter = vi.fn().mockResolvedValue(customProviders);
      const registryWithCustom = createProviderRegistry(getter);
      await registryWithCustom.initialize();

      const matches = await registryWithCustom.matchCustomProviders('community-123', {
        botIds: ['999888777666555444'],
      });

      expect(getter).toHaveBeenCalledWith('community-123');
      expect(matches.length).toBe(1);
      expect(matches[0].provider.slug).toBe('my-custom-bot');
    });

    it('should skip inactive custom providers', async () => {
      const customProviders: CustomProviderRecord[] = [
        {
          id: 'custom-1',
          slug: 'inactive-bot',
          name: 'Inactive Bot',
          communityId: 'community-123',
          botIds: ['111222333444555666'],
          channelPatterns: [],
          rolePatterns: [],
          weight: 0.8,
          isActive: false, // Inactive
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const getter = vi.fn().mockResolvedValue(customProviders);
      const registryWithCustom = createProviderRegistry(getter);
      await registryWithCustom.initialize();

      const matches = await registryWithCustom.matchCustomProviders('community-123', {
        botIds: ['111222333444555666'],
      });

      expect(matches.length).toBe(0);
    });
  });

  describe('Pattern Validation', () => {
    beforeEach(async () => {
      await registry.initialize();
    });

    it('should accept simple patterns', () => {
      expect(registry.validatePattern('verify')).toBe(true);
      expect(registry.validatePattern('holder')).toBe(true);
      expect(registry.validatePattern('guild-join')).toBe(true);
    });

    it('should accept valid regex patterns', () => {
      expect(registry.validatePattern('verify.*')).toBe(true);
      expect(registry.validatePattern('holder-[0-9]+')).toBe(true);
    });

    it('should reject very long patterns', () => {
      const longPattern = 'a'.repeat(101);
      expect(registry.validatePattern(longPattern)).toBe(false);
    });

    it('should reject invalid regex', () => {
      expect(registry.validatePattern('[invalid')).toBe(false);
      expect(registry.validatePattern('(?:unclosed')).toBe(false);
    });
  });

  describe('Provider Display Names', () => {
    beforeEach(async () => {
      await registry.initialize();
    });

    it('should return correct display name for Collab.Land', () => {
      expect(registry.getProviderDisplayName('collabland')).toBe('Collab.Land');
    });

    it('should return correct display name for Matrica', () => {
      expect(registry.getProviderDisplayName('matrica')).toBe('Matrica');
    });

    it('should return correct display name for Guild.xyz', () => {
      expect(registry.getProviderDisplayName('guild.xyz')).toBe('Guild.xyz');
    });

    it('should format unknown slugs nicely', () => {
      expect(registry.getProviderDisplayName('my-custom-bot')).toBe('My Custom Bot');
      expect(registry.getProviderDisplayName('some_other_bot')).toBe('Some Other Bot');
    });
  });

  describe('Confidence Constants', () => {
    it('should have correct confidence values', () => {
      expect(MATCH_CONFIDENCE.BOT_ID).toBe(0.95);
      expect(MATCH_CONFIDENCE.USERNAME).toBe(0.85);
      expect(MATCH_CONFIDENCE.CHANNEL).toBe(0.70);
      expect(MATCH_CONFIDENCE.ROLE).toBe(0.50);
      expect(MATCH_CONFIDENCE.GENERIC).toBe(0.40);
    });
  });
});
