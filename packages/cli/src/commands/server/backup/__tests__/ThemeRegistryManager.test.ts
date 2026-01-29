/**
 * ThemeRegistryManager Unit Tests
 *
 * Sprint 169: Theme Registry - Unit Tests
 *
 * Tests theme deployment tracking, history, and rollback operations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { gzipSync } from 'zlib';
import { createHash } from 'crypto';

import { ThemeRegistryManager } from '../ThemeRegistryManager.js';
import { SnapshotManager } from '../SnapshotManager.js';
import { BackupError } from '../types.js';
import type { ThemeRegistry, ThemeDeployment } from '../types.js';
import type { GaibState, StateBackend } from '../../iac/backends/types.js';

// ============================================================================
// Mocks
// ============================================================================

const s3Mock = mockClient(S3Client);

// Mock state backend
const createMockBackend = (state: GaibState | null): StateBackend => ({
  type: 'local' as const,
  supportsLocking: false,
  getState: vi.fn().mockResolvedValue(state),
  setState: vi.fn().mockResolvedValue(undefined),
  deleteState: vi.fn().mockResolvedValue(undefined),
  listWorkspaces: vi.fn().mockResolvedValue(['default']),
  lock: vi.fn().mockResolvedValue({ acquired: true, lockInfo: undefined }),
  unlock: vi.fn().mockResolvedValue(true),
  forceUnlock: vi.fn().mockResolvedValue(true),
  getLockInfo: vi.fn().mockResolvedValue(null),
  isConfigured: vi.fn().mockResolvedValue(true),
  close: vi.fn().mockResolvedValue(undefined),
});

// Sample registry for testing
const sampleRegistry: ThemeRegistry = {
  serverId: '1234567890',
  workspace: 'default',
  version: '1.0',
  current: {
    id: 'deploy-current',
    timestamp: '2026-01-29T14:00:00Z',
    themeName: 'sietch',
    themeVersion: '3.0.0',
    serial: 50,
    snapshotId: 'snap-current',
    action: 'apply',
    who: 'user@example.com',
  },
  history: [
    {
      id: 'deploy-prev1',
      timestamp: '2026-01-29T12:00:00Z',
      themeName: 'sietch',
      themeVersion: '2.0.0',
      serial: 42,
      snapshotId: 'snap-prev1',
      action: 'apply',
      who: 'user@example.com',
    },
    {
      id: 'deploy-prev2',
      timestamp: '2026-01-29T10:00:00Z',
      themeName: 'sietch',
      themeVersion: '1.0.0',
      serial: 30,
      snapshotId: 'snap-prev2',
      action: 'apply',
      who: 'admin@example.com',
    },
  ],
  lastUpdated: '2026-01-29T14:00:00Z',
};

const emptyRegistry: ThemeRegistry = {
  serverId: '1234567890',
  workspace: 'default',
  version: '1.0',
  current: null,
  history: [],
  lastUpdated: '2026-01-29T00:00:00Z',
};

// Sample state for snapshot restore
const sampleState: GaibState = {
  version: 1,
  serial: 42,
  lineage: 'test-lineage-123',
  workspace: 'default',
  resources: [],
  outputs: {},
  lastModified: '2026-01-29T12:00:00Z',
};

// ============================================================================
// Test Setup
// ============================================================================

describe('ThemeRegistryManager', () => {
  let manager: ThemeRegistryManager;

  beforeEach(() => {
    s3Mock.reset();
    vi.clearAllMocks();

    process.env.AWS_ACCOUNT_ID = '123456789012';
    process.env.AWS_REGION = 'us-east-1';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // getRegistry Tests
  // ============================================================================

  describe('getRegistry', () => {
    it('should load registry from S3', async () => {
      s3Mock.on(GetObjectCommand).resolves({
        Body: Readable.from(JSON.stringify(sampleRegistry)),
      });

      manager = await ThemeRegistryManager.create({
        serverId: '1234567890',
        workspace: 'default',
      });

      const registry = await manager.getRegistry();

      expect(registry.current?.themeName).toBe('sietch');
      expect(registry.current?.themeVersion).toBe('3.0.0');
      expect(registry.history).toHaveLength(2);
    });

    it('should create empty registry if not found', async () => {
      const error = new Error('NoSuchKey');
      (error as any).name = 'NoSuchKey';
      s3Mock.on(GetObjectCommand).rejects(error);

      manager = await ThemeRegistryManager.create({
        serverId: '1234567890',
        workspace: 'default',
      });

      const registry = await manager.getRegistry();

      expect(registry.current).toBeNull();
      expect(registry.history).toHaveLength(0);
    });
  });

  // ============================================================================
  // getRegistryInfo Tests
  // ============================================================================

  describe('getRegistryInfo', () => {
    it('should return current and recent history', async () => {
      s3Mock.on(GetObjectCommand).resolves({
        Body: Readable.from(JSON.stringify(sampleRegistry)),
      });

      manager = await ThemeRegistryManager.create({
        serverId: '1234567890',
        workspace: 'default',
      });

      const info = await manager.getRegistryInfo();

      expect(info.current?.themeName).toBe('sietch');
      expect(info.recentHistory).toHaveLength(2);
      expect(info.totalDeployments).toBe(3);
    });

    it('should handle empty registry', async () => {
      s3Mock.on(GetObjectCommand).resolves({
        Body: Readable.from(JSON.stringify(emptyRegistry)),
      });

      manager = await ThemeRegistryManager.create({
        serverId: '1234567890',
        workspace: 'default',
      });

      const info = await manager.getRegistryInfo();

      expect(info.current).toBeNull();
      expect(info.recentHistory).toHaveLength(0);
      expect(info.totalDeployments).toBe(0);
    });
  });

  // ============================================================================
  // recordDeployment Tests
  // ============================================================================

  describe('recordDeployment', () => {
    beforeEach(async () => {
      s3Mock.on(GetObjectCommand).resolves({
        Body: Readable.from(JSON.stringify(sampleRegistry)),
      });
      s3Mock.on(PutObjectCommand).resolves({});

      manager = await ThemeRegistryManager.create({
        serverId: '1234567890',
        workspace: 'default',
      });
    });

    it('should add new deployment and move current to history', async () => {
      const deployment = await manager.recordDeployment({
        themeName: 'sietch',
        themeVersion: '4.0.0',
        serial: 60,
        snapshotId: 'snap-new',
        action: 'apply',
        who: 'user@example.com',
      });

      expect(deployment.themeName).toBe('sietch');
      expect(deployment.themeVersion).toBe('4.0.0');
      expect(deployment.id).toBeDefined();

      const registry = await manager.getRegistry();
      expect(registry.current?.themeVersion).toBe('4.0.0');
      expect(registry.history[0].themeVersion).toBe('3.0.0'); // Previous current
    });

    it('should handle destroy action', async () => {
      await manager.recordDeployment({
        themeName: 'sietch',
        themeVersion: '3.0.0',
        serial: 51,
        action: 'destroy',
        who: 'user@example.com',
      });

      const registry = await manager.getRegistry();
      expect(registry.current).toBeNull();
      expect(registry.history[0].themeVersion).toBe('3.0.0');
    });

    it('should enforce history limit for free tier', async () => {
      // Create manager with large history
      const largeHistory: ThemeDeployment[] = [];
      for (let i = 0; i < 10; i++) {
        largeHistory.push({
          id: `deploy-${i}`,
          timestamp: `2026-01-2${i}T12:00:00Z`,
          themeName: 'sietch',
          themeVersion: `1.${i}.0`,
          serial: i,
          action: 'apply',
          who: 'user@example.com',
        });
      }

      const largeRegistry: ThemeRegistry = {
        ...sampleRegistry,
        history: largeHistory,
      };

      s3Mock.on(GetObjectCommand).resolves({
        Body: Readable.from(JSON.stringify(largeRegistry)),
      });

      manager = await ThemeRegistryManager.create({
        serverId: '1234567890',
        workspace: 'default',
        tier: 'free',
      });

      await manager.recordDeployment({
        themeName: 'sietch',
        themeVersion: '5.0.0',
        serial: 100,
        action: 'apply',
        who: 'user@example.com',
      });

      const registry = await manager.getRegistry();
      expect(registry.history.length).toBeLessThanOrEqual(5); // Free tier limit
    });

    it('should write audit entry', async () => {
      await manager.recordDeployment({
        themeName: 'sietch',
        themeVersion: '4.0.0',
        serial: 60,
        action: 'apply',
        who: 'user@example.com',
      });

      // Should have 2 puts: registry + audit
      const putCalls = s3Mock.commandCalls(PutObjectCommand);
      expect(putCalls.length).toBeGreaterThanOrEqual(2);

      const auditCall = putCalls.find((call) =>
        (call.args[0].input.Key as string).includes('audit/')
      );
      expect(auditCall).toBeDefined();
    });
  });

  // ============================================================================
  // rollback Tests
  // ============================================================================

  describe('rollback', () => {
    beforeEach(async () => {
      s3Mock.on(GetObjectCommand).resolves({
        Body: Readable.from(JSON.stringify(sampleRegistry)),
      });
      s3Mock.on(PutObjectCommand).resolves({});

      manager = await ThemeRegistryManager.create({
        serverId: '1234567890',
        workspace: 'default',
      });
    });

    it('should find correct target with steps', async () => {
      const result = await manager.rollback({
        steps: 1,
        dryRun: true,
      });

      expect(result.dryRun).toBe(true);
      expect(result.from?.themeVersion).toBe('3.0.0');
      expect(result.to.themeVersion).toBe('2.0.0');
    });

    it('should find specific deployment by ID', async () => {
      const result = await manager.rollback({
        toDeploymentId: 'deploy-prev2',
        dryRun: true,
      });

      expect(result.to.id).toBe('deploy-prev2');
      expect(result.to.themeVersion).toBe('1.0.0');
    });

    it('should throw error if deployment not found', async () => {
      await expect(
        manager.rollback({
          toDeploymentId: 'nonexistent',
          dryRun: true,
        })
      ).rejects.toThrow(BackupError);
    });

    it('should throw error if no snapshot available', async () => {
      const registryNoSnapshot: ThemeRegistry = {
        ...sampleRegistry,
        history: [
          {
            ...sampleRegistry.history[0],
            snapshotId: undefined, // No snapshot
          },
        ],
      };

      s3Mock.on(GetObjectCommand).resolves({
        Body: Readable.from(JSON.stringify(registryNoSnapshot)),
      });

      manager = await ThemeRegistryManager.create({
        serverId: '1234567890',
        workspace: 'default',
      });

      await expect(
        manager.rollback({
          steps: 1,
          dryRun: false,
        })
      ).rejects.toThrow('no associated snapshot');
    });

    it('should throw error if steps exceed history', async () => {
      await expect(
        manager.rollback({
          steps: 10,
          dryRun: true,
        })
      ).rejects.toThrow('Cannot rollback 10 steps');
    });

    it('should perform actual rollback with snapshot manager', async () => {
      // Mock snapshot manager
      const mockSnapshotManager = {
        restoreSnapshot: vi.fn().mockResolvedValue({
          dryRun: false,
          manifest: { serial: 42 },
          state: sampleState,
        }),
      } as unknown as SnapshotManager;

      manager.setSnapshotManager(mockSnapshotManager);

      const result = await manager.rollback({
        steps: 1,
        dryRun: false,
      });

      expect(result.dryRun).toBe(false);
      expect(mockSnapshotManager.restoreSnapshot).toHaveBeenCalledWith(
        'snap-prev1',
        { dryRun: false }
      );

      // Should record rollback as new deployment
      const registry = await manager.getRegistry();
      expect(registry.current?.action).toBe('rollback');
    });

    it('should throw error if snapshot manager not configured for actual rollback', async () => {
      await expect(
        manager.rollback({
          steps: 1,
          dryRun: false,
        })
      ).rejects.toThrow('Snapshot manager not configured');
    });
  });

  // ============================================================================
  // getHistory Tests
  // ============================================================================

  describe('getHistory', () => {
    beforeEach(async () => {
      s3Mock.on(GetObjectCommand).resolves({
        Body: Readable.from(JSON.stringify(sampleRegistry)),
      });

      manager = await ThemeRegistryManager.create({
        serverId: '1234567890',
        workspace: 'default',
      });
    });

    it('should return all deployments including current', async () => {
      const history = await manager.getHistory();

      expect(history).toHaveLength(3);
      expect(history[0].themeVersion).toBe('3.0.0'); // Current
      expect(history[1].themeVersion).toBe('2.0.0'); // History[0]
      expect(history[2].themeVersion).toBe('1.0.0'); // History[1]
    });

    it('should respect limit parameter', async () => {
      const history = await manager.getHistory({ limit: 2 });

      expect(history).toHaveLength(2);
    });
  });

  // ============================================================================
  // findDeployment Tests
  // ============================================================================

  describe('findDeployment', () => {
    beforeEach(async () => {
      s3Mock.on(GetObjectCommand).resolves({
        Body: Readable.from(JSON.stringify(sampleRegistry)),
      });

      manager = await ThemeRegistryManager.create({
        serverId: '1234567890',
        workspace: 'default',
      });
    });

    it('should find current deployment', async () => {
      const deployment = await manager.findDeployment('deploy-current');
      expect(deployment?.themeVersion).toBe('3.0.0');
    });

    it('should find deployment in history', async () => {
      const deployment = await manager.findDeployment('deploy-prev2');
      expect(deployment?.themeVersion).toBe('1.0.0');
    });

    it('should return null for unknown deployment', async () => {
      const deployment = await manager.findDeployment('nonexistent');
      expect(deployment).toBeNull();
    });
  });
});
