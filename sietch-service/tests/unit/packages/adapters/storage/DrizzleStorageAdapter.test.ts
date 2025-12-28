/**
 * DrizzleStorageAdapter Unit Tests
 *
 * Sprint 40: Drizzle Storage Adapter
 *
 * Tests for the DrizzleStorageAdapter that implements IStorageProvider.
 * These are unit tests that mock the database layer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DrizzleStorageAdapter } from '../../../../../src/packages/adapters/storage/DrizzleStorageAdapter.js';

// =============================================================================
// Mock Setup
// =============================================================================

// Mock postgres client
const mockClient = {
  end: vi.fn().mockResolvedValue(undefined),
};

// Test data
const TEST_TENANT_ID = '123e4567-e89b-12d3-a456-426614174000';
const TEST_COMMUNITY = {
  id: TEST_TENANT_ID,
  name: 'Test Community',
  themeId: 'basic',
  subscriptionTier: 'free',
  discordGuildId: '123456789',
  telegramChatId: null,
  isActive: true,
  settings: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};
const TEST_PROFILE = {
  id: 'aaaaaaaa-bbbb-1ccc-dddd-eeeeeeeeeeee',
  communityId: TEST_TENANT_ID,
  discordId: '987654321',
  telegramId: null,
  walletAddress: '0x1234567890abcdef',
  tier: 'gold',
  currentRank: 5,
  activityScore: 100,
  convictionScore: 50,
  joinedAt: new Date(),
  lastSeenAt: new Date(),
  firstClaimAt: null,
  metadata: { displayName: 'TestUser' },
  createdAt: new Date(),
  updatedAt: new Date(),
};
const TEST_BADGE = {
  id: 'bbbbbbbb-cccc-1ddd-eeee-ffffffffffff',
  communityId: TEST_TENANT_ID,
  profileId: TEST_PROFILE.id,
  badgeType: 'water_sharer',
  awardedAt: new Date(),
  awardedBy: null,
  revokedAt: null,
  metadata: {},
  createdAt: new Date(),
};
const TEST_MANIFEST = {
  id: 'cccccccc-dddd-1eee-ffff-000000000000',
  communityId: TEST_TENANT_ID,
  version: 1,
  content: {
    schemaVersion: '1.0',
    theme: { themeId: 'basic' },
    roles: [],
    channels: [],
    categories: [],
  },
  checksum: 'abc123',
  synthesizedAt: new Date(),
  synthesizedBy: 'system',
  isActive: true,
  createdAt: new Date(),
};
const TEST_SHADOW_STATE = {
  id: 'dddddddd-eeee-1fff-0000-111111111111',
  communityId: TEST_TENANT_ID,
  manifestVersion: 1,
  appliedAt: new Date(),
  appliedBy: 'system',
  resources: { roles: {}, channels: {}, categories: {} },
  checksum: 'abc123',
  status: 'applied',
  createdAt: new Date(),
};

// Create mock database
function createMockDb() {
  const createChain = (finalResult: unknown) => {
    const chain: Record<string, any> = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockReturnValue(Promise.resolve(finalResult));
    chain.offset = vi.fn().mockReturnValue(chain);
    chain.orderBy = vi.fn().mockReturnValue(Promise.resolve(finalResult));
    chain.returning = vi.fn().mockReturnValue(Promise.resolve(finalResult));
    chain.set = vi.fn().mockReturnValue(chain);
    chain.values = vi.fn().mockReturnValue(chain);
    return chain;
  };

  return {
    select: vi.fn(() => createChain([])),
    insert: vi.fn(() => createChain([])),
    update: vi.fn(() => createChain([])),
    delete: vi.fn(() => createChain([])),
    execute: vi.fn().mockResolvedValue([]),
    transaction: vi.fn(async (fn: any) => fn({
      select: vi.fn(() => createChain([])),
      insert: vi.fn(() => createChain([])),
      update: vi.fn(() => createChain([])),
      delete: vi.fn(() => createChain([])),
      execute: vi.fn().mockResolvedValue([]),
    })),
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('DrizzleStorageAdapter', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let adapter: DrizzleStorageAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    adapter = new DrizzleStorageAdapter(
      mockDb as any,
      mockClient as any,
      TEST_TENANT_ID
    );
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ===========================================================================
  // Constructor & Properties
  // ===========================================================================

  describe('constructor', () => {
    it('should create instance with tenant ID', () => {
      expect(adapter).toBeDefined();
      expect(adapter.tenantId).toBe(TEST_TENANT_ID);
    });

    it('should create instance with debug mode', () => {
      const debugAdapter = new DrizzleStorageAdapter(
        mockDb as any,
        mockClient as any,
        TEST_TENANT_ID,
        { debug: true }
      );
      expect(debugAdapter).toBeDefined();
    });
  });

  // ===========================================================================
  // Community Operations
  // ===========================================================================

  describe('getCommunity', () => {
    it('should return community when found', async () => {
      const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([TEST_COMMUNITY]),
      };
      mockDb.select.mockReturnValue(chain as any);

      const result = await adapter.getCommunity(TEST_TENANT_ID);

      expect(result).toEqual(TEST_COMMUNITY);
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('should return null when not found', async () => {
      const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
      mockDb.select.mockReturnValue(chain as any);

      const result = await adapter.getCommunity('nonexistent-id');

      expect(result).toBeNull();
    });
  });

  describe('getCommunityByDiscordGuild', () => {
    it('should return community by Discord guild ID', async () => {
      const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([TEST_COMMUNITY]),
      };
      mockDb.select.mockReturnValue(chain as any);

      const result = await adapter.getCommunityByDiscordGuild('123456789');

      expect(result).toEqual(TEST_COMMUNITY);
    });

    it('should return null when not found', async () => {
      const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
      mockDb.select.mockReturnValue(chain as any);

      const result = await adapter.getCommunityByDiscordGuild('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getCommunityByTelegramChat', () => {
    it('should return community by Telegram chat ID', async () => {
      const communityWithTelegram = { ...TEST_COMMUNITY, telegramChatId: '111222333' };
      const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([communityWithTelegram]),
      };
      mockDb.select.mockReturnValue(chain as any);

      const result = await adapter.getCommunityByTelegramChat('111222333');

      expect(result).toEqual(communityWithTelegram);
    });
  });

  describe('createCommunity', () => {
    it('should create and return new community', async () => {
      const chain = {
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([TEST_COMMUNITY]),
      };
      mockDb.insert.mockReturnValue(chain as any);

      const result = await adapter.createCommunity({
        name: 'Test Community',
      });

      expect(result).toEqual(TEST_COMMUNITY);
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe('updateCommunity', () => {
    it('should update and return community', async () => {
      const updatedCommunity = { ...TEST_COMMUNITY, name: 'Updated Name' };
      const chain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([updatedCommunity]),
      };
      mockDb.update.mockReturnValue(chain as any);

      const result = await adapter.updateCommunity(TEST_TENANT_ID, {
        name: 'Updated Name',
      });

      expect(result).toEqual(updatedCommunity);
    });

    it('should return null when community not found', async () => {
      const chain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([]),
      };
      mockDb.update.mockReturnValue(chain as any);

      const result = await adapter.updateCommunity('nonexistent', {
        name: 'Updated',
      });

      expect(result).toBeNull();
    });
  });

  describe('deactivateCommunity', () => {
    it('should deactivate community and return true', async () => {
      const chain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ ...TEST_COMMUNITY, isActive: false }]),
      };
      mockDb.update.mockReturnValue(chain as any);

      const result = await adapter.deactivateCommunity(TEST_TENANT_ID);

      expect(result).toBe(true);
    });

    it('should return false when community not found', async () => {
      const chain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([]),
      };
      mockDb.update.mockReturnValue(chain as any);

      const result = await adapter.deactivateCommunity('nonexistent');

      expect(result).toBe(false);
    });
  });

  // ===========================================================================
  // Profile Operations
  // ===========================================================================

  describe('getProfile', () => {
    it('should return profile when found', async () => {
      const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([TEST_PROFILE]),
      };
      mockDb.select.mockReturnValue(chain as any);

      const result = await adapter.getProfile(TEST_PROFILE.id);

      expect(result).toEqual(TEST_PROFILE);
    });

    it('should return null when not found', async () => {
      const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
      mockDb.select.mockReturnValue(chain as any);

      const result = await adapter.getProfile('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getProfileByDiscordId', () => {
    it('should return profile by Discord ID', async () => {
      const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([TEST_PROFILE]),
      };
      mockDb.select.mockReturnValue(chain as any);

      const result = await adapter.getProfileByDiscordId('987654321');

      expect(result).toEqual(TEST_PROFILE);
    });
  });

  describe('getProfileByTelegramId', () => {
    it('should return profile by Telegram ID', async () => {
      const profileWithTelegram = { ...TEST_PROFILE, telegramId: '111222' };
      const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([profileWithTelegram]),
      };
      mockDb.select.mockReturnValue(chain as any);

      const result = await adapter.getProfileByTelegramId('111222');

      expect(result).toEqual(profileWithTelegram);
    });
  });

  describe('getProfileByWallet', () => {
    it('should return profile by wallet address', async () => {
      const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([TEST_PROFILE]),
      };
      mockDb.select.mockReturnValue(chain as any);

      const result = await adapter.getProfileByWallet('0x1234567890abcdef');

      expect(result).toEqual(TEST_PROFILE);
    });
  });

  describe('createProfile', () => {
    it('should create profile with tenant ID', async () => {
      const chain = {
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([TEST_PROFILE]),
      };
      mockDb.insert.mockReturnValue(chain as any);

      const result = await adapter.createProfile({
        discordId: '987654321',
        communityId: TEST_TENANT_ID,
      });

      expect(result).toEqual(TEST_PROFILE);
    });
  });

  describe('updateProfile', () => {
    it('should update and return profile', async () => {
      const updatedProfile = { ...TEST_PROFILE, tier: 'platinum' };
      const chain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([updatedProfile]),
      };
      mockDb.update.mockReturnValue(chain as any);

      const result = await adapter.updateProfile(TEST_PROFILE.id, {
        tier: 'platinum',
      });

      expect(result).toEqual(updatedProfile);
    });

    it('should return null when profile not found', async () => {
      const chain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([]),
      };
      mockDb.update.mockReturnValue(chain as any);

      const result = await adapter.updateProfile('nonexistent', {
        tier: 'platinum',
      });

      expect(result).toBeNull();
    });
  });

  describe('deleteProfile', () => {
    it('should delete profile and return true', async () => {
      const chain = {
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([TEST_PROFILE]),
      };
      mockDb.delete.mockReturnValue(chain as any);

      const result = await adapter.deleteProfile(TEST_PROFILE.id);

      expect(result).toBe(true);
    });

    it('should return false when profile not found', async () => {
      const chain = {
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([]),
      };
      mockDb.delete.mockReturnValue(chain as any);

      const result = await adapter.deleteProfile('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('touchProfile', () => {
    it('should update lastSeenAt timestamp', async () => {
      const chain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      };
      mockDb.update.mockReturnValue(chain as any);

      await adapter.touchProfile(TEST_PROFILE.id);

      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Badge Operations
  // ===========================================================================

  describe('getBadge', () => {
    it('should return badge when found', async () => {
      const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([TEST_BADGE]),
      };
      mockDb.select.mockReturnValue(chain as any);

      const result = await adapter.getBadge(TEST_BADGE.id);

      expect(result).toEqual(TEST_BADGE);
    });
  });

  describe('getBadgesForProfile', () => {
    it('should return badges for profile', async () => {
      const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue([TEST_BADGE]),
      };
      mockDb.select.mockReturnValue(chain as any);

      const result = await adapter.getBadgesForProfile(TEST_PROFILE.id);

      expect(result).toEqual([TEST_BADGE]);
    });
  });

  describe('hasBadge', () => {
    it('should return true when profile has badge', async () => {
      const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ count: 1 }]),
      };
      mockDb.select.mockReturnValue(chain as any);

      const result = await adapter.hasBadge(TEST_PROFILE.id, 'water_sharer');

      expect(result).toBe(true);
    });

    it('should return false when profile does not have badge', async () => {
      const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ count: 0 }]),
      };
      mockDb.select.mockReturnValue(chain as any);

      const result = await adapter.hasBadge(TEST_PROFILE.id, 'nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('awardBadge', () => {
    it('should create badge with tenant ID', async () => {
      const chain = {
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([TEST_BADGE]),
      };
      mockDb.insert.mockReturnValue(chain as any);

      const result = await adapter.awardBadge({
        profileId: TEST_PROFILE.id,
        badgeType: 'water_sharer',
        communityId: TEST_TENANT_ID,
      });

      expect(result).toEqual(TEST_BADGE);
    });
  });

  describe('revokeBadge', () => {
    it('should revoke badge and return true', async () => {
      const chain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ ...TEST_BADGE, revokedAt: new Date() }]),
      };
      mockDb.update.mockReturnValue(chain as any);

      const result = await adapter.revokeBadge(TEST_BADGE.id);

      expect(result).toBe(true);
    });
  });

  describe('getBadgeLineage', () => {
    it('should return badge lineage', async () => {
      const lineageResult = [
        {
          badge_id: TEST_BADGE.id,
          profile_id: TEST_PROFILE.id,
          display_name: 'TestUser',
          awarded_at: new Date(),
          depth: 0,
        },
      ];
      mockDb.execute.mockResolvedValue(lineageResult);

      const result = await adapter.getBadgeLineage(TEST_BADGE.id);

      expect(result).toHaveLength(1);
      expect(result[0].badgeId).toBe(TEST_BADGE.id);
      expect(result[0].depth).toBe(0);
    });

    it('should respect maxDepth parameter', async () => {
      mockDb.execute.mockResolvedValue([]);

      await adapter.getBadgeLineage(TEST_BADGE.id, 5);

      expect(mockDb.execute).toHaveBeenCalled();
    });
  });

  describe('getBadgesAwardedBy', () => {
    it('should return badges awarded by profile', async () => {
      const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue([TEST_BADGE]),
      };
      mockDb.select.mockReturnValue(chain as any);

      const result = await adapter.getBadgesAwardedBy(TEST_PROFILE.id);

      expect(result).toEqual([TEST_BADGE]);
    });
  });

  // ===========================================================================
  // Manifest Operations
  // ===========================================================================

  describe('getCurrentManifest', () => {
    it('should return current active manifest', async () => {
      const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([TEST_MANIFEST]),
      };
      mockDb.select.mockReturnValue(chain as any);

      const result = await adapter.getCurrentManifest();

      expect(result).toEqual(TEST_MANIFEST);
    });

    it('should return null when no active manifest', async () => {
      const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
      mockDb.select.mockReturnValue(chain as any);

      const result = await adapter.getCurrentManifest();

      expect(result).toBeNull();
    });
  });

  describe('getManifestByVersion', () => {
    it('should return manifest by version', async () => {
      const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([TEST_MANIFEST]),
      };
      mockDb.select.mockReturnValue(chain as any);

      const result = await adapter.getManifestByVersion(1);

      expect(result).toEqual(TEST_MANIFEST);
    });
  });

  describe('createManifest', () => {
    it('should create manifest with auto-incremented version', async () => {
      // Mock getCurrentManifest to return null (first manifest)
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
      mockDb.select.mockReturnValue(selectChain as any);

      const insertChain = {
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([TEST_MANIFEST]),
      };
      mockDb.insert.mockReturnValue(insertChain as any);

      const result = await adapter.createManifest({
        content: TEST_MANIFEST.content,
        checksum: 'abc123',
        communityId: TEST_TENANT_ID,
      });

      expect(result).toEqual(TEST_MANIFEST);
    });

    it('should increment version from current manifest', async () => {
      const newManifest = { ...TEST_MANIFEST, version: 2 };

      // Mock getCurrentManifest to return existing manifest
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([TEST_MANIFEST]),
      };
      mockDb.select.mockReturnValue(selectChain as any);

      const insertChain = {
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([newManifest]),
      };
      mockDb.insert.mockReturnValue(insertChain as any);

      const result = await adapter.createManifest({
        content: TEST_MANIFEST.content,
        checksum: 'def456',
        communityId: TEST_TENANT_ID,
      });

      expect(result.version).toBe(2);
    });
  });

  describe('deactivateCurrentManifest', () => {
    it('should deactivate all active manifests', async () => {
      const chain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      };
      mockDb.update.mockReturnValue(chain as any);

      await adapter.deactivateCurrentManifest();

      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Shadow State Operations
  // ===========================================================================

  describe('getCurrentShadowState', () => {
    it('should return current applied shadow state', async () => {
      const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([TEST_SHADOW_STATE]),
      };
      mockDb.select.mockReturnValue(chain as any);

      const result = await adapter.getCurrentShadowState();

      expect(result).toEqual(TEST_SHADOW_STATE);
    });
  });

  describe('getShadowStateByVersion', () => {
    it('should return shadow state by version', async () => {
      const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([TEST_SHADOW_STATE]),
      };
      mockDb.select.mockReturnValue(chain as any);

      const result = await adapter.getShadowStateByVersion(1);

      expect(result).toEqual(TEST_SHADOW_STATE);
    });
  });

  describe('createShadowState', () => {
    it('should create shadow state with tenant ID', async () => {
      const chain = {
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([TEST_SHADOW_STATE]),
      };
      mockDb.insert.mockReturnValue(chain as any);

      const result = await adapter.createShadowState({
        manifestVersion: 1,
        resources: { roles: {}, channels: {}, categories: {} },
        checksum: 'abc123',
        communityId: TEST_TENANT_ID,
      });

      expect(result).toEqual(TEST_SHADOW_STATE);
    });
  });

  describe('updateShadowStateStatus', () => {
    it('should update shadow state status', async () => {
      const updatedShadow = { ...TEST_SHADOW_STATE, status: 'failed' };
      const chain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([updatedShadow]),
      };
      mockDb.update.mockReturnValue(chain as any);

      const result = await adapter.updateShadowStateStatus(
        TEST_SHADOW_STATE.id,
        'failed'
      );

      expect(result).toEqual(updatedShadow);
    });
  });

  // ===========================================================================
  // Transaction Support
  // ===========================================================================

  describe('transaction', () => {
    it('should execute operations in transaction', async () => {
      const result = await adapter.transaction(async (tx) => {
        return 'transaction result';
      });

      expect(mockDb.transaction).toHaveBeenCalled();
      expect(result).toBe('transaction result');
    });

    it('should rollback on error', async () => {
      mockDb.transaction.mockImplementationOnce(async (fn: any) => {
        return fn(mockDb);
      });

      await expect(
        adapter.transaction(async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');
    });
  });

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  describe('close', () => {
    it('should close database connection', async () => {
      await adapter.close();

      expect(mockClient.end).toHaveBeenCalled();
    });
  });
});

// =============================================================================
// IStorageProvider Interface Tests
// =============================================================================

describe('IStorageProvider Interface', () => {
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockDb = createMockDb();
  });

  it('should implement all required methods', () => {
    const adapter = new DrizzleStorageAdapter(
      mockDb as any,
      mockClient as any,
      TEST_TENANT_ID
    );

    // Community operations
    expect(typeof adapter.getCommunity).toBe('function');
    expect(typeof adapter.getCommunityByDiscordGuild).toBe('function');
    expect(typeof adapter.getCommunityByTelegramChat).toBe('function');
    expect(typeof adapter.createCommunity).toBe('function');
    expect(typeof adapter.updateCommunity).toBe('function');
    expect(typeof adapter.deactivateCommunity).toBe('function');

    // Profile operations
    expect(typeof adapter.getProfile).toBe('function');
    expect(typeof adapter.getProfileByDiscordId).toBe('function');
    expect(typeof adapter.getProfileByTelegramId).toBe('function');
    expect(typeof adapter.getProfileByWallet).toBe('function');
    expect(typeof adapter.getProfiles).toBe('function');
    expect(typeof adapter.getProfilesByTier).toBe('function');
    expect(typeof adapter.createProfile).toBe('function');
    expect(typeof adapter.updateProfile).toBe('function');
    expect(typeof adapter.deleteProfile).toBe('function');
    expect(typeof adapter.touchProfile).toBe('function');

    // Badge operations
    expect(typeof adapter.getBadge).toBe('function');
    expect(typeof adapter.getBadgesForProfile).toBe('function');
    expect(typeof adapter.getBadgesByType).toBe('function');
    expect(typeof adapter.hasBadge).toBe('function');
    expect(typeof adapter.awardBadge).toBe('function');
    expect(typeof adapter.revokeBadge).toBe('function');
    expect(typeof adapter.getBadgeLineage).toBe('function');
    expect(typeof adapter.getBadgesAwardedBy).toBe('function');

    // Manifest operations
    expect(typeof adapter.getCurrentManifest).toBe('function');
    expect(typeof adapter.getManifestByVersion).toBe('function');
    expect(typeof adapter.getManifestHistory).toBe('function');
    expect(typeof adapter.createManifest).toBe('function');
    expect(typeof adapter.deactivateCurrentManifest).toBe('function');

    // Shadow state operations
    expect(typeof adapter.getCurrentShadowState).toBe('function');
    expect(typeof adapter.getShadowStateByVersion).toBe('function');
    expect(typeof adapter.createShadowState).toBe('function');
    expect(typeof adapter.updateShadowStateStatus).toBe('function');

    // Transaction & lifecycle
    expect(typeof adapter.transaction).toBe('function');
    expect(typeof adapter.close).toBe('function');
  });

  it('should have tenantId property', () => {
    const adapter = new DrizzleStorageAdapter(
      mockDb as any,
      mockClient as any,
      TEST_TENANT_ID
    );

    expect(adapter.tenantId).toBe(TEST_TENANT_ID);
  });
});
