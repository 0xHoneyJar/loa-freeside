/**
 * IStorageProvider Interface Tests
 *
 * Sprint 40: Drizzle Storage Adapter
 *
 * Tests for the IStorageProvider type definitions and utility types.
 */

import { describe, it, expect } from 'vitest';
import type {
  IStorageProvider,
  QueryOptions,
  PaginatedResult,
  BadgeLineageNode,
  StorageProviderOptions,
} from '../../../../../src/packages/core/ports/IStorageProvider.js';

// =============================================================================
// Type Tests (compile-time verification)
// =============================================================================

describe('IStorageProvider Types', () => {
  // These tests verify type definitions at compile time
  // If the types are wrong, TypeScript will fail to compile

  describe('QueryOptions', () => {
    it('should allow partial options', () => {
      const options: QueryOptions = {};
      expect(options).toBeDefined();
    });

    it('should allow all options', () => {
      const options: QueryOptions = {
        limit: 10,
        offset: 20,
        orderBy: 'createdAt',
        orderDirection: 'desc',
      };
      expect(options.limit).toBe(10);
      expect(options.offset).toBe(20);
      expect(options.orderBy).toBe('createdAt');
      expect(options.orderDirection).toBe('desc');
    });

    it('should only allow valid orderDirection values', () => {
      const ascOptions: QueryOptions = { orderDirection: 'asc' };
      const descOptions: QueryOptions = { orderDirection: 'desc' };
      expect(ascOptions.orderDirection).toBe('asc');
      expect(descOptions.orderDirection).toBe('desc');
    });
  });

  describe('PaginatedResult', () => {
    it('should have items, total, and hasMore', () => {
      const result: PaginatedResult<string> = {
        items: ['a', 'b', 'c'],
        total: 100,
        hasMore: true,
      };
      expect(result.items).toHaveLength(3);
      expect(result.total).toBe(100);
      expect(result.hasMore).toBe(true);
    });

    it('should work with complex types', () => {
      interface TestItem {
        id: string;
        name: string;
      }
      const result: PaginatedResult<TestItem> = {
        items: [{ id: '1', name: 'Test' }],
        total: 1,
        hasMore: false,
      };
      expect(result.items[0].id).toBe('1');
    });
  });

  describe('BadgeLineageNode', () => {
    it('should have all required fields', () => {
      const node: BadgeLineageNode = {
        badgeId: '123',
        profileId: '456',
        displayName: 'TestUser',
        awardedAt: new Date(),
        depth: 0,
      };
      expect(node.badgeId).toBe('123');
      expect(node.profileId).toBe('456');
      expect(node.displayName).toBe('TestUser');
      expect(node.depth).toBe(0);
    });

    it('should allow null displayName', () => {
      const node: BadgeLineageNode = {
        badgeId: '123',
        profileId: '456',
        displayName: null,
        awardedAt: new Date(),
        depth: 1,
      };
      expect(node.displayName).toBeNull();
    });
  });

  describe('StorageProviderOptions', () => {
    it('should require connectionString and tenantId', () => {
      const options: StorageProviderOptions = {
        connectionString: 'postgresql://localhost/test',
        tenantId: '123e4567-e89b-12d3-a456-426614174000',
      };
      expect(options.connectionString).toBeDefined();
      expect(options.tenantId).toBeDefined();
    });

    it('should allow optional debug and cacheTtl', () => {
      const options: StorageProviderOptions = {
        connectionString: 'postgresql://localhost/test',
        tenantId: '123e4567-e89b-12d3-a456-426614174000',
        debug: true,
        cacheTtl: 600,
      };
      expect(options.debug).toBe(true);
      expect(options.cacheTtl).toBe(600);
    });
  });
});

// =============================================================================
// Interface Contract Tests
// =============================================================================

describe('IStorageProvider Contract', () => {
  // Mock implementation for contract testing
  const createMockProvider = (): IStorageProvider => ({
    tenantId: '123e4567-e89b-12d3-a456-426614174000',

    // Community operations
    getCommunity: async () => null,
    getCommunityByDiscordGuild: async () => null,
    getCommunityByTelegramChat: async () => null,
    createCommunity: async (data) => ({ ...data, id: '1', createdAt: new Date(), updatedAt: new Date() } as any),
    updateCommunity: async () => null,
    deactivateCommunity: async () => false,

    // Profile operations
    getProfile: async () => null,
    getProfileByDiscordId: async () => null,
    getProfileByTelegramId: async () => null,
    getProfileByWallet: async () => null,
    getProfiles: async () => ({ items: [], total: 0, hasMore: false }),
    getProfilesByTier: async () => ({ items: [], total: 0, hasMore: false }),
    createProfile: async (data) => ({ ...data, id: '1', createdAt: new Date(), updatedAt: new Date() } as any),
    updateProfile: async () => null,
    deleteProfile: async () => false,
    touchProfile: async () => {},

    // Badge operations
    getBadge: async () => null,
    getBadgesForProfile: async () => [],
    getBadgesByType: async () => ({ items: [], total: 0, hasMore: false }),
    hasBadge: async () => false,
    awardBadge: async (data) => ({ ...data, id: '1', createdAt: new Date() } as any),
    revokeBadge: async () => false,
    getBadgeLineage: async () => [],
    getBadgesAwardedBy: async () => [],

    // Manifest operations
    getCurrentManifest: async () => null,
    getManifestByVersion: async () => null,
    getManifestHistory: async () => ({ items: [], total: 0, hasMore: false }),
    createManifest: async (data) => ({ ...data, id: '1', version: 1, createdAt: new Date() } as any),
    deactivateCurrentManifest: async () => {},

    // Shadow state operations
    getCurrentShadowState: async () => null,
    getShadowStateByVersion: async () => null,
    createShadowState: async (data) => ({ ...data, id: '1', createdAt: new Date() } as any),
    updateShadowStateStatus: async () => null,

    // Transaction & lifecycle
    transaction: async (fn) => fn({} as any),
    close: async () => {},
  });

  describe('Community Operations', () => {
    it('should return null for non-existent community', async () => {
      const provider = createMockProvider();
      expect(await provider.getCommunity('nonexistent')).toBeNull();
    });

    it('should return null for non-existent Discord guild', async () => {
      const provider = createMockProvider();
      expect(await provider.getCommunityByDiscordGuild('nonexistent')).toBeNull();
    });

    it('should return null for non-existent Telegram chat', async () => {
      const provider = createMockProvider();
      expect(await provider.getCommunityByTelegramChat('nonexistent')).toBeNull();
    });

    it('should create community with data', async () => {
      const provider = createMockProvider();
      const community = await provider.createCommunity({ name: 'Test' });
      expect(community).toBeDefined();
      expect(community.id).toBeDefined();
    });
  });

  describe('Profile Operations', () => {
    it('should return empty paginated result', async () => {
      const provider = createMockProvider();
      const result = await provider.getProfiles();
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.hasMore).toBe(false);
    });

    it('should accept query options', async () => {
      const provider = createMockProvider();
      const result = await provider.getProfiles({
        limit: 10,
        offset: 20,
        orderBy: 'createdAt',
        orderDirection: 'desc',
      });
      expect(result).toBeDefined();
    });
  });

  describe('Badge Operations', () => {
    it('should return false for hasBadge when no badge', async () => {
      const provider = createMockProvider();
      expect(await provider.hasBadge('profile', 'badge_type')).toBe(false);
    });

    it('should return empty array for lineage', async () => {
      const provider = createMockProvider();
      expect(await provider.getBadgeLineage('badge_id')).toEqual([]);
    });

    it('should accept maxDepth parameter', async () => {
      const provider = createMockProvider();
      expect(await provider.getBadgeLineage('badge_id', 5)).toEqual([]);
    });
  });

  describe('Manifest Operations', () => {
    it('should return null for current manifest when none exists', async () => {
      const provider = createMockProvider();
      expect(await provider.getCurrentManifest()).toBeNull();
    });

    it('should return empty paginated result for history', async () => {
      const provider = createMockProvider();
      const result = await provider.getManifestHistory();
      expect(result.items).toEqual([]);
    });
  });

  describe('Shadow State Operations', () => {
    it('should return null for current shadow state when none exists', async () => {
      const provider = createMockProvider();
      expect(await provider.getCurrentShadowState()).toBeNull();
    });
  });

  describe('Transaction Support', () => {
    it('should execute transaction callback', async () => {
      const provider = createMockProvider();
      let executed = false;
      await provider.transaction(async () => {
        executed = true;
        return 'result';
      });
      expect(executed).toBe(true);
    });
  });

  describe('Lifecycle', () => {
    it('should close without error', async () => {
      const provider = createMockProvider();
      await expect(provider.close()).resolves.toBeUndefined();
    });
  });
});
