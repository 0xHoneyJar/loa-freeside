/**
 * MigrationManager Tests
 *
 * Sprint S-28: Migration Strategies & Rollback
 *
 * Comprehensive tests for all migration operations including:
 * - Readiness checks
 * - All 4 migration strategies (instant, gradual, parallel_forever, arrakis_primary)
 * - Rollback system
 * - Auto-rollback triggers
 * - Incumbent health monitoring
 * - Backup activation
 * - Audit trail
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import pino from 'pino';
import {
  MigrationManager,
  createMigrationManager,
  InMemoryMigrationStateStore,
  InMemorySnapshotStore,
  InMemoryMigrationAuditTrail,
  type IShadowLedgerForMigration,
  type IDiscordMigrationService,
  type IRoleMappingService,
  type IMigrationCommunityService,
  type IMigrationNotificationService,
  type IMigrationMetrics,
} from './migration-manager.js';
import type { MigrationConfig, MigrationState } from '@arrakis/core/domain';
import {
  MIN_SHADOW_DAYS_FOR_MIGRATION,
  MIN_ACCURACY_FOR_MIGRATION,
  MAX_DIVERGENCE_RATE_FOR_MIGRATION,
} from '@arrakis/core/domain';

// =============================================================================
// Test Fixtures
// =============================================================================

const testLogger = pino({ level: 'silent' });

function createMockShadowLedger(overrides?: Partial<IShadowLedgerForMigration>): IShadowLedgerForMigration {
  return {
    getShadowStartDate: vi.fn().mockResolvedValue(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)), // 30 days ago
    getShadowAccuracy: vi.fn().mockResolvedValue(0.97),
    getDivergenceRate: vi.fn().mockResolvedValue(0.02),
    getMemberCount: vi.fn().mockResolvedValue(100),
    ...overrides,
  };
}

function createMockDiscord(overrides?: Partial<IDiscordMigrationService>): IDiscordMigrationService {
  return {
    isBotInGuild: vi.fn().mockResolvedValue(true),
    getGuildMemberRoles: vi.fn().mockResolvedValue([
      { userId: 'user-1', roles: ['role-a', 'role-b'] },
      { userId: 'user-2', roles: ['role-a'] },
      { userId: 'user-3', roles: ['role-b', 'role-c'] },
    ]),
    addRolesToMember: vi.fn().mockResolvedValue(undefined),
    removeRolesFromMember: vi.fn().mockResolvedValue(undefined),
    getLastIncumbentRoleUpdate: vi.fn().mockResolvedValue(new Date(Date.now() - 2 * 60 * 60 * 1000)), // 2 hours ago
    isIncumbentBotPresent: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function createMockRoleMapping(overrides?: Partial<IRoleMappingService>): IRoleMappingService {
  return {
    getArrakisRolesForIncumbent: vi.fn().mockResolvedValue(['arrakis-role-1']),
    getIncumbentRoles: vi.fn().mockImplementation((_guildId, userId) => {
      if (userId === 'user-1') return Promise.resolve(['incumbent-role-a', 'incumbent-role-b']);
      if (userId === 'user-2') return Promise.resolve(['incumbent-role-a']);
      return Promise.resolve(['incumbent-role-b']);
    }),
    getArrakisRoles: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function createMockCommunity(overrides?: Partial<IMigrationCommunityService>): IMigrationCommunityService {
  return {
    updateCoexistenceMode: vi.fn().mockResolvedValue(undefined),
    getAdminUserIds: vi.fn().mockResolvedValue(['admin-1', 'admin-2']),
    ...overrides,
  };
}

function createMockNotifications(overrides?: Partial<IMigrationNotificationService>): IMigrationNotificationService {
  return {
    sendChannelNotification: vi.fn().mockResolvedValue(undefined),
    sendDirectMessage: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockMetrics(overrides?: Partial<IMigrationMetrics>): IMigrationMetrics {
  return {
    increment: vi.fn(),
    gauge: vi.fn(),
    timing: vi.fn(),
    ...overrides,
  };
}

function createDefaultConfig(strategy: MigrationConfig['strategy'] = 'instant'): MigrationConfig {
  return {
    strategy,
    gradualDays: strategy === 'gradual' ? 7 : undefined,
    batchSize: strategy === 'gradual' ? 10 : undefined,
    rollbackThresholds: {
      accessLossPercent: 5,
      accessLossWindowMinutes: 60,
      errorRatePercent: 10,
      errorRateWindowMinutes: 15,
    },
    preserveIncumbentRoles: false,
    notificationChannelId: 'channel-123',
    adminUserIds: ['admin-1'],
  };
}

// =============================================================================
// Readiness Check Tests
// =============================================================================

describe('MigrationManager', () => {
  let manager: MigrationManager;
  let mockShadowLedger: IShadowLedgerForMigration;
  let mockDiscord: IDiscordMigrationService;
  let mockRoleMapping: IRoleMappingService;
  let mockCommunity: IMigrationCommunityService;
  let mockNotifications: IMigrationNotificationService;
  let mockMetrics: IMigrationMetrics;
  let stateStore: InMemoryMigrationStateStore;
  let snapshotStore: InMemorySnapshotStore;
  let auditTrail: InMemoryMigrationAuditTrail;

  // Fixed base time for consistent Date.now() with fake timers
  const BASE_TIME = new Date('2025-01-15T12:00:00Z').getTime();

  function rebuildManager() {
    manager = createMigrationManager(
      testLogger,
      mockShadowLedger,
      mockDiscord,
      mockRoleMapping,
      mockCommunity,
      mockNotifications,
      mockMetrics,
      stateStore,
      snapshotStore,
      auditTrail,
      { enableAutoRollback: false }
    );
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
    mockShadowLedger = createMockShadowLedger();
    mockDiscord = createMockDiscord();
    mockRoleMapping = createMockRoleMapping();
    mockCommunity = createMockCommunity();
    mockNotifications = createMockNotifications();
    mockMetrics = createMockMetrics();
    stateStore = new InMemoryMigrationStateStore();
    snapshotStore = new InMemorySnapshotStore();
    auditTrail = new InMemoryMigrationAuditTrail();

    // Update mocks to use BASE_TIME for consistent behavior
    mockShadowLedger.getShadowStartDate = vi.fn().mockResolvedValue(
      new Date(BASE_TIME - 30 * 24 * 60 * 60 * 1000) // 30 days before BASE_TIME
    );
    mockDiscord.getLastIncumbentRoleUpdate = vi.fn().mockResolvedValue(
      new Date(BASE_TIME - 2 * 60 * 60 * 1000) // 2 hours before BASE_TIME
    );

    rebuildManager();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('checkReadiness', () => {
    it('should return ready when all checks pass', async () => {
      const result = await manager.checkReadiness('community-1');

      expect(result.ready).toBe(true);
      expect(result.blockers).toHaveLength(0);
      expect(result.checks).toHaveLength(3);
      expect(result.recommendedStrategy).toBe('gradual'); // 97% accuracy
    });

    it('should return not ready when shadow days insufficient', async () => {
      mockShadowLedger.getShadowStartDate = vi.fn().mockResolvedValue(
        new Date(BASE_TIME - 7 * 24 * 60 * 60 * 1000) // 7 days before BASE_TIME
      );

      const result = await manager.checkReadiness('community-1');

      expect(result.ready).toBe(false);
      expect(result.blockers).toEqual(
        expect.arrayContaining([expect.stringContaining('shadow mode')])
      );
      expect(result.estimatedDaysUntilReady).toBe(MIN_SHADOW_DAYS_FOR_MIGRATION - 7);
    });

    it('should return not ready when accuracy too low', async () => {
      mockShadowLedger.getShadowAccuracy = vi.fn().mockResolvedValue(0.90);

      const result = await manager.checkReadiness('community-1');

      expect(result.ready).toBe(false);
      expect(result.blockers).toEqual(
        expect.arrayContaining([expect.stringContaining('below minimum')])
      );
    });

    it('should return not ready when divergence too high', async () => {
      mockShadowLedger.getDivergenceRate = vi.fn().mockResolvedValue(0.10);

      const result = await manager.checkReadiness('community-1');

      expect(result.ready).toBe(false);
      expect(result.blockers).toEqual(
        expect.arrayContaining([expect.stringContaining('exceeds max')])
      );
    });

    it('should recommend instant strategy for 99%+ accuracy', async () => {
      mockShadowLedger.getShadowAccuracy = vi.fn().mockResolvedValue(0.995);

      const result = await manager.checkReadiness('community-1');

      expect(result.recommendedStrategy).toBe('instant');
    });

    it('should recommend arrakis_primary for lower accuracy', async () => {
      mockShadowLedger.getShadowAccuracy = vi.fn().mockResolvedValue(0.96);

      const result = await manager.checkReadiness('community-1');

      expect(result.recommendedStrategy).toBe('arrakis_primary');
    });

    it('should add warning for edge case accuracy', async () => {
      mockShadowLedger.getShadowAccuracy = vi.fn().mockResolvedValue(0.96);

      const result = await manager.checkReadiness('community-1');

      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining('not optimal')])
      );
    });

    it('should record metrics', async () => {
      await manager.checkReadiness('community-1');

      expect(mockMetrics.gauge).toHaveBeenCalledWith(
        'migration.readiness.shadow_days',
        expect.any(Number),
        { communityId: 'community-1' }
      );
      expect(mockMetrics.gauge).toHaveBeenCalledWith(
        'migration.readiness.accuracy',
        0.97,
        { communityId: 'community-1' }
      );
      expect(mockMetrics.increment).toHaveBeenCalledWith(
        'migration.readiness.checks',
        1,
        expect.objectContaining({ communityId: 'community-1' })
      );
    });

    it('should validate input', async () => {
      await expect(manager.checkReadiness('')).rejects.toThrow('communityId');
      await expect(manager.checkReadiness(null as unknown as string)).rejects.toThrow('communityId');
    });
  });

  describe('getMigrationState', () => {
    it('should return null when no active migration', async () => {
      const state = await manager.getMigrationState('community-1');
      expect(state).toBeNull();
    });

    it('should return active migration state', async () => {
      // Setup gradual migration so we can catch it in_progress
      mockShadowLedger.getMemberCount = vi.fn().mockResolvedValue(30);
      mockDiscord.getGuildMemberRoles = vi.fn().mockResolvedValue(
        Array.from({ length: 30 }, (_, i) => ({
          userId: `user-${i}`,
          roles: ['role-a'],
        }))
      );

      // Start migration - don't await
      const migrationPromise = manager.startMigration('community-1', 'guild-1', {
        ...createDefaultConfig('gradual'),
        gradualDays: 30,
        batchSize: 10,
      });

      // Advance to let first batch start
      await vi.advanceTimersByTimeAsync(100);

      // Get state while in_progress
      const state = await manager.getMigrationState('community-1');

      expect(state).not.toBeNull();
      expect(state?.communityId).toBe('community-1');
      expect(state?.status).toBe('in_progress_gradual');

      // Cleanup
      await vi.runAllTimersAsync();
      await migrationPromise;
    });
  });

  describe('getRecommendedStrategy', () => {
    it('should return null when not ready', async () => {
      // Accuracy 0.80 is below MIN_ACCURACY_FOR_MIGRATION (0.95), so not ready
      mockShadowLedger.getShadowAccuracy = vi.fn().mockResolvedValue(0.80);
      // Also need insufficient shadow days to ensure not ready
      mockShadowLedger.getShadowStartDate = vi.fn().mockResolvedValue(
        new Date(BASE_TIME - 5 * 24 * 60 * 60 * 1000) // Only 5 days
      );

      const strategy = await manager.getRecommendedStrategy('community-1');
      expect(strategy).toBeNull();
    });

    it('should return strategy when ready', async () => {
      const strategy = await manager.getRecommendedStrategy('community-1');
      expect(strategy).toBe('gradual');
    });
  });

  // ===========================================================================
  // Migration Strategy Tests
  // ===========================================================================

  describe('startMigration', () => {
    it('should reject if community not ready', async () => {
      // Set low accuracy AND insufficient shadow days to ensure not ready
      mockShadowLedger.getShadowAccuracy = vi.fn().mockResolvedValue(0.80);
      mockShadowLedger.getShadowStartDate = vi.fn().mockResolvedValue(
        new Date(BASE_TIME - 5 * 24 * 60 * 60 * 1000) // Only 5 days
      );

      await expect(
        manager.startMigration('community-1', 'guild-1', createDefaultConfig())
      ).rejects.toThrow('not ready for migration');
    });

    it('should reject if migration already exists', async () => {
      // Setup gradual migration so it stays in_progress
      mockShadowLedger.getMemberCount = vi.fn().mockResolvedValue(30);
      mockDiscord.getGuildMemberRoles = vi.fn().mockResolvedValue(
        Array.from({ length: 30 }, (_, i) => ({
          userId: `user-${i}`,
          roles: ['role-a'],
        }))
      );

      // Start first migration - don't await
      const firstMigrationPromise = manager.startMigration('community-1', 'guild-1', {
        ...createDefaultConfig('gradual'),
        gradualDays: 30,
        batchSize: 10,
      });

      // Advance to let first batch start
      await vi.advanceTimersByTimeAsync(100);

      // Verify migration is in_progress
      const state = await stateStore.getActiveByCommunity('community-1');
      expect(state?.status).toBe('in_progress_gradual');

      // Try to start another on same community - this should fail
      await expect(
        manager.startMigration('community-1', 'guild-1', createDefaultConfig())
      ).rejects.toThrow('Active migration already exists');

      // Cleanup
      await vi.runAllTimersAsync();
      await firstMigrationPromise;
    });

    it('should allow parallel_forever without full readiness', async () => {
      mockShadowLedger.getShadowAccuracy = vi.fn().mockResolvedValue(0.80);

      const migrationId = await manager.startMigration(
        'community-1',
        'guild-1',
        createDefaultConfig('parallel_forever')
      );

      expect(migrationId).toBeTruthy();
    });

    it('should validate strategy', async () => {
      await expect(
        manager.startMigration('community-1', 'guild-1', {
          ...createDefaultConfig(),
          strategy: 'invalid' as any,
        })
      ).rejects.toThrow('Invalid migration strategy');
    });

    it('should create pre-migration snapshot', async () => {
      const migrationId = await manager.startMigration(
        'community-1',
        'guild-1',
        createDefaultConfig()
      );

      const snapshot = await manager.getSnapshot(migrationId);

      expect(snapshot).not.toBeNull();
      expect(snapshot?.communityId).toBe('community-1');
      expect(snapshot?.members.length).toBeGreaterThan(0);
    });

    it('should log audit event', async () => {
      await manager.startMigration('community-1', 'guild-1', createDefaultConfig());

      const events = await auditTrail.getRecent('community-1');

      expect(events.some((e) => e.eventType === 'migration_started')).toBe(true);
    });
  });

  describe('instant strategy', () => {
    it('should migrate all members immediately', async () => {
      const migrationId = await manager.startMigration(
        'community-1',
        'guild-1',
        createDefaultConfig('instant')
      );

      // Fast-forward to let migration complete
      await vi.advanceTimersByTimeAsync(1000);

      const state = await stateStore.getById(migrationId);

      expect(state?.status).toBe('completed');
      expect(mockDiscord.addRolesToMember).toHaveBeenCalled();
      expect(mockCommunity.updateCoexistenceMode).toHaveBeenCalledWith('community-1', 'solo');
    });

    it('should remove incumbent roles by default', async () => {
      await manager.startMigration(
        'community-1',
        'guild-1',
        createDefaultConfig('instant')
      );

      await vi.advanceTimersByTimeAsync(1000);

      expect(mockDiscord.removeRolesFromMember).toHaveBeenCalled();
    });

    it('should preserve incumbent roles when configured', async () => {
      await manager.startMigration('community-1', 'guild-1', {
        ...createDefaultConfig('instant'),
        preserveIncumbentRoles: true,
      });

      await vi.advanceTimersByTimeAsync(1000);

      expect(mockDiscord.removeRolesFromMember).not.toHaveBeenCalled();
    });

    it('should send notification on completion', async () => {
      await manager.startMigration('community-1', 'guild-1', createDefaultConfig('instant'));

      await vi.advanceTimersByTimeAsync(1000);

      expect(mockNotifications.sendChannelNotification).toHaveBeenCalledWith(
        'channel-123',
        expect.stringContaining('Migration completed'),
        expect.any(Object)
      );
    });
  });

  describe('gradual strategy', () => {
    it('should migrate in batches over time', async () => {
      // Setup more members for batching
      mockDiscord.getGuildMemberRoles = vi.fn().mockResolvedValue(
        Array.from({ length: 30 }, (_, i) => ({
          userId: `user-${i}`,
          roles: ['role-a'],
        }))
      );
      mockShadowLedger.getMemberCount = vi.fn().mockResolvedValue(30);

      // Start migration - don't await, let it run with timers
      const migrationPromise = manager.startMigration('community-1', 'guild-1', {
        ...createDefaultConfig('gradual'),
        batchSize: 10,
        gradualDays: 3,
      });

      // Run all timers to completion (this will process all batches)
      await vi.runAllTimersAsync();

      // Now await the migration promise
      const migrationId = await migrationPromise;

      const finalState = await stateStore.getById(migrationId);
      expect(finalState?.status).toBe('completed');
      expect(finalState?.membersMigrated).toBe(30);
    });

    it('should log batch events', async () => {
      mockShadowLedger.getMemberCount = vi.fn().mockResolvedValue(20);
      mockDiscord.getGuildMemberRoles = vi.fn().mockResolvedValue(
        Array.from({ length: 20 }, (_, i) => ({
          userId: `user-${i}`,
          roles: ['role-a'],
        }))
      );

      // Start migration - don't await
      const migrationPromise = manager.startMigration('community-1', 'guild-1', {
        ...createDefaultConfig('gradual'),
        batchSize: 10,
        gradualDays: 2,
      });

      // Run all timers to completion
      await vi.runAllTimersAsync();
      await migrationPromise;

      const events = await auditTrail.getRecent('community-1', 50);

      expect(events.some((e) => e.eventType === 'batch_started')).toBe(true);
      expect(events.some((e) => e.eventType === 'batch_completed')).toBe(true);
    });
  });

  describe('parallel_forever strategy', () => {
    it('should update mode to parallel without migrating roles', async () => {
      mockShadowLedger.getShadowAccuracy = vi.fn().mockResolvedValue(0.80); // Low accuracy allowed

      await manager.startMigration(
        'community-1',
        'guild-1',
        createDefaultConfig('parallel_forever')
      );

      await vi.advanceTimersByTimeAsync(100);

      expect(mockCommunity.updateCoexistenceMode).toHaveBeenCalledWith('community-1', 'parallel');
      expect(mockDiscord.addRolesToMember).not.toHaveBeenCalled();
      expect(mockDiscord.removeRolesFromMember).not.toHaveBeenCalled();
    });

    it('should complete immediately', async () => {
      const migrationId = await manager.startMigration(
        'community-1',
        'guild-1',
        createDefaultConfig('parallel_forever')
      );

      await vi.advanceTimersByTimeAsync(100);

      const state = await stateStore.getById(migrationId);
      expect(state?.status).toBe('completed');
      expect(state?.progressPercent).toBe(100);
    });
  });

  describe('arrakis_primary strategy', () => {
    it('should add Arrakis roles but keep incumbent roles', async () => {
      await manager.startMigration(
        'community-1',
        'guild-1',
        createDefaultConfig('arrakis_primary')
      );

      await vi.advanceTimersByTimeAsync(1000);

      expect(mockDiscord.addRolesToMember).toHaveBeenCalled();
      expect(mockDiscord.removeRolesFromMember).not.toHaveBeenCalled();
      expect(mockCommunity.updateCoexistenceMode).toHaveBeenCalledWith('community-1', 'primary');
    });
  });

  // ===========================================================================
  // Migration Lifecycle Tests
  // ===========================================================================

  describe('pauseMigration', () => {
    it('should pause in-progress migration', async () => {
      // Setup gradual migration with multiple batches
      mockShadowLedger.getMemberCount = vi.fn().mockResolvedValue(30);
      mockDiscord.getGuildMemberRoles = vi.fn().mockResolvedValue(
        Array.from({ length: 30 }, (_, i) => ({
          userId: `user-${i}`,
          roles: ['role-a'],
        }))
      );

      // Start migration - don't await
      const migrationPromise = manager.startMigration('community-1', 'guild-1', {
        ...createDefaultConfig('gradual'),
        batchSize: 10,
        gradualDays: 30, // Long gradual period
      });

      // Advance just enough for first batch to process and migration to be in_progress
      await vi.advanceTimersByTimeAsync(100);

      // Get the migration ID from the state store (can't await the promise yet)
      const states = await stateStore.getHistoryByCommunity('community-1');
      const migrationId = states[0]?.migrationId;
      expect(migrationId).toBeTruthy();

      // Pause the migration
      const state = await manager.pauseMigration(migrationId!, 'Manual pause');
      expect(state.status).toBe('paused');

      // Run remaining timers to clean up the promise
      await vi.runAllTimersAsync();
      await migrationPromise;
    });

    it('should reject pausing completed migration', async () => {
      const migrationId = await manager.startMigration(
        'community-1',
        'guild-1',
        createDefaultConfig('instant')
      );

      await expect(
        manager.pauseMigration(migrationId, 'Test')
      ).rejects.toThrow('Cannot pause migration in status');
    });

    it('should log audit event', async () => {
      mockShadowLedger.getMemberCount = vi.fn().mockResolvedValue(30);
      mockDiscord.getGuildMemberRoles = vi.fn().mockResolvedValue(
        Array.from({ length: 30 }, (_, i) => ({
          userId: `user-${i}`,
          roles: ['role-a'],
        }))
      );

      // Start migration - don't await
      const migrationPromise = manager.startMigration('community-1', 'guild-1', {
        ...createDefaultConfig('gradual'),
        gradualDays: 30,
        batchSize: 10,
      });

      await vi.advanceTimersByTimeAsync(100);

      const states = await stateStore.getHistoryByCommunity('community-1');
      const migrationId = states[0]?.migrationId;

      await manager.pauseMigration(migrationId!, 'Test pause');

      const events = await auditTrail.getRecent('community-1');
      expect(events.some((e) => e.eventType === 'migration_paused')).toBe(true);

      // Cleanup
      await vi.runAllTimersAsync();
      await migrationPromise;
    });
  });

  describe('resumeMigration', () => {
    it('should resume paused migration', async () => {
      // Setup gradual migration
      mockShadowLedger.getMemberCount = vi.fn().mockResolvedValue(30);
      mockDiscord.getGuildMemberRoles = vi.fn().mockResolvedValue(
        Array.from({ length: 30 }, (_, i) => ({
          userId: `user-${i}`,
          roles: ['role-a'],
        }))
      );

      // Start migration - don't await
      const migrationPromise = manager.startMigration('community-1', 'guild-1', {
        ...createDefaultConfig('gradual'),
        batchSize: 10,
        gradualDays: 30,
      });

      await vi.advanceTimersByTimeAsync(100);

      // Get migration ID from state store
      const states = await stateStore.getHistoryByCommunity('community-1');
      const migrationId = states[0]?.migrationId;

      await manager.pauseMigration(migrationId!, 'Pause');

      // Resume - this starts a new execution promise
      const resumePromise = manager.resumeMigration(migrationId!);

      // Advance timers briefly
      await vi.advanceTimersByTimeAsync(100);

      // The resumed state should be fetched before running timers
      const states2 = await stateStore.getHistoryByCommunity('community-1');
      expect(states2[0]?.status).toBe('in_progress_gradual');

      // Cleanup - run all remaining timers
      await vi.runAllTimersAsync();
      await migrationPromise;
      await resumePromise;
    });

    it('should reject resuming non-paused migration', async () => {
      const migrationId = await manager.startMigration(
        'community-1',
        'guild-1',
        createDefaultConfig('instant')
      );

      await expect(manager.resumeMigration(migrationId)).rejects.toThrow(
        'Cannot resume migration in status'
      );
    });
  });

  describe('cancelMigration', () => {
    it('should cancel in-progress migration', async () => {
      // Setup gradual migration
      mockShadowLedger.getMemberCount = vi.fn().mockResolvedValue(30);
      mockDiscord.getGuildMemberRoles = vi.fn().mockResolvedValue(
        Array.from({ length: 30 }, (_, i) => ({
          userId: `user-${i}`,
          roles: ['role-a'],
        }))
      );

      // Start migration - don't await
      const migrationPromise = manager.startMigration('community-1', 'guild-1', {
        ...createDefaultConfig('gradual'),
        gradualDays: 30,
        batchSize: 10,
      });

      await vi.advanceTimersByTimeAsync(100);

      // Get migration ID from state store
      const states = await stateStore.getHistoryByCommunity('community-1');
      const migrationId = states[0]?.migrationId;

      const state = await manager.cancelMigration(migrationId!, 'User requested');

      expect(state.status).toBe('failed');
      expect(state.lastError).toContain('Cancelled');

      // Cleanup
      await vi.runAllTimersAsync();
      await migrationPromise;
    });

    it('should reject cancelling completed migration', async () => {
      const migrationId = await manager.startMigration(
        'community-1',
        'guild-1',
        createDefaultConfig('instant')
      );

      await expect(
        manager.cancelMigration(migrationId, 'Test')
      ).rejects.toThrow('Cannot cancel migration in status');
    });
  });

  // ===========================================================================
  // Rollback Tests
  // ===========================================================================

  describe('rollback', () => {
    it('should restore pre-migration state', async () => {
      const migrationId = await manager.startMigration(
        'community-1',
        'guild-1',
        createDefaultConfig('instant')
      );

      await vi.advanceTimersByTimeAsync(1000);

      // Reset mock to track rollback calls
      mockDiscord.addRolesToMember = vi.fn().mockResolvedValue(undefined);
      mockDiscord.removeRolesFromMember = vi.fn().mockResolvedValue(undefined);

      const result = await manager.rollback({
        migrationId,
        reason: 'Testing rollback',
        trigger: 'manual',
        requestedBy: 'admin-1',
      });

      expect(result.success).toBe(true);
      expect(result.membersAffected).toBeGreaterThan(0);
      expect(mockDiscord.addRolesToMember).toHaveBeenCalled(); // Restore incumbent
      expect(mockCommunity.updateCoexistenceMode).toHaveBeenCalledWith('community-1', 'shadow');
    });

    it('should fail gracefully if snapshot not found', async () => {
      const result = await manager.rollback({
        migrationId: 'non-existent',
        reason: 'Test',
        trigger: 'manual',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should send notification on rollback', async () => {
      const migrationId = await manager.startMigration(
        'community-1',
        'guild-1',
        createDefaultConfig('instant')
      );

      await vi.advanceTimersByTimeAsync(1000);
      mockNotifications.sendChannelNotification = vi.fn().mockResolvedValue(undefined);

      await manager.rollback({
        migrationId,
        reason: 'Testing',
        trigger: 'manual',
      });

      expect(mockNotifications.sendChannelNotification).toHaveBeenCalledWith(
        'channel-123',
        expect.stringContaining('rolled back')
      );
    });

    it('should log audit events', async () => {
      const migrationId = await manager.startMigration(
        'community-1',
        'guild-1',
        createDefaultConfig('instant')
      );

      await vi.advanceTimersByTimeAsync(1000);

      await manager.rollback({
        migrationId,
        reason: 'Test',
        trigger: 'manual',
      });

      const events = await auditTrail.getRecent('community-1');
      expect(events.some((e) => e.eventType === 'rollback_started')).toBe(true);
      expect(events.some((e) => e.eventType === 'rollback_completed')).toBe(true);
    });
  });

  describe('checkAutoRollbackTriggers', () => {
    it('should trigger on high divergence', async () => {
      // Setup gradual migration
      mockShadowLedger.getMemberCount = vi.fn().mockResolvedValue(30);
      mockDiscord.getGuildMemberRoles = vi.fn().mockResolvedValue(
        Array.from({ length: 30 }, (_, i) => ({
          userId: `user-${i}`,
          roles: ['role-a'],
        }))
      );

      // Start migration - don't await
      const migrationPromise = manager.startMigration('community-1', 'guild-1', {
        ...createDefaultConfig('gradual'),
        gradualDays: 30,
        batchSize: 10,
        rollbackThresholds: {
          accessLossPercent: 5,
          accessLossWindowMinutes: 60,
          errorRatePercent: 10,
          errorRateWindowMinutes: 15,
        },
      });

      await vi.advanceTimersByTimeAsync(100);

      // Get migration ID from state store
      const states = await stateStore.getHistoryByCommunity('community-1');
      const migrationId = states[0]?.migrationId;

      // Simulate high divergence
      mockShadowLedger.getDivergenceRate = vi.fn().mockResolvedValue(0.10); // 10%

      const trigger = await manager.checkAutoRollbackTriggers(migrationId!);

      expect(trigger?.trigger).toBe(true);
      expect(trigger?.reason).toContain('exceeds threshold');

      // Cleanup
      await vi.runAllTimersAsync();
      await migrationPromise;
    });

    it('should return null for non-existent migration', async () => {
      const trigger = await manager.checkAutoRollbackTriggers('non-existent');
      expect(trigger).toBeNull();
    });
  });

  // ===========================================================================
  // Health Monitor Tests
  // ===========================================================================

  describe('checkHealth', () => {
    it('should return healthy when bot is present and recent', async () => {
      const health = await manager.checkHealth('guild-1');

      expect(health.status).toBe('healthy');
      expect(health.botPresent).toBe(true);
      expect(health.hoursSinceLastRoleUpdate).toBeLessThan(48);
    });

    it('should return warning when hoursSinceLastUpdate >= warningHours', async () => {
      // Test by using custom thresholds
      const health = await manager.checkHealth('guild-1', {
        warningHours: 1, // Very low threshold - 2 hours ago should be warning
        criticalHours: 24,
        deadHours: 48,
      });

      // Mock returns 2 hours ago by default, so with warningHours=1, status should be warning
      expect(health.status).toBe('warning');
    });

    it('should return critical when hoursSinceLastUpdate >= criticalHours', async () => {
      // Test by using custom thresholds
      const health = await manager.checkHealth('guild-1', {
        warningHours: 0.5, // Very low
        criticalHours: 1, // 2 hours ago should be critical with this threshold
        deadHours: 48,
      });

      // Mock returns 2 hours ago by default, so with criticalHours=1, status should be critical
      expect(health.status).toBe('critical');
    });

    it('should return dead when bot not present', async () => {
      mockDiscord.isIncumbentBotPresent = vi.fn().mockResolvedValue(false);

      const health = await manager.checkHealth('guild-1');

      expect(health.status).toBe('dead');
      expect(health.botPresent).toBe(false);
    });

    it('should allow custom thresholds', async () => {
      mockDiscord.getLastIncumbentRoleUpdate = vi.fn().mockResolvedValue(
        new Date(Date.now() - 30 * 60 * 60 * 1000) // 30 hours ago
      );

      const health = await manager.checkHealth('guild-1', { warningHours: 24 });

      expect(health.status).toBe('warning');
    });
  });

  describe('startMonitoring / stopMonitoring', () => {
    it('should start health monitoring', async () => {
      await manager.startMonitoring('community-1', 'guild-1');

      // Advance timer to trigger check
      await vi.advanceTimersByTimeAsync(3600000); // 1 hour

      expect(mockDiscord.isIncumbentBotPresent).toHaveBeenCalled();
    });

    it('should stop health monitoring', async () => {
      await manager.startMonitoring('community-1', 'guild-1');
      await manager.stopMonitoring('guild-1');

      // Clear previous calls
      mockDiscord.isIncumbentBotPresent = vi.fn();

      // Advance timer
      await vi.advanceTimersByTimeAsync(3600000);

      // Should not have been called after stop
      expect(mockDiscord.isIncumbentBotPresent).not.toHaveBeenCalled();
    });

    it('should detect critical health when using custom thresholds', async () => {
      // Use custom thresholds to trigger critical status
      // Mock returns 2 hours ago by default
      const health = await manager.checkHealth('guild-1', {
        warningHours: 0.5,
        criticalHours: 1,
        deadHours: 48,
      });

      expect(health.status).toBe('critical');
    });
  });

  // ===========================================================================
  // Backup Activation Tests
  // ===========================================================================

  describe('activateBackup', () => {
    it('should activate Arrakis as backup', async () => {
      const result = await manager.activateBackup({
        communityId: 'community-1',
        guildId: 'guild-1',
        requestedBy: 'admin-1',
        reason: 'Incumbent unresponsive',
      });

      expect(result.success).toBe(true);
      expect(result.activationId).toBeTruthy();
      expect(mockCommunity.updateCoexistenceMode).toHaveBeenCalledWith('community-1', 'primary');
    });

    it('should reject if backup already active', async () => {
      await manager.activateBackup({
        communityId: 'community-1',
        guildId: 'guild-1',
        requestedBy: 'admin-1',
        reason: 'Test',
      });

      const result = await manager.activateBackup({
        communityId: 'community-1',
        guildId: 'guild-1',
        requestedBy: 'admin-1',
        reason: 'Test again',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already active');
    });

    it('should log audit event', async () => {
      await manager.activateBackup({
        communityId: 'community-1',
        guildId: 'guild-1',
        requestedBy: 'admin-1',
        reason: 'Test',
      });

      const events = await auditTrail.getRecent('community-1');
      expect(events.some((e) => e.eventType === 'backup_activated')).toBe(true);
    });
  });

  describe('deactivateBackup', () => {
    it('should deactivate backup', async () => {
      await manager.activateBackup({
        communityId: 'community-1',
        guildId: 'guild-1',
        requestedBy: 'admin-1',
        reason: 'Test',
      });

      const result = await manager.deactivateBackup('community-1', 'admin-1');

      expect(result).toBe(true);
      expect(mockCommunity.updateCoexistenceMode).toHaveBeenCalledWith('community-1', 'shadow');
    });

    it('should return false if not active', async () => {
      const result = await manager.deactivateBackup('community-1', 'admin-1');
      expect(result).toBe(false);
    });
  });

  describe('isBackupActive', () => {
    it('should return backup status', async () => {
      expect(await manager.isBackupActive('community-1')).toBe(false);

      await manager.activateBackup({
        communityId: 'community-1',
        guildId: 'guild-1',
        requestedBy: 'admin-1',
        reason: 'Test',
      });

      expect(await manager.isBackupActive('community-1')).toBe(true);
    });
  });

  // ===========================================================================
  // Audit Trail Tests
  // ===========================================================================

  describe('getAuditTrail', () => {
    it('should return audit trail interface', () => {
      const trail = manager.getAuditTrail();
      expect(trail).toBeDefined();
      expect(typeof trail.log).toBe('function');
      expect(typeof trail.query).toBe('function');
    });

    it('should allow querying audit events', async () => {
      await manager.startMigration(
        'community-1',
        'guild-1',
        createDefaultConfig('instant')
      );

      await vi.advanceTimersByTimeAsync(1000);

      const trail = manager.getAuditTrail();
      const events = await trail.query({
        communityId: 'community-1',
        eventType: 'migration_started',
      });

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].eventType).toBe('migration_started');
    });
  });

  // ===========================================================================
  // Input Validation Tests
  // ===========================================================================

  describe('input validation', () => {
    it('should validate communityId', async () => {
      await expect(
        manager.startMigration('', 'guild-1', createDefaultConfig())
      ).rejects.toThrow('communityId');
    });

    it('should validate guildId', async () => {
      await expect(
        manager.startMigration('community-1', '', createDefaultConfig())
      ).rejects.toThrow('guildId');
    });

    it('should sanitize gradual days', async () => {
      const migrationId = await manager.startMigration('community-1', 'guild-1', {
        ...createDefaultConfig('gradual'),
        gradualDays: 1000, // Over max
      });

      const state = await stateStore.getById(migrationId);
      expect(state?.config.gradualDays).toBe(90); // Max
    });

    it('should sanitize batch size', async () => {
      const migrationId = await manager.startMigration('community-1', 'guild-1', {
        ...createDefaultConfig('gradual'),
        batchSize: 5000, // Over max
      });

      const state = await stateStore.getById(migrationId);
      expect(state?.config.batchSize).toBe(1000); // Max
    });

    it('should truncate long reasons', async () => {
      const longReason = 'x'.repeat(1000);
      // Setup gradual migration
      mockShadowLedger.getMemberCount = vi.fn().mockResolvedValue(30);
      mockDiscord.getGuildMemberRoles = vi.fn().mockResolvedValue(
        Array.from({ length: 30 }, (_, i) => ({
          userId: `user-${i}`,
          roles: ['role-a'],
        }))
      );

      // Start migration - don't await
      const migrationPromise = manager.startMigration('community-1', 'guild-1', {
        ...createDefaultConfig('gradual'),
        gradualDays: 30,
        batchSize: 10,
      });

      await vi.advanceTimersByTimeAsync(100);

      // Get migration ID from state store
      const states = await stateStore.getHistoryByCommunity('community-1');
      const migrationId = states[0]?.migrationId;

      await manager.pauseMigration(migrationId!, longReason);

      const events = await auditTrail.getRecent('community-1');
      const pauseEvent = events.find((e) => e.eventType === 'migration_paused');
      expect((pauseEvent?.details.reason as string).length).toBeLessThanOrEqual(500);

      // Cleanup
      await vi.runAllTimersAsync();
      await migrationPromise;
    });
  });

  // ===========================================================================
  // InMemory Store Tests
  // ===========================================================================

  describe('InMemoryMigrationStateStore', () => {
    it('should save and retrieve state', async () => {
      const store = new InMemoryMigrationStateStore();
      const state: MigrationState = {
        migrationId: 'mig-1',
        communityId: 'community-1',
        guildId: 'guild-1',
        config: createDefaultConfig(),
        status: 'pending',
        startedAt: new Date(),
        completedAt: null,
        progressPercent: 0,
        membersMigrated: 0,
        totalMembers: 100,
        lastError: null,
      };

      await store.save(state);
      const retrieved = await store.getById('mig-1');

      expect(retrieved).toEqual(state);
    });

    it('should track community index', async () => {
      const store = new InMemoryMigrationStateStore();

      const state1: MigrationState = {
        migrationId: 'mig-1',
        communityId: 'community-1',
        guildId: 'guild-1',
        config: createDefaultConfig(),
        status: 'completed',
        startedAt: new Date(Date.now() - 1000),
        completedAt: new Date(),
        progressPercent: 100,
        membersMigrated: 100,
        totalMembers: 100,
        lastError: null,
      };

      const state2: MigrationState = {
        migrationId: 'mig-2',
        communityId: 'community-1',
        guildId: 'guild-1',
        config: createDefaultConfig(),
        status: 'in_progress',
        startedAt: new Date(),
        completedAt: null,
        progressPercent: 50,
        membersMigrated: 50,
        totalMembers: 100,
        lastError: null,
      };

      await store.save(state1);
      await store.save(state2);

      const active = await store.getActiveByCommunity('community-1');
      expect(active?.migrationId).toBe('mig-2');

      const history = await store.getHistoryByCommunity('community-1');
      expect(history).toHaveLength(2);
    });
  });

  describe('InMemorySnapshotStore', () => {
    it('should save and retrieve snapshot', async () => {
      const store = new InMemorySnapshotStore();
      const snapshot = {
        migrationId: 'mig-1',
        communityId: 'community-1',
        guildId: 'guild-1',
        snapshotAt: new Date(),
        members: [{ userId: 'user-1', incumbentRoles: ['a'], arrakisRoles: [] }],
      };

      await store.save(snapshot);
      const retrieved = await store.getByMigration('mig-1');

      expect(retrieved).toEqual(snapshot);
    });

    it('should add member to snapshot', async () => {
      const store = new InMemorySnapshotStore();
      await store.save({
        migrationId: 'mig-1',
        communityId: 'community-1',
        guildId: 'guild-1',
        snapshotAt: new Date(),
        members: [],
      });

      await store.addMember('mig-1', {
        userId: 'user-2',
        incumbentRoles: ['b'],
        arrakisRoles: [],
      });

      const snapshot = await store.getByMigration('mig-1');
      expect(snapshot?.members).toHaveLength(1);
    });
  });

  describe('InMemoryMigrationAuditTrail', () => {
    it('should log and query events', async () => {
      const trail = new InMemoryMigrationAuditTrail();

      await trail.log({
        communityId: 'community-1',
        guildId: 'guild-1',
        migrationId: 'mig-1',
        eventType: 'migration_started',
        timestamp: new Date(),
        actor: 'admin-1',
        details: {},
        severity: 'info',
      });

      const events = await trail.query({ communityId: 'community-1' });
      expect(events).toHaveLength(1);
      expect(events[0].eventId).toBeTruthy();
    });

    it('should filter by event type', async () => {
      const trail = new InMemoryMigrationAuditTrail();

      await trail.log({
        communityId: 'community-1',
        guildId: 'guild-1',
        migrationId: 'mig-1',
        eventType: 'migration_started',
        timestamp: new Date(),
        actor: 'admin-1',
        details: {},
        severity: 'info',
      });

      await trail.log({
        communityId: 'community-1',
        guildId: 'guild-1',
        migrationId: 'mig-1',
        eventType: 'migration_completed',
        timestamp: new Date(),
        actor: 'system',
        details: {},
        severity: 'info',
      });

      const started = await trail.query({ eventType: 'migration_started' });
      expect(started).toHaveLength(1);
    });
  });
});
