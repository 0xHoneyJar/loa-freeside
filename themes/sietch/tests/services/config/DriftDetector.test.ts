/**
 * DriftDetector Service Tests
 *
 * Sprint 123: DriftDetector Service
 *
 * Tests drift detection logic, caching, and metrics.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Guild, Role, Collection } from 'discord.js';
import {
  DriftDetector,
  createDriftDetector,
  clearAllDriftCache,
  getDriftCacheSize,
  type DriftReport,
  type DriftItem,
} from '../../../src/services/config/DriftDetector.js';
import {
  getDriftMetricsRaw,
  resetDriftMetrics,
  getGhostRolesCount,
  getTotalGhostRolesCount,
  getServersWithGhostRoles,
} from '../../../src/services/config/driftMetrics.js';
import type { CurrentConfiguration, RoleMapping } from '../../../src/db/types/config.types.js';

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockRole(id: string, name: string): Role {
  return {
    id,
    name,
    managed: false,
  } as Role;
}

function createMockGuild(roles: Role[]): Guild {
  const rolesMap = new Map<string, Role>();
  for (const role of roles) {
    rolesMap.set(role.id, role);
  }

  return {
    roles: {
      fetch: vi.fn().mockResolvedValue({
        values: () => roles,
        [Symbol.iterator]: () => roles[Symbol.iterator](),
      }),
    },
  } as unknown as Guild;
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

function createRoleMapping(
  roleId: string,
  roleName: string,
  tierId: string,
  status: 'active' | 'deleted' = 'active'
): RoleMapping {
  return {
    roleId,
    roleName,
    tierId,
    priority: 0,
    status,
  };
}

// =============================================================================
// DriftDetector Tests
// =============================================================================

describe('DriftDetector', () => {
  beforeEach(() => {
    resetDriftMetrics();
    clearAllDriftCache();
    vi.clearAllMocks();
  });

  describe('checkServerDrift', () => {
    it('should detect ROLE_DELETED when role is missing from Discord', async () => {
      // Discord has roles A and B, but config references A, B, and C
      const discordRoles = [
        createMockRole('role-a', 'Role A'),
        createMockRole('role-b', 'Role B'),
      ];
      const guild = createMockGuild(discordRoles);

      const config = createMockConfig('server-123', {
        'role-a': createRoleMapping('role-a', 'Role A', 'tier-1'),
        'role-b': createRoleMapping('role-b', 'Role B', 'tier-2'),
        'role-c': createRoleMapping('role-c', 'Role C', 'tier-3'), // Ghost role!
      });

      const detector = createDriftDetector({ guild });
      const report = await detector.checkServerDrift('server-123', config);

      expect(report.hasDrift).toBe(true);
      expect(report.totalDriftCount).toBe(1);
      expect(report.deletedRolesCount).toBe(1);
      expect(report.renamedRolesCount).toBe(0);
      expect(report.healthyRolesCount).toBe(2);

      const deletedItem = report.items.find((i) => i.type === 'ROLE_DELETED');
      expect(deletedItem).toBeDefined();
      expect(deletedItem?.roleId).toBe('role-c');
      expect(deletedItem?.configRoleName).toBe('Role C');
      expect(deletedItem?.currentRoleName).toBeNull();
      expect(deletedItem?.tierId).toBe('tier-3');
      expect(deletedItem?.severity).toBe('high');
    });

    it('should detect ROLE_RENAMED when role exists but name changed', async () => {
      const discordRoles = [
        createMockRole('role-a', 'New Role A Name'), // Name changed!
        createMockRole('role-b', 'Role B'),
      ];
      const guild = createMockGuild(discordRoles);

      const config = createMockConfig('server-123', {
        'role-a': createRoleMapping('role-a', 'Role A', 'tier-1'), // Old name
        'role-b': createRoleMapping('role-b', 'Role B', 'tier-2'),
      });

      const detector = createDriftDetector({ guild });
      const report = await detector.checkServerDrift('server-123', config);

      expect(report.hasDrift).toBe(true);
      expect(report.totalDriftCount).toBe(1);
      expect(report.deletedRolesCount).toBe(0);
      expect(report.renamedRolesCount).toBe(1);

      const renamedItem = report.items.find((i) => i.type === 'ROLE_RENAMED');
      expect(renamedItem).toBeDefined();
      expect(renamedItem?.roleId).toBe('role-a');
      expect(renamedItem?.configRoleName).toBe('Role A');
      expect(renamedItem?.currentRoleName).toBe('New Role A Name');
      expect(renamedItem?.severity).toBe('medium');
    });

    it('should detect both DELETED and RENAMED drift simultaneously', async () => {
      const discordRoles = [
        createMockRole('role-a', 'Updated Role A'), // Renamed
        // role-b missing (deleted)
      ];
      const guild = createMockGuild(discordRoles);

      const config = createMockConfig('server-123', {
        'role-a': createRoleMapping('role-a', 'Role A', 'tier-1'),
        'role-b': createRoleMapping('role-b', 'Role B', 'tier-2'),
      });

      const detector = createDriftDetector({ guild });
      const report = await detector.checkServerDrift('server-123', config);

      expect(report.hasDrift).toBe(true);
      expect(report.totalDriftCount).toBe(2);
      expect(report.deletedRolesCount).toBe(1);
      expect(report.renamedRolesCount).toBe(1);
      expect(report.healthyRolesCount).toBe(0);
    });

    it('should return no drift when all roles match', async () => {
      const discordRoles = [
        createMockRole('role-a', 'Role A'),
        createMockRole('role-b', 'Role B'),
        createMockRole('role-c', 'Role C'),
      ];
      const guild = createMockGuild(discordRoles);

      const config = createMockConfig('server-123', {
        'role-a': createRoleMapping('role-a', 'Role A', 'tier-1'),
        'role-b': createRoleMapping('role-b', 'Role B', 'tier-2'),
      });

      const detector = createDriftDetector({ guild });
      const report = await detector.checkServerDrift('server-123', config);

      expect(report.hasDrift).toBe(false);
      expect(report.totalDriftCount).toBe(0);
      expect(report.deletedRolesCount).toBe(0);
      expect(report.renamedRolesCount).toBe(0);
      expect(report.healthyRolesCount).toBe(2);
      expect(report.items).toHaveLength(0);
    });

    it('should skip role mappings with status=deleted', async () => {
      const discordRoles = [
        createMockRole('role-a', 'Role A'),
      ];
      const guild = createMockGuild(discordRoles);

      const config = createMockConfig('server-123', {
        'role-a': createRoleMapping('role-a', 'Role A', 'tier-1'),
        'role-b': createRoleMapping('role-b', 'Role B', 'tier-2', 'deleted'), // Already known deleted
      });

      const detector = createDriftDetector({ guild });
      const report = await detector.checkServerDrift('server-123', config);

      // Should not detect role-b as drift since it's already marked deleted
      expect(report.hasDrift).toBe(false);
      expect(report.totalDriftCount).toBe(0);
      expect(report.healthyRolesCount).toBe(1);
    });

    it('should handle empty role mappings', async () => {
      const discordRoles = [createMockRole('role-a', 'Role A')];
      const guild = createMockGuild(discordRoles);

      const config = createMockConfig('server-123', {});

      const detector = createDriftDetector({ guild });
      const report = await detector.checkServerDrift('server-123', config);

      expect(report.hasDrift).toBe(false);
      expect(report.totalDriftCount).toBe(0);
      expect(report.healthyRolesCount).toBe(0);
    });
  });

  describe('caching', () => {
    it('should cache drift report for TTL duration', async () => {
      const discordRoles = [createMockRole('role-a', 'Role A')];
      const guild = createMockGuild(discordRoles);
      const config = createMockConfig('server-123', {
        'role-a': createRoleMapping('role-a', 'Role A', 'tier-1'),
      });

      const detector = createDriftDetector({ guild, cacheTtlMs: 10000 });

      // First call
      const report1 = await detector.checkServerDrift('server-123', config);
      expect(guild.roles.fetch).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      const report2 = await detector.checkServerDrift('server-123', config);
      expect(guild.roles.fetch).toHaveBeenCalledTimes(1); // Still 1
      expect(report2.checkedAt).toEqual(report1.checkedAt);
    });

    it('should clear cache on clearCache()', async () => {
      const discordRoles = [createMockRole('role-a', 'Role A')];
      const guild = createMockGuild(discordRoles);
      const config = createMockConfig('server-123', {
        'role-a': createRoleMapping('role-a', 'Role A', 'tier-1'),
      });

      const detector = createDriftDetector({ guild });

      // First call
      await detector.checkServerDrift('server-123', config);
      expect(getDriftCacheSize()).toBe(1);

      // Clear cache
      detector.clearCache('server-123');
      expect(getDriftCacheSize()).toBe(0);

      // Next call should fetch fresh
      await detector.checkServerDrift('server-123', config);
      expect(guild.roles.fetch).toHaveBeenCalledTimes(2);
    });

    it('should clear all caches on clearAllDriftCache()', async () => {
      const discordRoles = [createMockRole('role-a', 'Role A')];
      const guild = createMockGuild(discordRoles);

      const config1 = createMockConfig('server-1', {
        'role-a': createRoleMapping('role-a', 'Role A', 'tier-1'),
      });
      const config2 = createMockConfig('server-2', {
        'role-a': createRoleMapping('role-a', 'Role A', 'tier-1'),
      });

      const detector = createDriftDetector({ guild });

      await detector.checkServerDrift('server-1', config1);
      await detector.checkServerDrift('server-2', config2);
      expect(getDriftCacheSize()).toBe(2);

      clearAllDriftCache();
      expect(getDriftCacheSize()).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should throw when Discord role fetch fails', async () => {
      const guild = {
        roles: {
          fetch: vi.fn().mockRejectedValue(new Error('Discord API error')),
        },
      } as unknown as Guild;

      const config = createMockConfig('server-123', {
        'role-a': createRoleMapping('role-a', 'Role A', 'tier-1'),
      });

      const detector = createDriftDetector({ guild });

      await expect(detector.checkServerDrift('server-123', config)).rejects.toThrow(
        'Unable to fetch Discord roles for drift detection'
      );
    });
  });
});

// =============================================================================
// Drift Metrics Tests
// =============================================================================

describe('Drift Metrics', () => {
  beforeEach(() => {
    resetDriftMetrics();
    clearAllDriftCache();
  });

  it('should record ghost roles per server', async () => {
    const discordRoles = [createMockRole('role-a', 'Role A')];
    const guild = createMockGuild(discordRoles);

    const config = createMockConfig('server-123', {
      'role-a': createRoleMapping('role-a', 'Role A', 'tier-1'),
      'role-b': createRoleMapping('role-b', 'Role B', 'tier-2'), // Ghost
      'role-c': createRoleMapping('role-c', 'Role C', 'tier-3'), // Ghost
    });

    const detector = createDriftDetector({ guild });
    await detector.checkServerDrift('server-123', config);

    expect(getGhostRolesCount('server-123')).toBe(2);
  });

  it('should track total ghost roles across servers', async () => {
    const discordRoles = [createMockRole('role-a', 'Role A')];
    const guild = createMockGuild(discordRoles);

    const config1 = createMockConfig('server-1', {
      'role-a': createRoleMapping('role-a', 'Role A', 'tier-1'),
      'role-b': createRoleMapping('role-b', 'Role B', 'tier-2'), // Ghost
    });
    const config2 = createMockConfig('server-2', {
      'role-c': createRoleMapping('role-c', 'Role C', 'tier-1'), // Ghost
      'role-d': createRoleMapping('role-d', 'Role D', 'tier-2'), // Ghost
    });

    const detector = createDriftDetector({ guild });

    // Clear cache between checks for different servers
    await detector.checkServerDrift('server-1', config1);
    clearAllDriftCache();
    await detector.checkServerDrift('server-2', config2);

    expect(getGhostRolesCount('server-1')).toBe(1);
    expect(getGhostRolesCount('server-2')).toBe(2);
    expect(getTotalGhostRolesCount()).toBe(3);
  });

  it('should list servers with ghost roles', async () => {
    const discordRoles = [createMockRole('role-a', 'Role A')];
    const guild = createMockGuild(discordRoles);

    const config1 = createMockConfig('server-1', {
      'role-a': createRoleMapping('role-a', 'Role A', 'tier-1'),
      'role-b': createRoleMapping('role-b', 'Role B', 'tier-2'), // Ghost
    });
    const config2 = createMockConfig('server-2', {
      'role-a': createRoleMapping('role-a', 'Role A', 'tier-1'), // No ghost
    });

    const detector = createDriftDetector({ guild });

    await detector.checkServerDrift('server-1', config1);
    clearAllDriftCache();
    await detector.checkServerDrift('server-2', config2);

    const servers = getServersWithGhostRoles();
    expect(servers).toContain('server-1');
    expect(servers).not.toContain('server-2');
  });

  it('should track drift check operations', async () => {
    const discordRoles = [createMockRole('role-a', 'Role A')];
    const guild = createMockGuild(discordRoles);
    const config = createMockConfig('server-123', {
      'role-a': createRoleMapping('role-a', 'Role A', 'tier-1'),
    });

    const detector = createDriftDetector({ guild });

    // First check increments counter
    await detector.checkServerDrift('server-123', config);
    expect(getDriftMetricsRaw().driftChecks).toBe(1);

    // Cached check does not increment (no actual check)
    await detector.checkServerDrift('server-123', config);
    expect(getDriftMetricsRaw().driftChecks).toBe(1);

    // After cache clear, check increments
    clearAllDriftCache();
    await detector.checkServerDrift('server-123', config);
    expect(getDriftMetricsRaw().driftChecks).toBe(2);
  });
});

// =============================================================================
// DriftReport Structure Tests
// =============================================================================

describe('DriftReport structure', () => {
  beforeEach(() => {
    resetDriftMetrics();
    clearAllDriftCache();
  });

  it('should include helpful suggestions for deleted roles', async () => {
    const discordRoles: Role[] = [];
    const guild = createMockGuild(discordRoles);

    const config = createMockConfig('server-123', {
      'role-a': createRoleMapping('role-a', 'Admins', 'tier-1'),
    });

    const detector = createDriftDetector({ guild });
    const report = await detector.checkServerDrift('server-123', config);

    const item = report.items[0];
    expect(item.suggestion).toContain('Remove role mapping');
    expect(item.suggestion).toContain('Admins');
    expect(item.suggestion).toContain('deleted from Discord');
  });

  it('should include helpful suggestions for renamed roles', async () => {
    const discordRoles = [createMockRole('role-a', 'Super Admins')];
    const guild = createMockGuild(discordRoles);

    const config = createMockConfig('server-123', {
      'role-a': createRoleMapping('role-a', 'Admins', 'tier-1'),
    });

    const detector = createDriftDetector({ guild });
    const report = await detector.checkServerDrift('server-123', config);

    const item = report.items[0];
    expect(item.suggestion).toContain('Update role name');
    expect(item.suggestion).toContain('Admins');
    expect(item.suggestion).toContain('Super Admins');
  });

  it('should have correct timestamp on report', async () => {
    const discordRoles = [createMockRole('role-a', 'Role A')];
    const guild = createMockGuild(discordRoles);
    const config = createMockConfig('server-123', {
      'role-a': createRoleMapping('role-a', 'Role A', 'tier-1'),
    });

    const before = new Date();
    const detector = createDriftDetector({ guild });
    const report = await detector.checkServerDrift('server-123', config);
    const after = new Date();

    expect(report.checkedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(report.checkedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});
