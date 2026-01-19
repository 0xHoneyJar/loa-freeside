/**
 * State Backends Tests
 *
 * Sprint 96: Remote State Backend - Unit Tests
 *
 * Tests for LocalBackend, S3Backend interfaces, and BackendFactory.
 *
 * @module packages/cli/commands/server/iac/__tests__/backends.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  // Types
  type GaibState,
  type LockInfo,

  // Utilities
  createEmptyState,
  generateLineage,
  generateLockId,
  isValidState,
  isValidBackendConfig,

  // LocalBackend
  LocalBackend,
  createLocalBackend,
  getCurrentWorkspace,
  setCurrentWorkspace,

  // BackendFactory
  BackendFactory,
  findConfigFile,

  // Errors
  BackendError,
  StateLockError,
  BackendConfigError,
} from '../backends/index.js';

// ============================================================================
// Test Utilities
// ============================================================================

function createTempDir(): string {
  const tempDir = join(tmpdir(), `gaib-test-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`);
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function cleanupTempDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

function createTestState(workspace: string = 'default'): GaibState {
  return {
    version: 1,
    serial: 1,
    lineage: generateLineage(),
    workspace,
    resources: [
      {
        type: 'discord_role',
        name: 'admin',
        provider: 'discord',
        instances: [
          {
            schema_version: 1,
            attributes: {
              id: '1234567890',
              name: 'Admin',
              color: '#FF0000',
            },
          },
        ],
      },
    ],
    outputs: {
      server_id: {
        value: '9876543210',
        sensitive: false,
      },
    },
    lastModified: new Date().toISOString(),
  };
}

// ============================================================================
// Type Utilities Tests
// ============================================================================

describe('State Type Utilities', () => {
  describe('createEmptyState', () => {
    it('creates empty state with workspace', () => {
      const state = createEmptyState({ workspace: 'production' });

      expect(state.version).toBe(1);
      expect(state.serial).toBe(0);
      expect(state.workspace).toBe('production');
      expect(state.resources).toEqual([]);
      expect(state.outputs).toEqual({});
      expect(state.lineage).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
    });

    it('uses provided lineage', () => {
      const state = createEmptyState({
        workspace: 'test',
        lineage: 'custom-lineage-123',
      });

      expect(state.lineage).toBe('custom-lineage-123');
    });
  });

  describe('generateLineage', () => {
    it('generates unique lineages', () => {
      const lineages = new Set<string>();

      for (let i = 0; i < 100; i++) {
        lineages.add(generateLineage());
      }

      expect(lineages.size).toBe(100);
    });
  });

  describe('generateLockId', () => {
    it('generates unique lock IDs', () => {
      const ids = new Set<string>();

      for (let i = 0; i < 100; i++) {
        ids.add(generateLockId());
      }

      expect(ids.size).toBe(100);
    });

    it('generates IDs with lock prefix', () => {
      const id = generateLockId();
      expect(id).toMatch(/^lock-[a-z0-9]+-[a-z0-9]+$/);
    });
  });

  describe('isValidState', () => {
    it('validates correct state', () => {
      const state = createTestState();
      expect(isValidState(state)).toBe(true);
    });

    it('rejects null', () => {
      expect(isValidState(null)).toBe(false);
    });

    it('rejects non-object', () => {
      expect(isValidState('not an object')).toBe(false);
      expect(isValidState(123)).toBe(false);
    });

    it('rejects missing required fields', () => {
      expect(isValidState({ version: 1 })).toBe(false);
      expect(isValidState({ version: 1, serial: 0 })).toBe(false);
    });
  });

  describe('isValidBackendConfig', () => {
    it('validates local config', () => {
      expect(isValidBackendConfig({ type: 'local' })).toBe(true);
      expect(isValidBackendConfig({ type: 'local', path: '.state' })).toBe(true);
    });

    it('validates s3 config', () => {
      expect(
        isValidBackendConfig({
          type: 's3',
          bucket: 'my-bucket',
          key: 'state/${workspace}/terraform.tfstate',
          region: 'us-east-1',
          dynamodb_table: 'locks',
        })
      ).toBe(true);
    });

    it('rejects invalid s3 config', () => {
      expect(isValidBackendConfig({ type: 's3' })).toBe(false);
      expect(isValidBackendConfig({ type: 's3', bucket: 'b' })).toBe(false);
    });

    it('rejects unknown type', () => {
      expect(isValidBackendConfig({ type: 'unknown' })).toBe(false);
    });
  });
});

// ============================================================================
// LocalBackend Tests
// ============================================================================

describe('LocalBackend', () => {
  let tempDir: string;
  let backend: LocalBackend;

  beforeEach(() => {
    tempDir = createTempDir();
    backend = createLocalBackend({ path: tempDir });
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('state operations', () => {
    it('returns null for non-existent state', async () => {
      const state = await backend.getState('nonexistent');
      expect(state).toBeNull();
    });

    it('writes and reads state', async () => {
      const state = createTestState('test');

      await backend.setState('test', state);
      const retrieved = await backend.getState('test');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.workspace).toBe('test');
      expect(retrieved!.resources).toHaveLength(1);
      expect(retrieved!.resources[0].name).toBe('admin');
    });

    it('updates lastModified on write', async () => {
      const state = createTestState();
      const originalModified = state.lastModified;

      // Wait a bit to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      await backend.setState('default', state);
      const retrieved = await backend.getState('default');

      expect(retrieved!.lastModified).not.toBe(originalModified);
    });

    it('increments serial is responsibility of caller', async () => {
      const state = createTestState();
      state.serial = 5;

      await backend.setState('default', state);
      const retrieved = await backend.getState('default');

      // Backend doesn't auto-increment, caller does
      expect(retrieved!.serial).toBe(5);
    });

    it('deletes state', async () => {
      const state = createTestState();

      await backend.setState('default', state);
      expect(await backend.getState('default')).not.toBeNull();

      await backend.deleteState('default');
      expect(await backend.getState('default')).toBeNull();
    });

    it('delete is idempotent', async () => {
      // Should not throw
      await backend.deleteState('nonexistent');
    });
  });

  describe('workspace listing', () => {
    it('lists empty workspaces', async () => {
      const workspaces = await backend.listWorkspaces();
      expect(workspaces).toEqual([]);
    });

    it('lists created workspaces', async () => {
      await backend.setState('dev', createTestState('dev'));
      await backend.setState('staging', createTestState('staging'));
      await backend.setState('prod', createTestState('prod'));

      const workspaces = await backend.listWorkspaces();

      expect(workspaces).toHaveLength(3);
      expect(workspaces).toContain('dev');
      expect(workspaces).toContain('staging');
      expect(workspaces).toContain('prod');
    });
  });

  describe('locking', () => {
    it('acquires lock on unlocked workspace', async () => {
      const result = await backend.lock('default', {
        who: 'test@example.com',
        operation: 'apply',
      });

      expect(result.acquired).toBe(true);
      expect(result.lockInfo).toBeDefined();
      expect(result.lockInfo!.who).toBe('test@example.com');
      expect(result.lockInfo!.operation).toBe('apply');
    });

    it('fails to acquire lock when already locked', async () => {
      const first = await backend.lock('default', {
        who: 'user1@example.com',
        operation: 'apply',
      });

      expect(first.acquired).toBe(true);

      const second = await backend.lock('default', {
        who: 'user2@example.com',
        operation: 'apply',
      });

      expect(second.acquired).toBe(false);
      expect(second.error).toContain('locked by user1@example.com');
    });

    it('unlocks with correct lock ID', async () => {
      const lock = await backend.lock('default', {
        who: 'test@example.com',
        operation: 'apply',
      });

      expect(lock.acquired).toBe(true);

      const unlocked = await backend.unlock('default', lock.lockInfo!.id);
      expect(unlocked).toBe(true);

      // Can now acquire again
      const newLock = await backend.lock('default', {
        who: 'another@example.com',
        operation: 'destroy',
      });

      expect(newLock.acquired).toBe(true);
    });

    it('fails to unlock with wrong lock ID', async () => {
      const lock = await backend.lock('default', {
        who: 'test@example.com',
        operation: 'apply',
      });

      await expect(
        backend.unlock('default', 'wrong-id')
      ).rejects.toThrow(StateLockError);
    });

    it('force unlock removes any lock', async () => {
      await backend.lock('default', {
        who: 'test@example.com',
        operation: 'apply',
      });

      const forceResult = await backend.forceUnlock('default');
      expect(forceResult).toBe(true);

      // Can now acquire
      const newLock = await backend.lock('default', {
        who: 'another@example.com',
        operation: 'plan',
      });

      expect(newLock.acquired).toBe(true);
    });

    it('gets lock info', async () => {
      await backend.lock('default', {
        who: 'test@example.com',
        operation: 'apply',
        info: 'Testing lock info',
      });

      const lockInfo = await backend.getLockInfo('default');

      expect(lockInfo).not.toBeNull();
      expect(lockInfo!.who).toBe('test@example.com');
      expect(lockInfo!.operation).toBe('apply');
      expect(lockInfo!.info).toBe('Testing lock info');
    });

    it('returns null for unlocked workspace', async () => {
      const lockInfo = await backend.getLockInfo('unlocked');
      expect(lockInfo).toBeNull();
    });
  });

  describe('configuration', () => {
    it('reports as configured', async () => {
      expect(await backend.isConfigured()).toBe(true);
    });

    it('has correct type', () => {
      expect(backend.type).toBe('local');
    });

    it('supports locking', () => {
      expect(backend.supportsLocking).toBe(true);
    });
  });
});

// ============================================================================
// Current Workspace Tracking Tests
// ============================================================================

describe('Current Workspace Tracking', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('returns default when no tracking file', async () => {
    const workspace = await getCurrentWorkspace(tempDir);
    expect(workspace).toBe('default');
  });

  it('sets and gets current workspace', async () => {
    await setCurrentWorkspace('production', tempDir);

    const workspace = await getCurrentWorkspace(tempDir);
    expect(workspace).toBe('production');
  });

  it('overwrites previous workspace', async () => {
    await setCurrentWorkspace('staging', tempDir);
    await setCurrentWorkspace('production', tempDir);

    const workspace = await getCurrentWorkspace(tempDir);
    expect(workspace).toBe('production');
  });
});

// ============================================================================
// BackendFactory Tests
// ============================================================================

describe('BackendFactory', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    // Clear relevant env vars
    delete process.env.GAIB_BACKEND_TYPE;
    delete process.env.GAIB_S3_BUCKET;
    delete process.env.GAIB_STATE_PATH;
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('create', () => {
    it('creates LocalBackend from config', () => {
      const backend = BackendFactory.create({
        type: 'local',
        path: tempDir,
      });

      expect(backend.type).toBe('local');
      expect(backend).toBeInstanceOf(LocalBackend);
    });

    it('throws on invalid config', () => {
      expect(() =>
        BackendFactory.create({ type: 'invalid' as 'local' })
      ).toThrow(BackendConfigError);
    });
  });

  describe('fromConfig', () => {
    it('uses local backend when no config file', async () => {
      const backend = await BackendFactory.fromConfig(tempDir);

      expect(backend.type).toBe('local');
    });

    it('reads backend from config file', async () => {
      const configPath = join(tempDir, 'gaib.yaml');
      writeFileSync(
        configPath,
        `
version: "1"
name: test-project
backend:
  type: local
  path: ${tempDir}/state
`
      );

      const backend = await BackendFactory.fromConfig(tempDir);

      expect(backend.type).toBe('local');
    });
  });

  describe('fromEnvironment', () => {
    it('uses local backend by default', () => {
      const backend = BackendFactory.fromEnvironment();
      expect(backend.type).toBe('local');
    });

    it('uses local backend with GAIB_BACKEND_TYPE=local', () => {
      process.env.GAIB_BACKEND_TYPE = 'local';

      const backend = BackendFactory.fromEnvironment();
      expect(backend.type).toBe('local');
    });

    it('throws for S3 without bucket', () => {
      process.env.GAIB_BACKEND_TYPE = 's3';

      expect(() => BackendFactory.fromEnvironment()).toThrow(
        BackendConfigError
      );
    });
  });

  describe('getBackendType', () => {
    it('returns local by default', () => {
      expect(BackendFactory.getBackendType(tempDir)).toBe('local');
    });

    it('respects GAIB_BACKEND_TYPE env var', () => {
      process.env.GAIB_BACKEND_TYPE = 's3';
      expect(BackendFactory.getBackendType(tempDir)).toBe('s3');
    });

    it('infers s3 from GAIB_S3_BUCKET', () => {
      process.env.GAIB_S3_BUCKET = 'my-bucket';
      expect(BackendFactory.getBackendType(tempDir)).toBe('s3');
    });
  });
});

// ============================================================================
// findConfigFile Tests
// ============================================================================

describe('findConfigFile', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('returns null when no config file', () => {
    expect(findConfigFile(tempDir)).toBeNull();
  });

  it('finds gaib.yaml in current directory', () => {
    writeFileSync(join(tempDir, 'gaib.yaml'), 'version: "1"');

    const found = findConfigFile(tempDir);
    expect(found).toBe(join(tempDir, 'gaib.yaml'));
  });

  it('finds gaib.yml alternative', () => {
    writeFileSync(join(tempDir, 'gaib.yml'), 'version: "1"');

    const found = findConfigFile(tempDir);
    expect(found).toBe(join(tempDir, 'gaib.yml'));
  });

  it('finds .gaib.yaml alternative', () => {
    writeFileSync(join(tempDir, '.gaib.yaml'), 'version: "1"');

    const found = findConfigFile(tempDir);
    expect(found).toBe(join(tempDir, '.gaib.yaml'));
  });

  it('prefers gaib.yaml over alternatives', () => {
    writeFileSync(join(tempDir, 'gaib.yaml'), 'version: "1"');
    writeFileSync(join(tempDir, 'gaib.yml'), 'version: "1"');

    const found = findConfigFile(tempDir);
    expect(found).toBe(join(tempDir, 'gaib.yaml'));
  });

  it('searches parent directories', () => {
    const subDir = join(tempDir, 'sub', 'nested');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(tempDir, 'gaib.yaml'), 'version: "1"');

    const found = findConfigFile(subDir);
    expect(found).toBe(join(tempDir, 'gaib.yaml'));
  });
});

// ============================================================================
// Error Classes Tests
// ============================================================================

describe('Error Classes', () => {
  it('BackendError has correct properties', () => {
    const error = new BackendError('Test error', 'TEST_CODE', 'local');

    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_CODE');
    expect(error.backend).toBe('local');
    expect(error.name).toBe('BackendError');
  });

  it('StateLockError includes lock info', () => {
    const lockInfo: LockInfo = {
      id: 'lock-123',
      who: 'user@example.com',
      operation: 'apply',
      created: new Date().toISOString(),
      path: '/test/path',
    };

    const error = new StateLockError('Lock held', lockInfo, 's3');

    expect(error.lockInfo).toBe(lockInfo);
    expect(error.code).toBe('STATE_LOCKED');
    expect(error.name).toBe('StateLockError');
  });

  it('BackendConfigError has CONFIG_ERROR code', () => {
    const error = new BackendConfigError('Bad config', 's3');

    expect(error.code).toBe('CONFIG_ERROR');
    expect(error.backend).toBe('s3');
    expect(error.name).toBe('BackendConfigError');
  });
});
