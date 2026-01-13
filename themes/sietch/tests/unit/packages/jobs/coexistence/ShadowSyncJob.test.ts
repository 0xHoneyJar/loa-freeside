/**
 * ShadowSyncJob Unit Tests
 *
 * Sprint 57: Shadow Mode Foundation - Shadow Ledger & Sync
 *
 * Tests for the scheduled shadow sync job including batch processing,
 * accuracy alerts, and admin digest generation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ShadowSyncJob,
  createShadowSyncJob,
  type GetCommunityGuildMappings,
  type CommunityGuildMapping,
} from '../../../../../src/packages/jobs/coexistence/ShadowSyncJob.js';
import type { ICoexistenceStorage } from '../../../../../src/packages/core/ports/ICoexistenceStorage.js';
import type { GetArrakisPredictions } from '../../../../../src/packages/adapters/coexistence/ShadowLedger.js';
import { nullLogger } from '../../../../../src/packages/infrastructure/logging/index.js';

// =============================================================================
// Mock Helpers
// =============================================================================

/**
 * Mock Discord.js Collection
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

function createMockMember(id: string, isBot = false) {
  const rolesCollection = new MockCollection<string, { id: string }>();
  return {
    id,
    user: { id, username: `user-${id}`, bot: isBot },
    roles: { cache: rolesCollection },
  };
}

function createMockGuild(guildId: string, memberCount: number) {
  const membersCollection = new MockCollection<string, ReturnType<typeof createMockMember>>();
  for (let i = 0; i < memberCount; i++) {
    const member = createMockMember(`user-${i}`);
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

function createMockDiscordClient(guilds: Map<string, ReturnType<typeof createMockGuild>>) {
  return {
    guilds: {
      fetch: vi.fn().mockImplementation((guildId: string) => {
        return Promise.resolve(guilds.get(guildId));
      }),
    },
  };
}

function createMockStorage(overrides: Partial<ICoexistenceStorage> = {}): ICoexistenceStorage {
  return {
    getIncumbentConfig: vi.fn().mockResolvedValue({
      id: 'config-1',
      communityId: 'comm-1',
      provider: 'collabland',
      botId: '704521096837464076',
      botUsername: 'collab.land',
      verificationChannelId: null,
      detectedAt: new Date(),
      confidence: 0.95,
      manualOverride: false,
      lastHealthCheck: new Date(),
      healthStatus: 'healthy',
      detectedRoles: [],
      capabilities: { hasBalanceCheck: true, hasConvictionScoring: false, hasTierSystem: true, hasSocialLayer: false },
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    saveIncumbentConfig: vi.fn(),
    updateIncumbentHealth: vi.fn(),
    deleteIncumbentConfig: vi.fn(),
    hasIncumbent: vi.fn().mockResolvedValue(true),
    getMigrationState: vi.fn().mockResolvedValue({
      id: 'state-1',
      communityId: 'comm-1',
      currentMode: 'shadow',
      targetMode: null,
      strategy: null,
      shadowStartedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
      parallelEnabledAt: null,
      primaryEnabledAt: null,
      exclusiveEnabledAt: null,
      rollbackCount: 0,
      lastRollbackAt: null,
      lastRollbackReason: null,
      readinessCheckPassed: false,
      accuracyPercent: null,
      shadowDays: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
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
      communityId: 'comm-1',
      totalMembers: 100,
      matchCount: 95,
      arrakisHigherCount: 3,
      arrakisLowerCount: 2,
      mismatchCount: 0,
      accuracyPercent: 95,
    }),
    savePrediction: vi.fn(),
    validatePrediction: vi.fn(),
    getUnvalidatedPredictions: vi.fn().mockResolvedValue([]),
    calculateAccuracy: vi.fn().mockResolvedValue(95),
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('ShadowSyncJob', () => {
  describe('run', () => {
    it('returns early when no communities in shadow mode', async () => {
      const storage = createMockStorage({
        getCommunitiesByMode: vi.fn().mockResolvedValue([]),
      });

      const guilds = new Map<string, ReturnType<typeof createMockGuild>>();
      const discordClient = createMockDiscordClient(guilds) as any;
      const getPredictions: GetArrakisPredictions = vi.fn().mockResolvedValue([]);
      const getCommunityMappings: GetCommunityGuildMappings = vi.fn().mockResolvedValue([]);

      const job = createShadowSyncJob(
        storage,
        discordClient,
        getPredictions,
        getCommunityMappings,
        {},
        nullLogger
      );

      const result = await job.run();

      expect(result.success).toBe(true);
      expect(result.communitiesProcessed).toBe(0);
      expect(result.communityResults).toHaveLength(0);
    });

    it('processes multiple communities in shadow mode', async () => {
      const storage = createMockStorage({
        getCommunitiesByMode: vi.fn().mockResolvedValue(['comm-1', 'comm-2']),
      });

      const guild1 = createMockGuild('guild-1', 5);
      const guild2 = createMockGuild('guild-2', 3);

      const guilds = new Map<string, ReturnType<typeof createMockGuild>>();
      guilds.set('guild-1', guild1);
      guilds.set('guild-2', guild2);

      const discordClient = createMockDiscordClient(guilds) as any;
      const getPredictions: GetArrakisPredictions = vi.fn().mockResolvedValue([]);

      const mappings: CommunityGuildMapping[] = [
        { communityId: 'comm-1', guildId: 'guild-1' },
        { communityId: 'comm-2', guildId: 'guild-2' },
      ];
      const getCommunityMappings: GetCommunityGuildMappings = vi.fn().mockResolvedValue(mappings);

      const job = createShadowSyncJob(
        storage,
        discordClient,
        getPredictions,
        getCommunityMappings,
        {},
        nullLogger
      );

      const result = await job.run();

      expect(result.success).toBe(true);
      expect(result.communitiesProcessed).toBe(2);
    });

    it('respects maxCommunitiesPerRun config', async () => {
      const storage = createMockStorage({
        getCommunitiesByMode: vi.fn().mockResolvedValue(['comm-1', 'comm-2', 'comm-3', 'comm-4']),
      });

      const guilds = new Map<string, ReturnType<typeof createMockGuild>>();
      for (let i = 1; i <= 4; i++) {
        guilds.set(`guild-${i}`, createMockGuild(`guild-${i}`, 2));
      }

      const discordClient = createMockDiscordClient(guilds) as any;
      const getPredictions: GetArrakisPredictions = vi.fn().mockResolvedValue([]);

      const mappings: CommunityGuildMapping[] = [
        { communityId: 'comm-1', guildId: 'guild-1' },
        { communityId: 'comm-2', guildId: 'guild-2' },
        { communityId: 'comm-3', guildId: 'guild-3' },
        { communityId: 'comm-4', guildId: 'guild-4' },
      ];
      const getCommunityMappings: GetCommunityGuildMappings = vi.fn().mockResolvedValue(mappings);

      const job = createShadowSyncJob(
        storage,
        discordClient,
        getPredictions,
        getCommunityMappings,
        { maxCommunitiesPerRun: 2 },
        nullLogger
      );

      const result = await job.run();

      expect(result.communitiesProcessed).toBeLessThanOrEqual(2);
    });

    it('detects accuracy alerts when threshold exceeded', async () => {
      const storage = createMockStorage({
        getCommunitiesByMode: vi.fn().mockResolvedValue(['comm-1']),
        getDivergenceSummary: vi.fn()
          .mockResolvedValueOnce({
            communityId: 'comm-1',
            totalMembers: 100,
            matchCount: 80,
            arrakisHigherCount: 10,
            arrakisLowerCount: 10,
            mismatchCount: 0,
            accuracyPercent: 80, // Previous
          })
          .mockResolvedValue({
            communityId: 'comm-1',
            totalMembers: 100,
            matchCount: 70,
            arrakisHigherCount: 15,
            arrakisLowerCount: 15,
            mismatchCount: 0,
            accuracyPercent: 70, // Current (dropped 10%)
          }),
      });

      const guild = createMockGuild('guild-1', 5);
      const guilds = new Map<string, ReturnType<typeof createMockGuild>>();
      guilds.set('guild-1', guild);

      const discordClient = createMockDiscordClient(guilds) as any;
      const getPredictions: GetArrakisPredictions = vi.fn().mockResolvedValue([]);

      const mappings: CommunityGuildMapping[] = [
        { communityId: 'comm-1', guildId: 'guild-1', previousAccuracy: 80 },
      ];
      const getCommunityMappings: GetCommunityGuildMappings = vi.fn().mockResolvedValue(mappings);

      const job = createShadowSyncJob(
        storage,
        discordClient,
        getPredictions,
        getCommunityMappings,
        { accuracyAlertThreshold: 5 }, // Alert on 5%+ change
        nullLogger
      );

      const result = await job.run();

      expect(result.accuracyAlerts).toHaveLength(1);
      expect(result.accuracyAlerts[0]).toMatchObject({
        communityId: 'comm-1',
        direction: 'degraded',
      });
    });

    it('handles failed community syncs gracefully', async () => {
      const storage = createMockStorage({
        getCommunitiesByMode: vi.fn().mockResolvedValue(['comm-1', 'comm-2']),
        getCurrentMode: vi.fn()
          .mockResolvedValueOnce('shadow')
          .mockResolvedValueOnce('parallel'), // Second community not in shadow mode
      });

      const guild1 = createMockGuild('guild-1', 5);
      const guild2 = createMockGuild('guild-2', 3);

      const guilds = new Map<string, ReturnType<typeof createMockGuild>>();
      guilds.set('guild-1', guild1);
      guilds.set('guild-2', guild2);

      const discordClient = createMockDiscordClient(guilds) as any;
      const getPredictions: GetArrakisPredictions = vi.fn().mockResolvedValue([]);

      const mappings: CommunityGuildMapping[] = [
        { communityId: 'comm-1', guildId: 'guild-1' },
        { communityId: 'comm-2', guildId: 'guild-2' },
      ];
      const getCommunityMappings: GetCommunityGuildMappings = vi.fn().mockResolvedValue(mappings);

      const job = createShadowSyncJob(
        storage,
        discordClient,
        getPredictions,
        getCommunityMappings,
        {},
        nullLogger
      );

      const result = await job.run();

      expect(result.success).toBe(true);
      expect(result.communitiesProcessed).toBe(1);
      expect(result.communitiesFailed).toBe(1);
    });

    it('skips communities without guild mapping', async () => {
      const storage = createMockStorage({
        getCommunitiesByMode: vi.fn().mockResolvedValue(['comm-1', 'comm-2']),
      });

      const guild1 = createMockGuild('guild-1', 5);
      const guilds = new Map<string, ReturnType<typeof createMockGuild>>();
      guilds.set('guild-1', guild1);

      const discordClient = createMockDiscordClient(guilds) as any;
      const getPredictions: GetArrakisPredictions = vi.fn().mockResolvedValue([]);

      // Only comm-1 has a mapping
      const mappings: CommunityGuildMapping[] = [
        { communityId: 'comm-1', guildId: 'guild-1' },
      ];
      const getCommunityMappings: GetCommunityGuildMappings = vi.fn().mockResolvedValue(mappings);

      const job = createShadowSyncJob(
        storage,
        discordClient,
        getPredictions,
        getCommunityMappings,
        {},
        nullLogger
      );

      const result = await job.run();

      expect(result.communitiesProcessed).toBe(1);
      expect(result.communitiesFailed).toBe(1); // comm-2 has no mapping
    });
  });

  describe('generateDigest', () => {
    it('generates admin digest with readiness assessment', async () => {
      const storage = createMockStorage({
        getDivergenceSummary: vi.fn().mockResolvedValue({
          communityId: 'comm-1',
          totalMembers: 100,
          matchCount: 96,
          arrakisHigherCount: 2,
          arrakisLowerCount: 2,
          mismatchCount: 0,
          accuracyPercent: 96, // Above 95% threshold
        }),
        getMigrationState: vi.fn().mockResolvedValue({
          id: 'state-1',
          communityId: 'comm-1',
          currentMode: 'shadow',
          shadowStartedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
          shadowDays: 10,
        }),
        getIncumbentConfig: vi.fn().mockResolvedValue({
          provider: 'collabland',
        }),
      });

      const guilds = new Map<string, ReturnType<typeof createMockGuild>>();
      const discordClient = createMockDiscordClient(guilds) as any;
      const getPredictions: GetArrakisPredictions = vi.fn().mockResolvedValue([]);
      const getCommunityMappings: GetCommunityGuildMappings = vi.fn().mockResolvedValue([]);

      const job = createShadowSyncJob(
        storage,
        discordClient,
        getPredictions,
        getCommunityMappings,
        {},
        nullLogger
      );

      const digest = await job.generateDigest('comm-1');

      expect(digest.isReadyForMigration).toBe(true);
      expect(digest.incumbentProvider).toBe('collabland');
      expect(digest.shadowDays).toBeGreaterThanOrEqual(7);
      expect(digest.summary.accuracyPercent).toBeGreaterThanOrEqual(95);
    });

    it('generates not-ready digest with recommendations', async () => {
      const storage = createMockStorage({
        getDivergenceSummary: vi.fn().mockResolvedValue({
          communityId: 'comm-1',
          totalMembers: 100,
          matchCount: 70,
          arrakisHigherCount: 25,
          arrakisLowerCount: 5,
          mismatchCount: 0,
          accuracyPercent: 70, // Below 95% threshold
        }),
        getMigrationState: vi.fn().mockResolvedValue({
          id: 'state-1',
          communityId: 'comm-1',
          currentMode: 'shadow',
          shadowStartedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // Only 3 days
          shadowDays: 3,
        }),
        getIncumbentConfig: vi.fn().mockResolvedValue({
          provider: 'matrica',
        }),
      });

      const guilds = new Map<string, ReturnType<typeof createMockGuild>>();
      const discordClient = createMockDiscordClient(guilds) as any;
      const getPredictions: GetArrakisPredictions = vi.fn().mockResolvedValue([]);
      const getCommunityMappings: GetCommunityGuildMappings = vi.fn().mockResolvedValue([]);

      const job = createShadowSyncJob(
        storage,
        discordClient,
        getPredictions,
        getCommunityMappings,
        {},
        nullLogger
      );

      const digest = await job.generateDigest('comm-1');

      expect(digest.isReadyForMigration).toBe(false);
      expect(digest.readinessReason).toContain('below 95%');
      expect(digest.recommendations.length).toBeGreaterThan(0);
      expect(digest.recommendations.some(r => r.includes('20%+'))).toBe(true); // High arrakis_higher
    });
  });
});

describe('createShadowSyncJob', () => {
  it('creates ShadowSyncJob instance with default config', () => {
    const storage = createMockStorage();
    const guilds = new Map<string, ReturnType<typeof createMockGuild>>();
    const discordClient = createMockDiscordClient(guilds) as any;
    const getPredictions: GetArrakisPredictions = vi.fn().mockResolvedValue([]);
    const getCommunityMappings: GetCommunityGuildMappings = vi.fn().mockResolvedValue([]);

    const job = createShadowSyncJob(
      storage,
      discordClient,
      getPredictions,
      getCommunityMappings
    );

    expect(job).toBeInstanceOf(ShadowSyncJob);
  });

  it('creates ShadowSyncJob instance with custom config', () => {
    const storage = createMockStorage();
    const guilds = new Map<string, ReturnType<typeof createMockGuild>>();
    const discordClient = createMockDiscordClient(guilds) as any;
    const getPredictions: GetArrakisPredictions = vi.fn().mockResolvedValue([]);
    const getCommunityMappings: GetCommunityGuildMappings = vi.fn().mockResolvedValue([]);

    const job = createShadowSyncJob(
      storage,
      discordClient,
      getPredictions,
      getCommunityMappings,
      {
        intervalHours: 12,
        maxCommunitiesPerRun: 25,
        memberBatchSize: 50,
        skipRecentHours: 12,
        enableDigest: false,
        accuracyAlertThreshold: 10,
      }
    );

    expect(job).toBeInstanceOf(ShadowSyncJob);
  });
});
