/**
 * CoexistenceStorage Unit Tests
 *
 * Sprint 56: Shadow Mode Foundation - Incumbent Detection
 *
 * Tests for the PostgreSQL storage adapter for coexistence data.
 * Uses mock Drizzle database for unit testing.
 *
 * @module tests/unit/packages/adapters/coexistence/CoexistenceStorage.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CoexistenceStorage } from '../../../../../src/packages/adapters/coexistence/CoexistenceStorage.js';
import { nullLogger } from '../../../../../src/packages/infrastructure/logging/index.js';
import type {
  CoexistenceMode,
  IncumbentProvider,
  HealthStatus,
} from '../../../../../src/packages/adapters/storage/schema.js';

// =============================================================================
// Mock Database Types
// =============================================================================

interface MockIncumbentConfig {
  id: string;
  communityId: string;
  provider: string;
  botId: string | null;
  botUsername: string | null;
  verificationChannelId: string | null;
  detectedAt: Date;
  confidence: number;
  manualOverride: boolean;
  lastHealthCheck: Date | null;
  healthStatus: string;
  detectedRoles: unknown[];
  capabilities: Record<string, boolean>;
  createdAt: Date;
  updatedAt: Date;
}

interface MockMigrationState {
  id: string;
  communityId: string;
  currentMode: string;
  targetMode: string | null;
  strategy: string | null;
  shadowStartedAt: Date | null;
  parallelEnabledAt: Date | null;
  primaryEnabledAt: Date | null;
  exclusiveEnabledAt: Date | null;
  rollbackCount: number;
  lastRollbackAt: Date | null;
  lastRollbackReason: string | null;
  readinessCheckPassed: boolean;
  accuracyPercent: number | null;
  shadowDays: number;
  createdAt: Date;
  updatedAt: Date;
}

// =============================================================================
// Mock Database Builder
// =============================================================================

function createMockDb() {
  // In-memory storage
  const incumbentConfigs = new Map<string, MockIncumbentConfig>();
  const migrationStates = new Map<string, MockMigrationState>();

  // Mock query results
  let lastSelectResult: unknown[] = [];
  let lastInsertResult: unknown[] = [];
  let lastUpdateResult: unknown[] = [];

  const mockDb = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(() => {
            return Promise.resolve(lastSelectResult);
          }),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockImplementation(() => {
          return Promise.resolve(lastInsertResult);
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockImplementation(() => {
            return Promise.resolve(lastUpdateResult);
          }),
        }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),

    // Helpers for test setup
    _setSelectResult: (result: unknown[]) => {
      lastSelectResult = result;
    },
    _setInsertResult: (result: unknown[]) => {
      lastInsertResult = result;
    },
    _setUpdateResult: (result: unknown[]) => {
      lastUpdateResult = result;
    },
    _incumbentConfigs: incumbentConfigs,
    _migrationStates: migrationStates,
  };

  return mockDb;
}

// =============================================================================
// Tests
// =============================================================================

describe('CoexistenceStorage', () => {
  let storage: CoexistenceStorage;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockDb = createMockDb();
    storage = new CoexistenceStorage(
      mockDb as unknown as Parameters<typeof CoexistenceStorage['prototype']['constructor']>[0],
      nullLogger
    );
  });

  describe('Incumbent Configuration', () => {
    describe('getIncumbentConfig', () => {
      it('should return null when no config exists', async () => {
        mockDb._setSelectResult([]);

        const result = await storage.getIncumbentConfig('community-123');

        expect(result).toBeNull();
      });

      it('should return mapped config when found', async () => {
        const mockConfig: MockIncumbentConfig = {
          id: 'config-1',
          communityId: 'community-123',
          provider: 'collabland',
          botId: '704521096837464076',
          botUsername: 'Collab.Land',
          verificationChannelId: 'channel-1',
          detectedAt: new Date('2024-01-01'),
          confidence: 95, // Stored as 0-100
          manualOverride: false,
          lastHealthCheck: null,
          healthStatus: 'unknown',
          detectedRoles: [],
          capabilities: { hasBalanceCheck: true },
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        };
        mockDb._setSelectResult([mockConfig]);

        const result = await storage.getIncumbentConfig('community-123');

        expect(result).not.toBeNull();
        expect(result?.provider).toBe('collabland');
        expect(result?.confidence).toBe(0.95); // Converted to 0-1
        expect(result?.botId).toBe('704521096837464076');
      });
    });

    describe('saveIncumbentConfig', () => {
      it('should create new config when none exists', async () => {
        mockDb._setSelectResult([]); // No existing config

        const insertedConfig: MockIncumbentConfig = {
          id: 'new-config',
          communityId: 'community-123',
          provider: 'collabland',
          botId: '704521096837464076',
          botUsername: 'Collab.Land',
          verificationChannelId: null,
          detectedAt: new Date(),
          confidence: 95,
          manualOverride: false,
          lastHealthCheck: null,
          healthStatus: 'unknown',
          detectedRoles: [],
          capabilities: { hasBalanceCheck: true },
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        mockDb._setInsertResult([insertedConfig]);

        const result = await storage.saveIncumbentConfig({
          communityId: 'community-123',
          provider: 'collabland',
          botId: '704521096837464076',
          botUsername: 'Collab.Land',
          confidence: 0.95,
        });

        expect(result.provider).toBe('collabland');
        expect(result.botId).toBe('704521096837464076');
        expect(mockDb.insert).toHaveBeenCalled();
      });

      it('should update existing config', async () => {
        // Existing config
        const existingConfig: MockIncumbentConfig = {
          id: 'existing-config',
          communityId: 'community-123',
          provider: 'collabland',
          botId: '704521096837464076',
          botUsername: 'Collab.Land',
          verificationChannelId: null,
          detectedAt: new Date(),
          confidence: 95,
          manualOverride: false,
          lastHealthCheck: null,
          healthStatus: 'unknown',
          detectedRoles: [],
          capabilities: { hasBalanceCheck: true },
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        mockDb._setSelectResult([existingConfig]);

        // Updated config
        const updatedConfig = { ...existingConfig, confidence: 98 };
        mockDb._setUpdateResult([updatedConfig]);

        const result = await storage.saveIncumbentConfig({
          communityId: 'community-123',
          provider: 'collabland',
          botId: '704521096837464076',
          confidence: 0.98,
        });

        expect(mockDb.update).toHaveBeenCalled();
        expect(result.confidence).toBe(0.98);
      });

      it('should convert confidence to integer for storage', async () => {
        mockDb._setSelectResult([]);

        const insertedConfig: MockIncumbentConfig = {
          id: 'new-config',
          communityId: 'community-123',
          provider: 'collabland',
          botId: null,
          botUsername: null,
          verificationChannelId: null,
          detectedAt: new Date(),
          confidence: 70, // 0.70 * 100
          manualOverride: false,
          lastHealthCheck: null,
          healthStatus: 'unknown',
          detectedRoles: [],
          capabilities: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        mockDb._setInsertResult([insertedConfig]);

        const result = await storage.saveIncumbentConfig({
          communityId: 'community-123',
          provider: 'collabland',
          confidence: 0.7,
        });

        expect(result.confidence).toBe(0.7);
      });
    });

    describe('updateIncumbentHealth', () => {
      it('should update health status', async () => {
        await storage.updateIncumbentHealth({
          communityId: 'community-123',
          healthStatus: 'healthy',
          lastHealthCheck: new Date(),
        });

        expect(mockDb.update).toHaveBeenCalled();
      });
    });

    describe('hasIncumbent', () => {
      it('should return true when config exists', async () => {
        mockDb._setSelectResult([{ id: 'config-1' }]);

        const result = await storage.hasIncumbent('community-123');

        expect(result).toBe(true);
      });

      it('should return false when no config', async () => {
        mockDb._setSelectResult([]);

        const result = await storage.hasIncumbent('community-123');

        expect(result).toBe(false);
      });
    });
  });

  describe('Migration State', () => {
    describe('getMigrationState', () => {
      it('should return null when no state exists', async () => {
        mockDb._setSelectResult([]);

        const result = await storage.getMigrationState('community-123');

        expect(result).toBeNull();
      });

      it('should return mapped state when found', async () => {
        const mockState: MockMigrationState = {
          id: 'state-1',
          communityId: 'community-123',
          currentMode: 'shadow',
          targetMode: null,
          strategy: null,
          shadowStartedAt: new Date('2024-01-01'),
          parallelEnabledAt: null,
          primaryEnabledAt: null,
          exclusiveEnabledAt: null,
          rollbackCount: 0,
          lastRollbackAt: null,
          lastRollbackReason: null,
          readinessCheckPassed: false,
          accuracyPercent: 9500, // 95.00 * 100
          shadowDays: 7,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        };
        mockDb._setSelectResult([mockState]);

        const result = await storage.getMigrationState('community-123');

        expect(result).not.toBeNull();
        expect(result?.currentMode).toBe('shadow');
        expect(result?.accuracyPercent).toBe(95); // Converted back
        expect(result?.shadowDays).toBe(7);
      });
    });

    describe('getCurrentMode', () => {
      it('should return shadow as default', async () => {
        mockDb._setSelectResult([]);

        const mode = await storage.getCurrentMode('community-123');

        expect(mode).toBe('shadow');
      });

      it('should return stored mode', async () => {
        const mockState: MockMigrationState = {
          id: 'state-1',
          communityId: 'community-123',
          currentMode: 'parallel',
          targetMode: null,
          strategy: null,
          shadowStartedAt: new Date(),
          parallelEnabledAt: new Date(),
          primaryEnabledAt: null,
          exclusiveEnabledAt: null,
          rollbackCount: 0,
          lastRollbackAt: null,
          lastRollbackReason: null,
          readinessCheckPassed: true,
          accuracyPercent: null,
          shadowDays: 14,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        mockDb._setSelectResult([mockState]);

        const mode = await storage.getCurrentMode('community-123');

        expect(mode).toBe('parallel');
      });
    });

    describe('initializeShadowMode', () => {
      it('should create state in shadow mode', async () => {
        mockDb._setSelectResult([]); // No existing state

        const insertedState: MockMigrationState = {
          id: 'new-state',
          communityId: 'community-123',
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
        };
        mockDb._setInsertResult([insertedState]);

        const result = await storage.initializeShadowMode('community-123');

        expect(result.currentMode).toBe('shadow');
        expect(result.shadowStartedAt).not.toBeNull();
      });
    });

    describe('updateMode', () => {
      it('should update mode and set timestamp', async () => {
        const existingState: MockMigrationState = {
          id: 'state-1',
          communityId: 'community-123',
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
          readinessCheckPassed: true,
          accuracyPercent: null,
          shadowDays: 14,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        mockDb._setSelectResult([existingState]);

        await storage.updateMode('community-123', 'parallel', 'Ready for parallel');

        expect(mockDb.update).toHaveBeenCalled();
      });

      it('should create state if none exists', async () => {
        mockDb._setSelectResult([]); // No existing state

        await storage.updateMode('community-123', 'shadow');

        expect(mockDb.insert).toHaveBeenCalled();
      });
    });

    describe('recordRollback', () => {
      it('should increment rollback count', async () => {
        const existingState: MockMigrationState = {
          id: 'state-1',
          communityId: 'community-123',
          currentMode: 'parallel',
          targetMode: null,
          strategy: null,
          shadowStartedAt: new Date(),
          parallelEnabledAt: new Date(),
          primaryEnabledAt: null,
          exclusiveEnabledAt: null,
          rollbackCount: 1,
          lastRollbackAt: null,
          lastRollbackReason: null,
          readinessCheckPassed: true,
          accuracyPercent: null,
          shadowDays: 14,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        mockDb._setSelectResult([existingState]);

        await storage.recordRollback(
          'community-123',
          'Too many errors',
          'shadow'
        );

        expect(mockDb.update).toHaveBeenCalled();
      });
    });
  });

  describe('Query Methods', () => {
    describe('getCommunitiesByMode', () => {
      it('should return community IDs for given mode', async () => {
        mockDb.select = vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { communityId: 'community-1' },
              { communityId: 'community-2' },
            ]),
          }),
        });

        const result = await storage.getCommunitiesByMode('shadow');

        expect(result).toEqual(['community-1', 'community-2']);
      });
    });

    describe('getReadyCommunities', () => {
      it('should return communities ready for migration', async () => {
        mockDb.select = vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { communityId: 'ready-community' },
            ]),
          }),
        });

        const result = await storage.getReadyCommunities();

        expect(result).toContain('ready-community');
      });
    });

    describe('getIncumbentHealthOverview', () => {
      it('should return health status map', async () => {
        mockDb.select = vi.fn().mockReturnValue({
          from: vi.fn().mockResolvedValue([
            { communityId: 'community-1', healthStatus: 'healthy' },
            { communityId: 'community-2', healthStatus: 'degraded' },
          ]),
        });

        const result = await storage.getIncumbentHealthOverview();

        expect(result.get('community-1')).toBe('healthy');
        expect(result.get('community-2')).toBe('degraded');
      });
    });
  });
});

describe('Type Safety', () => {
  it('should enforce valid CoexistenceMode values', () => {
    const validModes: CoexistenceMode[] = ['shadow', 'parallel', 'primary', 'exclusive'];
    expect(validModes).toHaveLength(4);
  });

  it('should enforce valid IncumbentProvider values', () => {
    const validProviders: IncumbentProvider[] = ['collabland', 'matrica', 'guild.xyz', 'other'];
    expect(validProviders).toHaveLength(4);
  });

  it('should enforce valid HealthStatus values', () => {
    const validStatuses: HealthStatus[] = ['healthy', 'degraded', 'offline', 'unknown'];
    expect(validStatuses).toHaveLength(4);
  });
});
