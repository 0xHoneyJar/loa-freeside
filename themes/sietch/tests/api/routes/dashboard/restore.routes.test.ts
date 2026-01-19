/**
 * Restore Routes Tests
 *
 * Sprint 126: Restore API & CLI
 *
 * Tests for restore API endpoints.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { createRestoreRoutes, type RestoreRoutesDeps } from '../../../../src/api/routes/dashboard/restore.routes.js';
import type { IConfigService } from '../../../../src/services/config/ConfigService.js';
import type {
  CurrentConfiguration,
  ConfigRecordWithPayload,
  CheckpointSnapshot,
  ConfigHistoryResult,
} from '../../../../src/db/types/config.types.js';
import { createImpactAnalyzer } from '../../../../src/services/restore/ImpactAnalyzer.js';

// =============================================================================
// Mocks
// =============================================================================

vi.mock('../../../../src/api/middleware/dashboardAuth.js', () => ({
  requireDashboardAuth: (req: Request, res: Response, next: NextFunction) => {
    (req as any).dashboardSession = {
      userId: 'test-user',
      username: 'testuser',
      adminGuilds: [{ id: 'server-123', name: 'Test Server', icon: null }],
    };
    next();
  },
  requireServerAccess: (req: Request, res: Response, next: NextFunction) => {
    next();
  },
}));

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockConfig(
  serverId: string,
  thresholds: Record<string, any> = {},
  featureGates: Record<string, any> = {},
  roleMappings: Record<string, any> = {}
): CurrentConfiguration {
  return {
    serverId,
    thresholds,
    featureGates,
    roleMappings,
    activeThemeId: null,
    lastRecordId: null,
    version: 1,
    schemaVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createMockCheckpoint(
  id: string,
  fullStateJson: Record<string, any>
): CheckpointSnapshot {
  return {
    id,
    serverId: 'server-123',
    schemaVersion: 1,
    triggerCommand: 'teardown',
    fullStateJson,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  };
}

function createMockHistoryResult(
  checkpoints: CheckpointSnapshot[]
): ConfigHistoryResult {
  return {
    records: checkpoints.map((cp) => ({
      id: `record-${cp.id}`,
      serverId: cp.serverId,
      userId: 'test-user',
      action: 'CREATE' as const,
      recordableType: 'CheckpointSnapshot' as const,
      recordableId: cp.id,
      schemaVersion: 1,
      createdAt: cp.createdAt,
      payload: cp,
    })),
    total: checkpoints.length,
    hasMore: false,
  };
}

function createMockResponse(): Response & {
  json: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
} {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as any;
}

// =============================================================================
// Tests
// =============================================================================

describe('Restore Routes', () => {
  let mockConfigService: IConfigService;

  beforeEach(() => {
    vi.clearAllMocks();

    mockConfigService = {
      getCurrentConfiguration: vi.fn(),
      getConfigHistory: vi.fn(),
      updateThresholds: vi.fn(),
      updateFeatureGates: vi.fn(),
      updateRoleMappings: vi.fn(),
      initializeConfiguration: vi.fn(),
    };
  });

  describe('GET /servers/:serverId/restore/checkpoints', () => {
    it('should return list of checkpoints', async () => {
      const checkpoints = [
        createMockCheckpoint('cp-1', { thresholds: {} }),
        createMockCheckpoint('cp-2', { thresholds: {} }),
      ];

      (mockConfigService.getConfigHistory as any).mockResolvedValue(
        createMockHistoryResult(checkpoints)
      );

      const deps: RestoreRoutesDeps = { configService: mockConfigService };
      const router = createRestoreRoutes(deps);

      const getHandler = router.stack.find(
        (layer: any) =>
          layer.route?.path === '/servers/:serverId/restore/checkpoints' &&
          layer.route?.methods?.get
      )?.route?.stack.slice(-1)[0].handle;

      expect(getHandler).toBeDefined();

      const req = {
        params: { serverId: 'server-123' },
        dashboardSession: { userId: 'test-user' },
      } as any;
      const res = createMockResponse();
      const next = vi.fn();

      await getHandler(req, res, next);

      expect(res.json).toHaveBeenCalled();
      const response = res.json.mock.calls[0][0];

      expect(response.serverId).toBe('server-123');
      expect(response.checkpoints).toHaveLength(2);
      expect(response.total).toBe(2);
    });
  });

  describe('POST /servers/:serverId/restore/preview', () => {
    it('should return impact analysis for valid checkpoint', async () => {
      const currentConfig = createMockConfig('server-123', {
        'tier-1': { bgt: 100 },
      });

      const checkpoint = createMockCheckpoint('cp-1', {
        thresholds: { 'tier-1': { bgt: 50 } },
      });

      (mockConfigService.getCurrentConfiguration as any).mockResolvedValue(currentConfig);
      (mockConfigService.getConfigHistory as any).mockResolvedValue(
        createMockHistoryResult([checkpoint])
      );

      const deps: RestoreRoutesDeps = { configService: mockConfigService };
      const router = createRestoreRoutes(deps);

      const postHandler = router.stack.find(
        (layer: any) =>
          layer.route?.path === '/servers/:serverId/restore/preview' &&
          layer.route?.methods?.post
      )?.route?.stack.slice(-1)[0].handle;

      const req = {
        params: { serverId: 'server-123' },
        body: { checkpointId: 'cp-1' },
        dashboardSession: { userId: 'test-user' },
      } as any;
      const res = createMockResponse();
      const next = vi.fn();

      await postHandler(req, res, next);

      expect(res.json).toHaveBeenCalled();
      const response = res.json.mock.calls[0][0];

      expect(response.serverId).toBe('server-123');
      expect(response.summary).toBeDefined();
      expect(response.thresholdChanges).toBeDefined();
      expect(response.humanReadableSummary).toBeDefined();
    });

    it('should return 400 for missing checkpoint ID', async () => {
      const deps: RestoreRoutesDeps = { configService: mockConfigService };
      const router = createRestoreRoutes(deps);

      const postHandler = router.stack.find(
        (layer: any) =>
          layer.route?.path === '/servers/:serverId/restore/preview' &&
          layer.route?.methods?.post
      )?.route?.stack.slice(-1)[0].handle;

      const req = {
        params: { serverId: 'server-123' },
        body: {},
        dashboardSession: { userId: 'test-user' },
      } as any;
      const res = createMockResponse();
      const next = vi.fn();

      await postHandler(req, res, next);

      expect(next).toHaveBeenCalled();
      const error = next.mock.calls[0][0];
      // Zod validation error
      expect(error.message).toBeDefined();
    });

    it('should include confirmation code for high-impact restores', async () => {
      const currentConfig = createMockConfig('server-123', {
        'tier-1': { bgt: 100 },
      });

      // Create checkpoint with many role changes to trigger high-impact
      const checkpoint = createMockCheckpoint('cp-1', {
        thresholds: { 'tier-1': { bgt: 50 } },
        roleMappings: {
          'role-1': { roleId: 'role-1', roleName: 'R1', tierId: 'tier-1', priority: 0, status: 'active' },
          'role-2': { roleId: 'role-2', roleName: 'R2', tierId: 'tier-1', priority: 0, status: 'active' },
        },
      });

      (mockConfigService.getCurrentConfiguration as any).mockResolvedValue(currentConfig);
      (mockConfigService.getConfigHistory as any).mockResolvedValue(
        createMockHistoryResult([checkpoint])
      );

      const deps: RestoreRoutesDeps = { configService: mockConfigService };
      const router = createRestoreRoutes(deps);

      const postHandler = router.stack.find(
        (layer: any) =>
          layer.route?.path === '/servers/:serverId/restore/preview' &&
          layer.route?.methods?.post
      )?.route?.stack.slice(-1)[0].handle;

      const req = {
        params: { serverId: 'server-123' },
        body: { checkpointId: 'cp-1' },
        dashboardSession: { userId: 'test-user' },
      } as any;
      const res = createMockResponse();
      const next = vi.fn();

      await postHandler(req, res, next);

      const response = res.json.mock.calls[0][0];

      // With 2 role additions (20 users) + 1 threshold decrease (5 users) = 25 > 10
      expect(response.isHighImpact).toBe(true);
      expect(response.confirmationCode).not.toBeNull();
      expect(response.confirmationRequired).toBe(true);
    });
  });

  describe('POST /servers/:serverId/restore/execute', () => {
    it('should execute restore successfully', async () => {
      const currentConfig = createMockConfig('server-123', {
        'tier-1': { bgt: 100 },
      });

      const checkpoint = createMockCheckpoint('cp-1', {
        thresholds: { 'tier-1': { bgt: 50 } },
        featureGates: {},
        roleMappings: {},
      });

      (mockConfigService.getCurrentConfiguration as any).mockResolvedValue(currentConfig);
      (mockConfigService.getConfigHistory as any).mockResolvedValue(
        createMockHistoryResult([checkpoint])
      );
      (mockConfigService.updateThresholds as any).mockResolvedValue(undefined);
      (mockConfigService.updateFeatureGates as any).mockResolvedValue(undefined);
      (mockConfigService.updateRoleMappings as any).mockResolvedValue(undefined);

      const deps: RestoreRoutesDeps = { configService: mockConfigService };
      const router = createRestoreRoutes(deps);

      const postHandler = router.stack.find(
        (layer: any) =>
          layer.route?.path === '/servers/:serverId/restore/execute' &&
          layer.route?.methods?.post
      )?.route?.stack.slice(-1)[0].handle;

      const req = {
        params: { serverId: 'server-123' },
        body: { checkpointId: 'cp-1', confirmationCode: '123456' },
        dashboardSession: { userId: 'test-user' },
      } as any;
      const res = createMockResponse();
      const next = vi.fn();

      await postHandler(req, res, next);

      expect(res.json).toHaveBeenCalled();
      const response = res.json.mock.calls[0][0];

      expect(response.success).toBe(true);
      expect(response.checkpointId).toBe('cp-1');
      expect(response.message).toContain('restored');

      // Verify config service was called
      expect(mockConfigService.updateThresholds).toHaveBeenCalled();
    });

    it('should return 400 for missing checkpoint ID', async () => {
      const deps: RestoreRoutesDeps = { configService: mockConfigService };
      const router = createRestoreRoutes(deps);

      const postHandler = router.stack.find(
        (layer: any) =>
          layer.route?.path === '/servers/:serverId/restore/execute' &&
          layer.route?.methods?.post
      )?.route?.stack.slice(-1)[0].handle;

      const req = {
        params: { serverId: 'server-123' },
        body: { confirmationCode: '123456' },
        dashboardSession: { userId: 'test-user' },
      } as any;
      const res = createMockResponse();
      const next = vi.fn();

      await postHandler(req, res, next);

      expect(next).toHaveBeenCalled();
      const error = next.mock.calls[0][0];
      // Zod validation error
      expect(error.message).toBeDefined();
    });

    it('should return 400 for missing confirmation code', async () => {
      const deps: RestoreRoutesDeps = { configService: mockConfigService };
      const router = createRestoreRoutes(deps);

      const postHandler = router.stack.find(
        (layer: any) =>
          layer.route?.path === '/servers/:serverId/restore/execute' &&
          layer.route?.methods?.post
      )?.route?.stack.slice(-1)[0].handle;

      const req = {
        params: { serverId: 'server-123' },
        body: { checkpointId: 'cp-1' },
        dashboardSession: { userId: 'test-user' },
      } as any;
      const res = createMockResponse();
      const next = vi.fn();

      await postHandler(req, res, next);

      expect(next).toHaveBeenCalled();
      const error = next.mock.calls[0][0];
      // Zod validation error
      expect(error.message).toBeDefined();
    });
  });
});
