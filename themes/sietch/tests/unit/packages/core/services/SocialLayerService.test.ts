/**
 * SocialLayerService Unit Tests
 *
 * Sprint 65: Full Social Layer & Polish
 *
 * Tests for social layer unlock logic based on coexistence mode.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SocialLayerService,
  createSocialLayerService,
  FULL_SOCIAL_MODES,
  SOCIAL_FEATURES,
  type SocialFeatureStatus,
  type SocialLayerStatus,
} from '../../../../../src/packages/core/services/SocialLayerService.js';
import type { ICoexistenceStorage, StoredMigrationState } from '../../../../../src/packages/core/ports/ICoexistenceStorage.js';
import type { CoexistenceMode } from '../../../../../src/packages/adapters/storage/schema.js';

// =============================================================================
// Mocks
// =============================================================================

function createMockStorage(overrides: Partial<ICoexistenceStorage> = {}): ICoexistenceStorage {
  return {
    // Incumbent config
    getIncumbentConfig: vi.fn().mockResolvedValue(null),
    saveIncumbentConfig: vi.fn().mockResolvedValue({}),
    updateIncumbentHealth: vi.fn().mockResolvedValue(undefined),
    deleteIncumbentConfig: vi.fn().mockResolvedValue(undefined),
    hasIncumbent: vi.fn().mockResolvedValue(false),

    // Migration state
    getMigrationState: vi.fn().mockResolvedValue(null),
    saveMigrationState: vi.fn().mockResolvedValue({}),
    getCurrentMode: vi.fn().mockResolvedValue('shadow'),
    updateMode: vi.fn().mockResolvedValue(undefined),
    recordRollback: vi.fn().mockResolvedValue(undefined),
    initializeShadowMode: vi.fn().mockResolvedValue({}),
    updateMigrationState: vi.fn().mockResolvedValue({}),

    // Community
    getCommunity: vi.fn().mockResolvedValue(null),

    // Query
    getCommunitiesByMode: vi.fn().mockResolvedValue([]),
    getReadyCommunities: vi.fn().mockResolvedValue([]),
    getIncumbentHealthOverview: vi.fn().mockResolvedValue(new Map()),

    // Shadow member states
    getShadowMemberState: vi.fn().mockResolvedValue(null),
    getShadowMemberStates: vi.fn().mockResolvedValue([]),
    saveShadowMemberState: vi.fn().mockResolvedValue({}),
    batchSaveShadowMemberStates: vi.fn().mockResolvedValue(undefined),
    deleteShadowMemberState: vi.fn().mockResolvedValue(undefined),

    // Divergences
    saveDivergence: vi.fn().mockResolvedValue({}),
    getDivergences: vi.fn().mockResolvedValue([]),
    resolveDivergence: vi.fn().mockResolvedValue(undefined),
    getDivergenceSummary: vi.fn().mockResolvedValue({
      communityId: 'test',
      totalMembers: 0,
      matchCount: 0,
      arrakisHigherCount: 0,
      arrakisLowerCount: 0,
      mismatchCount: 0,
      accuracyPercent: 100,
    }),

    // Predictions
    savePrediction: vi.fn().mockResolvedValue({}),
    validatePrediction: vi.fn().mockResolvedValue(undefined),
    getUnvalidatedPredictions: vi.fn().mockResolvedValue([]),
    calculateAccuracy: vi.fn().mockResolvedValue(100),

    // Parallel role config
    getParallelRoleConfig: vi.fn().mockResolvedValue(null),
    saveParallelRoleConfig: vi.fn().mockResolvedValue({}),
    deleteParallelRoleConfig: vi.fn().mockResolvedValue(undefined),
    isParallelEnabled: vi.fn().mockResolvedValue(false),

    // Parallel roles
    getParallelRole: vi.fn().mockResolvedValue(null),
    getParallelRoles: vi.fn().mockResolvedValue([]),
    getParallelRoleByTier: vi.fn().mockResolvedValue(null),
    saveParallelRole: vi.fn().mockResolvedValue({}),
    updateParallelRolePosition: vi.fn().mockResolvedValue(undefined),
    updateParallelRoleMemberCount: vi.fn().mockResolvedValue(undefined),
    deleteParallelRole: vi.fn().mockResolvedValue(undefined),
    deleteAllParallelRoles: vi.fn().mockResolvedValue(undefined),

    // Parallel member assignments
    getParallelMemberAssignment: vi.fn().mockResolvedValue(null),
    getParallelMemberAssignments: vi.fn().mockResolvedValue([]),
    saveParallelMemberAssignment: vi.fn().mockResolvedValue({}),
    batchSaveParallelMemberAssignments: vi.fn().mockResolvedValue(undefined),
    deleteParallelMemberAssignment: vi.fn().mockResolvedValue(undefined),
    getMembersByTier: vi.fn().mockResolvedValue([]),

    // Parallel channel config
    getParallelChannelConfig: vi.fn().mockResolvedValue(null),
    saveParallelChannelConfig: vi.fn().mockResolvedValue({}),
    deleteParallelChannelConfig: vi.fn().mockResolvedValue(undefined),
    isChannelsEnabled: vi.fn().mockResolvedValue(false),

    // Parallel channels
    getParallelChannel: vi.fn().mockResolvedValue(null),
    getParallelChannels: vi.fn().mockResolvedValue([]),
    getParallelChannelsByConviction: vi.fn().mockResolvedValue([]),
    saveParallelChannel: vi.fn().mockResolvedValue({}),
    updateParallelChannelAccessCount: vi.fn().mockResolvedValue(undefined),
    deleteParallelChannel: vi.fn().mockResolvedValue(undefined),
    deleteAllParallelChannels: vi.fn().mockResolvedValue(undefined),

    // Parallel channel access
    getParallelChannelAccess: vi.fn().mockResolvedValue(null),
    getMemberChannelAccess: vi.fn().mockResolvedValue([]),
    getChannelAccessMembers: vi.fn().mockResolvedValue([]),
    saveParallelChannelAccess: vi.fn().mockResolvedValue({}),
    batchSaveParallelChannelAccess: vi.fn().mockResolvedValue(undefined),
    deleteParallelChannelAccess: vi.fn().mockResolvedValue(undefined),
    getMembersNeedingAccess: vi.fn().mockResolvedValue([]),
    getMembersNeedingRevocation: vi.fn().mockResolvedValue([]),

    ...overrides,
  };
}

function createMockMigrationState(mode: CoexistenceMode): StoredMigrationState {
  return {
    id: 'migration-1',
    communityId: 'community-1',
    currentMode: mode,
    targetMode: null,
    strategy: null,
    shadowStartedAt: new Date(),
    parallelEnabledAt: mode !== 'shadow' ? new Date() : null,
    primaryEnabledAt: ['primary', 'exclusive'].includes(mode) ? new Date() : null,
    exclusiveEnabledAt: mode === 'exclusive' ? new Date() : null,
    rollbackCount: 0,
    lastRollbackAt: null,
    lastRollbackReason: null,
    readinessCheckPassed: true,
    accuracyPercent: 95,
    shadowDays: 14,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('SocialLayerService', () => {
  let service: SocialLayerService;
  let mockStorage: ICoexistenceStorage;

  beforeEach(() => {
    mockStorage = createMockStorage();
    service = createSocialLayerService(mockStorage);
  });

  // ===========================================================================
  // Constants Tests
  // ===========================================================================

  describe('Constants', () => {
    it('should define full social modes', () => {
      expect(FULL_SOCIAL_MODES).toEqual(['primary', 'exclusive']);
    });

    it('should define all social features', () => {
      expect(SOCIAL_FEATURES.length).toBeGreaterThan(0);

      // Check required fields
      for (const feature of SOCIAL_FEATURES) {
        expect(feature.featureId).toBeDefined();
        expect(feature.category).toBeDefined();
        expect(feature.displayName).toBeDefined();
        expect(feature.description).toBeDefined();
        expect(typeof feature.unlocked).toBe('boolean');
      }
    });

    it('should have features across all categories', () => {
      const categories = new Set(SOCIAL_FEATURES.map(f => f.category));
      expect(categories.has('profile')).toBe(true);
      expect(categories.has('badges')).toBe(true);
      expect(categories.has('directory')).toBe(true);
      expect(categories.has('conviction')).toBe(true);
      expect(categories.has('water_sharing')).toBe(true);
      expect(categories.has('activity')).toBe(true);
    });
  });

  // ===========================================================================
  // getSocialLayerStatus Tests
  // ===========================================================================

  describe('getSocialLayerStatus', () => {
    it('should return null when no migration state exists', async () => {
      const status = await service.getSocialLayerStatus('community-1');
      expect(status).toBeNull();
    });

    it('should return status for shadow mode', async () => {
      mockStorage.getMigrationState = vi.fn().mockResolvedValue(
        createMockMigrationState('shadow')
      );

      const status = await service.getSocialLayerStatus('community-1');

      expect(status).not.toBeNull();
      expect(status!.currentMode).toBe('shadow');
      expect(status!.fullyUnlocked).toBe(false);
      expect(status!.unlockProgress).toBeLessThan(100);
    });

    it('should return status for parallel mode', async () => {
      mockStorage.getMigrationState = vi.fn().mockResolvedValue(
        createMockMigrationState('parallel')
      );

      const status = await service.getSocialLayerStatus('community-1');

      expect(status).not.toBeNull();
      expect(status!.currentMode).toBe('parallel');
      expect(status!.fullyUnlocked).toBe(false);
      // Some features should be unlocked in parallel
      const unlockedCount = status!.features.filter(f => f.unlocked).length;
      expect(unlockedCount).toBeGreaterThan(0);
    });

    it('should return fully unlocked status for primary mode', async () => {
      mockStorage.getMigrationState = vi.fn().mockResolvedValue(
        createMockMigrationState('primary')
      );

      const status = await service.getSocialLayerStatus('community-1');

      expect(status).not.toBeNull();
      expect(status!.currentMode).toBe('primary');
      expect(status!.fullyUnlocked).toBe(true);
      expect(status!.unlockProgress).toBe(100);
    });

    it('should return fully unlocked status for exclusive mode', async () => {
      mockStorage.getMigrationState = vi.fn().mockResolvedValue(
        createMockMigrationState('exclusive')
      );

      const status = await service.getSocialLayerStatus('community-1');

      expect(status).not.toBeNull();
      expect(status!.currentMode).toBe('exclusive');
      expect(status!.fullyUnlocked).toBe(true);
    });

    it('should include next milestone for non-fully-unlocked modes', async () => {
      mockStorage.getMigrationState = vi.fn().mockResolvedValue(
        createMockMigrationState('shadow')
      );

      const status = await service.getSocialLayerStatus('community-1');

      expect(status!.nextMilestone).toBeDefined();
      expect(status!.nextMilestone!.mode).toBe('parallel');
    });

    it('should not include next milestone for exclusive mode', async () => {
      mockStorage.getMigrationState = vi.fn().mockResolvedValue(
        createMockMigrationState('exclusive')
      );

      const status = await service.getSocialLayerStatus('community-1');

      expect(status!.nextMilestone).toBeUndefined();
    });
  });

  // ===========================================================================
  // isFeatureUnlocked Tests
  // ===========================================================================

  describe('isFeatureUnlocked', () => {
    const shadowFeature: SocialFeatureStatus = {
      featureId: 'test_shadow',
      category: 'profile',
      unlocked: false,
      displayName: 'Test Shadow',
      description: 'Test feature',
      requiredMode: null,
      requiredTier: null,
    };

    const parallelFeature: SocialFeatureStatus = {
      featureId: 'test_parallel',
      category: 'profile',
      unlocked: false,
      displayName: 'Test Parallel',
      description: 'Test feature',
      requiredMode: 'parallel',
      requiredTier: null,
    };

    const primaryFeature: SocialFeatureStatus = {
      featureId: 'test_primary',
      category: 'profile',
      unlocked: false,
      displayName: 'Test Primary',
      description: 'Test feature',
      requiredMode: 'primary',
      requiredTier: null,
    };

    it('should unlock feature with no required mode in any mode', () => {
      expect(service.isFeatureUnlocked(shadowFeature, 'shadow')).toBe(true);
      expect(service.isFeatureUnlocked(shadowFeature, 'parallel')).toBe(true);
      expect(service.isFeatureUnlocked(shadowFeature, 'primary')).toBe(true);
      expect(service.isFeatureUnlocked(shadowFeature, 'exclusive')).toBe(true);
    });

    it('should unlock parallel feature only in parallel+', () => {
      expect(service.isFeatureUnlocked(parallelFeature, 'shadow')).toBe(false);
      expect(service.isFeatureUnlocked(parallelFeature, 'parallel')).toBe(true);
      expect(service.isFeatureUnlocked(parallelFeature, 'primary')).toBe(true);
      expect(service.isFeatureUnlocked(parallelFeature, 'exclusive')).toBe(true);
    });

    it('should unlock primary feature only in primary+', () => {
      expect(service.isFeatureUnlocked(primaryFeature, 'shadow')).toBe(false);
      expect(service.isFeatureUnlocked(primaryFeature, 'parallel')).toBe(false);
      expect(service.isFeatureUnlocked(primaryFeature, 'primary')).toBe(true);
      expect(service.isFeatureUnlocked(primaryFeature, 'exclusive')).toBe(true);
    });
  });

  // ===========================================================================
  // isSocialLayerUnlocked Tests
  // ===========================================================================

  describe('isSocialLayerUnlocked', () => {
    it('should return false for shadow mode', async () => {
      mockStorage.getMigrationState = vi.fn().mockResolvedValue(
        createMockMigrationState('shadow')
      );

      const unlocked = await service.isSocialLayerUnlocked('community-1');
      expect(unlocked).toBe(false);
    });

    it('should return false for parallel mode', async () => {
      mockStorage.getMigrationState = vi.fn().mockResolvedValue(
        createMockMigrationState('parallel')
      );

      const unlocked = await service.isSocialLayerUnlocked('community-1');
      expect(unlocked).toBe(false);
    });

    it('should return true for primary mode', async () => {
      mockStorage.getMigrationState = vi.fn().mockResolvedValue(
        createMockMigrationState('primary')
      );

      const unlocked = await service.isSocialLayerUnlocked('community-1');
      expect(unlocked).toBe(true);
    });

    it('should return true for exclusive mode', async () => {
      mockStorage.getMigrationState = vi.fn().mockResolvedValue(
        createMockMigrationState('exclusive')
      );

      const unlocked = await service.isSocialLayerUnlocked('community-1');
      expect(unlocked).toBe(true);
    });

    it('should return false when no migration state', async () => {
      const unlocked = await service.isSocialLayerUnlocked('community-1');
      expect(unlocked).toBe(false);
    });
  });

  // ===========================================================================
  // getMemberFeatures Tests
  // ===========================================================================

  describe('getMemberFeatures', () => {
    it('should return empty array when no status', async () => {
      const features = await service.getMemberFeatures(
        'community-1',
        'member-1',
        'arrakis_full'
      );
      expect(features).toEqual([]);
    });

    it('should filter features by tier', async () => {
      mockStorage.getMigrationState = vi.fn().mockResolvedValue(
        createMockMigrationState('primary')
      );

      // Full tier should get all features
      const fullFeatures = await service.getMemberFeatures(
        'community-1',
        'member-1',
        'arrakis_full'
      );
      expect(fullFeatures.length).toBeGreaterThan(0);

      // Basic tier should get fewer features
      const basicFeatures = await service.getMemberFeatures(
        'community-1',
        'member-1',
        'arrakis_basic'
      );
      expect(basicFeatures.length).toBeLessThanOrEqual(fullFeatures.length);

      // Incumbent only should get even fewer
      const incumbentFeatures = await service.getMemberFeatures(
        'community-1',
        'member-1',
        'incumbent_only'
      );
      expect(incumbentFeatures.length).toBeLessThanOrEqual(basicFeatures.length);
    });
  });

  // ===========================================================================
  // onModeChange Tests
  // ===========================================================================

  describe('onModeChange', () => {
    it('should handle unlock transition', async () => {
      // Transition from parallel to primary (unlock)
      await service.onModeChange('community-1', 'parallel', 'primary');
      // No error thrown means success
    });

    it('should handle rollback transition', async () => {
      // Transition from primary to parallel (lock/rollback)
      await service.onModeChange('community-1', 'primary', 'parallel');
      // No error thrown means success
    });

    it('should handle transition between non-unlock modes', async () => {
      // Shadow to parallel (not a full unlock)
      await service.onModeChange('community-1', 'shadow', 'parallel');
      // No error thrown means success
    });
  });

  // ===========================================================================
  // Factory Function Tests
  // ===========================================================================

  describe('createSocialLayerService', () => {
    it('should create service with storage', () => {
      const svc = createSocialLayerService(mockStorage);
      expect(svc).toBeInstanceOf(SocialLayerService);
    });

    it('should create service with custom logger', () => {
      const mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn().mockReturnThis(),
      };

      const svc = createSocialLayerService(mockStorage, mockLogger as any);
      expect(svc).toBeInstanceOf(SocialLayerService);
    });
  });
});
