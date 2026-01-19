/**
 * DriftCheckJob Tests
 *
 * Sprint 124: Drift API & Scheduled Check
 *
 * Tests for scheduled drift check job.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Guild, Role, Client, User, DMChannel } from 'discord.js';
import {
  DriftCheckJob,
  createDriftCheckJob,
  type DriftCheckJobConfig,
} from '../../src/jobs/driftCheck.job.js';
import type { IConfigService } from '../../src/services/config/ConfigService.js';
import type { CurrentConfiguration, RoleMapping } from '../../src/db/types/config.types.js';
import { clearAllDriftCache } from '../../src/services/config/DriftDetector.js';
import { resetDriftMetrics } from '../../src/services/config/driftMetrics.js';
import {
  resetDriftJobMetrics,
  getDriftJobMetricsRaw,
} from '../../src/jobs/driftCheckMetrics.js';

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

// =============================================================================
// Tests
// =============================================================================

describe('DriftCheckJob', () => {
  beforeEach(() => {
    resetDriftMetrics();
    clearAllDriftCache();
    resetDriftJobMetrics();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('run()', () => {
    it('should check all active servers for drift', async () => {
      vi.useRealTimers(); // Need real timers for async

      const discordRoles = [createMockRole('role-a', 'Role A')];
      const guild = createMockGuild(discordRoles);

      const configs: Record<string, CurrentConfiguration> = {
        'server-1': createMockConfig('server-1', {
          'role-a': createRoleMapping('role-a', 'Role A', 'tier-1'),
        }),
        'server-2': createMockConfig('server-2', {
          'role-a': createRoleMapping('role-a', 'Role A', 'tier-1'),
          'role-b': createRoleMapping('role-b', 'Role B', 'tier-2'), // Ghost
        }),
        'server-3': createMockConfig('server-3', {}), // No mappings
      };

      const configService: IConfigService = {
        getCurrentConfiguration: vi.fn((serverId: string) =>
          Promise.resolve(configs[serverId])
        ),
        getConfigHistory: vi.fn(),
        updateThresholds: vi.fn(),
        updateFeatureGates: vi.fn(),
        updateRoleMappings: vi.fn(),
        initializeConfiguration: vi.fn(),
      };

      const job = createDriftCheckJob({
        guild,
        configService,
        getActiveServerIds: () => Promise.resolve(['server-1', 'server-2', 'server-3']),
      });

      const result = await job.run();

      expect(result.serversChecked).toBe(3);
      expect(result.serversWithDrift).toBe(1); // Only server-2 has drift
      expect(result.totalGhostRoles).toBe(1);
      expect(result.reports).toHaveLength(2); // server-3 skipped (no mappings)
      expect(result.errors).toHaveLength(0);
    });

    it('should record job metrics', async () => {
      vi.useRealTimers();

      const discordRoles = [createMockRole('role-a', 'Role A')];
      const guild = createMockGuild(discordRoles);

      const configService: IConfigService = {
        getCurrentConfiguration: vi.fn().mockResolvedValue(
          createMockConfig('server-1', {
            'role-a': createRoleMapping('role-a', 'Role A', 'tier-1'),
          })
        ),
        getConfigHistory: vi.fn(),
        updateThresholds: vi.fn(),
        updateFeatureGates: vi.fn(),
        updateRoleMappings: vi.fn(),
        initializeConfiguration: vi.fn(),
      };

      const job = createDriftCheckJob({
        guild,
        configService,
        getActiveServerIds: () => Promise.resolve(['server-1']),
      });

      await job.run();

      const metrics = getDriftJobMetricsRaw();
      expect(metrics.jobRuns).toBe(1);
      expect(metrics.lastRunAt).not.toBeNull();
    });

    it('should handle config service errors gracefully', async () => {
      vi.useRealTimers();

      const discordRoles = [createMockRole('role-a', 'Role A')];
      const guild = createMockGuild(discordRoles);

      const configService: IConfigService = {
        getCurrentConfiguration: vi.fn().mockRejectedValue(new Error('DB error')),
        getConfigHistory: vi.fn(),
        updateThresholds: vi.fn(),
        updateFeatureGates: vi.fn(),
        updateRoleMappings: vi.fn(),
        initializeConfiguration: vi.fn(),
      };

      const job = createDriftCheckJob({
        guild,
        configService,
        getActiveServerIds: () => Promise.resolve(['server-1', 'server-2']),
      });

      const result = await job.run();

      expect(result.serversChecked).toBe(2);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].serverId).toBe('server-1');
      expect(result.errors[0].error).toContain('DB error');

      const metrics = getDriftJobMetricsRaw();
      expect(metrics.jobErrors).toBe(2);
    });

    it('should prevent concurrent runs', async () => {
      vi.useRealTimers();

      const discordRoles = [createMockRole('role-a', 'Role A')];
      const guild = createMockGuild(discordRoles);

      let resolveFirst: () => void;
      const firstRunPromise = new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });

      const configService: IConfigService = {
        getCurrentConfiguration: vi.fn().mockImplementation(async () => {
          await firstRunPromise;
          return createMockConfig('server-1', {});
        }),
        getConfigHistory: vi.fn(),
        updateThresholds: vi.fn(),
        updateFeatureGates: vi.fn(),
        updateRoleMappings: vi.fn(),
        initializeConfiguration: vi.fn(),
      };

      const job = createDriftCheckJob({
        guild,
        configService,
        getActiveServerIds: () => Promise.resolve(['server-1']),
      });

      // Start first run
      const runPromise = job.run();

      // Try second run while first is running
      await expect(job.run()).rejects.toThrow('already running');

      // Allow first run to complete
      resolveFirst!();
      await runPromise;
    });

    it('should return last result via getLastResult()', async () => {
      vi.useRealTimers();

      const discordRoles = [createMockRole('role-a', 'Role A')];
      const guild = createMockGuild(discordRoles);

      const configService: IConfigService = {
        getCurrentConfiguration: vi.fn().mockResolvedValue(
          createMockConfig('server-1', {
            'role-a': createRoleMapping('role-a', 'Role A', 'tier-1'),
          })
        ),
        getConfigHistory: vi.fn(),
        updateThresholds: vi.fn(),
        updateFeatureGates: vi.fn(),
        updateRoleMappings: vi.fn(),
        initializeConfiguration: vi.fn(),
      };

      const job = createDriftCheckJob({
        guild,
        configService,
        getActiveServerIds: () => Promise.resolve(['server-1']),
      });

      expect(job.getLastResult()).toBeNull();

      await job.run();

      const lastResult = job.getLastResult();
      expect(lastResult).not.toBeNull();
      expect(lastResult?.serversChecked).toBe(1);
    });
  });

  describe('scheduling', () => {
    it('should schedule at midnight UTC', async () => {
      const discordRoles = [createMockRole('role-a', 'Role A')];
      const guild = createMockGuild(discordRoles);

      let runCount = 0;
      const configService: IConfigService = {
        getCurrentConfiguration: vi.fn().mockImplementation(() => {
          runCount++;
          return Promise.resolve(createMockConfig('server-1', {}));
        }),
        getConfigHistory: vi.fn(),
        updateThresholds: vi.fn(),
        updateFeatureGates: vi.fn(),
        updateRoleMappings: vi.fn(),
        initializeConfiguration: vi.fn(),
      };

      const job = createDriftCheckJob({
        guild,
        configService,
        getActiveServerIds: () => Promise.resolve(['server-1']),
      });

      // Set time to 23:00 UTC
      vi.setSystemTime(new Date('2026-01-20T23:00:00Z'));

      job.start();

      // Should not run immediately
      expect(runCount).toBe(0);

      // Advance to midnight (1 hour later) - use async to handle promises
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

      // Job should have been triggered (config fetched)
      expect(runCount).toBeGreaterThan(0);

      job.stop();
    });

    it('should stop scheduled jobs on stop()', () => {
      const discordRoles = [createMockRole('role-a', 'Role A')];
      const guild = createMockGuild(discordRoles);

      const configService: IConfigService = {
        getCurrentConfiguration: vi.fn().mockResolvedValue(createMockConfig('server-1', {})),
        getConfigHistory: vi.fn(),
        updateThresholds: vi.fn(),
        updateFeatureGates: vi.fn(),
        updateRoleMappings: vi.fn(),
        initializeConfiguration: vi.fn(),
      };

      const job = createDriftCheckJob({
        guild,
        configService,
        getActiveServerIds: () => Promise.resolve([]),
      });

      job.start();
      job.stop();

      // Advance time significantly - should not trigger job
      vi.advanceTimersByTime(48 * 60 * 60 * 1000); // 48 hours

      expect(configService.getCurrentConfiguration).not.toHaveBeenCalled();
    });
  });

  describe('notifications', () => {
    it('should send Discord DM when drift detected and notifications enabled', async () => {
      vi.useRealTimers();

      const discordRoles: Role[] = [];
      const guild = createMockGuild(discordRoles);

      const mockSend = vi.fn().mockResolvedValue(undefined);
      const mockUser = { send: mockSend } as unknown as User;

      const mockClient = {
        users: {
          fetch: vi.fn().mockResolvedValue(mockUser),
        },
      } as unknown as Client;

      const configService: IConfigService = {
        getCurrentConfiguration: vi.fn().mockResolvedValue(
          createMockConfig('server-1', {
            'role-a': createRoleMapping('role-a', 'Ghost Role', 'tier-1'),
          })
        ),
        getConfigHistory: vi.fn(),
        updateThresholds: vi.fn(),
        updateFeatureGates: vi.fn(),
        updateRoleMappings: vi.fn(),
        initializeConfiguration: vi.fn(),
      };

      const job = createDriftCheckJob({
        guild,
        client: mockClient,
        configService,
        getActiveServerIds: () => Promise.resolve(['server-1']),
        sendNotifications: true,
        adminUserId: 'admin-123',
      });

      await job.run();

      expect(mockClient.users.fetch).toHaveBeenCalledWith('admin-123');
      expect(mockSend).toHaveBeenCalled();

      const sentMessage = mockSend.mock.calls[0][0];
      expect(sentMessage).toContain('Ghost Roles Detected');
      expect(sentMessage).toContain('server-1');
      expect(sentMessage).toContain('Ghost Role');
    });

    it('should not send notification when notifications disabled', async () => {
      vi.useRealTimers();

      const discordRoles: Role[] = [];
      const guild = createMockGuild(discordRoles);

      const mockClient = {
        users: {
          fetch: vi.fn(),
        },
      } as unknown as Client;

      const configService: IConfigService = {
        getCurrentConfiguration: vi.fn().mockResolvedValue(
          createMockConfig('server-1', {
            'role-a': createRoleMapping('role-a', 'Ghost Role', 'tier-1'),
          })
        ),
        getConfigHistory: vi.fn(),
        updateThresholds: vi.fn(),
        updateFeatureGates: vi.fn(),
        updateRoleMappings: vi.fn(),
        initializeConfiguration: vi.fn(),
      };

      const job = createDriftCheckJob({
        guild,
        client: mockClient,
        configService,
        getActiveServerIds: () => Promise.resolve(['server-1']),
        sendNotifications: false, // Disabled
      });

      await job.run();

      expect(mockClient.users.fetch).not.toHaveBeenCalled();
    });
  });
});
