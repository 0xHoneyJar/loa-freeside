/**
 * NamespacedRoleManager Tests
 *
 * Sprint S-26: Namespaced Roles & Parallel Channels
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NamespacedRoleManager } from './namespaced-role-manager.js';
import type {
  IDiscordRoleService,
  ISynthesisQueue,
  IParallelModeConfigStore,
  IParallelModeMetrics,
} from './namespaced-role-manager.js';
import type { DiscordRole, NamespacedRoleConfig, MemberEligibility } from '@freeside/core/domain';
import { DEFAULT_NAMESPACED_ROLE_CONFIG } from '@freeside/core/domain';
import type { Logger } from 'pino';

// =============================================================================
// Test Mocks
// =============================================================================

function createMockLogger(): Logger {
  return {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  } as unknown as Logger;
}

function createMockDiscordService(): IDiscordRoleService {
  return {
    getGuildRoles: vi.fn(),
    getMemberRoles: vi.fn(),
    addMemberRole: vi.fn(),
    removeMemberRole: vi.fn(),
  };
}

function createMockSynthesisQueue(): ISynthesisQueue {
  return {
    add: vi.fn(),
  };
}

function createMockConfigStore(): IParallelModeConfigStore {
  const configs = new Map<string, NamespacedRoleConfig>();
  return {
    getRoleConfig: vi.fn(async (communityId: string) => configs.get(communityId) ?? null),
    saveRoleConfig: vi.fn(async (communityId: string, config: NamespacedRoleConfig) => {
      configs.set(communityId, config);
    }),
  };
}

function createMockMetrics(): IParallelModeMetrics {
  return {
    roleAssignments: { inc: vi.fn() },
    roleSyncDuration: { observe: vi.fn() },
    roleSyncErrors: { inc: vi.fn() },
  };
}

function createMockRole(id: string, name: string, position: number, managed = false): DiscordRole {
  return {
    id,
    name,
    color: 0,
    position,
    permissions: BigInt(0),
    hoist: false,
    managed,
    mentionable: false,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('NamespacedRoleManager', () => {
  let manager: NamespacedRoleManager;
  let discord: IDiscordRoleService;
  let synthesis: ISynthesisQueue;
  let configStore: IParallelModeConfigStore;
  let metrics: IParallelModeMetrics;
  let logger: Logger;

  beforeEach(() => {
    discord = createMockDiscordService();
    synthesis = createMockSynthesisQueue();
    configStore = createMockConfigStore();
    metrics = createMockMetrics();
    logger = createMockLogger();

    manager = new NamespacedRoleManager(
      discord,
      synthesis,
      configStore,
      metrics,
      logger
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createNamespacedRole', () => {
    it('should create role with default prefix', async () => {
      vi.mocked(discord.getGuildRoles).mockResolvedValue([
        createMockRole('1', 'holder', 10),
        createMockRole('2', 'admin', 20),
      ]);

      const roleName = await manager.createNamespacedRole(
        'guild-123',
        'community-456',
        {
          id: 'tier-1',
          name: 'Fremen',
          roleColor: 0x3498db,
          permissions: BigInt(0),
        }
      );

      expect(roleName).toBe('arrakis-Fremen');
      expect(synthesis.add).toHaveBeenCalledWith(
        expect.stringContaining('create-role'),
        expect.objectContaining({
          type: 'create_role',
          guildId: 'guild-123',
          communityId: 'community-456',
          payload: expect.objectContaining({
            name: 'arrakis-Fremen',
          }),
        })
      );
    });

    it('should use custom prefix from config', async () => {
      vi.mocked(discord.getGuildRoles).mockResolvedValue([]);

      const roleName = await manager.createNamespacedRole(
        'guild-123',
        'community-456',
        {
          id: 'tier-1',
          name: 'Fremen',
          roleColor: 0x3498db,
          permissions: BigInt(0),
        },
        { prefix: 'custom-' }
      );

      expect(roleName).toBe('custom-Fremen');
    });

    it('should set permissions to 0 when mode is none', async () => {
      vi.mocked(discord.getGuildRoles).mockResolvedValue([]);

      await manager.createNamespacedRole(
        'guild-123',
        'community-456',
        {
          id: 'tier-1',
          name: 'Fremen',
          roleColor: 0x3498db,
          permissions: BigInt(1024), // VIEW_CHANNEL
        },
        { permissionsMode: 'none' }
      );

      expect(synthesis.add).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          payload: expect.objectContaining({
            permissions: '0',
          }),
        })
      );
    });

    it('should set VIEW_CHANNEL when mode is view_only', async () => {
      vi.mocked(discord.getGuildRoles).mockResolvedValue([]);

      await manager.createNamespacedRole(
        'guild-123',
        'community-456',
        {
          id: 'tier-1',
          name: 'Fremen',
          roleColor: 0x3498db,
          permissions: BigInt(0),
        },
        { permissionsMode: 'view_only' }
      );

      expect(synthesis.add).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          payload: expect.objectContaining({
            permissions: '1024', // VIEW_CHANNEL
          }),
        })
      );
    });
  });

  describe('findIncumbentRolePosition', () => {
    it('should find highest incumbent role position', async () => {
      vi.mocked(discord.getGuildRoles).mockResolvedValue([
        createMockRole('1', '@everyone', 0),
        createMockRole('2', 'holder', 5),
        createMockRole('3', 'verified', 10),
        createMockRole('4', 'admin', 15),
      ]);

      const position = await manager.findIncumbentRolePosition('guild-123');

      // Should find 'verified' at position 10 as highest incumbent match
      expect(position).toBe(10);
    });

    it('should skip managed roles', async () => {
      vi.mocked(discord.getGuildRoles).mockResolvedValue([
        createMockRole('1', 'holder', 10, true), // managed
        createMockRole('2', 'member', 5),
      ]);

      const position = await manager.findIncumbentRolePosition('guild-123');

      // Should skip managed 'holder' and find 'member'
      expect(position).toBe(5);
    });

    it('should return middle of hierarchy when no incumbent found', async () => {
      vi.mocked(discord.getGuildRoles).mockResolvedValue([
        createMockRole('1', '@everyone', 0),
        createMockRole('2', 'random', 5),
        createMockRole('3', 'other', 10),
        createMockRole('4', 'admin', 15),
      ]);

      const position = await manager.findIncumbentRolePosition('guild-123');

      // Should return middle: floor(4/2) = 2
      expect(position).toBe(2);
    });
  });

  describe('calculateRolePosition', () => {
    it('should position below incumbent when strategy is below_incumbent', async () => {
      vi.mocked(discord.getGuildRoles).mockResolvedValue([
        createMockRole('1', 'holder', 10),
      ]);

      const position = await manager.calculateRolePosition('guild-123', {
        ...DEFAULT_NAMESPACED_ROLE_CONFIG,
        positionStrategy: 'below_incumbent',
      });

      // Should be 10 - 1 = 9
      expect(position).toBe(9);
    });

    it('should position at bottom when strategy is bottom', async () => {
      const position = await manager.calculateRolePosition('guild-123', {
        ...DEFAULT_NAMESPACED_ROLE_CONFIG,
        positionStrategy: 'bottom',
      });

      expect(position).toBe(1);
    });

    it('should use custom position when strategy is custom', async () => {
      const position = await manager.calculateRolePosition('guild-123', {
        ...DEFAULT_NAMESPACED_ROLE_CONFIG,
        positionStrategy: 'custom',
        customPosition: 7,
      });

      expect(position).toBe(7);
    });

    it('should ensure minimum position of 1', async () => {
      vi.mocked(discord.getGuildRoles).mockResolvedValue([
        createMockRole('1', 'holder', 1),
      ]);

      const position = await manager.calculateRolePosition('guild-123', {
        ...DEFAULT_NAMESPACED_ROLE_CONFIG,
        positionStrategy: 'below_incumbent',
      });

      // 1 - 1 = 0, but should clamp to 1
      expect(position).toBe(1);
    });
  });

  describe('isArrakisRole', () => {
    it('should identify Arrakis roles by prefix', () => {
      expect(manager.isArrakisRole('arrakis-Fremen')).toBe(true);
      expect(manager.isArrakisRole('arrakis-Outsider')).toBe(true);
      expect(manager.isArrakisRole('holder')).toBe(false);
      expect(manager.isArrakisRole('verified')).toBe(false);
    });
  });

  describe('getArrakisRoles', () => {
    it('should return only Arrakis roles', async () => {
      vi.mocked(discord.getGuildRoles).mockResolvedValue([
        createMockRole('1', 'holder', 10),
        createMockRole('2', 'arrakis-Fremen', 5),
        createMockRole('3', 'arrakis-Outsider', 3),
        createMockRole('4', 'admin', 15),
      ]);

      const roles = await manager.getArrakisRoles('guild-123');

      expect(roles).toHaveLength(2);
      expect(roles.map(r => r.name)).toEqual(['arrakis-Fremen', 'arrakis-Outsider']);
    });
  });

  describe('syncRoles', () => {
    it('should assign role to eligible member without role', async () => {
      vi.mocked(discord.getGuildRoles).mockResolvedValue([
        createMockRole('role-fremen', 'arrakis-Fremen', 5),
      ]);

      const members: MemberEligibility[] = [
        { userId: 'user-1', eligible: true, tier: 'Fremen', roles: [] },
      ];

      const result = await manager.syncRoles('guild-123', 'community-456', members);

      expect(result.assigned).toBe(1);
      expect(synthesis.add).toHaveBeenCalledWith(
        expect.stringContaining('assign'),
        expect.objectContaining({
          type: 'assign_role',
          payload: expect.objectContaining({
            userId: 'user-1',
            roleId: 'role-fremen',
          }),
        })
      );
    });

    it('should remove role from ineligible member with role', async () => {
      vi.mocked(discord.getGuildRoles).mockResolvedValue([
        createMockRole('role-fremen', 'arrakis-Fremen', 5),
      ]);

      const members: MemberEligibility[] = [
        { userId: 'user-1', eligible: false, tier: null, roles: ['role-fremen'] },
      ];

      const result = await manager.syncRoles('guild-123', 'community-456', members);

      expect(result.removed).toBe(1);
      expect(synthesis.add).toHaveBeenCalledWith(
        expect.stringContaining('remove'),
        expect.objectContaining({
          type: 'remove_role',
        })
      );
    });

    it('should not change member who already has correct role', async () => {
      vi.mocked(discord.getGuildRoles).mockResolvedValue([
        createMockRole('role-fremen', 'arrakis-Fremen', 5),
      ]);

      const members: MemberEligibility[] = [
        { userId: 'user-1', eligible: true, tier: 'Fremen', roles: ['role-fremen'] },
      ];

      const result = await manager.syncRoles('guild-123', 'community-456', members);

      expect(result.unchanged).toBe(1);
      expect(result.assigned).toBe(0);
      expect(result.removed).toBe(0);
    });

    it('should handle tier changes (remove old, assign new)', async () => {
      vi.mocked(discord.getGuildRoles).mockResolvedValue([
        createMockRole('role-outsider', 'arrakis-Outsider', 3),
        createMockRole('role-fremen', 'arrakis-Fremen', 5),
      ]);

      const members: MemberEligibility[] = [
        { userId: 'user-1', eligible: true, tier: 'Fremen', roles: ['role-outsider'] },
      ];

      const result = await manager.syncRoles('guild-123', 'community-456', members);

      expect(result.assigned).toBe(1);
      expect(result.removed).toBe(1);
    });

    it('should track sync errors', async () => {
      vi.mocked(discord.getGuildRoles).mockResolvedValue([
        createMockRole('role-fremen', 'arrakis-Fremen', 5),
      ]);
      vi.mocked(synthesis.add).mockRejectedValueOnce(new Error('Rate limited'));

      const members: MemberEligibility[] = [
        { userId: 'user-1', eligible: true, tier: 'Fremen', roles: [] },
      ];

      const result = await manager.syncRoles('guild-123', 'community-456', members);

      expect(result.errors).toBeDefined();
      expect(result.errors?.length).toBe(1);
      expect(result.errors?.[0].userId).toBe('user-1');
      expect(result.errors?.[0].retryable).toBe(true);
    });

    it('should record metrics on sync', async () => {
      vi.mocked(discord.getGuildRoles).mockResolvedValue([
        createMockRole('role-fremen', 'arrakis-Fremen', 5),
      ]);

      const members: MemberEligibility[] = [
        { userId: 'user-1', eligible: true, tier: 'Fremen', roles: [] },
      ];

      await manager.syncRoles('guild-123', 'community-456', members);

      expect(metrics.roleSyncDuration.observe).toHaveBeenCalledWith(
        { community_id: 'community-456' },
        expect.any(Number)
      );
    });
  });

  describe('createAllRoles', () => {
    it('should create all tier roles', async () => {
      vi.mocked(discord.getGuildRoles).mockResolvedValue([]);

      const tiers = [
        { id: 'tier-1', name: 'Naib', roleColor: 0xff0000, permissions: BigInt(0) },
        { id: 'tier-2', name: 'Fremen', roleColor: 0x00ff00, permissions: BigInt(0) },
        { id: 'tier-3', name: 'Outsider', roleColor: 0x0000ff, permissions: BigInt(0) },
      ];

      const roleNames = await manager.createAllRoles('guild-123', 'community-456', tiers);

      expect(roleNames).toHaveLength(3);
      expect(roleNames).toEqual(['arrakis-Naib', 'arrakis-Fremen', 'arrakis-Outsider']);
      expect(synthesis.add).toHaveBeenCalledTimes(3);
    });
  });

  describe('configuration', () => {
    it('should save and retrieve config', async () => {
      await manager.updateConfig('community-456', {
        prefix: 'custom-',
        positionStrategy: 'bottom',
      });

      const config = await manager.getConfig('community-456');

      expect(config).toBeDefined();
      expect(config?.prefix).toBe('custom-');
      expect(config?.positionStrategy).toBe('bottom');
    });

    it('should merge with defaults', async () => {
      await manager.updateConfig('community-456', {
        prefix: 'custom-',
      });

      const config = await manager.getConfig('community-456');

      expect(config?.prefix).toBe('custom-');
      expect(config?.permissionsMode).toBe('none'); // default
    });
  });
});
