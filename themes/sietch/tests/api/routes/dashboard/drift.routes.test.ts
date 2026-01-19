/**
 * Drift Routes Tests
 *
 * Sprint 124: Drift API & Scheduled Check
 *
 * Tests for drift detection API endpoints.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Guild, Role } from 'discord.js';
import type { Request, Response, NextFunction } from 'express';
import { createDriftRoutes, type DriftRoutesDeps } from '../../../../src/api/routes/dashboard/drift.routes.js';
import type { IConfigService } from '../../../../src/services/config/ConfigService.js';
import type { CurrentConfiguration, RoleMapping } from '../../../../src/db/types/config.types.js';
import { clearAllDriftCache } from '../../../../src/services/config/DriftDetector.js';
import { resetDriftMetrics } from '../../../../src/services/config/driftMetrics.js';

// =============================================================================
// Mocks
// =============================================================================

// Mock the middleware
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

function createMockRole(id: string, name: string): Role {
  return { id, name, managed: false } as Role;
}

function createMockGuild(roles: Role[]): Guild {
  return {
    roles: {
      fetch: vi.fn().mockResolvedValue({
        values: () => roles,
        [Symbol.iterator]: () => roles[Symbol.iterator](),
      }),
    },
  } as unknown as Guild;
}

function createRoleMapping(
  roleId: string,
  roleName: string,
  tierId: string
): RoleMapping {
  return {
    roleId,
    roleName,
    tierId,
    priority: 0,
    status: 'active',
  };
}

function createMockConfig(
  serverId: string,
  roleMappings: Record<string, RoleMapping>
): CurrentConfiguration {
  return {
    serverId,
    thresholds: {},
    featureGates: {},
    roleMappings,
    activeThemeId: null,
    lastRecordId: null,
    version: 1,
    schemaVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createMockConfigService(config: CurrentConfiguration): IConfigService {
  return {
    getCurrentConfiguration: vi.fn().mockResolvedValue(config),
    getConfigHistory: vi.fn(),
    updateThresholds: vi.fn(),
    updateFeatureGates: vi.fn(),
    updateRoleMappings: vi.fn(),
    initializeConfiguration: vi.fn(),
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
  return res as Response & {
    json: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('Drift Routes', () => {
  beforeEach(() => {
    resetDriftMetrics();
    clearAllDriftCache();
    vi.clearAllMocks();
  });

  describe('GET /servers/:serverId/drift', () => {
    it('should return drift report with ghost roles', async () => {
      // Discord has role A only
      const discordRoles = [createMockRole('role-a', 'Role A')];
      const guild = createMockGuild(discordRoles);

      // Config has roles A and B (B is ghost)
      const config = createMockConfig('server-123', {
        'role-a': createRoleMapping('role-a', 'Role A', 'tier-1'),
        'role-b': createRoleMapping('role-b', 'Role B', 'tier-2'),
      });
      const configService = createMockConfigService(config);

      const deps: DriftRoutesDeps = { guild, configService };
      const router = createDriftRoutes(deps);

      // Find the GET handler
      const getHandler = router.stack.find(
        (layer: any) => layer.route?.path === '/servers/:serverId/drift' && layer.route?.methods?.get
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
      expect(response.status).toBe('drift_detected');
      expect(response.summary.deletedRoles).toBe(1);
      expect(response.summary.healthyRoles).toBe(1);
      expect(response.issues).toHaveLength(1);
      expect(response.issues[0].type).toBe('ROLE_DELETED');
      expect(response.issues[0].roleId).toBe('role-b');
      expect(response.alert).not.toBeNull();
      expect(response.alert.level).toBe('info');
    });

    it('should return healthy status when no drift', async () => {
      const discordRoles = [
        createMockRole('role-a', 'Role A'),
        createMockRole('role-b', 'Role B'),
      ];
      const guild = createMockGuild(discordRoles);

      const config = createMockConfig('server-123', {
        'role-a': createRoleMapping('role-a', 'Role A', 'tier-1'),
        'role-b': createRoleMapping('role-b', 'Role B', 'tier-2'),
      });
      const configService = createMockConfigService(config);

      const deps: DriftRoutesDeps = { guild, configService };
      const router = createDriftRoutes(deps);

      const getHandler = router.stack.find(
        (layer: any) => layer.route?.path === '/servers/:serverId/drift' && layer.route?.methods?.get
      )?.route?.stack.slice(-1)[0].handle;

      const req = {
        params: { serverId: 'server-123' },
        dashboardSession: { userId: 'test-user' },
      } as any;
      const res = createMockResponse();
      const next = vi.fn();

      await getHandler(req, res, next);

      const response = res.json.mock.calls[0][0];
      expect(response.status).toBe('healthy');
      expect(response.summary.totalIssues).toBe(0);
      expect(response.issues).toHaveLength(0);
      expect(response.alert).toBeNull();
    });

    it('should include renamed roles in response', async () => {
      const discordRoles = [createMockRole('role-a', 'New Name')];
      const guild = createMockGuild(discordRoles);

      const config = createMockConfig('server-123', {
        'role-a': createRoleMapping('role-a', 'Old Name', 'tier-1'),
      });
      const configService = createMockConfigService(config);

      const deps: DriftRoutesDeps = { guild, configService };
      const router = createDriftRoutes(deps);

      const getHandler = router.stack.find(
        (layer: any) => layer.route?.path === '/servers/:serverId/drift' && layer.route?.methods?.get
      )?.route?.stack.slice(-1)[0].handle;

      const req = {
        params: { serverId: 'server-123' },
        dashboardSession: { userId: 'test-user' },
      } as any;
      const res = createMockResponse();
      const next = vi.fn();

      await getHandler(req, res, next);

      const response = res.json.mock.calls[0][0];
      expect(response.status).toBe('drift_detected');
      expect(response.summary.renamedRoles).toBe(1);
      expect(response.issues[0].type).toBe('ROLE_RENAMED');
      expect(response.issues[0].configRoleName).toBe('Old Name');
      expect(response.issues[0].currentRoleName).toBe('New Name');
      // No alert for renamed only (alert is for ghost/deleted)
      expect(response.alert).toBeNull();
    });
  });

  describe('POST /servers/:serverId/drift/clear-cache', () => {
    it('should clear drift cache for server', async () => {
      const discordRoles = [createMockRole('role-a', 'Role A')];
      const guild = createMockGuild(discordRoles);

      const config = createMockConfig('server-123', {
        'role-a': createRoleMapping('role-a', 'Role A', 'tier-1'),
      });
      const configService = createMockConfigService(config);

      const deps: DriftRoutesDeps = { guild, configService };
      const router = createDriftRoutes(deps);

      const postHandler = router.stack.find(
        (layer: any) =>
          layer.route?.path === '/servers/:serverId/drift/clear-cache' &&
          layer.route?.methods?.post
      )?.route?.stack.slice(-1)[0].handle;

      expect(postHandler).toBeDefined();

      const req = {
        params: { serverId: 'server-123' },
        dashboardSession: { userId: 'test-user' },
      } as any;
      const res = createMockResponse();

      await postHandler(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Drift cache cleared. Next request will perform fresh check.',
      });
    });
  });
});

// =============================================================================
// Response Format Tests
// =============================================================================

describe('Drift API Response Format', () => {
  beforeEach(() => {
    resetDriftMetrics();
    clearAllDriftCache();
  });

  it('should include ISO timestamp in checkedAt', async () => {
    const discordRoles = [createMockRole('role-a', 'Role A')];
    const guild = createMockGuild(discordRoles);

    const config = createMockConfig('server-123', {
      'role-a': createRoleMapping('role-a', 'Role A', 'tier-1'),
    });
    const configService = createMockConfigService(config);

    const deps: DriftRoutesDeps = { guild, configService };
    const router = createDriftRoutes(deps);

    const getHandler = router.stack.find(
      (layer: any) => layer.route?.path === '/servers/:serverId/drift' && layer.route?.methods?.get
    )?.route?.stack.slice(-1)[0].handle;

    const req = {
      params: { serverId: 'server-123' },
      dashboardSession: { userId: 'test-user' },
    } as any;
    const res = createMockResponse();
    const next = vi.fn();

    await getHandler(req, res, next);

    const response = res.json.mock.calls[0][0];
    expect(response.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('should include tierId in each issue', async () => {
    const discordRoles: Role[] = [];
    const guild = createMockGuild(discordRoles);

    const config = createMockConfig('server-123', {
      'role-a': createRoleMapping('role-a', 'Role A', 'tier-premium'),
    });
    const configService = createMockConfigService(config);

    const deps: DriftRoutesDeps = { guild, configService };
    const router = createDriftRoutes(deps);

    const getHandler = router.stack.find(
      (layer: any) => layer.route?.path === '/servers/:serverId/drift' && layer.route?.methods?.get
    )?.route?.stack.slice(-1)[0].handle;

    const req = {
      params: { serverId: 'server-123' },
      dashboardSession: { userId: 'test-user' },
    } as any;
    const res = createMockResponse();
    const next = vi.fn();

    await getHandler(req, res, next);

    const response = res.json.mock.calls[0][0];
    expect(response.issues[0].tierId).toBe('tier-premium');
  });
});
