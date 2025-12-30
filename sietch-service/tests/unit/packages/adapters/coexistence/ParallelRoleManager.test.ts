/**
 * ParallelRoleManager Unit Tests
 *
 * Sprint 58: Parallel Mode - Namespaced Role Management
 *
 * Tests for parallel role management including role creation,
 * positioning, syncing, and mode transitions.
 *
 * CRITICAL TEST: Verify namespaced roles have NO permissions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ParallelRoleManager,
  createParallelRoleManager,
  DEFAULT_NAMESPACE,
  DEFAULT_TIER_MAPPINGS,
  type GetMemberTier,
  type GetMemberTiersBatch,
} from '../../../../../src/packages/adapters/coexistence/ParallelRoleManager.js';
import type {
  ICoexistenceStorage,
  StoredIncumbentConfig,
  StoredParallelRoleConfig,
  StoredParallelRole,
  TierRoleMapping,
} from '../../../../../src/packages/core/ports/ICoexistenceStorage.js';
import { nullLogger } from '../../../../../src/packages/infrastructure/logging/index.js';

// =============================================================================
// Mock Helpers
// =============================================================================

/**
 * Mock Discord.js Collection with find/filter/map
 */
class MockCollection<K, V> extends Map<K, V> {
  find(fn: (value: V) => boolean): V | undefined {
    for (const value of this.values()) {
      if (fn(value)) return value;
    }
    return undefined;
  }

  filter(fn: (value: V) => boolean): MockCollection<K, V> {
    const result = new MockCollection<K, V>();
    for (const [key, value] of this.entries()) {
      if (fn(value)) result.set(key, value);
    }
    return result;
  }

  map<R>(fn: (value: V) => R): R[] {
    const result: R[] = [];
    for (const value of this.values()) {
      result.push(fn(value));
    }
    return result;
  }
}

/**
 * Create mock Discord Role
 */
function createMockRole(id: string, name: string, position: number) {
  return {
    id,
    name,
    position,
    setPosition: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Create mock GuildMember
 */
function createMockMember(
  id: string,
  username: string,
  roles: string[],
  isBot = false
) {
  const rolesCollection = new MockCollection<string, { id: string; name: string }>();
  for (const roleId of roles) {
    rolesCollection.set(roleId, { id: roleId, name: `Role-${roleId}` });
  }

  return {
    id,
    user: {
      id,
      username,
      bot: isBot,
    },
    roles: {
      cache: rolesCollection,
      add: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
  };
}

/**
 * Create mock Guild
 */
function createMockGuild(
  guildId: string,
  members: ReturnType<typeof createMockMember>[],
  roles: ReturnType<typeof createMockRole>[] = []
) {
  const membersCollection = new MockCollection<string, ReturnType<typeof createMockMember>>();
  for (const member of members) {
    membersCollection.set(member.id, member);
  }

  const rolesCollection = new MockCollection<string, ReturnType<typeof createMockRole>>();
  for (const role of roles) {
    rolesCollection.set(role.id, role);
  }

  return {
    id: guildId,
    members: {
      cache: membersCollection,
      fetch: vi.fn().mockResolvedValue(membersCollection),
    },
    roles: {
      cache: rolesCollection,
      create: vi.fn().mockImplementation(async (options: any) => {
        const newRole = createMockRole(
          `role-${Date.now()}`,
          options.name,
          options.position ?? 1
        );
        rolesCollection.set(newRole.id, newRole);
        return newRole;
      }),
    },
  };
}

/**
 * Create mock Discord client
 */
function createMockDiscordClient(guild: ReturnType<typeof createMockGuild>) {
  return {
    guilds: {
      fetch: vi.fn().mockResolvedValue(guild),
    },
  };
}

/**
 * Create mock storage with parallel mode support
 */
function createMockStorage(overrides: Partial<ICoexistenceStorage> = {}): ICoexistenceStorage {
  return {
    // Original methods from Sprint 56-57
    getIncumbentConfig: vi.fn().mockResolvedValue(null),
    saveIncumbentConfig: vi.fn(),
    updateIncumbentHealth: vi.fn(),
    deleteIncumbentConfig: vi.fn(),
    hasIncumbent: vi.fn().mockResolvedValue(false),
    getMigrationState: vi.fn().mockResolvedValue(null),
    saveMigrationState: vi.fn(),
    getCurrentMode: vi.fn().mockResolvedValue('shadow'),
    updateMode: vi.fn(),
    recordRollback: vi.fn(),
    initializeShadowMode: vi.fn(),
    getCommunitiesByMode: vi.fn().mockResolvedValue([]),
    getReadyCommunities: vi.fn().mockResolvedValue([]),
    getIncumbentHealthOverview: vi.fn().mockResolvedValue(new Map()),
    getShadowMemberState: vi.fn().mockResolvedValue(null),
    getShadowMemberStates: vi.fn().mockResolvedValue([]),
    saveShadowMemberState: vi.fn(),
    batchSaveShadowMemberStates: vi.fn(),
    deleteShadowMemberState: vi.fn(),
    saveDivergence: vi.fn(),
    getDivergences: vi.fn().mockResolvedValue([]),
    resolveDivergence: vi.fn(),
    getDivergenceSummary: vi.fn().mockResolvedValue({
      communityId: 'test',
      totalMembers: 0,
      matchCount: 0,
      arrakisHigherCount: 0,
      arrakisLowerCount: 0,
      mismatchCount: 0,
      accuracyPercent: 0,
    }),
    savePrediction: vi.fn(),
    validatePrediction: vi.fn(),
    getUnvalidatedPredictions: vi.fn().mockResolvedValue([]),
    calculateAccuracy: vi.fn().mockResolvedValue(0),

    // Sprint 58 parallel mode methods
    getParallelRoleConfig: vi.fn().mockResolvedValue(null),
    saveParallelRoleConfig: vi.fn(),
    deleteParallelRoleConfig: vi.fn(),
    isParallelEnabled: vi.fn().mockResolvedValue(false),
    getParallelRole: vi.fn().mockResolvedValue(null),
    getParallelRoles: vi.fn().mockResolvedValue([]),
    getParallelRoleByTier: vi.fn().mockResolvedValue(null),
    saveParallelRole: vi.fn(),
    updateParallelRolePosition: vi.fn(),
    updateParallelRoleMemberCount: vi.fn(),
    deleteParallelRole: vi.fn(),
    deleteAllParallelRoles: vi.fn(),
    getParallelMemberAssignment: vi.fn().mockResolvedValue(null),
    getParallelMemberAssignments: vi.fn().mockResolvedValue([]),
    saveParallelMemberAssignment: vi.fn(),
    batchSaveParallelMemberAssignments: vi.fn(),
    deleteParallelMemberAssignment: vi.fn(),
    getMembersByTier: vi.fn().mockResolvedValue([]),

    ...overrides,
  };
}

/**
 * Create mock incumbent config
 */
function createMockIncumbentConfig(
  communityId: string,
  detectedRoles: { id: string; position: number }[] = []
): StoredIncumbentConfig {
  return {
    id: 'config-1',
    communityId,
    provider: 'collabland',
    botId: '704521096837464076',
    botUsername: 'collab.land',
    verificationChannelId: 'verify-channel',
    detectedAt: new Date(),
    confidence: 0.95,
    manualOverride: false,
    lastHealthCheck: new Date(),
    healthStatus: 'healthy',
    detectedRoles: detectedRoles.map(r => ({
      id: r.id,
      name: `Role-${r.id}`,
      memberCount: 10,
      likelyTokenGated: true,
      confidence: 0.9,
    })),
    capabilities: {
      hasBalanceCheck: true,
      hasConvictionScoring: false,
      hasTierSystem: true,
      hasSocialLayer: false,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Create mock parallel role config
 */
function createMockParallelConfig(
  communityId: string,
  enabled = true
): StoredParallelRoleConfig {
  return {
    id: 'config-1',
    communityId,
    namespace: '@arrakis-',
    enabled,
    positionStrategy: 'below_incumbent',
    tierRoleMapping: DEFAULT_TIER_MAPPINGS,
    customRoleNames: {},
    grantPermissions: false,
    setupCompletedAt: new Date(),
    lastSyncAt: new Date(),
    totalRolesCreated: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Create mock parallel role
 */
function createMockParallelRole(
  communityId: string,
  tier: number,
  discordRoleId: string
): StoredParallelRole {
  return {
    id: `role-${tier}`,
    communityId,
    discordRoleId,
    roleName: `@arrakis-${tier === 1 ? 'holder' : tier === 2 ? 'believer' : 'diamond'}`,
    baseName: tier === 1 ? 'holder' : tier === 2 ? 'believer' : 'diamond',
    tier,
    minConviction: tier === 1 ? 1 : tier === 2 ? 50 : 80,
    position: 10 - tier,
    incumbentReferenceId: null,
    color: '#5865F2',
    mentionable: false,
    hoist: false,
    memberCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Create mock GetMemberTier callback
 */
function createMockGetMemberTier(
  tiers: Map<string, { tier: number; conviction: number }>
): GetMemberTier {
  return vi.fn().mockImplementation(async (communityId, memberId) => {
    return tiers.get(memberId) ?? null;
  });
}

/**
 * Create mock GetMemberTiersBatch callback
 */
function createMockGetMemberTiersBatch(
  tiers: Map<string, { tier: number; conviction: number }>
): GetMemberTiersBatch {
  return vi.fn().mockImplementation(async (communityId, memberIds) => {
    const result = new Map<string, { tier: number; conviction: number }>();
    for (const memberId of memberIds) {
      const tierInfo = tiers.get(memberId);
      if (tierInfo) {
        result.set(memberId, tierInfo);
      }
    }
    return result;
  });
}

// =============================================================================
// Tests
// =============================================================================

describe('ParallelRoleManager', () => {
  describe('setupParallelRoles', () => {
    it('creates namespaced roles with correct prefix', async () => {
      const guild = createMockGuild('guild-1', []);
      const discordClient = createMockDiscordClient(guild) as any;
      const storage = createMockStorage({
        getCurrentMode: vi.fn().mockResolvedValue('shadow'),
      });

      const tierMap = new Map<string, { tier: number; conviction: number }>();
      const manager = createParallelRoleManager(
        storage,
        discordClient as any,
        createMockGetMemberTier(tierMap),
        createMockGetMemberTiersBatch(tierMap),
        nullLogger
      );

      const result = await manager.setupParallelRoles({
        communityId: 'comm-1',
        guildId: 'guild-1',
        tierRoleMappings: DEFAULT_TIER_MAPPINGS,
      });

      expect(result.success).toBe(true);
      expect(result.rolesCreated).toBe(3);

      // Verify roles were created with correct names
      expect(guild.roles.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: '@arrakis-holder',
          permissions: [], // CRITICAL: NO permissions
        })
      );
      expect(guild.roles.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: '@arrakis-believer',
          permissions: [],
        })
      );
      expect(guild.roles.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: '@arrakis-diamond',
          permissions: [],
        })
      );
    });

    it('CRITICAL: creates roles with NO permissions', async () => {
      const guild = createMockGuild('guild-1', []);
      const discordClient = createMockDiscordClient(guild) as any;
      const storage = createMockStorage({
        getCurrentMode: vi.fn().mockResolvedValue('shadow'),
      });

      const tierMap = new Map<string, { tier: number; conviction: number }>();
      const manager = createParallelRoleManager(
        storage,
        discordClient as any,
        createMockGetMemberTier(tierMap),
        createMockGetMemberTiersBatch(tierMap),
        nullLogger
      );

      await manager.setupParallelRoles({
        communityId: 'comm-1',
        guildId: 'guild-1',
        tierRoleMappings: DEFAULT_TIER_MAPPINGS,
      });

      // Verify ALL role creations used empty permissions array
      const calls = (guild.roles.create as any).mock.calls;
      for (const call of calls) {
        expect(call[0].permissions).toEqual([]);
      }
    });

    it('uses custom namespace when provided', async () => {
      const guild = createMockGuild('guild-1', []);
      const discordClient = createMockDiscordClient(guild) as any;
      const storage = createMockStorage({
        getCurrentMode: vi.fn().mockResolvedValue('shadow'),
      });

      const tierMap = new Map<string, { tier: number; conviction: number }>();
      const manager = createParallelRoleManager(
        storage,
        discordClient as any,
        createMockGetMemberTier(tierMap),
        createMockGetMemberTiersBatch(tierMap),
        nullLogger
      );

      const result = await manager.setupParallelRoles({
        communityId: 'comm-1',
        guildId: 'guild-1',
        namespace: '[THJ] ',
        tierRoleMappings: [
          { tier: 1, baseName: 'member', color: '#5865F2', minConviction: 1 },
        ],
      });

      expect(result.success).toBe(true);
      expect(guild.roles.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: '[THJ] member',
        })
      );
    });

    it('positions roles below incumbent roles', async () => {
      const incumbentRole = createMockRole('incumbent-role', 'Holder', 10);
      const guild = createMockGuild('guild-1', [], [incumbentRole]);
      const discordClient = createMockDiscordClient(guild) as any;

      const incumbentConfig = createMockIncumbentConfig('comm-1', [
        { id: 'incumbent-role', position: 10 },
      ]);

      const storage = createMockStorage({
        getCurrentMode: vi.fn().mockResolvedValue('shadow'),
        getIncumbentConfig: vi.fn().mockResolvedValue(incumbentConfig),
      });

      const tierMap = new Map<string, { tier: number; conviction: number }>();
      const manager = createParallelRoleManager(
        storage,
        discordClient as any,
        createMockGetMemberTier(tierMap),
        createMockGetMemberTiersBatch(tierMap),
        nullLogger
      );

      await manager.setupParallelRoles({
        communityId: 'comm-1',
        guildId: 'guild-1',
        tierRoleMappings: DEFAULT_TIER_MAPPINGS,
        positionStrategy: 'below_incumbent',
      });

      // Roles should be positioned below position 10
      const calls = (guild.roles.create as any).mock.calls;
      for (const call of calls) {
        expect(call[0].position).toBeLessThan(10);
      }
    });

    it('fails when not in shadow or parallel mode', async () => {
      const guild = createMockGuild('guild-1', []);
      const discordClient = createMockDiscordClient(guild) as any;
      const storage = createMockStorage({
        getCurrentMode: vi.fn().mockResolvedValue('autonomous'),
      });

      const tierMap = new Map<string, { tier: number; conviction: number }>();
      const manager = createParallelRoleManager(
        storage,
        discordClient as any,
        createMockGetMemberTier(tierMap),
        createMockGetMemberTiersBatch(tierMap),
        nullLogger
      );

      const result = await manager.setupParallelRoles({
        communityId: 'comm-1',
        guildId: 'guild-1',
        tierRoleMappings: DEFAULT_TIER_MAPPINGS,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid mode');
    });

    it('handles existing roles gracefully', async () => {
      const existingRole = createMockRole('existing-1', '@arrakis-holder', 5);
      const guild = createMockGuild('guild-1', [], [existingRole]);
      const discordClient = createMockDiscordClient(guild) as any;
      const storage = createMockStorage({
        getCurrentMode: vi.fn().mockResolvedValue('shadow'),
      });

      const tierMap = new Map<string, { tier: number; conviction: number }>();
      const manager = createParallelRoleManager(
        storage,
        discordClient as any,
        createMockGetMemberTier(tierMap),
        createMockGetMemberTiersBatch(tierMap),
        nullLogger
      );

      const result = await manager.setupParallelRoles({
        communityId: 'comm-1',
        guildId: 'guild-1',
        tierRoleMappings: DEFAULT_TIER_MAPPINGS,
      });

      expect(result.success).toBe(true);
      expect(result.rolesExisted).toBe(1);
      expect(result.rolesCreated).toBe(2);
    });
  });

  describe('syncParallelRoles', () => {
    it('assigns roles based on member tiers', async () => {
      const members = [
        createMockMember('user-1', 'alice', []),
        createMockMember('user-2', 'bob', []),
      ];
      const guild = createMockGuild('guild-1', members);
      const discordClient = createMockDiscordClient(guild) as any;

      const parallelConfig = createMockParallelConfig('comm-1');
      const parallelRoles = [
        createMockParallelRole('comm-1', 1, 'arrakis-role-1'),
        createMockParallelRole('comm-1', 2, 'arrakis-role-2'),
        createMockParallelRole('comm-1', 3, 'arrakis-role-3'),
      ];

      const storage = createMockStorage({
        getCurrentMode: vi.fn().mockResolvedValue('parallel'),
        getParallelRoleConfig: vi.fn().mockResolvedValue(parallelConfig),
        getParallelRoles: vi.fn().mockResolvedValue(parallelRoles),
      });

      const tierMap = new Map([
        ['user-1', { tier: 1, conviction: 30 }],
        ['user-2', { tier: 3, conviction: 95 }],
      ]);

      const manager = createParallelRoleManager(
        storage,
        discordClient as any,
        createMockGetMemberTier(tierMap),
        createMockGetMemberTiersBatch(tierMap),
        nullLogger
      );

      const result = await manager.syncParallelRoles({
        communityId: 'comm-1',
        guildId: 'guild-1',
      });

      expect(result.success).toBe(true);
      expect(result.membersProcessed).toBe(2);
      expect(result.roleAdditions).toBe(2);

      // Verify correct roles were added
      expect(members[0].roles.add).toHaveBeenCalledWith(
        'arrakis-role-1',
        'Arrakis parallel mode sync'
      );
      expect(members[1].roles.add).toHaveBeenCalledWith(
        'arrakis-role-3',
        'Arrakis parallel mode sync'
      );
    });

    it('removes roles when member tier drops', async () => {
      const members = [
        createMockMember('user-1', 'alice', ['arrakis-role-3']),
      ];
      // Add the role to the member's role cache
      members[0].roles.cache.set('arrakis-role-3', { id: 'arrakis-role-3', name: '@arrakis-diamond' });

      const guild = createMockGuild('guild-1', members);
      const discordClient = createMockDiscordClient(guild) as any;

      const parallelConfig = createMockParallelConfig('comm-1');
      const parallelRoles = [
        createMockParallelRole('comm-1', 1, 'arrakis-role-1'),
        createMockParallelRole('comm-1', 2, 'arrakis-role-2'),
        createMockParallelRole('comm-1', 3, 'arrakis-role-3'),
      ];

      const storage = createMockStorage({
        getCurrentMode: vi.fn().mockResolvedValue('parallel'),
        getParallelRoleConfig: vi.fn().mockResolvedValue(parallelConfig),
        getParallelRoles: vi.fn().mockResolvedValue(parallelRoles),
      });

      // User now has tier 1 (was tier 3)
      const tierMap = new Map([
        ['user-1', { tier: 1, conviction: 20 }],
      ]);

      const manager = createParallelRoleManager(
        storage,
        discordClient as any,
        createMockGetMemberTier(tierMap),
        createMockGetMemberTiersBatch(tierMap),
        nullLogger
      );

      const result = await manager.syncParallelRoles({
        communityId: 'comm-1',
        guildId: 'guild-1',
      });

      expect(result.success).toBe(true);
      expect(result.roleRemovals).toBe(1);
      expect(result.roleAdditions).toBe(1);

      // Verify old role removed and new role added
      expect(members[0].roles.remove).toHaveBeenCalledWith(
        'arrakis-role-3',
        'Arrakis parallel mode sync'
      );
      expect(members[0].roles.add).toHaveBeenCalledWith(
        'arrakis-role-1',
        'Arrakis parallel mode sync'
      );
    });

    it('fails when not in parallel mode', async () => {
      const guild = createMockGuild('guild-1', []);
      const discordClient = createMockDiscordClient(guild) as any;
      const storage = createMockStorage({
        getCurrentMode: vi.fn().mockResolvedValue('shadow'),
      });

      const tierMap = new Map<string, { tier: number; conviction: number }>();
      const manager = createParallelRoleManager(
        storage,
        discordClient as any,
        createMockGetMemberTier(tierMap),
        createMockGetMemberTiersBatch(tierMap),
        nullLogger
      );

      const result = await manager.syncParallelRoles({
        communityId: 'comm-1',
        guildId: 'guild-1',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Not in parallel mode');
    });

    it('skips bot members', async () => {
      const members = [
        createMockMember('user-1', 'alice', [], false),
        createMockMember('bot-1', 'collab.land', [], true),
      ];
      const guild = createMockGuild('guild-1', members);
      const discordClient = createMockDiscordClient(guild) as any;

      const parallelConfig = createMockParallelConfig('comm-1');
      const parallelRoles = [
        createMockParallelRole('comm-1', 1, 'arrakis-role-1'),
      ];

      const storage = createMockStorage({
        getCurrentMode: vi.fn().mockResolvedValue('parallel'),
        getParallelRoleConfig: vi.fn().mockResolvedValue(parallelConfig),
        getParallelRoles: vi.fn().mockResolvedValue(parallelRoles),
      });

      const tierMap = new Map([
        ['user-1', { tier: 1, conviction: 30 }],
      ]);

      const manager = createParallelRoleManager(
        storage,
        discordClient as any,
        createMockGetMemberTier(tierMap),
        createMockGetMemberTiersBatch(tierMap),
        nullLogger
      );

      const result = await manager.syncParallelRoles({
        communityId: 'comm-1',
        guildId: 'guild-1',
      });

      expect(result.success).toBe(true);
      expect(result.membersProcessed).toBe(1); // Only human user
    });
  });

  describe('enableParallel', () => {
    it('transitions from shadow to parallel mode', async () => {
      const guild = createMockGuild('guild-1', []);
      const discordClient = createMockDiscordClient(guild) as any;
      const storage = createMockStorage({
        getCurrentMode: vi.fn().mockResolvedValue('shadow'),
        getMigrationState: vi.fn().mockResolvedValue({
          communityId: 'comm-1',
          currentMode: 'shadow',
          readinessCheckPassed: true,
          accuracyPercent: 95,
          shadowDays: 7,
        }),
      });

      const tierMap = new Map<string, { tier: number; conviction: number }>();
      const manager = createParallelRoleManager(
        storage,
        discordClient as any,
        createMockGetMemberTier(tierMap),
        createMockGetMemberTiersBatch(tierMap),
        nullLogger
      );

      const result = await manager.enableParallel('comm-1', 'guild-1');

      expect(result.success).toBe(true);
      expect(storage.updateMode).toHaveBeenCalledWith(
        'comm-1',
        'parallel',
        'Enabled parallel mode'
      );
      expect(storage.saveMigrationState).toHaveBeenCalledWith(
        expect.objectContaining({
          communityId: 'comm-1',
          currentMode: 'parallel',
        })
      );
    });

    it('fails when not in shadow mode', async () => {
      const guild = createMockGuild('guild-1', []);
      const discordClient = createMockDiscordClient(guild) as any;
      const storage = createMockStorage({
        getCurrentMode: vi.fn().mockResolvedValue('parallel'),
      });

      const tierMap = new Map<string, { tier: number; conviction: number }>();
      const manager = createParallelRoleManager(
        storage,
        discordClient as any,
        createMockGetMemberTier(tierMap),
        createMockGetMemberTiersBatch(tierMap),
        nullLogger
      );

      const result = await manager.enableParallel('comm-1', 'guild-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot enable parallel from mode');
    });

    it('uses custom tier mappings when provided', async () => {
      const guild = createMockGuild('guild-1', []);
      const discordClient = createMockDiscordClient(guild) as any;
      const storage = createMockStorage({
        getCurrentMode: vi.fn().mockResolvedValue('shadow'),
      });

      const customMappings: TierRoleMapping[] = [
        { tier: 1, baseName: 'bronze', color: '#CD7F32', minConviction: 1 },
        { tier: 2, baseName: 'silver', color: '#C0C0C0', minConviction: 50 },
        { tier: 3, baseName: 'gold', color: '#FFD700', minConviction: 90 },
      ];

      const tierMap = new Map<string, { tier: number; conviction: number }>();
      const manager = createParallelRoleManager(
        storage,
        discordClient as any,
        createMockGetMemberTier(tierMap),
        createMockGetMemberTiersBatch(tierMap),
        nullLogger
      );

      const result = await manager.enableParallel('comm-1', 'guild-1', customMappings);

      expect(result.success).toBe(true);
      expect(guild.roles.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: '@arrakis-bronze' })
      );
      expect(guild.roles.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: '@arrakis-silver' })
      );
      expect(guild.roles.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: '@arrakis-gold' })
      );
    });
  });

  describe('rollbackToShadow', () => {
    it('removes all parallel roles and transitions to shadow', async () => {
      const arrakisRole1 = createMockRole('arrakis-role-1', '@arrakis-holder', 5);
      const arrakisRole2 = createMockRole('arrakis-role-2', '@arrakis-believer', 4);
      const guild = createMockGuild('guild-1', [], [arrakisRole1, arrakisRole2]);
      const discordClient = createMockDiscordClient(guild) as any;

      const parallelRoles = [
        createMockParallelRole('comm-1', 1, 'arrakis-role-1'),
        createMockParallelRole('comm-1', 2, 'arrakis-role-2'),
      ];

      const storage = createMockStorage({
        getParallelRoles: vi.fn().mockResolvedValue(parallelRoles),
      });

      const tierMap = new Map<string, { tier: number; conviction: number }>();
      const manager = createParallelRoleManager(
        storage,
        discordClient as any,
        createMockGetMemberTier(tierMap),
        createMockGetMemberTiersBatch(tierMap),
        nullLogger
      );

      const result = await manager.rollbackToShadow('comm-1', 'guild-1', 'Testing rollback');

      expect(result.success).toBe(true);
      expect(result.rolesRemoved).toBe(2);
      expect(arrakisRole1.delete).toHaveBeenCalledWith('Arrakis rollback: Testing rollback');
      expect(arrakisRole2.delete).toHaveBeenCalledWith('Arrakis rollback: Testing rollback');
      expect(storage.deleteAllParallelRoles).toHaveBeenCalledWith('comm-1');
      expect(storage.deleteParallelRoleConfig).toHaveBeenCalledWith('comm-1');
      expect(storage.recordRollback).toHaveBeenCalledWith('comm-1', 'Testing rollback', 'shadow');
    });
  });

  describe('getParallelConfig', () => {
    it('returns parallel configuration for community', async () => {
      const parallelConfig = createMockParallelConfig('comm-1');
      const guild = createMockGuild('guild-1', []);
      const discordClient = createMockDiscordClient(guild) as any;
      const storage = createMockStorage({
        getParallelRoleConfig: vi.fn().mockResolvedValue(parallelConfig),
      });

      const tierMap = new Map<string, { tier: number; conviction: number }>();
      const manager = createParallelRoleManager(
        storage,
        discordClient as any,
        createMockGetMemberTier(tierMap),
        createMockGetMemberTiersBatch(tierMap),
        nullLogger
      );

      const config = await manager.getParallelConfig('comm-1');

      expect(config).not.toBeNull();
      expect(config?.namespace).toBe('@arrakis-');
      expect(config?.enabled).toBe(true);
    });
  });

  describe('updateNamespace', () => {
    it('updates namespace configuration', async () => {
      const guild = createMockGuild('guild-1', []);
      const discordClient = createMockDiscordClient(guild) as any;
      const storage = createMockStorage();

      const tierMap = new Map<string, { tier: number; conviction: number }>();
      const manager = createParallelRoleManager(
        storage,
        discordClient as any,
        createMockGetMemberTier(tierMap),
        createMockGetMemberTiersBatch(tierMap),
        nullLogger
      );

      await manager.updateNamespace('comm-1', '[THJ] ');

      expect(storage.saveParallelRoleConfig).toHaveBeenCalledWith({
        communityId: 'comm-1',
        namespace: '[THJ] ',
      });
    });
  });

  describe('updateTierMappings', () => {
    it('updates tier role mappings', async () => {
      const guild = createMockGuild('guild-1', []);
      const discordClient = createMockDiscordClient(guild) as any;
      const storage = createMockStorage();

      const newMappings: TierRoleMapping[] = [
        { tier: 1, baseName: 'newbie', color: '#FFFFFF', minConviction: 1 },
        { tier: 2, baseName: 'pro', color: '#000000', minConviction: 75 },
      ];

      const tierMap = new Map<string, { tier: number; conviction: number }>();
      const manager = createParallelRoleManager(
        storage,
        discordClient as any,
        createMockGetMemberTier(tierMap),
        createMockGetMemberTiersBatch(tierMap),
        nullLogger
      );

      await manager.updateTierMappings('comm-1', newMappings);

      expect(storage.saveParallelRoleConfig).toHaveBeenCalledWith({
        communityId: 'comm-1',
        tierRoleMapping: newMappings,
      });
    });
  });
});

describe('createParallelRoleManager', () => {
  it('creates ParallelRoleManager instance', () => {
    const guild = createMockGuild('guild-1', []);
    const discordClient = createMockDiscordClient(guild) as any;
    const storage = createMockStorage();
    const tierMap = new Map<string, { tier: number; conviction: number }>();

    const manager = createParallelRoleManager(
      storage,
      discordClient as any,
      createMockGetMemberTier(tierMap),
      createMockGetMemberTiersBatch(tierMap)
    );

    expect(manager).toBeInstanceOf(ParallelRoleManager);
  });
});

describe('DEFAULT_NAMESPACE', () => {
  it('has correct default value', () => {
    expect(DEFAULT_NAMESPACE).toBe('@arrakis-');
  });
});

describe('DEFAULT_TIER_MAPPINGS', () => {
  it('has three tiers with correct defaults', () => {
    expect(DEFAULT_TIER_MAPPINGS).toHaveLength(3);
    expect(DEFAULT_TIER_MAPPINGS[0]).toMatchObject({
      tier: 1,
      baseName: 'holder',
      minConviction: 1,
    });
    expect(DEFAULT_TIER_MAPPINGS[1]).toMatchObject({
      tier: 2,
      baseName: 'believer',
      minConviction: 50,
    });
    expect(DEFAULT_TIER_MAPPINGS[2]).toMatchObject({
      tier: 3,
      baseName: 'diamond',
      minConviction: 80,
    });
  });
});
