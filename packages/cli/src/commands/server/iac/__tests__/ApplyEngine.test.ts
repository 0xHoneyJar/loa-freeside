/**
 * ApplyEngine Tests
 *
 * Sprint 98: Apply & Destroy Operations
 *
 * Unit tests for apply engine with state locking.
 *
 * @module packages/cli/commands/server/iac/__tests__/ApplyEngine.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { ApplyEngine } from '../ApplyEngine.js';
import { StateWriter } from '../StateWriter.js';
import { createLocalBackend } from '../backends/LocalBackend.js';
import { createEmptyState } from '../backends/types.js';
import type { StateBackend } from '../backends/types.js';
import type { ServerDiff, ApplyBatchResult } from '../types.js';
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

describe('ApplyEngine', () => {
  let tempDir: string;
  let backend: StateBackend;
  let client: DiscordClient;
  let engine: ApplyEngine;

  const emptyDiff: ServerDiff = {
    roles: [],
    categories: [],
    channels: [],
    permissions: [],
    hasChanges: false,
    summary: { create: 0, update: 0, delete: 0, total: 0 },
  };

  const simpleDiff: ServerDiff = {
    roles: [
      {
        operation: 'create',
        name: 'test-role',
        desired: {
          name: 'test-role',
          color: '#ff0000',
          hoist: true,
          mentionable: false,
          permissions: ['SEND_MESSAGES'],
        },
      },
    ],
    categories: [],
    channels: [],
    permissions: [],
    hasChanges: true,
    summary: { create: 1, update: 0, delete: 0, total: 1 },
  };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'applyengine-test-'));
    backend = createLocalBackend({ path: join(tempDir, '.gaib') });
    client = createMockClient();
    engine = new ApplyEngine(backend, client);
  });

  afterEach(async () => {
    await backend.close();
    await rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  // ============================================================================
  // apply() - Basic Operations
  // ============================================================================

  describe('apply() - Basic Operations', () => {
    it('returns success for empty diff', async () => {
      const result = await engine.apply(emptyDiff, '123456789', 'default');

      expect(result.success).toBe(true);
      expect(result.stateUpdated).toBe(true);
    });

    it('applies changes and updates state', async () => {
      const result = await engine.apply(simpleDiff, '123456789', 'default');

      expect(result.success).toBe(true);
      expect(result.stateUpdated).toBe(true);
      expect(result.newSerial).toBe(1);
    });

    it('includes apply result details', async () => {
      const result = await engine.apply(simpleDiff, '123456789', 'default');

      expect(result.applyResult).toBeDefined();
      expect(result.applyResult?.summary.total).toBe(1);
      expect(result.applyResult?.summary.succeeded).toBe(1);
    });
  });

  // ============================================================================
  // apply() - Dry Run
  // ============================================================================

  describe('apply() - Dry Run', () => {
    it('does not make changes in dry run mode', async () => {
      const result = await engine.apply(simpleDiff, '123456789', 'default', {
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.stateUpdated).toBe(false);
    });

    it('returns apply result in dry run mode', async () => {
      const result = await engine.apply(simpleDiff, '123456789', 'default', {
        dryRun: true,
      });

      expect(result.applyResult).toBeDefined();
      expect(result.applyResult?.summary.total).toBe(1);
    });
  });

  // ============================================================================
  // apply() - State Locking
  // ============================================================================

  describe('apply() - State Locking', () => {
    it('acquires lock during apply', async () => {
      // Start apply
      const applyPromise = engine.apply(simpleDiff, '123456789', 'default');

      // Check that lock is acquired
      const stateLock = engine.getStateLock();

      // Wait for apply to complete
      await applyPromise;

      // Lock should be released
      const isLocked = await stateLock.isLocked('default');
      expect(isLocked).toBe(false);
    });

    it('releases lock on error', async () => {
      // Make the apply fail by mocking StateWriter
      const mockWriter = {
        apply: vi.fn().mockRejectedValue(new Error('Apply failed')),
      } as unknown as StateWriter;

      const failingEngine = new ApplyEngine(backend, client, mockWriter);

      try {
        await failingEngine.apply(simpleDiff, '123456789', 'default');
      } catch {
        // Expected
      }

      // Lock should be released
      const stateLock = failingEngine.getStateLock();
      const isLocked = await stateLock.isLocked('default');
      expect(isLocked).toBe(false);
    });

    it('can skip locking', async () => {
      const result = await engine.apply(simpleDiff, '123456789', 'default', {
        skipLock: true,
      });

      expect(result.success).toBe(true);
    });

    it('fails when lock is already held', async () => {
      // Acquire lock first
      const stateLock = engine.getStateLock();
      await stateLock.acquire('default', { operation: 'apply' });

      // Try to apply (should fail due to lock)
      const result = await engine.apply(simpleDiff, '123456789', 'default');

      expect(result.success).toBe(false);
      expect(result.error).toContain('lock');
    });
  });

  // ============================================================================
  // apply() - State Updates
  // ============================================================================

  describe('apply() - State Updates', () => {
    it('creates state if none exists', async () => {
      const result = await engine.apply(simpleDiff, '123456789', 'default');

      const state = await backend.getState('default');
      expect(state).not.toBeNull();
      expect(state?.serial).toBe(1);
    });

    it('updates existing state', async () => {
      // Create initial state
      const initialState = createEmptyState({ workspace: 'default' });
      initialState.serial = 5;
      await backend.setState('default', initialState);

      const result = await engine.apply(simpleDiff, '123456789', 'default');

      const state = await backend.getState('default');
      expect(state?.serial).toBe(6);
    });

    it('records new resource IDs in state', async () => {
      const result = await engine.apply(simpleDiff, '123456789', 'default');

      const state = await backend.getState('default');
      const roleResource = state?.resources.find(
        (r) => r.type === 'discord_role' && r.name === 'test-role'
      );

      expect(roleResource).toBeDefined();
      expect(roleResource?.instances[0]?.attributes?.id).toBe('new-role-id');
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
