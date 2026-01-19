/**
 * DestroyEngine Tests
 *
 * Sprint 98: Apply & Destroy Operations
 *
 * Unit tests for destroy engine with state locking.
 *
 * @module packages/cli/commands/server/iac/__tests__/DestroyEngine.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { DestroyEngine } from '../DestroyEngine.js';
import { createLocalBackend } from '../backends/LocalBackend.js';
import { createEmptyState } from '../backends/types.js';
import type { StateBackend, GaibState } from '../backends/types.js';
import type { DiscordClient } from '../DiscordClient.js';

// Create mock Discord client
function createMockClient(): DiscordClient {
  return {
    createRole: vi.fn().mockResolvedValue({ id: 'new-role-id' }),
    updateRole: vi.fn().mockResolvedValue({}),
    deleteRole: vi.fn().mockResolvedValue({}),
    createChannel: vi.fn().mockResolvedValue({ id: 'new-channel-id' }),
    updateChannel: vi.fn().mockResolvedValue({}),
    deleteChannel: vi.fn().mockResolvedValue({}),
    setChannelPermission: vi.fn().mockResolvedValue({}),
    deleteChannelPermission: vi.fn().mockResolvedValue({}),
  } as unknown as DiscordClient;
}

describe('DestroyEngine', () => {
  let tempDir: string;
  let backend: StateBackend;
  let client: DiscordClient;
  let engine: DestroyEngine;

  const createStateWithResources = (): GaibState => ({
    version: 1,
    serial: 5,
    lineage: 'test-lineage',
    workspace: 'default',
    guildId: '123456789',
    lastModified: new Date().toISOString(),
    resources: [
      {
        type: 'discord_role',
        name: 'test-role',
        provider: 'discord',
        instances: [{
          schema_version: 1,
          attributes: {
            id: 'role-123',
            name: 'test-role',
            color: '#ff0000',
            hoist: true,
            mentionable: false,
            permissions: ['SEND_MESSAGES'],
          },
        }],
      },
      {
        type: 'discord_category',
        name: 'test-category',
        provider: 'discord',
        instances: [{
          schema_version: 1,
          attributes: {
            id: 'category-123',
            name: 'test-category',
            position: 0,
          },
        }],
      },
      {
        type: 'discord_channel',
        name: 'test-channel',
        provider: 'discord',
        instances: [{
          schema_version: 1,
          attributes: {
            id: 'channel-123',
            name: 'test-channel',
            type: 'text',
            parent_name: 'test-category',
          },
        }],
      },
    ],
    outputs: {},
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'destroyengine-test-'));
    backend = createLocalBackend({ path: join(tempDir, '.gaib') });
    client = createMockClient();
    engine = new DestroyEngine(backend, client);
  });

  afterEach(async () => {
    await backend.close();
    await rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  // ============================================================================
  // destroy() - Empty State
  // ============================================================================

  describe('destroy() - Empty State', () => {
    it('returns success for empty workspace', async () => {
      const result = await engine.destroy('123456789', 'default');

      expect(result.success).toBe(true);
      expect(result.resourcesDestroyed).toBe(0);
      expect(result.stateUpdated).toBe(false);
    });

    it('returns success for state with no resources', async () => {
      const emptyState = createEmptyState({ workspace: 'default' });
      await backend.setState('default', emptyState);

      const result = await engine.destroy('123456789', 'default');

      expect(result.success).toBe(true);
      expect(result.resourcesDestroyed).toBe(0);
    });
  });

  // ============================================================================
  // destroy() - With Resources
  // ============================================================================

  describe('destroy() - With Resources', () => {
    it('destroys all resources', async () => {
      await backend.setState('default', createStateWithResources());

      const result = await engine.destroy('123456789', 'default');

      expect(result.success).toBe(true);
      expect(result.resourcesDestroyed).toBe(3);
      expect(result.stateUpdated).toBe(true);
    });

    it('updates state after destroy', async () => {
      await backend.setState('default', createStateWithResources());

      await engine.destroy('123456789', 'default');

      const state = await backend.getState('default');
      expect(state?.resources.length).toBe(0);
      expect(state?.serial).toBe(6);
    });
  });

  // ============================================================================
  // destroy() - Target Types
  // ============================================================================

  describe('destroy() - Target Types', () => {
    it('destroys only targeted resource types', async () => {
      await backend.setState('default', createStateWithResources());

      const result = await engine.destroy('123456789', 'default', {
        targetTypes: ['role'],
      });

      expect(result.success).toBe(true);
      expect(result.resourcesDestroyed).toBe(1);

      const state = await backend.getState('default');
      // Role should be removed, category and channel should remain
      expect(state?.resources.find((r) => r.type === 'discord_role')).toBeUndefined();
      expect(state?.resources.find((r) => r.type === 'discord_category')).toBeDefined();
    });

    it('destroys multiple targeted types', async () => {
      await backend.setState('default', createStateWithResources());

      const result = await engine.destroy('123456789', 'default', {
        targetTypes: ['role', 'channel'],
      });

      expect(result.success).toBe(true);
      expect(result.resourcesDestroyed).toBe(2);
    });
  });

  // ============================================================================
  // destroy() - Dry Run
  // ============================================================================

  describe('destroy() - Dry Run', () => {
    it('does not make changes in dry run mode', async () => {
      await backend.setState('default', createStateWithResources());

      const result = await engine.destroy('123456789', 'default', {
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.stateUpdated).toBe(false);

      // State should be unchanged
      const state = await backend.getState('default');
      expect(state?.resources.length).toBe(3);
    });

    it('returns resource count in dry run', async () => {
      await backend.setState('default', createStateWithResources());

      const result = await engine.destroy('123456789', 'default', {
        dryRun: true,
      });

      expect(result.resourcesDestroyed).toBe(3);
    });
  });

  // ============================================================================
  // destroy() - State Locking
  // ============================================================================

  describe('destroy() - State Locking', () => {
    it('acquires lock during destroy', async () => {
      await backend.setState('default', createStateWithResources());

      // Start destroy
      const destroyPromise = engine.destroy('123456789', 'default');

      // Wait for destroy to complete
      await destroyPromise;

      // Lock should be released
      const stateLock = engine.getStateLock();
      const isLocked = await stateLock.isLocked('default');
      expect(isLocked).toBe(false);
    });

    it('can skip locking', async () => {
      await backend.setState('default', createStateWithResources());

      const result = await engine.destroy('123456789', 'default', {
        skipLock: true,
      });

      expect(result.success).toBe(true);
    });

    it('fails when lock is already held', async () => {
      await backend.setState('default', createStateWithResources());

      // Acquire lock first
      const stateLock = engine.getStateLock();
      await stateLock.acquire('default', { operation: 'apply' });

      // Try to destroy (should fail due to lock)
      const result = await engine.destroy('123456789', 'default');

      expect(result.success).toBe(false);
      expect(result.error).toContain('lock');
    });
  });

  // ============================================================================
  // preview()
  // ============================================================================

  describe('preview()', () => {
    it('returns empty preview for empty workspace', async () => {
      const preview = await engine.preview('default');

      expect(preview.resources.length).toBe(0);
      expect(preview.diff.hasChanges).toBe(false);
    });

    it('returns resources and diff for workspace with resources', async () => {
      await backend.setState('default', createStateWithResources());

      const preview = await engine.preview('default');

      expect(preview.resources.length).toBe(3);
      expect(preview.diff.hasChanges).toBe(true);
      expect(preview.diff.summary.delete).toBe(3);
    });

    it('filters by target types', async () => {
      await backend.setState('default', createStateWithResources());

      const preview = await engine.preview('default', ['role']);

      expect(preview.resources.length).toBe(1);
      expect(preview.resources[0].type).toBe('role');
      expect(preview.diff.summary.delete).toBe(1);
    });
  });

  // ============================================================================
  // getStateLock() / getBackend()
  // ============================================================================

  describe('getStateLock() / getBackend()', () => {
    it('returns the state lock instance', () => {
      const stateLock = engine.getStateLock();
      expect(stateLock).toBeDefined();
    });

    it('returns the backend instance', () => {
      const backendInstance = engine.getBackend();
      expect(backendInstance).toBe(backend);
    });
  });
});
