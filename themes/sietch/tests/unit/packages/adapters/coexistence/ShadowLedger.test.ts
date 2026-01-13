/**
 * ShadowLedger Unit Tests
 *
 * Sprint 57: Shadow Mode Foundation - Shadow Ledger & Sync
 *
 * Tests for shadow ledger functionality including divergence detection,
 * guild syncing, and accuracy calculation.
 *
 * CRITICAL TEST: Verify no Discord mutations occur in shadow mode.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ShadowLedger,
  createShadowLedger,
  type GetArrakisPredictions,
  type ArrakisPrediction,
} from '../../../../../src/packages/adapters/coexistence/ShadowLedger.js';
import type {
  ICoexistenceStorage,
  StoredIncumbentConfig,
  StoredShadowMemberState,
  DivergenceSummary,
  StoredPrediction,
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
    },
  };
}

/**
 * Create mock Guild
 */
function createMockGuild(guildId: string, members: ReturnType<typeof createMockMember>[]) {
  const membersCollection = new MockCollection<string, ReturnType<typeof createMockMember>>();
  for (const member of members) {
    membersCollection.set(member.id, member);
  }

  return {
    id: guildId,
    members: {
      cache: membersCollection,
      fetch: vi.fn().mockResolvedValue(membersCollection),
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
 * Create mock storage
 */
function createMockStorage(overrides: Partial<ICoexistenceStorage> = {}): ICoexistenceStorage {
  return {
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
    ...overrides,
  };
}

/**
 * Create mock incumbent config
 */
function createMockIncumbentConfig(
  communityId: string,
  detectedRoles: { id: string; confidence: number }[] = []
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
      confidence: r.confidence,
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
 * Create mock predictions callback
 */
function createMockGetPredictions(
  predictions: ArrakisPrediction[]
): GetArrakisPredictions {
  return vi.fn().mockResolvedValue(predictions);
}

// =============================================================================
// Tests
// =============================================================================

describe('ShadowLedger', () => {
  describe('detectDivergence', () => {
    let storage: ICoexistenceStorage;
    let discordClient: ReturnType<typeof createMockDiscordClient>;
    let getPredictions: GetArrakisPredictions;
    let shadowLedger: ShadowLedger;

    beforeEach(() => {
      storage = createMockStorage();
      const guild = createMockGuild('guild-1', []);
      discordClient = createMockDiscordClient(guild) as any;
      getPredictions = createMockGetPredictions([]);
      shadowLedger = createShadowLedger(
        storage,
        discordClient as any,
        getPredictions,
        nullLogger
      );
    });

    it('detects match when roles are identical', () => {
      const result = shadowLedger.detectDivergence(
        { roles: ['role-1', 'role-2'], tier: null },
        { roles: ['role-1', 'role-2'], tier: null, conviction: 80 }
      );

      expect(result.type).toBe('match');
      expect(result.reason).toBeNull();
    });

    it('detects match when tiers are equal', () => {
      const result = shadowLedger.detectDivergence(
        { roles: ['role-1'], tier: 2 },
        { roles: ['role-1'], tier: 2, conviction: 80 }
      );

      expect(result.type).toBe('match');
    });

    it('detects arrakis_higher when Arrakis tier is higher', () => {
      const result = shadowLedger.detectDivergence(
        { roles: ['role-1'], tier: 1 },
        { roles: ['role-1'], tier: 3, conviction: 95 }
      );

      expect(result.type).toBe('arrakis_higher');
      expect(result.reason).toContain('tier 3 > incumbent tier 1');
    });

    it('detects arrakis_lower when Arrakis tier is lower', () => {
      const result = shadowLedger.detectDivergence(
        { roles: ['role-1'], tier: 3 },
        { roles: ['role-1'], tier: 1, conviction: 30 }
      );

      expect(result.type).toBe('arrakis_lower');
      expect(result.reason).toContain('tier 1 < incumbent tier 3');
    });

    it('detects arrakis_higher when Arrakis has more roles', () => {
      const result = shadowLedger.detectDivergence(
        { roles: ['role-1'], tier: null },
        { roles: ['role-1', 'role-2', 'role-3'], tier: null, conviction: 90 }
      );

      expect(result.type).toBe('arrakis_higher');
      expect(result.reason).toContain('2 more roles');
    });

    it('detects arrakis_lower when Arrakis has fewer roles', () => {
      const result = shadowLedger.detectDivergence(
        { roles: ['role-1', 'role-2', 'role-3'], tier: null },
        { roles: ['role-1'], tier: null, conviction: 20 }
      );

      expect(result.type).toBe('arrakis_lower');
      expect(result.reason).toContain('2 fewer roles');
    });

    it('detects mismatch when same count but different roles', () => {
      const result = shadowLedger.detectDivergence(
        { roles: ['role-1', 'role-2'], tier: null },
        { roles: ['role-3', 'role-4'], tier: null, conviction: 50 }
      );

      expect(result.type).toBe('mismatch');
      expect(result.reason).toContain('Different role sets');
    });
  });

  describe('syncGuild', () => {
    it('returns error when not in shadow mode', async () => {
      const storage = createMockStorage({
        getCurrentMode: vi.fn().mockResolvedValue('parallel'),
      });
      const guild = createMockGuild('guild-1', []);
      const discordClient = createMockDiscordClient(guild) as any;
      const getPredictions = createMockGetPredictions([]);

      const shadowLedger = createShadowLedger(
        storage,
        discordClient as any,
        getPredictions,
        nullLogger
      );

      const result = await shadowLedger.syncGuild({
        communityId: 'comm-1',
        guildId: 'guild-1',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Not in shadow mode');
    });

    it('returns error when no incumbent configured', async () => {
      const storage = createMockStorage({
        getCurrentMode: vi.fn().mockResolvedValue('shadow'),
        getIncumbentConfig: vi.fn().mockResolvedValue(null),
      });
      const guild = createMockGuild('guild-1', []);
      const discordClient = createMockDiscordClient(guild) as any;
      const getPredictions = createMockGetPredictions([]);

      const shadowLedger = createShadowLedger(
        storage,
        discordClient as any,
        getPredictions,
        nullLogger
      );

      const result = await shadowLedger.syncGuild({
        communityId: 'comm-1',
        guildId: 'guild-1',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No incumbent bot configured');
    });

    it('processes members and detects divergences', async () => {
      const incumbentConfig = createMockIncumbentConfig('comm-1', [
        { id: 'role-1', confidence: 0.9 },
        { id: 'role-2', confidence: 0.8 },
      ]);

      const members = [
        createMockMember('user-1', 'alice', ['role-1']),
        createMockMember('user-2', 'bob', ['role-1', 'role-2']),
        createMockMember('bot-1', 'collab.land', [], true), // Bot should be skipped
      ];

      const guild = createMockGuild('guild-1', members);
      const discordClient = createMockDiscordClient(guild) as any;

      const storage = createMockStorage({
        getCurrentMode: vi.fn().mockResolvedValue('shadow'),
        getIncumbentConfig: vi.fn().mockResolvedValue(incumbentConfig),
        getDivergenceSummary: vi.fn().mockResolvedValue({
          communityId: 'comm-1',
          totalMembers: 2,
          matchCount: 1,
          arrakisHigherCount: 1,
          arrakisLowerCount: 0,
          mismatchCount: 0,
          accuracyPercent: 50,
        }),
      });

      const predictions: ArrakisPrediction[] = [
        { memberId: 'user-1', roles: ['role-1'], tier: 1, conviction: 50 },
        { memberId: 'user-2', roles: ['role-1', 'role-2', 'role-3'], tier: 2, conviction: 85 },
      ];
      const getPredictions = createMockGetPredictions(predictions);

      const shadowLedger = createShadowLedger(
        storage,
        discordClient as any,
        getPredictions,
        nullLogger
      );

      const result = await shadowLedger.syncGuild({
        communityId: 'comm-1',
        guildId: 'guild-1',
      });

      expect(result.success).toBe(true);
      expect(result.membersProcessed).toBe(2);
      expect(result.membersSkipped).toBe(0);
      expect(storage.batchSaveShadowMemberStates).toHaveBeenCalled();
    });

    it('skips recently synced members', async () => {
      const incumbentConfig = createMockIncumbentConfig('comm-1', [
        { id: 'role-1', confidence: 0.9 },
      ]);

      const members = [
        createMockMember('user-1', 'alice', ['role-1']),
        createMockMember('user-2', 'bob', ['role-1']),
      ];

      const guild = createMockGuild('guild-1', members);
      const discordClient = createMockDiscordClient(guild) as any;

      // user-1 was synced recently
      const recentSyncState: StoredShadowMemberState = {
        id: 'state-1',
        communityId: 'comm-1',
        memberId: 'user-1',
        incumbentRoles: ['role-1'],
        incumbentTier: 1,
        incumbentLastUpdate: new Date(),
        arrakisRoles: ['role-1'],
        arrakisTier: 1,
        arrakisConviction: 50,
        arrakisLastCalculated: new Date(),
        divergenceType: 'match',
        divergenceReason: null,
        divergenceDetectedAt: null,
        lastSyncAt: new Date(), // Just synced
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const storage = createMockStorage({
        getCurrentMode: vi.fn().mockResolvedValue('shadow'),
        getIncumbentConfig: vi.fn().mockResolvedValue(incumbentConfig),
        getShadowMemberState: vi.fn().mockImplementation((commId, memberId) => {
          if (memberId === 'user-1') return Promise.resolve(recentSyncState);
          return Promise.resolve(null);
        }),
      });

      const getPredictions = createMockGetPredictions([
        { memberId: 'user-2', roles: ['role-1'], tier: 1, conviction: 50 },
      ]);

      const shadowLedger = createShadowLedger(
        storage,
        discordClient as any,
        getPredictions,
        nullLogger
      );

      const result = await shadowLedger.syncGuild({
        communityId: 'comm-1',
        guildId: 'guild-1',
        skipRecentHours: 6,
      });

      expect(result.success).toBe(true);
      expect(result.membersSkipped).toBe(1);
      expect(result.membersProcessed).toBe(1);
    });

    it('CRITICAL: never performs Discord mutations', async () => {
      const incumbentConfig = createMockIncumbentConfig('comm-1', [
        { id: 'role-1', confidence: 0.9 },
      ]);

      const members = [createMockMember('user-1', 'alice', ['role-1'])];
      const guild = createMockGuild('guild-1', members);
      const discordClient = createMockDiscordClient(guild) as any;

      // Add spies for mutation methods
      const roleAdd = vi.fn();
      const roleRemove = vi.fn();
      const memberBan = vi.fn();
      const memberKick = vi.fn();
      const channelCreate = vi.fn();
      const messageSend = vi.fn();

      // Mock any potential mutation methods
      guild.members.cache.get('user-1')!.roles = {
        ...guild.members.cache.get('user-1')!.roles,
        add: roleAdd,
        remove: roleRemove,
      } as any;

      discordClient.guilds.fetch = vi.fn().mockResolvedValue({
        ...guild,
        bans: { create: memberBan },
        members: {
          ...guild.members,
          kick: memberKick,
        },
        channels: { create: channelCreate },
      });

      const storage = createMockStorage({
        getCurrentMode: vi.fn().mockResolvedValue('shadow'),
        getIncumbentConfig: vi.fn().mockResolvedValue(incumbentConfig),
      });

      const getPredictions = createMockGetPredictions([
        { memberId: 'user-1', roles: ['role-1', 'role-2'], tier: 2, conviction: 90 },
      ]);

      const shadowLedger = createShadowLedger(
        storage,
        discordClient as any,
        getPredictions,
        nullLogger
      );

      await shadowLedger.syncGuild({
        communityId: 'comm-1',
        guildId: 'guild-1',
      });

      // CRITICAL: Verify no mutations occurred
      expect(roleAdd).not.toHaveBeenCalled();
      expect(roleRemove).not.toHaveBeenCalled();
      expect(memberBan).not.toHaveBeenCalled();
      expect(memberKick).not.toHaveBeenCalled();
      expect(channelCreate).not.toHaveBeenCalled();
      expect(messageSend).not.toHaveBeenCalled();
    });
  });

  describe('calculateAccuracy', () => {
    it('returns accuracy from divergence summary', async () => {
      const storage = createMockStorage({
        getDivergenceSummary: vi.fn().mockResolvedValue({
          communityId: 'comm-1',
          totalMembers: 100,
          matchCount: 95,
          arrakisHigherCount: 3,
          arrakisLowerCount: 2,
          mismatchCount: 0,
          accuracyPercent: 95,
        }),
      });

      const guild = createMockGuild('guild-1', []);
      const discordClient = createMockDiscordClient(guild) as any;
      const getPredictions = createMockGetPredictions([]);

      const shadowLedger = createShadowLedger(
        storage,
        discordClient as any,
        getPredictions,
        nullLogger
      );

      const accuracy = await shadowLedger.calculateAccuracy('comm-1');

      expect(accuracy).toBe(95);
    });
  });

  describe('validatePredictions', () => {
    it('validates predictions against actual outcomes', async () => {
      const unvalidatedPredictions: StoredPrediction[] = [
        {
          id: 'pred-1',
          communityId: 'comm-1',
          memberId: 'user-1',
          predictedRoles: ['role-1', 'role-2'],
          predictedTier: 2,
          predictedConviction: 80,
          predictedAt: new Date(),
          actualRoles: null,
          actualTier: null,
          validatedAt: null,
          accurate: null,
          accuracyScore: null,
          accuracyDetails: null,
          createdAt: new Date(),
        },
      ];

      const shadowState: StoredShadowMemberState = {
        id: 'state-1',
        communityId: 'comm-1',
        memberId: 'user-1',
        incumbentRoles: ['role-1', 'role-2'], // Same as predicted
        incumbentTier: 2,
        incumbentLastUpdate: new Date(),
        arrakisRoles: ['role-1', 'role-2'],
        arrakisTier: 2,
        arrakisConviction: 80,
        arrakisLastCalculated: new Date(),
        divergenceType: 'match',
        divergenceReason: null,
        divergenceDetectedAt: null,
        lastSyncAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const storage = createMockStorage({
        getUnvalidatedPredictions: vi.fn().mockResolvedValue(unvalidatedPredictions),
        getShadowMemberState: vi.fn().mockResolvedValue(shadowState),
        validatePrediction: vi.fn(),
      });

      const guild = createMockGuild('guild-1', []);
      const discordClient = createMockDiscordClient(guild) as any;
      const getPredictions = createMockGetPredictions([]);

      const shadowLedger = createShadowLedger(
        storage,
        discordClient as any,
        getPredictions,
        nullLogger
      );

      const result = await shadowLedger.validatePredictions('comm-1');

      expect(result.validated).toBe(1);
      expect(result.accurate).toBe(1);
      expect(result.inaccurate).toBe(0);
      expect(storage.validatePrediction).toHaveBeenCalledWith(
        expect.objectContaining({
          predictionId: 'pred-1',
          accurate: true,
        })
      );
    });
  });
});

describe('createShadowLedger', () => {
  it('creates ShadowLedger instance', () => {
    const storage = createMockStorage();
    const guild = createMockGuild('guild-1', []);
    const discordClient = createMockDiscordClient(guild) as any;
    const getPredictions = createMockGetPredictions([]);

    const ledger = createShadowLedger(
      storage,
      discordClient as any,
      getPredictions
    );

    expect(ledger).toBeInstanceOf(ShadowLedger);
  });
});
