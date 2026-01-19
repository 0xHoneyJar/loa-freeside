/**
 * WorkspaceManager Tests
 *
 * Sprint 97: Workspace Management
 *
 * Unit tests for workspace lifecycle operations.
 *
 * @module packages/cli/commands/server/iac/__tests__/WorkspaceManager.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  WorkspaceManager,
  WorkspaceError,
  DEFAULT_WORKSPACE,
  createWorkspaceManagerWithBackend,
} from '../WorkspaceManager.js';
import { createLocalBackend } from '../backends/LocalBackend.js';
import type { StateBackend } from '../backends/types.js';

describe('WorkspaceManager', () => {
  let tempDir: string;
  let backend: StateBackend;
  let manager: WorkspaceManager;

  beforeEach(async () => {
    // Create temp directory for each test
    tempDir = await mkdtemp(join(tmpdir(), 'workspace-test-'));
    backend = createLocalBackend({ path: join(tempDir, '.gaib') });
    manager = createWorkspaceManagerWithBackend(backend, tempDir);
  });

  afterEach(async () => {
    await backend.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  // ============================================================================
  // current()
  // ============================================================================

  describe('current()', () => {
    it('returns "default" when no workspace file exists', async () => {
      const current = await manager.current();
      expect(current).toBe(DEFAULT_WORKSPACE);
    });

    it('reads workspace from file when it exists', async () => {
      await mkdir(join(tempDir, '.gaib'), { recursive: true });
      await writeFile(join(tempDir, '.gaib', 'workspace'), 'staging');

      const current = await manager.current();
      expect(current).toBe('staging');
    });

    it('returns "default" for empty workspace file', async () => {
      await mkdir(join(tempDir, '.gaib'), { recursive: true });
      await writeFile(join(tempDir, '.gaib', 'workspace'), '');

      const current = await manager.current();
      expect(current).toBe(DEFAULT_WORKSPACE);
    });

    it('trims whitespace from workspace name', async () => {
      await mkdir(join(tempDir, '.gaib'), { recursive: true });
      await writeFile(join(tempDir, '.gaib', 'workspace'), '  production  \n');

      const current = await manager.current();
      expect(current).toBe('production');
    });
  });

  // ============================================================================
  // list()
  // ============================================================================

  describe('list()', () => {
    it('returns at least the default workspace', async () => {
      const workspaces = await manager.list();
      expect(workspaces.length).toBeGreaterThanOrEqual(1);
      expect(workspaces.some((w) => w.name === DEFAULT_WORKSPACE)).toBe(true);
    });

    it('marks current workspace correctly', async () => {
      const workspaces = await manager.list();
      const defaultWs = workspaces.find((w) => w.name === DEFAULT_WORKSPACE);
      expect(defaultWs?.current).toBe(true);
    });

    it('lists created workspaces', async () => {
      await manager.create('staging');
      await manager.create('production');

      const workspaces = await manager.list();
      const names = workspaces.map((w) => w.name);

      expect(names).toContain('staging');
      expect(names).toContain('production');
    });

    it('shows resource counts', async () => {
      await manager.create('test-ws');
      const workspaces = await manager.list();
      const testWs = workspaces.find((w) => w.name === 'test-ws');

      expect(testWs?.resourceCount).toBe(0);
    });

    it('sorts with current workspace first', async () => {
      await manager.create('alpha');
      await manager.create('beta');
      await manager.select('beta');

      const workspaces = await manager.list();
      expect(workspaces[0].name).toBe('beta');
      expect(workspaces[0].current).toBe(true);
    });
  });

  // ============================================================================
  // create()
  // ============================================================================

  describe('create()', () => {
    it('creates a new workspace with empty state', async () => {
      const ws = await manager.create('staging');

      expect(ws.name).toBe('staging');
      expect(ws.resourceCount).toBe(0);
      expect(ws.serial).toBe(0);
    });

    it('can switch to new workspace on creation', async () => {
      await manager.create('staging', { switchTo: true });

      const current = await manager.current();
      expect(current).toBe('staging');
    });

    it('does not switch by default', async () => {
      await manager.create('staging');

      const current = await manager.current();
      expect(current).toBe(DEFAULT_WORKSPACE);
    });

    it('throws for duplicate workspace', async () => {
      await manager.create('staging');

      await expect(manager.create('staging')).rejects.toThrow(WorkspaceError);
      await expect(manager.create('staging')).rejects.toMatchObject({
        code: 'WORKSPACE_EXISTS',
      });
    });

    it('validates workspace name - empty', async () => {
      await expect(manager.create('')).rejects.toThrow(WorkspaceError);
      await expect(manager.create('')).rejects.toMatchObject({
        code: 'INVALID_NAME',
      });
    });

    it('validates workspace name - invalid characters', async () => {
      await expect(manager.create('my workspace')).rejects.toThrow(WorkspaceError);
      await expect(manager.create('my/workspace')).rejects.toThrow(WorkspaceError);
      await expect(manager.create('my.workspace')).rejects.toThrow(WorkspaceError);
    });

    it('validates workspace name - must start with alphanumeric', async () => {
      await expect(manager.create('-staging')).rejects.toThrow(WorkspaceError);
      await expect(manager.create('_staging')).rejects.toThrow(WorkspaceError);
    });

    it('allows valid workspace names', async () => {
      await expect(manager.create('staging')).resolves.toBeDefined();
      await expect(manager.create('prod-1')).resolves.toBeDefined();
      await expect(manager.create('test_env')).resolves.toBeDefined();
      await expect(manager.create('v2')).resolves.toBeDefined();
    });

    it('validates workspace name - max length', async () => {
      const longName = 'a'.repeat(65);
      await expect(manager.create(longName)).rejects.toThrow(WorkspaceError);
      await expect(manager.create(longName)).rejects.toMatchObject({
        code: 'INVALID_NAME',
      });

      const maxName = 'a'.repeat(64);
      await expect(manager.create(maxName)).resolves.toBeDefined();
    });
  });

  // ============================================================================
  // select()
  // ============================================================================

  describe('select()', () => {
    it('switches to existing workspace', async () => {
      await manager.create('staging');
      await manager.select('staging');

      const current = await manager.current();
      expect(current).toBe('staging');
    });

    it('throws for non-existent workspace without --create', async () => {
      await expect(manager.select('nonexistent')).rejects.toThrow(WorkspaceError);
      await expect(manager.select('nonexistent')).rejects.toMatchObject({
        code: 'WORKSPACE_NOT_FOUND',
      });
    });

    it('creates workspace with --create flag', async () => {
      await manager.select('new-workspace', { create: true });

      const current = await manager.current();
      expect(current).toBe('new-workspace');

      const exists = await manager.exists('new-workspace');
      expect(exists).toBe(true);
    });

    it('can select default workspace', async () => {
      await manager.create('staging', { switchTo: true });
      await manager.select(DEFAULT_WORKSPACE);

      const current = await manager.current();
      expect(current).toBe(DEFAULT_WORKSPACE);
    });

    it('persists workspace selection', async () => {
      await manager.create('staging');
      await manager.select('staging');

      // Create new manager instance
      const newManager = createWorkspaceManagerWithBackend(backend, tempDir);
      const current = await newManager.current();
      expect(current).toBe('staging');
    });
  });

  // ============================================================================
  // show()
  // ============================================================================

  describe('show()', () => {
    it('shows current workspace by default', async () => {
      const ws = await manager.show();
      expect(ws.name).toBe(DEFAULT_WORKSPACE);
      expect(ws.current).toBe(true);
    });

    it('shows specific workspace', async () => {
      await manager.create('staging');
      const ws = await manager.show('staging');

      expect(ws.name).toBe('staging');
      expect(ws.current).toBe(false);
    });

    it('throws for non-existent workspace', async () => {
      await expect(manager.show('nonexistent')).rejects.toThrow(WorkspaceError);
      await expect(manager.show('nonexistent')).rejects.toMatchObject({
        code: 'WORKSPACE_NOT_FOUND',
      });
    });

    it('includes workspace info', async () => {
      await manager.create('staging', { switchTo: true });
      const ws = await manager.show();

      expect(ws).toMatchObject({
        name: 'staging',
        current: true,
        resourceCount: 0,
        serial: 0,
        backend: 'local',
      });
      expect(ws.lastModified).toBeDefined();
    });
  });

  // ============================================================================
  // delete()
  // ============================================================================

  describe('delete()', () => {
    it('deletes empty workspace', async () => {
      await manager.create('staging');
      await manager.delete('staging');

      const exists = await manager.exists('staging');
      expect(exists).toBe(false);
    });

    it('cannot delete default workspace', async () => {
      await expect(manager.delete(DEFAULT_WORKSPACE)).rejects.toThrow(WorkspaceError);
      await expect(manager.delete(DEFAULT_WORKSPACE)).rejects.toMatchObject({
        code: 'CANNOT_DELETE_DEFAULT',
      });
    });

    it('cannot delete current workspace', async () => {
      await manager.create('staging', { switchTo: true });

      await expect(manager.delete('staging')).rejects.toThrow(WorkspaceError);
      await expect(manager.delete('staging')).rejects.toMatchObject({
        code: 'CANNOT_DELETE_CURRENT',
      });
    });

    it('throws for non-existent workspace', async () => {
      await expect(manager.delete('nonexistent')).rejects.toThrow(WorkspaceError);
      await expect(manager.delete('nonexistent')).rejects.toMatchObject({
        code: 'WORKSPACE_NOT_FOUND',
      });
    });

    it('requires --force for non-empty workspace', async () => {
      await manager.create('staging');

      // Add a resource to the state
      const state = await backend.getState('staging');
      if (state) {
        state.resources.push({
          type: 'discord_role',
          name: 'admin',
          provider: 'discord',
          instances: [{ schema_version: 1, attributes: { id: '123' } }],
        });
        await backend.setState('staging', state);
      }

      await expect(manager.delete('staging')).rejects.toThrow(WorkspaceError);
      await expect(manager.delete('staging')).rejects.toMatchObject({
        code: 'WORKSPACE_NOT_EMPTY',
      });

      // With force flag should succeed
      await manager.delete('staging', { force: true });
      const exists = await manager.exists('staging');
      expect(exists).toBe(false);
    });
  });

  // ============================================================================
  // exists()
  // ============================================================================

  describe('exists()', () => {
    it('returns true for default workspace', async () => {
      const exists = await manager.exists(DEFAULT_WORKSPACE);
      expect(exists).toBe(true);
    });

    it('returns true for created workspace', async () => {
      await manager.create('staging');
      const exists = await manager.exists('staging');
      expect(exists).toBe(true);
    });

    it('returns false for non-existent workspace', async () => {
      const exists = await manager.exists('nonexistent');
      expect(exists).toBe(false);
    });
  });

  // ============================================================================
  // State helpers
  // ============================================================================

  describe('getState() / setState()', () => {
    it('gets state for current workspace', async () => {
      const state = await manager.getState();
      // Default workspace starts with null state
      expect(state).toBeNull();
    });

    it('sets state for current workspace', async () => {
      await manager.create('staging', { switchTo: true });

      const state = await manager.getState();
      expect(state).not.toBeNull();
      expect(state?.workspace).toBe('staging');
    });
  });

  // ============================================================================
  // WorkspaceError
  // ============================================================================

  describe('WorkspaceError', () => {
    it('has correct name', () => {
      const error = new WorkspaceError('test', 'INVALID_NAME');
      expect(error.name).toBe('WorkspaceError');
    });

    it('has correct code', () => {
      const error = new WorkspaceError('test', 'WORKSPACE_EXISTS');
      expect(error.code).toBe('WORKSPACE_EXISTS');
    });

    it('has correct message', () => {
      const error = new WorkspaceError('test message', 'INVALID_NAME');
      expect(error.message).toBe('test message');
    });
  });
});
