/**
 * MigrationEngine Tests
 *
 * Sprint 62: Migration Engine - Strategy Selection & Execution
 *
 * Tests for the MigrationEngine service that orchestrates migration
 * from incumbent token-gating to Arrakis.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MigrationEngine,
  createMigrationEngine,
  MIN_SHADOW_DAYS,
  MIN_ACCURACY_PERCENT,
  DEFAULT_BATCH_SIZE,
  DEFAULT_GRADUAL_DURATION_DAYS,
  type ReadinessCheckResult,
  type MigrationPlan,
  type MigrationExecutionResult,
} from '../../../../../src/packages/adapters/coexistence/MigrationEngine.js';
import type {
  ICoexistenceStorage,
  StoredMigrationState,
  DivergenceSummary,
  StoredIncumbentConfig,
} from '../../../../../src/packages/core/ports/ICoexistenceStorage.js';
import type { MigrationStrategy } from '../../../../../src/packages/adapters/storage/schema.js';

// =============================================================================
// Mock Storage
// =============================================================================

function createMockStorage(
  overrides: Partial<{
    migrationState: StoredMigrationState | null;
    incumbentConfig: StoredIncumbentConfig | null;
    divergenceSummary: DivergenceSummary;
  }> = {}
): ICoexistenceStorage {
  const defaultState: StoredMigrationState = {
    id: 'state-123',
    communityId: 'test-community',
    currentMode: 'shadow',
    targetMode: null,
    strategy: null,
    shadowStartedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000), // 20 days ago
    parallelEnabledAt: null,
    primaryEnabledAt: null,
    exclusiveEnabledAt: null,
    rollbackCount: 0,
    lastRollbackAt: null,
    lastRollbackReason: null,
    readinessCheckPassed: false,
    accuracyPercent: null,
    shadowDays: 20,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const defaultDivergence: DivergenceSummary = {
    communityId: 'test-community',
    totalMembers: 500,
    matchCount: 480,
    arrakisHigherCount: 10,
    arrakisLowerCount: 5,
    mismatchCount: 5,
    accuracyPercent: 96, // Above threshold
  };

  const defaultIncumbent: StoredIncumbentConfig = {
    id: 'incumbent-123',
    communityId: 'test-community',
    guildId: 'guild-456',
    provider: 'collab_land',
    botUserId: 'bot-789',
    detectedRoles: [],
    capabilities: {},
    detectionConfidence: 95,
    healthStatus: 'healthy',
    lastHealthCheck: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Handle explicit null vs undefined for overrides
  const migrationState = 'migrationState' in overrides
    ? overrides.migrationState
    : defaultState;
  const incumbentConfig = 'incumbentConfig' in overrides
    ? overrides.incumbentConfig
    : defaultIncumbent;
  const divergenceSummary = overrides.divergenceSummary ?? defaultDivergence;

  return {
    // Migration state
    getMigrationState: vi.fn().mockResolvedValue(migrationState),
    saveMigrationState: vi.fn().mockImplementation(async (input) => ({
      ...defaultState,
      ...input,
    })),
    getCurrentMode: vi.fn().mockResolvedValue('shadow'),
    updateMode: vi.fn().mockResolvedValue(undefined),
    recordRollback: vi.fn().mockResolvedValue(undefined),
    initializeShadowMode: vi.fn().mockResolvedValue(defaultState),

    // Incumbent config
    getIncumbentConfig: vi.fn().mockResolvedValue(incumbentConfig),
    saveIncumbentConfig: vi.fn().mockResolvedValue(defaultIncumbent),
    deleteIncumbentConfig: vi.fn().mockResolvedValue(undefined),

    // Divergence summary
    getDivergenceSummary: vi.fn().mockResolvedValue(divergenceSummary),

    // Query methods
    getCommunitiesByMode: vi.fn().mockResolvedValue([]),
    getReadyCommunities: vi.fn().mockResolvedValue([]),
    getIncumbentHealthStatus: vi.fn().mockResolvedValue(new Map()),

    // Shadow member states
    getShadowMemberState: vi.fn().mockResolvedValue(null),
    saveShadowMemberState: vi.fn().mockResolvedValue(undefined),
    getShadowMemberStates: vi.fn().mockResolvedValue([]),
    deleteShadowMemberStates: vi.fn().mockResolvedValue(undefined),

    // Divergence records
    recordDivergence: vi.fn().mockResolvedValue(undefined),
    getDivergences: vi.fn().mockResolvedValue([]),
    resolveDivergence: vi.fn().mockResolvedValue(undefined),
    getUnresolvedDivergences: vi.fn().mockResolvedValue([]),

    // Predictions
    savePrediction: vi.fn().mockResolvedValue(undefined),
    validatePrediction: vi.fn().mockResolvedValue(undefined),
    getUnvalidatedPredictions: vi.fn().mockResolvedValue([]),
    getPredictionAccuracy: vi.fn().mockResolvedValue(96),

    // Parallel roles
    getParallelRoleConfig: vi.fn().mockResolvedValue(null),
    saveParallelRoleConfig: vi.fn().mockResolvedValue(undefined),
    getParallelRoleConfigs: vi.fn().mockResolvedValue([]),
    deleteParallelRoleConfig: vi.fn().mockResolvedValue(undefined),

    // Parallel channels
    getParallelChannelConfig: vi.fn().mockResolvedValue(null),
    saveParallelChannelConfig: vi.fn().mockResolvedValue(undefined),
    getParallelChannelConfigs: vi.fn().mockResolvedValue([]),
    deleteParallelChannelConfig: vi.fn().mockResolvedValue(undefined),
  } as unknown as ICoexistenceStorage;
}

// =============================================================================
// Test Constants
// =============================================================================

const TEST_COMMUNITY_ID = 'test-community';

// =============================================================================
// Tests
// =============================================================================

describe('MigrationEngine', () => {
  describe('factory function', () => {
    it('creates engine with createMigrationEngine', () => {
      const storage = createMockStorage();
      const engine = createMigrationEngine(storage);
      expect(engine).toBeInstanceOf(MigrationEngine);
    });
  });

  // ===========================================================================
  // Readiness Check Tests (TASK-62.10)
  // ===========================================================================

  describe('checkReadiness', () => {
    it('returns ready when all conditions met', async () => {
      const storage = createMockStorage();
      const engine = createMigrationEngine(storage);

      const result = await engine.checkReadiness(TEST_COMMUNITY_ID);

      expect(result.ready).toBe(true);
      expect(result.checks.shadowDaysCheck).toBe(true);
      expect(result.checks.accuracyCheck).toBe(true);
      expect(result.checks.incumbentConfigured).toBe(true);
      expect(result.checks.modeCheck).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('blocks migration when shadow days insufficient', async () => {
      const storage = createMockStorage({
        migrationState: {
          id: 'state-123',
          communityId: TEST_COMMUNITY_ID,
          currentMode: 'shadow',
          targetMode: null,
          strategy: null,
          shadowStartedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
          parallelEnabledAt: null,
          primaryEnabledAt: null,
          exclusiveEnabledAt: null,
          rollbackCount: 0,
          lastRollbackAt: null,
          lastRollbackReason: null,
          readinessCheckPassed: false,
          accuracyPercent: null,
          shadowDays: 5,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      const engine = createMigrationEngine(storage);

      const result = await engine.checkReadiness(TEST_COMMUNITY_ID);

      expect(result.ready).toBe(false);
      expect(result.checks.shadowDaysCheck).toBe(false);
      expect(result.shadowDays).toBe(5);
      expect(result.requiredShadowDays).toBe(MIN_SHADOW_DAYS);
      expect(result.reason).toContain('Insufficient shadow days');
    });

    it('blocks migration when accuracy insufficient', async () => {
      const storage = createMockStorage({
        divergenceSummary: {
          communityId: TEST_COMMUNITY_ID,
          totalMembers: 500,
          matchCount: 400,
          arrakisHigherCount: 50,
          arrakisLowerCount: 30,
          mismatchCount: 20,
          accuracyPercent: 80, // Below 95% threshold
        },
      });
      const engine = createMigrationEngine(storage);

      const result = await engine.checkReadiness(TEST_COMMUNITY_ID);

      expect(result.ready).toBe(false);
      expect(result.checks.accuracyCheck).toBe(false);
      expect(result.accuracyPercent).toBe(80);
      expect(result.requiredAccuracyPercent).toBe(MIN_ACCURACY_PERCENT);
      expect(result.reason).toContain('Insufficient accuracy');
    });

    it('blocks migration when no incumbent configured', async () => {
      const storage = createMockStorage({
        incumbentConfig: null,
      });
      const engine = createMigrationEngine(storage);

      const result = await engine.checkReadiness(TEST_COMMUNITY_ID);

      expect(result.ready).toBe(false);
      expect(result.checks.incumbentConfigured).toBe(false);
      expect(result.reason).toContain('No incumbent bot configured');
    });

    it('blocks migration when not in shadow or parallel mode', async () => {
      const storage = createMockStorage({
        migrationState: {
          id: 'state-123',
          communityId: TEST_COMMUNITY_ID,
          currentMode: 'exclusive', // Invalid mode for migration
          targetMode: null,
          strategy: null,
          shadowStartedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
          parallelEnabledAt: null,
          primaryEnabledAt: null,
          exclusiveEnabledAt: new Date(),
          rollbackCount: 0,
          lastRollbackAt: null,
          lastRollbackReason: null,
          readinessCheckPassed: true,
          accuracyPercent: 98,
          shadowDays: 20,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      const engine = createMigrationEngine(storage);

      const result = await engine.checkReadiness(TEST_COMMUNITY_ID);

      expect(result.ready).toBe(false);
      expect(result.checks.modeCheck).toBe(false);
      expect(result.reason).toContain('Invalid mode for migration');
    });

    it('returns not ready when no migration state exists', async () => {
      const storage = createMockStorage({
        migrationState: null,
      });
      const engine = createMigrationEngine(storage);

      const result = await engine.checkReadiness(TEST_COMMUNITY_ID);

      expect(result.ready).toBe(false);
      expect(result.reason).toContain('No migration state found');
    });

    it('combines multiple failure reasons', async () => {
      const storage = createMockStorage({
        migrationState: {
          id: 'state-123',
          communityId: TEST_COMMUNITY_ID,
          currentMode: 'shadow',
          targetMode: null,
          strategy: null,
          shadowStartedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days
          parallelEnabledAt: null,
          primaryEnabledAt: null,
          exclusiveEnabledAt: null,
          rollbackCount: 0,
          lastRollbackAt: null,
          lastRollbackReason: null,
          readinessCheckPassed: false,
          accuracyPercent: null,
          shadowDays: 5,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        divergenceSummary: {
          communityId: TEST_COMMUNITY_ID,
          totalMembers: 100,
          matchCount: 70,
          arrakisHigherCount: 20,
          arrakisLowerCount: 5,
          mismatchCount: 5,
          accuracyPercent: 70,
        },
      });
      const engine = createMigrationEngine(storage);

      const result = await engine.checkReadiness(TEST_COMMUNITY_ID);

      expect(result.ready).toBe(false);
      expect(result.reason).toContain('shadow days');
      expect(result.reason).toContain('accuracy');
    });
  });

  // ===========================================================================
  // Migration Execution Tests
  // ===========================================================================

  describe('executeMigration', () => {
    it('blocks execution when readiness check fails', async () => {
      const storage = createMockStorage({
        divergenceSummary: {
          communityId: TEST_COMMUNITY_ID,
          totalMembers: 100,
          matchCount: 50,
          arrakisHigherCount: 25,
          arrakisLowerCount: 15,
          mismatchCount: 10,
          accuracyPercent: 50, // Below threshold
        },
      });
      const engine = createMigrationEngine(storage);

      const result = await engine.executeMigration(TEST_COMMUNITY_ID, {
        strategy: 'instant',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Migration blocked');
    });

    it('allows execution when skipReadinessCheck is true (dangerous)', async () => {
      const storage = createMockStorage({
        divergenceSummary: {
          communityId: TEST_COMMUNITY_ID,
          totalMembers: 100,
          matchCount: 50,
          arrakisHigherCount: 25,
          arrakisLowerCount: 15,
          mismatchCount: 10,
          accuracyPercent: 50, // Below threshold
        },
      });
      const engine = createMigrationEngine(storage);

      const result = await engine.executeMigration(TEST_COMMUNITY_ID, {
        strategy: 'instant',
        skipReadinessCheck: true,
      });

      expect(result.success).toBe(true);
    });

    it('returns plan without executing on dryRun', async () => {
      const storage = createMockStorage();
      const engine = createMigrationEngine(storage);

      const result = await engine.executeMigration(TEST_COMMUNITY_ID, {
        strategy: 'gradual',
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.plan).toBeDefined();
      expect(storage.updateMode).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Instant Migration Tests
  // ===========================================================================

  describe('instant migration', () => {
    it('transitions to parallel mode immediately', async () => {
      const storage = createMockStorage();
      const engine = createMigrationEngine(storage);

      const result = await engine.executeMigration(TEST_COMMUNITY_ID, {
        strategy: 'instant',
      });

      expect(result.success).toBe(true);
      expect(result.newMode).toBe('parallel');
      expect(result.strategy).toBe('instant');
      expect(storage.updateMode).toHaveBeenCalledWith(
        TEST_COMMUNITY_ID,
        'parallel',
        expect.any(String)
      );
    });

    it('updates migration state with parallel timestamp', async () => {
      const storage = createMockStorage();
      const engine = createMigrationEngine(storage);

      await engine.executeMigration(TEST_COMMUNITY_ID, {
        strategy: 'instant',
      });

      expect(storage.saveMigrationState).toHaveBeenCalledWith(
        expect.objectContaining({
          communityId: TEST_COMMUNITY_ID,
          currentMode: 'parallel',
          strategy: 'instant',
          parallelEnabledAt: expect.any(Date),
          readinessCheckPassed: true,
        })
      );
    });
  });

  // ===========================================================================
  // Gradual Migration Tests (TASK-62.11)
  // ===========================================================================

  describe('gradual migration', () => {
    it('calculates batches correctly', async () => {
      const storage = createMockStorage({
        divergenceSummary: {
          communityId: TEST_COMMUNITY_ID,
          totalMembers: 500,
          matchCount: 480,
          arrakisHigherCount: 10,
          arrakisLowerCount: 5,
          mismatchCount: 5,
          accuracyPercent: 96,
        },
      });
      const engine = createMigrationEngine(storage);

      const result = await engine.executeMigration(TEST_COMMUNITY_ID, {
        strategy: 'gradual',
        batchSize: 100,
        durationDays: 7,
      });

      expect(result.success).toBe(true);
      expect(result.strategy).toBe('gradual');
      expect(result.initialBatchSize).toBe(100);
      expect(result.remainingBatches).toBe(4); // 500 / 100 = 5 batches, minus first
    });

    it('uses default batch size when not specified', async () => {
      const storage = createMockStorage({
        divergenceSummary: {
          communityId: TEST_COMMUNITY_ID,
          totalMembers: 250,
          matchCount: 240,
          arrakisHigherCount: 5,
          arrakisLowerCount: 3,
          mismatchCount: 2,
          accuracyPercent: 96,
        },
      });
      const engine = createMigrationEngine(storage);

      const result = await engine.executeMigration(TEST_COMMUNITY_ID, {
        strategy: 'gradual',
      });

      expect(result.success).toBe(true);
      expect(result.initialBatchSize).toBe(DEFAULT_BATCH_SIZE);
    });

    it('handles small community with single batch', async () => {
      const storage = createMockStorage({
        divergenceSummary: {
          communityId: TEST_COMMUNITY_ID,
          totalMembers: 50,
          matchCount: 48,
          arrakisHigherCount: 1,
          arrakisLowerCount: 1,
          mismatchCount: 0,
          accuracyPercent: 96,
        },
      });
      const engine = createMigrationEngine(storage);

      const result = await engine.executeMigration(TEST_COMMUNITY_ID, {
        strategy: 'gradual',
        batchSize: 100, // Larger than total members
      });

      expect(result.success).toBe(true);
      expect(result.initialBatchSize).toBe(50); // Capped to total
      expect(result.remainingBatches).toBe(0);
    });

    it('sets target mode to primary for gradual', async () => {
      const storage = createMockStorage();
      const engine = createMigrationEngine(storage);

      await engine.executeMigration(TEST_COMMUNITY_ID, {
        strategy: 'gradual',
      });

      expect(storage.saveMigrationState).toHaveBeenCalledWith(
        expect.objectContaining({
          targetMode: 'primary',
        })
      );
    });

    it('plan includes estimated completion date', async () => {
      const storage = createMockStorage();
      const engine = createMigrationEngine(storage);

      const result = await engine.executeMigration(TEST_COMMUNITY_ID, {
        strategy: 'gradual',
        durationDays: 14,
        dryRun: true,
      });

      expect(result.plan?.estimatedCompletion).toBeDefined();
      const estimatedDate = result.plan!.estimatedCompletion!;
      const now = new Date();
      const diffDays = Math.ceil(
        (estimatedDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );
      expect(diffDays).toBeGreaterThanOrEqual(13); // ~14 days from now
      expect(diffDays).toBeLessThanOrEqual(15);
    });
  });

  // ===========================================================================
  // Parallel Forever Tests
  // ===========================================================================

  describe('parallel_forever migration', () => {
    it('enables parallel mode with no planned transition', async () => {
      const storage = createMockStorage();
      const engine = createMigrationEngine(storage);

      const result = await engine.executeMigration(TEST_COMMUNITY_ID, {
        strategy: 'parallel_forever',
      });

      expect(result.success).toBe(true);
      expect(result.newMode).toBe('parallel');
      expect(result.strategy).toBe('parallel_forever');
    });

    it('sets target mode to parallel (no further transition)', async () => {
      const storage = createMockStorage();
      const engine = createMigrationEngine(storage);

      await engine.executeMigration(TEST_COMMUNITY_ID, {
        strategy: 'parallel_forever',
      });

      expect(storage.saveMigrationState).toHaveBeenCalledWith(
        expect.objectContaining({
          targetMode: 'parallel', // Final state
          strategy: 'parallel_forever',
        })
      );
    });
  });

  // ===========================================================================
  // Arrakis Primary Tests
  // ===========================================================================

  describe('arrakis_primary migration', () => {
    it('transitions directly to primary mode', async () => {
      const storage = createMockStorage();
      const engine = createMigrationEngine(storage);

      const result = await engine.executeMigration(TEST_COMMUNITY_ID, {
        strategy: 'arrakis_primary',
      });

      expect(result.success).toBe(true);
      expect(result.newMode).toBe('primary');
      expect(result.strategy).toBe('arrakis_primary');
    });

    it('sets target mode to exclusive (can transition further)', async () => {
      const storage = createMockStorage();
      const engine = createMigrationEngine(storage);

      await engine.executeMigration(TEST_COMMUNITY_ID, {
        strategy: 'arrakis_primary',
      });

      expect(storage.saveMigrationState).toHaveBeenCalledWith(
        expect.objectContaining({
          currentMode: 'primary',
          targetMode: 'exclusive', // Can go to exclusive later
          strategy: 'arrakis_primary',
        })
      );
    });
  });

  // ===========================================================================
  // Available Strategies Tests
  // ===========================================================================

  describe('getAvailableStrategies', () => {
    it('returns all strategies when ready in shadow mode', async () => {
      const storage = createMockStorage();
      const engine = createMigrationEngine(storage);

      const { strategies, currentMode, readiness } =
        await engine.getAvailableStrategies(TEST_COMMUNITY_ID);

      expect(currentMode).toBe('shadow');
      expect(readiness.ready).toBe(true);
      expect(strategies).toContain('instant');
      expect(strategies).toContain('gradual');
      expect(strategies).toContain('parallel_forever');
      expect(strategies).toContain('arrakis_primary');
    });

    it('returns only arrakis_primary from parallel mode', async () => {
      const storage = createMockStorage({
        migrationState: {
          id: 'state-123',
          communityId: TEST_COMMUNITY_ID,
          currentMode: 'parallel',
          targetMode: null,
          strategy: 'instant',
          shadowStartedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
          parallelEnabledAt: new Date(),
          primaryEnabledAt: null,
          exclusiveEnabledAt: null,
          rollbackCount: 0,
          lastRollbackAt: null,
          lastRollbackReason: null,
          readinessCheckPassed: true,
          accuracyPercent: 96,
          shadowDays: 20,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      const engine = createMigrationEngine(storage);

      const { strategies, currentMode } =
        await engine.getAvailableStrategies(TEST_COMMUNITY_ID);

      expect(currentMode).toBe('parallel');
      expect(strategies).toEqual(['arrakis_primary']);
    });

    it('returns empty when not ready', async () => {
      const storage = createMockStorage({
        divergenceSummary: {
          communityId: TEST_COMMUNITY_ID,
          totalMembers: 100,
          matchCount: 50,
          arrakisHigherCount: 25,
          arrakisLowerCount: 15,
          mismatchCount: 10,
          accuracyPercent: 50, // Not ready
        },
      });
      const engine = createMigrationEngine(storage);

      const { strategies, readiness } =
        await engine.getAvailableStrategies(TEST_COMMUNITY_ID);

      expect(readiness.ready).toBe(false);
      expect(strategies).toEqual([]);
    });
  });

  // ===========================================================================
  // Gradual Batch Info Tests
  // ===========================================================================

  describe('getGradualBatchInfo', () => {
    it('returns null when not gradual strategy', async () => {
      const storage = createMockStorage({
        migrationState: {
          id: 'state-123',
          communityId: TEST_COMMUNITY_ID,
          currentMode: 'parallel',
          targetMode: null,
          strategy: 'instant',
          shadowStartedAt: new Date(),
          parallelEnabledAt: new Date(),
          primaryEnabledAt: null,
          exclusiveEnabledAt: null,
          rollbackCount: 0,
          lastRollbackAt: null,
          lastRollbackReason: null,
          readinessCheckPassed: true,
          accuracyPercent: 96,
          shadowDays: 20,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      const engine = createMigrationEngine(storage);

      const info = await engine.getGradualBatchInfo(TEST_COMMUNITY_ID);

      expect(info).toBeNull();
    });

    it('returns batch info for gradual migration', async () => {
      const storage = createMockStorage({
        migrationState: {
          id: 'state-123',
          communityId: TEST_COMMUNITY_ID,
          currentMode: 'parallel',
          targetMode: 'primary',
          strategy: 'gradual',
          shadowStartedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
          parallelEnabledAt: new Date(),
          primaryEnabledAt: null,
          exclusiveEnabledAt: null,
          rollbackCount: 0,
          lastRollbackAt: null,
          lastRollbackReason: null,
          readinessCheckPassed: true,
          accuracyPercent: 96,
          shadowDays: 20,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        divergenceSummary: {
          communityId: TEST_COMMUNITY_ID,
          totalMembers: 500,
          matchCount: 480,
          arrakisHigherCount: 10,
          arrakisLowerCount: 5,
          mismatchCount: 5,
          accuracyPercent: 96,
        },
      });
      const engine = createMigrationEngine(storage);

      const info = await engine.getGradualBatchInfo(TEST_COMMUNITY_ID);

      expect(info).not.toBeNull();
      expect(info!.batchNumber).toBe(1);
      expect(info!.totalBatches).toBe(5); // 500 / 100
      expect(info!.membersInBatch).toBe(100);
      expect(info!.membersRemaining).toBe(500);
    });
  });

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe('error handling', () => {
    it('returns error for unknown strategy', async () => {
      const storage = createMockStorage();
      const engine = createMigrationEngine(storage);

      const result = await engine.executeMigration(TEST_COMMUNITY_ID, {
        strategy: 'unknown_strategy' as MigrationStrategy,
        skipReadinessCheck: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown migration strategy');
    });

    it('handles storage errors gracefully', async () => {
      const storage = createMockStorage();
      vi.mocked(storage.updateMode).mockRejectedValue(new Error('Database error'));
      const engine = createMigrationEngine(storage);

      const result = await engine.executeMigration(TEST_COMMUNITY_ID, {
        strategy: 'instant',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Database error');
    });

    it('returns error when no migration state on execute', async () => {
      const storage = createMockStorage({
        migrationState: null,
      });
      const engine = createMigrationEngine(storage);

      const result = await engine.executeMigration(TEST_COMMUNITY_ID, {
        strategy: 'instant',
        skipReadinessCheck: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No migration state found');
    });
  });
});
