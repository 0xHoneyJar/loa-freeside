/**
 * Scope Validation Middleware Tests
 *
 * Sprint 121: Scope Validation
 *
 * Tests privilege escalation prevention and tier-based access control.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  createScopeValidator,
  extractTargetTiers,
  getUserHighestTierLevel,
  getAllowedTierIds,
  validateTierAccess,
  clearAllUserRolesCache,
  type ScopeValidatedRequest,
} from '../../../src/api/middleware/scopeValidation.js';
import {
  getScopeMetricsRaw,
  resetScopeMetrics,
} from '../../../src/api/middleware/scopeMetrics.js';
import type { CurrentConfiguration, RoleMapping } from '../../../src/db/types/config.types.js';
import type { IConfigService } from '../../../src/services/config/ConfigService.js';

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockRoleMappings(): Record<string, RoleMapping> {
  return {
    'role-tier1': {
      roleId: 'role-tier1',
      roleName: 'Tier 1 Admin',
      tierId: 'tier-1',
      priority: 100,
      status: 'active',
    },
    'role-tier2': {
      roleId: 'role-tier2',
      roleName: 'Tier 2 Moderator',
      tierId: 'tier-2',
      priority: 50,
      status: 'active',
    },
    'role-tier3': {
      roleId: 'role-tier3',
      roleName: 'Tier 3 Member',
      tierId: 'tier-3',
      priority: 10,
      status: 'active',
    },
    'role-deleted': {
      roleId: 'role-deleted',
      roleName: 'Deleted Role',
      tierId: 'tier-2',
      priority: 50,
      status: 'deleted',
    },
  };
}

function createMockConfig(overrides: Partial<CurrentConfiguration> = {}): CurrentConfiguration {
  return {
    serverId: 'server-123',
    thresholds: {},
    featureGates: {},
    roleMappings: createMockRoleMappings(),
    activeThemeId: null,
    lastRecordId: null,
    version: 1,
    schemaVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
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

function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    cookies: {},
    params: {},
    ...overrides,
  } as Request;
}

function createMockResponse(): Response & { json: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn> } {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as Response & { json: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn> };
}

function createMockNext(): NextFunction {
  return vi.fn();
}

// =============================================================================
// extractTargetTiers Tests
// =============================================================================

describe('extractTargetTiers', () => {
  it('should extract tierId from direct field', () => {
    const result = extractTargetTiers({ tierId: 'tier-1' });
    expect(result).toEqual(['tier-1']);
  });

  it('should extract tierIds from array', () => {
    const result = extractTargetTiers({ tierIds: ['tier-1', 'tier-2'] });
    expect(result).toEqual(['tier-1', 'tier-2']);
  });

  it('should extract tier IDs from changes array', () => {
    const result = extractTargetTiers({
      changes: [
        { tierId: 'tier-1', field: 'bgt', newValue: 100 },
        { tierId: 'tier-2', field: 'engagement', newValue: 50 },
      ],
    });
    expect(result).toContain('tier-1');
    expect(result).toContain('tier-2');
  });

  it('should extract tier IDs from thresholds object keys', () => {
    const result = extractTargetTiers({
      thresholds: {
        'tier-1': { bgt: 100 },
        'tier-2': { bgt: 50 },
      },
    });
    expect(result).toContain('tier-1');
    expect(result).toContain('tier-2');
  });

  it('should extract newTierId from role mapping changes', () => {
    const result = extractTargetTiers({
      changes: [
        { roleId: 'role-1', newTierId: 'tier-1' },
        { roleId: 'role-2', newTierId: 'tier-2', oldTierId: 'tier-3' },
      ],
    });
    expect(result).toContain('tier-1');
    expect(result).toContain('tier-2');
    expect(result).toContain('tier-3');
  });

  it('should return empty array for invalid body', () => {
    expect(extractTargetTiers(null)).toEqual([]);
    expect(extractTargetTiers(undefined)).toEqual([]);
    expect(extractTargetTiers('string')).toEqual([]);
    expect(extractTargetTiers(123)).toEqual([]);
  });

  it('should deduplicate tier IDs', () => {
    const result = extractTargetTiers({
      tierId: 'tier-1',
      changes: [{ tierId: 'tier-1' }, { tierId: 'tier-1' }],
    });
    expect(result).toEqual(['tier-1']);
  });
});

// =============================================================================
// getUserHighestTierLevel Tests
// =============================================================================

describe('getUserHighestTierLevel', () => {
  it('should return highest tier (lowest index) for user with multiple roles', () => {
    const roleMappings = createMockRoleMappings();
    const userRoles = ['role-tier1', 'role-tier2', 'role-tier3'];

    const result = getUserHighestTierLevel(userRoles, roleMappings);

    // tier-1 has highest priority (100) so should be index 0
    expect(result.tierId).toBe('tier-1');
    expect(result.tierIndex).toBe(0);
  });

  it('should return correct tier for user with single role', () => {
    const roleMappings = createMockRoleMappings();
    const userRoles = ['role-tier2'];

    const result = getUserHighestTierLevel(userRoles, roleMappings);

    expect(result.tierId).toBe('tier-2');
    expect(result.tierIndex).toBe(1);
  });

  it('should ignore deleted role mappings', () => {
    const roleMappings = createMockRoleMappings();
    const userRoles = ['role-deleted', 'role-tier3'];

    const result = getUserHighestTierLevel(userRoles, roleMappings);

    expect(result.tierId).toBe('tier-3');
    expect(result.tierIndex).toBe(2);
  });

  it('should return lowest privilege for user with no mapped roles', () => {
    const roleMappings = createMockRoleMappings();
    const userRoles = ['unmapped-role'];

    const result = getUserHighestTierLevel(userRoles, roleMappings);

    expect(result.tierId).toBeNull();
    expect(result.tierIndex).toBe(3); // One beyond the last tier
  });

  it('should use explicit tier hierarchy when provided', () => {
    const roleMappings = createMockRoleMappings();
    const userRoles = ['role-tier2'];
    const tierHierarchy = [
      { id: 'tier-1', index: 0 },
      { id: 'tier-2', index: 1 },
      { id: 'tier-3', index: 2 },
    ];

    const result = getUserHighestTierLevel(userRoles, roleMappings, tierHierarchy);

    expect(result.tierId).toBe('tier-2');
    expect(result.tierIndex).toBe(1);
  });
});

// =============================================================================
// getAllowedTierIds Tests
// =============================================================================

describe('getAllowedTierIds', () => {
  it('should return all tiers for highest privilege user', () => {
    const roleMappings = createMockRoleMappings();
    const result = getAllowedTierIds(0, roleMappings);

    expect(result).toContain('tier-1');
    expect(result).toContain('tier-2');
    expect(result).toContain('tier-3');
  });

  it('should return only lower tiers for mid-level user', () => {
    const roleMappings = createMockRoleMappings();
    const result = getAllowedTierIds(1, roleMappings);

    expect(result).not.toContain('tier-1');
    expect(result).toContain('tier-2');
    expect(result).toContain('tier-3');
  });

  it('should return only own tier for lowest privilege user', () => {
    const roleMappings = createMockRoleMappings();
    const result = getAllowedTierIds(2, roleMappings);

    expect(result).not.toContain('tier-1');
    expect(result).not.toContain('tier-2');
    expect(result).toContain('tier-3');
  });

  it('should return empty for user with no tiers', () => {
    const roleMappings = createMockRoleMappings();
    const result = getAllowedTierIds(3, roleMappings);

    expect(result).toHaveLength(0);
  });
});

// =============================================================================
// validateTierAccess Tests
// =============================================================================

describe('validateTierAccess', () => {
  it('should allow access when all tiers are allowed', () => {
    const result = validateTierAccess(['tier-2', 'tier-3'], ['tier-1', 'tier-2', 'tier-3']);

    expect(result.valid).toBe(true);
    expect(result.blockedTierIds).toHaveLength(0);
  });

  it('should block access when target tier is not allowed', () => {
    const result = validateTierAccess(['tier-1', 'tier-2'], ['tier-2', 'tier-3']);

    expect(result.valid).toBe(false);
    expect(result.blockedTierIds).toContain('tier-1');
    expect(result.blockedTierIds).not.toContain('tier-2');
  });

  it('should identify all blocked tiers', () => {
    const result = validateTierAccess(['tier-1', 'tier-2', 'tier-3'], ['tier-3']);

    expect(result.valid).toBe(false);
    expect(result.blockedTierIds).toContain('tier-1');
    expect(result.blockedTierIds).toContain('tier-2');
    expect(result.blockedTierIds).not.toContain('tier-3');
  });

  it('should allow empty target tiers', () => {
    const result = validateTierAccess([], ['tier-1', 'tier-2']);

    expect(result.valid).toBe(true);
    expect(result.blockedTierIds).toHaveLength(0);
  });
});

// =============================================================================
// Middleware Tests
// =============================================================================

describe('createScopeValidator', () => {
  beforeEach(() => {
    resetScopeMetrics();
    clearAllUserRolesCache();
    vi.clearAllMocks();
  });

  describe('scopeValidator', () => {
    it('should allow request when user has permission to modify target tiers', async () => {
      const config = createMockConfig();
      const configService = createMockConfigService(config);
      const discordApi = {
        getMemberRoles: vi.fn().mockResolvedValue(['role-tier1']),
      };

      const { scopeValidator } = createScopeValidator({
        configService,
        discordApi,
      });

      const req = createMockRequest({
        body: { changes: [{ tierId: 'tier-2', field: 'bgt', newValue: 100 }] },
      }) as ScopeValidatedRequest;
      req.dashboardSession = {
        userId: 'user-123',
        username: 'test',
        avatar: null,
        accessToken: 'token',
        refreshToken: 'refresh',
        tokenExpiresAt: Date.now() + 3600000,
        adminGuilds: [],
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };
      req.serverId = 'server-123';

      const res = createMockResponse();
      const next = createMockNext();

      await scopeValidator(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(req.userTierIndex).toBe(0);
      expect(req.userTierId).toBe('tier-1');
      expect(req.allowedTierIds).toContain('tier-1');
      expect(req.allowedTierIds).toContain('tier-2');
    });

    it('should block request when user attempts privilege escalation', async () => {
      const config = createMockConfig();
      const configService = createMockConfigService(config);
      const discordApi = {
        getMemberRoles: vi.fn().mockResolvedValue(['role-tier2']),
      };

      const { scopeValidator } = createScopeValidator({
        configService,
        discordApi,
      });

      const req = createMockRequest({
        body: { changes: [{ tierId: 'tier-1', field: 'bgt', newValue: 100 }] },
      }) as ScopeValidatedRequest;
      req.dashboardSession = {
        userId: 'user-123',
        username: 'test',
        avatar: null,
        accessToken: 'token',
        refreshToken: 'refresh',
        tokenExpiresAt: Date.now() + 3600000,
        adminGuilds: [],
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };
      req.serverId = 'server-123';

      const res = createMockResponse();
      const next = createMockNext();

      await scopeValidator(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'SCOPE_VIOLATION',
          details: expect.objectContaining({
            blockedTiers: ['tier-1'],
          }),
        })
      );
    });

    it('should record metric on scope violation', async () => {
      const config = createMockConfig();
      const configService = createMockConfigService(config);
      const discordApi = {
        getMemberRoles: vi.fn().mockResolvedValue(['role-tier3']),
      };

      const { scopeValidator } = createScopeValidator({
        configService,
        discordApi,
      });

      const req = createMockRequest({
        body: { changes: [{ tierId: 'tier-1', field: 'bgt', newValue: 100 }] },
      }) as ScopeValidatedRequest;
      req.dashboardSession = {
        userId: 'user-123',
        username: 'test',
        avatar: null,
        accessToken: 'token',
        refreshToken: 'refresh',
        tokenExpiresAt: Date.now() + 3600000,
        adminGuilds: [],
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };
      req.serverId = 'server-123';

      const res = createMockResponse();
      const next = createMockNext();

      await scopeValidator(req, res, next);

      const metrics = getScopeMetricsRaw();
      expect(metrics.scopeViolations).toBe(1);
      expect(metrics.validations.get('blocked')).toBe(1);
    });

    it('should return 401 when session is missing', async () => {
      const config = createMockConfig();
      const configService = createMockConfigService(config);

      const { scopeValidator } = createScopeValidator({
        configService,
      });

      const req = createMockRequest({}) as ScopeValidatedRequest;
      const res = createMockResponse();
      const next = createMockNext();

      await scopeValidator(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'UNAUTHORIZED',
        })
      );
    });

    it('should return 400 when server ID is missing', async () => {
      const config = createMockConfig();
      const configService = createMockConfigService(config);

      const { scopeValidator } = createScopeValidator({
        configService,
      });

      const req = createMockRequest({}) as ScopeValidatedRequest;
      req.dashboardSession = {
        userId: 'user-123',
        username: 'test',
        avatar: null,
        accessToken: 'token',
        refreshToken: 'refresh',
        tokenExpiresAt: Date.now() + 3600000,
        adminGuilds: [],
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };

      const res = createMockResponse();
      const next = createMockNext();

      await scopeValidator(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'MISSING_SERVER_ID',
        })
      );
    });

    it('should allow request with no tier IDs in body', async () => {
      const config = createMockConfig();
      const configService = createMockConfigService(config);

      const { scopeValidator } = createScopeValidator({
        configService,
      });

      const req = createMockRequest({
        body: { someOtherField: 'value' },
      }) as ScopeValidatedRequest;
      req.dashboardSession = {
        userId: 'user-123',
        username: 'test',
        avatar: null,
        accessToken: 'token',
        refreshToken: 'refresh',
        tokenExpiresAt: Date.now() + 3600000,
        adminGuilds: [],
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };
      req.serverId = 'server-123';

      const res = createMockResponse();
      const next = createMockNext();

      await scopeValidator(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should handle edge case: user exactly at tier boundary', async () => {
      const config = createMockConfig();
      const configService = createMockConfigService(config);
      const discordApi = {
        getMemberRoles: vi.fn().mockResolvedValue(['role-tier2']),
      };

      const { scopeValidator } = createScopeValidator({
        configService,
        discordApi,
      });

      // User can modify their own tier
      const req = createMockRequest({
        body: { changes: [{ tierId: 'tier-2', field: 'bgt', newValue: 100 }] },
      }) as ScopeValidatedRequest;
      req.dashboardSession = {
        userId: 'user-123',
        username: 'test',
        avatar: null,
        accessToken: 'token',
        refreshToken: 'refresh',
        tokenExpiresAt: Date.now() + 3600000,
        adminGuilds: [],
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };
      req.serverId = 'server-123';

      const res = createMockResponse();
      const next = createMockNext();

      await scopeValidator(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.userTierId).toBe('tier-2');
    });
  });

  describe('scopeContext', () => {
    it('should attach scope context without blocking', async () => {
      const config = createMockConfig();
      const configService = createMockConfigService(config);
      const discordApi = {
        getMemberRoles: vi.fn().mockResolvedValue(['role-tier2']),
      };

      const { scopeContext } = createScopeValidator({
        configService,
        discordApi,
      });

      const req = createMockRequest({}) as ScopeValidatedRequest;
      req.dashboardSession = {
        userId: 'user-123',
        username: 'test',
        avatar: null,
        accessToken: 'token',
        refreshToken: 'refresh',
        tokenExpiresAt: Date.now() + 3600000,
        adminGuilds: [],
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };
      req.serverId = 'server-123';

      const res = createMockResponse();
      const next = createMockNext();

      await scopeContext(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.userTierIndex).toBe(1);
      expect(req.userTierId).toBe('tier-2');
      expect(req.allowedTierIds).toContain('tier-2');
      expect(req.allowedTierIds).toContain('tier-3');
    });

    it('should continue without context on error', async () => {
      const configService = createMockConfigService(createMockConfig());
      (configService.getCurrentConfiguration as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB error'));

      const { scopeContext } = createScopeValidator({
        configService,
      });

      const req = createMockRequest({}) as ScopeValidatedRequest;
      req.dashboardSession = {
        userId: 'user-123',
        username: 'test',
        avatar: null,
        accessToken: 'token',
        refreshToken: 'refresh',
        tokenExpiresAt: Date.now() + 3600000,
        adminGuilds: [],
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };
      req.serverId = 'server-123';

      const res = createMockResponse();
      const next = createMockNext();

      await scopeContext(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });
});
