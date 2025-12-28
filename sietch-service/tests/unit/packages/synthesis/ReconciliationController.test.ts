/**
 * Reconciliation Controller Tests (v5.0 - Sprint 45)
 *
 * Tests for drift detection and reconciliation between desired state,
 * shadow state, and actual Discord state.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Client, Guild, Role, GuildChannel } from 'discord.js';
import { ReconciliationController } from '../../../../src/packages/synthesis/ReconciliationController.js';
import { SynthesisQueue } from '../../../../src/packages/synthesis/SynthesisQueue.js';

// Mock Discord structures
const createMockRole = (id: string, name: string, color = 0) => ({
  id,
  name,
  color,
  permissions: { bitfield: 0n },
  hoist: false,
  mentionable: false,
  position: 1,
});

const createMockChannel = (id: string, name: string, type = 0, topic: string | null = null) => ({
  id,
  name,
  type,
  topic,
  parent: null,
  isTextBased: () => true, // Mock the isTextBased method
});

describe('ReconciliationController', () => {
  let controller: ReconciliationController;
  let mockDiscordClient: Client;
  let mockSynthesisQueue: SynthesisQueue;
  let mockStorageAdapter: any;
  let mockGuild: Guild;

  beforeEach(() => {
    // Mock Discord client
    mockGuild = {
      id: 'test-guild-id',
      roles: {
        fetch: vi.fn().mockResolvedValue(new Map()),
      },
      channels: {
        fetch: vi.fn().mockResolvedValue(new Map()),
      },
    } as unknown as Guild;

    mockDiscordClient = {
      guilds: {
        fetch: vi.fn().mockResolvedValue(mockGuild),
      },
    } as unknown as Client;

    // Mock synthesis queue
    mockSynthesisQueue = {
      enqueue: vi.fn().mockResolvedValue('job-id-123'),
    } as unknown as SynthesisQueue;

    // Mock storage adapter
    mockStorageAdapter = {
      getManifest: vi.fn(),
      getShadowState: vi.fn(),
      updateShadowState: vi.fn(),
    };

    controller = new ReconciliationController(
      mockDiscordClient,
      mockSynthesisQueue,
      mockStorageAdapter
    );
  });

  // ==========================================================================
  // Basic Reconciliation Tests
  // ==========================================================================

  describe('reconcileCommunity()', () => {
    it('should return error if manifest not found', async () => {
      mockStorageAdapter.getManifest.mockResolvedValue(null);

      const result = await controller.reconcileCommunity('community-123');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MANIFEST_NOT_FOUND');
      expect(result.operationsEnqueued).toBe(0);
    });

    it('should return error if guild not found', async () => {
      mockStorageAdapter.getManifest.mockResolvedValue({
        communityId: 'community-123',
        guildId: 'invalid-guild',
        version: 1,
        roles: [],
        channels: [],
        categories: [],
      });

      mockDiscordClient.guilds.fetch = vi.fn().mockResolvedValue(null);

      const result = await controller.reconcileCommunity('community-123');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GUILD_NOT_FOUND');
    });

    it('should detect no drift when states match', async () => {
      const manifest = {
        communityId: 'community-123',
        guildId: 'test-guild-id',
        version: 1,
        roles: [
          {
            name: 'Test Role',
            type: 'role' as const,
            config: { color: 0xff0000 },
          },
        ],
        channels: [
          {
            name: 'test-channel',
            type: 'channel' as const,
            config: { topic: 'Test Topic' },
          },
        ],
        categories: [],
      };

      mockStorageAdapter.getManifest.mockResolvedValue(manifest);
      mockStorageAdapter.getShadowState.mockResolvedValue({
        communityId: 'community-123',
        guildId: 'test-guild-id',
        appliedAt: new Date(),
        resources: {
          roles: { 'Test Role': 'role-id-1' },
          channels: { 'test-channel': 'channel-id-1' },
          categories: {},
        },
      });

      // Mock actual Discord state (matches manifest)
      mockGuild.roles.fetch = vi.fn().mockResolvedValue(
        new Map([['role-id-1', createMockRole('role-id-1', 'Test Role', 0xff0000)]])
      );
      mockGuild.channels.fetch = vi.fn().mockResolvedValue(
        new Map([['channel-id-1', createMockChannel('channel-id-1', 'test-channel', 0, 'Test Topic')]])
      );

      const result = await controller.reconcileCommunity('community-123');

      expect(result.success).toBe(true);
      expect(result.driftDetected).toBe(false);
      expect(result.operationsEnqueued).toBe(0);
    });
  });

  // ==========================================================================
  // Drift Detection Tests
  // ==========================================================================

  describe('Drift Detection', () => {
    it('should detect missing roles', async () => {
      const manifest = {
        communityId: 'community-123',
        guildId: 'test-guild-id',
        version: 1,
        roles: [
          {
            name: 'Missing Role',
            type: 'role' as const,
            config: { color: 0xff0000 },
          },
        ],
        channels: [],
        categories: [],
      };

      mockStorageAdapter.getManifest.mockResolvedValue(manifest);
      mockStorageAdapter.getShadowState.mockResolvedValue(null);

      // Actual Discord state: no roles
      mockGuild.roles.fetch = vi.fn().mockResolvedValue(new Map());
      mockGuild.channels.fetch = vi.fn().mockResolvedValue(new Map());

      const result = await controller.reconcileCommunity('community-123');

      expect(result.success).toBe(true);
      expect(result.driftDetected).toBe(true);
      expect(result.operationsEnqueued).toBeGreaterThan(0);
      expect(mockSynthesisQueue.enqueue).toHaveBeenCalledWith(
        'CREATE_ROLE',
        expect.objectContaining({ name: 'Missing Role' }),
        expect.any(Object)
      );
    });

    it('should detect missing channels', async () => {
      const manifest = {
        communityId: 'community-123',
        guildId: 'test-guild-id',
        version: 1,
        roles: [],
        channels: [
          {
            name: 'missing-channel',
            type: 'channel' as const,
            config: { topic: 'Test Topic' },
          },
        ],
        categories: [],
      };

      mockStorageAdapter.getManifest.mockResolvedValue(manifest);
      mockStorageAdapter.getShadowState.mockResolvedValue(null);

      mockGuild.roles.fetch = vi.fn().mockResolvedValue(new Map());
      mockGuild.channels.fetch = vi.fn().mockResolvedValue(new Map());

      const result = await controller.reconcileCommunity('community-123');

      expect(result.success).toBe(true);
      expect(result.driftDetected).toBe(true);
      expect(result.operationsEnqueued).toBeGreaterThan(0);
      expect(mockSynthesisQueue.enqueue).toHaveBeenCalledWith(
        'CREATE_CHANNEL',
        expect.objectContaining({ name: 'missing-channel' }),
        expect.any(Object)
      );
    });

    it('should detect config drift in roles', async () => {
      const manifest = {
        communityId: 'community-123',
        guildId: 'test-guild-id',
        version: 1,
        roles: [
          {
            name: 'Drifted Role',
            type: 'role' as const,
            config: { color: 0xff0000 }, // Expected: red
          },
        ],
        channels: [],
        categories: [],
      };

      mockStorageAdapter.getManifest.mockResolvedValue(manifest);
      mockStorageAdapter.getShadowState.mockResolvedValue({
        communityId: 'community-123',
        guildId: 'test-guild-id',
        appliedAt: new Date(),
        resources: {
          roles: { 'Drifted Role': 'role-id-1' },
          channels: {},
          categories: {},
        },
      });

      // Actual role has wrong color
      mockGuild.roles.fetch = vi.fn().mockResolvedValue(
        new Map([
          ['role-id-1', createMockRole('role-id-1', 'Drifted Role', 0x00ff00)], // Green instead of red
        ])
      );
      mockGuild.channels.fetch = vi.fn().mockResolvedValue(new Map());

      const result = await controller.reconcileCommunity('community-123');

      expect(result.success).toBe(true);
      expect(result.driftDetected).toBe(true);
      expect(result.operationsEnqueued).toBeGreaterThan(0);
      expect(mockSynthesisQueue.enqueue).toHaveBeenCalledWith(
        'UPDATE_ROLE',
        expect.objectContaining({
          roleId: 'role-id-1',
          color: 0xff0000,
        }),
        expect.any(Object)
      );
    });

    it('should detect orphaned roles', async () => {
      const manifest = {
        communityId: 'community-123',
        guildId: 'test-guild-id',
        version: 1,
        roles: [],
        channels: [],
        categories: [],
      };

      mockStorageAdapter.getManifest.mockResolvedValue(manifest);
      mockStorageAdapter.getShadowState.mockResolvedValue({
        communityId: 'community-123',
        guildId: 'test-guild-id',
        appliedAt: new Date(),
        resources: {
          roles: { 'Orphaned Role': 'role-id-1' }, // In shadow but not in manifest
          channels: {},
          categories: {},
        },
      });

      mockGuild.roles.fetch = vi.fn().mockResolvedValue(
        new Map([['role-id-1', createMockRole('role-id-1', 'Orphaned Role')]])
      );
      mockGuild.channels.fetch = vi.fn().mockResolvedValue(new Map());

      const result = await controller.reconcileCommunity('community-123', {
        destructive: true,
      });

      expect(result.success).toBe(true);
      expect(result.driftDetected).toBe(true);
      expect(result.operationsEnqueued).toBeGreaterThan(0);
      expect(mockSynthesisQueue.enqueue).toHaveBeenCalledWith(
        'DELETE_ROLE',
        expect.objectContaining({ roleId: 'role-id-1' }),
        expect.any(Object)
      );
    });

    it('should not delete orphaned resources without destructive mode', async () => {
      const manifest = {
        communityId: 'community-123',
        guildId: 'test-guild-id',
        version: 1,
        roles: [],
        channels: [],
        categories: [],
      };

      mockStorageAdapter.getManifest.mockResolvedValue(manifest);
      mockStorageAdapter.getShadowState.mockResolvedValue({
        communityId: 'community-123',
        guildId: 'test-guild-id',
        appliedAt: new Date(),
        resources: {
          roles: { 'Orphaned Role': 'role-id-1' },
          channels: {},
          categories: {},
        },
      });

      mockGuild.roles.fetch = vi.fn().mockResolvedValue(
        new Map([['role-id-1', createMockRole('role-id-1', 'Orphaned Role')]])
      );
      mockGuild.channels.fetch = vi.fn().mockResolvedValue(new Map());

      const result = await controller.reconcileCommunity('community-123', {
        destructive: false, // No destructive operations
      });

      // Drift detected but no delete operation enqueued
      expect(result.success).toBe(true);
      expect(result.operationsEnqueued).toBe(0);
      expect(mockSynthesisQueue.enqueue).not.toHaveBeenCalledWith(
        'DELETE_ROLE',
        expect.anything(),
        expect.anything()
      );
    });
  });

  // ==========================================================================
  // Dry-Run Tests
  // ==========================================================================

  describe('Dry-Run Mode', () => {
    it('should detect drift but not enqueue jobs in dry-run', async () => {
      const manifest = {
        communityId: 'community-123',
        guildId: 'test-guild-id',
        version: 1,
        roles: [
          {
            name: 'Missing Role',
            type: 'role' as const,
            config: { color: 0xff0000 },
          },
        ],
        channels: [],
        categories: [],
      };

      mockStorageAdapter.getManifest.mockResolvedValue(manifest);
      mockStorageAdapter.getShadowState.mockResolvedValue(null);

      mockGuild.roles.fetch = vi.fn().mockResolvedValue(new Map());
      mockGuild.channels.fetch = vi.fn().mockResolvedValue(new Map());

      const result = await controller.reconcileCommunity('community-123', {
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.driftDetected).toBe(true);
      expect(result.operationsEnqueued).toBe(0);
      expect(mockSynthesisQueue.enqueue).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Force Reconciliation Tests
  // ==========================================================================

  describe('Force Mode', () => {
    it('should reconcile even when no drift detected if force=true', async () => {
      const manifest = {
        communityId: 'community-123',
        guildId: 'test-guild-id',
        version: 1,
        roles: [
          {
            name: 'Test Role',
            type: 'role' as const,
            config: { color: 0xff0000 },
          },
        ],
        channels: [],
        categories: [],
      };

      mockStorageAdapter.getManifest.mockResolvedValue(manifest);
      mockStorageAdapter.getShadowState.mockResolvedValue(null);

      // Actual state matches manifest (no drift)
      mockGuild.roles.fetch = vi.fn().mockResolvedValue(
        new Map([['role-id-1', createMockRole('role-id-1', 'Test Role', 0xff0000)]])
      );
      mockGuild.channels.fetch = vi.fn().mockResolvedValue(new Map());

      const result = await controller.reconcileCommunity('community-123', {
        force: true,
      });

      // Should still process due to force flag
      expect(result.success).toBe(true);
      expect(result.driftDetected).toBe(true); // Forced
    });
  });

  // ==========================================================================
  // Batch Reconciliation Tests
  // ==========================================================================

  describe('reconcileAll()', () => {
    it('should reconcile multiple communities', async () => {
      mockStorageAdapter.getManifest.mockImplementation((id: string) =>
        Promise.resolve({
          communityId: id,
          guildId: 'test-guild-id',
          version: 1,
          roles: [],
          channels: [],
          categories: [],
        })
      );

      mockStorageAdapter.getShadowState.mockResolvedValue(null);
      mockGuild.roles.fetch = vi.fn().mockResolvedValue(new Map());
      mockGuild.channels.fetch = vi.fn().mockResolvedValue(new Map());

      const results = await controller.reconcileAll([
        'community-1',
        'community-2',
        'community-3',
      ]);

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.success)).toBe(true);
    });

    it('should handle failures in batch reconciliation', async () => {
      mockStorageAdapter.getManifest.mockImplementation((id: string) => {
        if (id === 'community-2') {
          return Promise.resolve(null); // Simulate failure
        }
        return Promise.resolve({
          communityId: id,
          guildId: 'test-guild-id',
          version: 1,
          roles: [],
          channels: [],
          categories: [],
        });
      });

      mockStorageAdapter.getShadowState.mockResolvedValue(null);
      mockGuild.roles.fetch = vi.fn().mockResolvedValue(new Map());
      mockGuild.channels.fetch = vi.fn().mockResolvedValue(new Map());

      const results = await controller.reconcileAll([
        'community-1',
        'community-2',
        'community-3',
      ]);

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false); // community-2 should fail
      expect(results[2].success).toBe(true);
    });
  });

  // ==========================================================================
  // Shadow State Update Tests
  // ==========================================================================

  describe('Shadow State Update', () => {
    it('should update shadow state after successful reconciliation', async () => {
      const manifest = {
        communityId: 'community-123',
        guildId: 'test-guild-id',
        version: 1,
        roles: [
          {
            name: 'Missing Role',
            type: 'role' as const,
            config: { color: 0xff0000 },
          },
        ],
        channels: [],
        categories: [],
      };

      mockStorageAdapter.getManifest.mockResolvedValue(manifest);
      mockStorageAdapter.getShadowState.mockResolvedValue(null);
      mockStorageAdapter.updateShadowState.mockResolvedValue(undefined);

      // Start with no roles
      mockGuild.roles.fetch = vi.fn().mockResolvedValue(new Map());
      mockGuild.channels.fetch = vi.fn().mockResolvedValue(new Map());

      const result = await controller.reconcileCommunity('community-123');

      expect(result.success).toBe(true);
      expect(result.driftDetected).toBe(true);
      expect(result.operationsEnqueued).toBeGreaterThan(0);

      // Verify updateShadowState was called
      expect(mockStorageAdapter.updateShadowState).toHaveBeenCalledWith(
        'community-123',
        expect.objectContaining({
          communityId: 'community-123',
          guildId: 'test-guild-id',
          appliedAt: expect.any(Date),
          resources: expect.objectContaining({
            roles: expect.any(Object),
            channels: expect.any(Object),
            categories: expect.any(Object),
          }),
        })
      );
    });

    it('should not update shadow state in dry-run mode', async () => {
      const manifest = {
        communityId: 'community-123',
        guildId: 'test-guild-id',
        version: 1,
        roles: [
          {
            name: 'Missing Role',
            type: 'role' as const,
            config: { color: 0xff0000 },
          },
        ],
        channels: [],
        categories: [],
      };

      mockStorageAdapter.getManifest.mockResolvedValue(manifest);
      mockStorageAdapter.getShadowState.mockResolvedValue(null);

      mockGuild.roles.fetch = vi.fn().mockResolvedValue(new Map());
      mockGuild.channels.fetch = vi.fn().mockResolvedValue(new Map());

      const result = await controller.reconcileCommunity('community-123', {
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.driftDetected).toBe(true);
      expect(result.operationsEnqueued).toBe(0);

      // updateShadowState should NOT be called in dry-run mode
      expect(mockStorageAdapter.updateShadowState).not.toHaveBeenCalled();
    });

    it('should not update shadow state when no drift detected', async () => {
      const manifest = {
        communityId: 'community-123',
        guildId: 'test-guild-id',
        version: 1,
        roles: [
          {
            name: 'Test Role',
            type: 'role' as const,
            config: { color: 0xff0000 },
          },
        ],
        channels: [],
        categories: [],
      };

      mockStorageAdapter.getManifest.mockResolvedValue(manifest);
      mockStorageAdapter.getShadowState.mockResolvedValue({
        communityId: 'community-123',
        guildId: 'test-guild-id',
        appliedAt: new Date(),
        resources: {
          roles: { 'Test Role': 'role-id-1' },
          channels: {},
          categories: {},
        },
      });

      // Actual Discord state matches manifest (no drift)
      mockGuild.roles.fetch = vi.fn().mockResolvedValue(
        new Map([['role-id-1', createMockRole('role-id-1', 'Test Role', 0xff0000)]])
      );
      mockGuild.channels.fetch = vi.fn().mockResolvedValue(new Map());

      const result = await controller.reconcileCommunity('community-123');

      expect(result.success).toBe(true);
      expect(result.driftDetected).toBe(false);

      // updateShadowState should NOT be called when no drift detected
      expect(mockStorageAdapter.updateShadowState).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle empty manifests', async () => {
      const manifest = {
        communityId: 'community-123',
        guildId: 'test-guild-id',
        version: 1,
        roles: [],
        channels: [],
        categories: [],
      };

      mockStorageAdapter.getManifest.mockResolvedValue(manifest);
      mockStorageAdapter.getShadowState.mockResolvedValue(null);

      mockGuild.roles.fetch = vi.fn().mockResolvedValue(new Map());
      mockGuild.channels.fetch = vi.fn().mockResolvedValue(new Map());

      const result = await controller.reconcileCommunity('community-123');

      expect(result.success).toBe(true);
      expect(result.driftDetected).toBe(false);
      expect(result.operationsEnqueued).toBe(0);
    });

    it('should handle large drift (many missing resources)', async () => {
      const manifest = {
        communityId: 'community-123',
        guildId: 'test-guild-id',
        version: 1,
        roles: Array(50)
          .fill(0)
          .map((_, i) => ({
            name: `Role ${i}`,
            type: 'role' as const,
            config: { color: 0xff0000 },
          })),
        channels: Array(50)
          .fill(0)
          .map((_, i) => ({
            name: `channel-${i}`,
            type: 'channel' as const,
            config: {},
          })),
        categories: [],
      };

      mockStorageAdapter.getManifest.mockResolvedValue(manifest);
      mockStorageAdapter.getShadowState.mockResolvedValue(null);

      mockGuild.roles.fetch = vi.fn().mockResolvedValue(new Map());
      mockGuild.channels.fetch = vi.fn().mockResolvedValue(new Map());

      const result = await controller.reconcileCommunity('community-123');

      expect(result.success).toBe(true);
      expect(result.driftDetected).toBe(true);
      expect(result.operationsEnqueued).toBe(100); // 50 roles + 50 channels
    });
  });
});
